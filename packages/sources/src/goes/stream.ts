import { AbiFile } from '@edgewarn/web-utils/goes';
import type { AbiGrid, AbiReadOptions, ByteSource, ReadPlan } from '@edgewarn/web-utils/goes';
import { unbound } from './http-source.ts';

/** One chunk's reference, derived from the read plan. */
type ChunkRef = ReadPlan['needed'][number];

export interface StreamAbiOptions extends Pick<AbiReadOptions, 'variable' | 'rows' | 'cols' | 'stride' | 'output' | 'signal' | 'inflate'> {
    /** Object size in bytes (e.g. from the bucket listing). Without it the file arrives as one stream. */
    size?: number;
    /** Target bytes per parallel stream. Default 4 MiB: one S3 connection tops out near 20 MB/s. */
    bytesPerStream?: number;
    /**
     * Most streams opened at once. Default 6: S3 speaks HTTP/1.1 and browsers allow 6 connections
     * per host, so more would only queue there (Node has no such cap; 16 streams cut C02 further).
     */
    maxStreams?: number;
    /** Bytes of stream 0 parsed as metadata before chunks are routed. Default 256 KiB. */
    headBytes?: number;
    fetcher?: typeof fetch;
}

const DEFAULT_HEAD_BYTES = 256 * 1024;
const DEFAULT_BYTES_PER_STREAM = 4 << 20;
const DEFAULT_MAX_STREAMS = 6;

/**
 * Decode a whole ABI image while the file streams in. Every request starts at once: the file is
 * split into contiguous ranges, metadata is parsed from the head of stream 0 as it arrives, and
 * each chunk is decoded the moment its last byte lands. The other streams are not read until the
 * chunk index is known, so their bytes wait in the socket rather than on the JS heap.
 *
 * Unlike `AbiFile.read()`, this downloads the whole file, so use it for full frames; use
 * `read()` for windows and strides that can skip chunks.
 */
export async function streamAbi(url: string, options: StreamAbiOptions = {}): Promise<AbiGrid> {
    const { signal, size } = options;
    const fetcher = options.fetcher ?? globalThis.fetch;
    const headBytes = options.headBytes ?? DEFAULT_HEAD_BYTES;
    const net = { requests: 0, bytesFetched: 0 };

    const open = async (start: number, end: number | null) => {
        net.requests++;
        const res = await fetcher(url, { headers: { Range: `bytes=${start}-${end === null ? '' : end - 1}` }, signal });
        // 200 means the server ignored Range; that is only usable for a stream starting at 0.
        if (!res.body || !(res.status === 206 || (res.status === 200 && start === 0))) {
            throw new Error(`GOES stream request failed: HTTP ${res.status} for ${url}`);
        }
        return res.body.getReader();
    };

    // Contiguous ranges covering the file, all requested now.
    const n = size ? Math.max(1, Math.min(options.maxStreams ?? DEFAULT_MAX_STREAMS, Math.ceil(size / (options.bytesPerStream ?? DEFAULT_BYTES_PER_STREAM)))) : 1;
    const ranges = Array.from({ length: n }, (_, i) => ({
        start: size ? Math.round((i * size) / n) : 0,
        end: size ? Math.round(((i + 1) * size) / n) : Infinity,
    }));
    const readers = ranges.map((r) => open(r.start, Number.isFinite(r.end) ? r.end : null));
    readers.forEach((p) => p.catch(() => {}));
    const cancelAll = () => readers.forEach((p) => p.then((rd) => rd.cancel().catch(() => {}), () => {}));

    try {
        // Head of stream 0: the metadata. Keep whatever spills past it for chunk routing.
        const r0 = await readers[0];
        const headLen = Math.min(headBytes, ranges[0].end - ranges[0].start);
        const head = new Uint8Array(headLen);
        let got = 0;
        let spill: Uint8Array | null = null;
        while (got < headLen) {
            const { value, done } = await r0.read();
            if (done) break;
            net.bytesFetched += value.length;
            const k = Math.min(value.length, headLen - got);
            head.set(value.subarray(0, k), got);
            got += k;
            if (k < value.length) spill = value.subarray(k);
        }

        const file = await AbiFile.open(new HeadSource(head.subarray(0, got), url, fetcher, net, signal));
        const plan = await file.prepare(options);

        const straddlers: Straddlers = new Map();
        await Promise.all(ranges.map(async (range, i) => {
            const feed = makeFeeder(plan, straddlers, range.start, range.end);
            const rd = await readers[i];
            if (i === 0) {
                await feed(0, head.subarray(0, got));
                if (spill) await feed(got, spill);
            }
            let pos = i === 0 ? got + (spill?.length ?? 0) : range.start;
            for (;;) {
                signal?.throwIfAborted();
                const { value, done } = await rd.read();
                if (done) break;
                net.bytesFetched += value.length;
                await feed(pos, value);
                pos += value.length;
            }
        }));
        return plan.finish(net);
    } catch (err) {
        cancelAll();
        throw err;
    }
}

/** Chunks that cross a stream boundary, assembled from both sides. */
type Straddlers = Map<ChunkRef, { buf: Uint8Array; filled: number }>;

/**
 * Route pieces of one stream (covering file bytes [start, end)) to the chunks they belong to,
 * decoding each chunk once complete. Chunks wholly inside the range are assembled in one staging
 * buffer (pieces arrive in order); a chunk straddling two streams gets its own buffer in `shared`
 * and is decoded by whichever stream delivers its last byte.
 */
function makeFeeder(plan: ReadPlan, shared: Straddlers, start: number, end: number) {
    const chunks = plan.needed;
    const scratch = new Uint8Array(plan.chunkBytes);
    const staging = new Uint8Array(plan.maxStored);
    let ci = 0;
    while (ci < chunks.length && chunks[ci].address + chunks[ci].size <= start) ci++;
    let filled = 0;

    return async (pos: number, piece: Uint8Array): Promise<void> => {
        const pieceEnd = pos + piece.length;
        while (ci < chunks.length && chunks[ci].address < pieceEnd) {
            const c = chunks[ci];
            const cEnd = c.address + c.size;
            if (c.address >= end) { ci = chunks.length; return; }
            const a = Math.max(pos, c.address), b = Math.min(pieceEnd, cEnd);
            if (b > a) {
                const part = piece.subarray(a - pos, b - pos);
                if (c.address >= start && cEnd <= end) {
                    if (a === c.address && b === cEnd) {
                        await plan.decode(c, part, scratch);
                    } else {
                        staging.set(part, a - c.address);
                        filled += part.length;
                        if (filled === c.size) { await plan.decode(c, staging.subarray(0, c.size), scratch); filled = 0; }
                    }
                } else {
                    let s = shared.get(c);
                    if (!s) { s = { buf: new Uint8Array(c.size), filled: 0 }; shared.set(c, s); }
                    s.buf.set(part, a - c.address);
                    s.filled += part.length;
                    if (s.filled === c.size) { shared.delete(c); await plan.decode(c, s.buf, scratch); }
                }
            }
            if (cEnd > pieceEnd) return; // rest of this chunk comes in a later piece (or stream)
            ci++;
        }
    };
}

/** Serves metadata from the streamed head; anything outside it (B-tree leaves) is a ranged GET. */
class HeadSource implements ByteSource {
    private head: Uint8Array;
    private url: string;
    private fetcher: typeof fetch;
    private net: { requests: number; bytesFetched: number };
    private signal?: AbortSignal;

    constructor(head: Uint8Array, url: string, fetcher: typeof fetch, net: { requests: number; bytesFetched: number }, signal?: AbortSignal) {
        this.head = head;
        this.url = url;
        this.fetcher = unbound(fetcher);
        this.net = net;
        this.signal = signal;
    }

    get requests(): number { return this.net.requests; }
    get bytesFetched(): number { return this.net.bytesFetched; }

    async read(offset: number, length: number): Promise<Uint8Array> {
        if (offset + length <= this.head.length) return this.head.subarray(offset, offset + length);
        this.net.requests++;
        const res = await this.fetcher(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal: this.signal });
        if (res.status !== 206 && res.status !== 200) throw new Error(`GOES range request failed: HTTP ${res.status} for ${this.url}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        this.net.bytesFetched += buf.length;
        return res.status === 200 ? buf.subarray(offset, offset + length) : buf;
    }
}
