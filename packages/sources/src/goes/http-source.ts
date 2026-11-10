import type { ByteSource } from '@edgewarn/web-utils/goes';

/**
 * Fetch policy for the GOES byte sources: retry-free ranged GETs with a
 * head block and aligned read-ahead blocks. Implemented over the package's
 * `ByteSource` interface, which stays a pure reader. Browsers throw
 * "Illegal invocation" when the global fetch is called as a method of another
 * object (`this.fetcher(...)`), so stored fetchers are wrapped to be called
 * plainly.
 */
export const unbound = (f: typeof fetch): typeof fetch => (input, init) => f(input, init);

const DEFAULT_HEAD_BYTES = 256 * 1024;

/** A non-2xx answer from the bucket; `status` tells retryable server trouble from a missing file. */
export class GoesHttpError extends Error {
    status: number;
    constructor(status: number, url: string) {
        super(`GOES request failed: HTTP ${status} for ${url}`);
        this.name = 'GoesHttpError';
        this.status = status;
    }
}

export interface ReadAheadSourceOptions {
    /** Bytes fetched by the first request. 256 KiB holds every CMIP header; MCMIP's run to ~2.6 MB. */
    headBytes?: number;
    /** A metadata read that misses the head fetches the aligned block around it. Default 512 KiB. */
    blockBytes?: number;
    /** Blocks kept (LRU). Default 8. */
    maxBlocks?: number;
    fetcher?: typeof fetch;
}

const DEFAULT_BLOCK_BYTES = 512 * 1024;
const DEFAULT_MAX_BLOCKS = 8;

/**
 * Range reads that answer metadata from a head block plus aligned read-ahead blocks. The HDF5
 * reader asks for many small slices (object headers, heaps, B-tree nodes); MCMIP spreads them over
 * the first few MB, so exact-range reads would cost hundreds of round trips. Data ranges are streamed
 * and never buffered. `release()` drops every buffer once the caller has the metadata it needs.
 */
export class ReadAheadSource implements ByteSource {
    bytesFetched = 0;
    requests = 0;
    private head: Promise<Uint8Array> | null = null;
    // Insertion order is the LRU order; a source is short-lived, so entries need no age limit.
    private blocks = new Map<number, Promise<Uint8Array>>();
    private headBytes: number;
    private blockBytes: number;
    private maxBlocks: number;
    private fetcher: typeof fetch;
    private url: string;

    constructor(url: string, options: ReadAheadSourceOptions = {}) {
        this.url = url;
        this.headBytes = options.headBytes ?? DEFAULT_HEAD_BYTES;
        this.blockBytes = options.blockBytes ?? DEFAULT_BLOCK_BYTES;
        this.maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
        this.fetcher = unbound(options.fetcher ?? globalThis.fetch);
    }

    /** Buffered bytes right now (head plus blocks); 0 after `release()`. */
    get bufferedBlocks(): number { return this.blocks.size + (this.head ? 1 : 0); }

    private async fetchRange(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
        this.requests++;
        const res = await this.fetcher(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal });
        if (res.status !== 206 && res.status !== 200) throw new GoesHttpError(res.status, this.url);
        const buf = new Uint8Array(await res.arrayBuffer());
        this.bytesFetched += buf.length;
        // A server that ignores Range sends the whole object; a range past the end comes back short.
        return res.status === 200 ? buf.subarray(offset, offset + length) : buf;
    }

    /** The head block, fetched once; a failed fetch (aborted first caller, 503) is dropped so the next read retries. */
    private headBlock(signal?: AbortSignal): Promise<Uint8Array> {
        if (!this.head) {
            const p = this.fetchRange(0, this.headBytes, signal);
            p.catch(() => { if (this.head === p) this.head = null; });
            this.head = p;
        }
        return this.head;
    }

    private block(index: number, signal?: AbortSignal): Promise<Uint8Array> {
        let p = this.blocks.get(index);
        if (p) {
            this.blocks.delete(index); // refresh LRU position
        } else {
            p = this.fetchRange(index * this.blockBytes, this.blockBytes, signal);
            p.catch(() => this.blocks.delete(index));
        }
        this.blocks.set(index, p);
        while (this.blocks.size > this.maxBlocks) this.blocks.delete(this.blocks.keys().next().value!);
        return p;
    }

    async read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
        const head = await this.headBlock(signal);
        if (offset + length <= head.length) return head.subarray(offset, offset + length);
        const first = Math.floor(offset / this.blockBytes), last = Math.floor((offset + length - 1) / this.blockBytes);
        if (first === last) {
            const b = await this.block(first, signal);
            const at = offset - first * this.blockBytes;
            if (at + length > b.length) throw new RangeError(`Read past end of ${this.url}: ${offset}+${length}`);
            return b.subarray(at, at + length);
        }
        const out = new Uint8Array(length);
        const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, i) => this.block(first + i, signal)));
        let filled = 0;
        parts.forEach((b, i) => {
            const blockStart = (first + i) * this.blockBytes;
            const from = Math.max(0, offset - blockStart), to = Math.min(b.length, offset + length - blockStart);
            out.set(b.subarray(from, to), filled);
            filled += to - from;
        });
        if (filled !== length) throw new RangeError(`Read past end of ${this.url}: ${offset}+${length}`);
        return out;
    }

    stream(offset: number, length: number, signal?: AbortSignal): AsyncIterable<Uint8Array> {
        return streamRange(this.fetcher, this.url, offset, length, (n) => { this.requests += n ? 0 : 1; this.bytesFetched += n; }, signal);
    }

    release(): void {
        this.head = null;
        this.blocks.clear();
    }
}

/** Stream one ranged GET; `count(0)` marks the request, `count(n)` each piece's bytes. */
async function* streamRange(
    fetcher: typeof fetch, url: string, offset: number, length: number, count: (n: number) => void, signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
    count(0);
    const res = await fetcher(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal });
    if ((res.status !== 206 && res.status !== 200) || !res.body) throw new GoesHttpError(res.status, url);
    let skip = res.status === 200 ? offset : 0, left = length;
    const reader = res.body.getReader();
    try {
        while (left > 0) {
            const { value, done } = await reader.read();
            if (done) throw new Error(`GOES range response ended ${left} bytes early for ${url}`);
            count(value.length);
            let piece = value;
            if (skip) { const k = Math.min(skip, piece.length); skip -= k; piece = piece.subarray(k); }
            if (piece.length > left) piece = piece.subarray(0, left);
            left -= piece.length;
            if (piece.length) yield piece;
        }
    } finally {
        reader.cancel().catch(() => {});
    }
}
