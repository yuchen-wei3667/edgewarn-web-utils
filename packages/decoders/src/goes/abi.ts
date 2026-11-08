import { Memory } from '../internal/memory.ts';
import { decodeValues, Hdf5File, Hdf5FormatError, parseDatatype } from './hdf5.ts';
import type { AttrValue, ChunkRef, Datatype, Filter, Layout } from './hdf5.ts';
import { inflate, INFLATE_WORKSPACE_BYTES } from './inflate.ts';
import type { ByteSource } from './source.ts';

const FILTER_DEFLATE = 1;
const FILTER_SHUFFLE = 2;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

export interface AbiProjection {
    perspectivePointHeight: number;
    semiMajorAxis: number;
    semiMinorAxis: number;
    longitudeOfProjectionOrigin: number;
    sweepAngleAxis: string;
}

export interface AbiReadOptions {
    /** Dataset to read; defaults to `Rad` (L1b) or `CMI` (L2 CMIP). */
    variable?: string;
    /** Half-open source row window [start, end). Defaults to every row. */
    rows?: [number, number];
    /** Half-open source column window [start, end). Defaults to every column. */
    cols?: [number, number];
    /** Keep every `stride`-th row and column (nearest-neighbour decimation). Default 1. */
    stride?: number;
    /** Reuse a buffer across frames; must hold at least width × height elements. */
    output?: Uint16Array | Uint8Array;
    signal?: AbortSignal;
    /** Largest single ranged GET when coalescing adjacent chunks. Batches are streamed, so this bounds requests, not memory. Default 16 MiB. */
    maxBatchBytes?: number;
    /** Unneeded bytes fetched to bridge chunks skipped by a stride, rather than split a batch. Default 256 KiB. */
    maxGapBytes?: number;
    fetchConcurrency?: number;
    /**
     * `js` (default): the built-in synchronous inflater, which decodes into a reused buffer and
     * allocates nothing per chunk. `native`: DecompressionStream, about 2× faster but it allocates
     * every output piece, so peak memory follows the garbage collector rather than the window.
     */
    inflate?: 'js' | 'native';
}

export interface AbiGrid {
    variable: string;
    width: number;
    height: number;
    /** Raw stored codes, row-major, north row first. Physical value = code × scale + offset. */
    data: Uint16Array | Uint8Array;
    scale: number;
    offset: number;
    /** Code marking missing pixels (already reinterpreted as unsigned), or null if none. */
    fill: number | null;
    units: string;
    stride: number;
    rows: [number, number];
    cols: [number, number];
    /** Fixed-grid scan angles (radians) of output column 0 / row 0 and the step between outputs. */
    x: { start: number; step: number };
    y: { start: number; step: number };
    projection: AbiProjection;
    /** Scan mid-point, ISO-8601. */
    time: string;
    stats: { chunksDecoded: number; chunksSkipped: number; requests: number; bytesFetched: number; bytesInflated: number };
}

/** Everything about an image variable except its pixels. */
export interface AbiGridInfo {
    variable: string;
    width: number;
    height: number;
    chunkRows: number;
    scale: number;
    offset: number;
    fill: number | null;
    units: string;
    /** Scan angles (radians) of pixel 0's centre and the step between pixels. */
    x: { start: number; step: number };
    y: { start: number; step: number };
    projection: AbiProjection;
    time: string;
}

/** One contiguous run of chunk bytes, as planned by `AbiFile.bandRange`. */
export interface AbiByteRange {
    start: number;
    end: number;
    /** Sorted by address, which is also row order. */
    chunks: ChunkRef[];
    /** Stable name for caching: the variable plus the band or chunk it holds. */
    key: string;
}

/** Receives decoded rows in ascending order. `codes` holds `count` rows of `width` codes. */
export interface AbiRowSink {
    rows(y0: number, codes: Uint16Array, width: number, count: number): void;
}

interface VarMeta {
    name: string;
    dims: number[];
    dtype: Datatype;
    layout: Layout;
    filters: Filter[];
    attrs: Map<string, AttrValue>;
    chunks?: ChunkRef[];
}

const num = (v: AttrValue | undefined, fallback: number) => (Array.isArray(v) && v.length ? v[0] : fallback);
const str = (v: AttrValue | undefined) => (typeof v === 'string' ? v : '');

/**
 * A GOES-R ABI L1b/L2 NetCDF-4 file opened for windowed reads. Metadata (links, attributes, chunk
 * index) is parsed once and cached, so repeated reads over pans and zooms cost only the chunks
 * they touch.
 */
export interface AbiDependencies {
    createMetadataCache?: <V>() => Map<string, V>;
}

export class AbiFile {
    readonly links: Map<string, number>;
    private h5: Hdf5File;
    private src: ByteSource;
    private vars: Map<string, Promise<VarMeta>>;
    private memory: Memory;

    private constructor(h5: Hdf5File, src: ByteSource, links: Map<string, number>, deps: AbiDependencies, memory: Memory) {
        this.memory = memory;
        memory.reserve(INFLATE_WORKSPACE_BYTES);
        this.vars = deps.createMetadataCache?.<Promise<VarMeta>>() ?? new Map();
        this.h5 = h5;
        this.src = src;
        this.links = links;
    }

    static open(src: ByteSource, signal?: AbortSignal, deps?: AbiDependencies): Promise<AbiFile>;
    /** @internal */
    static open(src: ByteSource, signal?: AbortSignal, deps?: AbiDependencies, memory?: Memory): Promise<AbiFile>;
    static async open(src: ByteSource, signal?: AbortSignal, deps: AbiDependencies = {}, memory = new Memory()): Promise<AbiFile> {
        const h5 = await Hdf5File.open(src, signal);
        return new AbiFile(h5, src, await h5.links(), deps, memory);
    }

    private meta(name: string): Promise<VarMeta> {
        let p = this.vars.get(name);
        if (!p) {
            p = this.loadMeta(name);
            p.catch(() => this.vars.delete(name));
            this.vars.set(name, p);
        }
        return p;
    }

    private async loadMeta(name: string): Promise<VarMeta> {
        const addr = this.links.get(name);
        if (addr === undefined) throw new Error(`Variable ${name} not found`);
        const msgs = await this.h5.messages(addr);
        let dims: number[] | null = null, dtype: Datatype | null = null, layout: Layout | null = null;
        let filters: Filter[] = [];
        for (const m of msgs) {
            if (m.type === 0x01) dims = this.h5.parseDataspace(m.body);
            else if (m.type === 0x03) dtype = parseDatatype(m.body);
            else if (m.type === 0x08) layout = this.h5.parseLayout(m.body);
            else if (m.type === 0x0b) filters = this.h5.parseFilters(m.body);
        }
        if (!dims || !dtype || !layout) throw new Hdf5FormatError(`${name} is missing its dataspace, datatype or layout`);
        return { name, dims, dtype, layout, filters, attrs: await this.h5.attributes(msgs) };
    }

    async attributes(name: string): Promise<Map<string, AttrValue>> {
        return (await this.meta(name)).attrs;
    }

    /** Elements [start, start + count) of an unfiltered contiguous/compact variable (coordinates, scalars). */
    private async readSmall(name: string, start = 0, count?: number): Promise<number[]> {
        const m = await this.meta(name);
        const total = m.dims.reduce((a, d) => a * d, 1);
        const n = count ?? total - start;
        const es = m.dtype.size;
        let bytes: Uint8Array;
        if (m.layout.kind === 'compact') bytes = m.layout.data.subarray(start * es, (start + n) * es);
        else if (m.layout.kind === 'contiguous') bytes = await this.h5.read(m.layout.address + start * es, n * es);
        else throw new Error(`${name} is chunked; readSmall only handles contiguous data`);
        return decodeValues(bytes, m.dtype, n) as number[];
    }

    private async axis(name: string, start: number, stride: number): Promise<{ start: number; step: number }> {
        const m = await this.meta(name);
        const scale = num(m.attrs.get('scale_factor'), 1), offset = num(m.attrs.get('add_offset'), 0);
        const raw = await this.readSmall(name, start, Math.min(2, m.dims[0] - start));
        const delta = raw.length > 1 ? raw[1] - raw[0] : 1;
        return { start: raw[0] * scale + offset, step: delta * scale * stride };
    }

    /** A scalar variable's value, e.g. `planck_fk1` or `kappa0`; NaN if the file lacks it. */
    async scalar(name: string): Promise<number> {
        if (!this.links.has(name)) return NaN;
        const [v] = await this.readSmall(name, 0, 1);
        return v;
    }

    async projection(): Promise<AbiProjection> {
        const a = await this.attributes('goes_imager_projection');
        return {
            perspectivePointHeight: num(a.get('perspective_point_height'), NaN),
            semiMajorAxis: num(a.get('semi_major_axis'), NaN),
            semiMinorAxis: num(a.get('semi_minor_axis'), NaN),
            longitudeOfProjectionOrigin: num(a.get('longitude_of_projection_origin'), NaN),
            sweepAngleAxis: str(a.get('sweep_angle_axis')),
        };
    }

    async time(): Promise<string> {
        const [t] = await this.readSmall('t');
        return new Date(J2000_MS + t * 1000).toISOString();
    }

    /**
     * Decode a window of a 2-D image variable into raw codes. Only chunks containing a sampled row
     * and column are fetched; adjacent chunks share one streamed ranged GET; each chunk is inflated
     * into a reused scratch buffer and un-shuffled straight into the output. Peak memory is the
     * output plus two chunk-sized buffers per concurrent stream.
     */
    async read(options: AbiReadOptions = {}): Promise<AbiGrid> {
        const controller = new AbortController();
        const signal = controller.signal;
        const onAbort = () => controller.abort(options.signal?.reason);
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });
        try {
        signal.throwIfAborted();
        const plan = await this.prepare(options);
        const before = { requests: this.src.requests, bytes: this.src.bytesFetched };
        const batches = planBatches(plan.needed, options.maxBatchBytes ?? 16 << 20, options.maxGapBytes ?? 256 << 10);

        // Each worker streams one batch at a time and owns two buffers: the inflate target and a
        // staging area for a chunk that straddles stream pieces. Chunks inside one piece decode in place.
        await forEachLimit(batches, Math.max(1, options.fetchConcurrency ?? 3), () => {
            const scratch = this.memory.array(Uint8Array, plan.chunkBytes);
            const staging = this.memory.array(Uint8Array, plan.maxStored);
            return async (batch) => {
                signal?.throwIfAborted();
                const start = batch[0].address;
                const last = batch[batch.length - 1];
                let pos = start, ci = 0, filled = 0;
                for await (const piece of this.h5.stream(start, last.address + last.size - start, signal)) {
                    let off = 0;
                    while (off < piece.length && ci < batch.length) {
                        const c = batch[ci];
                        if (pos < c.address) { const k = Math.min(c.address - pos, piece.length - off); off += k; pos += k; continue; }
                        const k = Math.min(c.size - filled, piece.length - off);
                        if (filled === 0 && k === c.size) {
                            await plan.decode(c, piece.subarray(off, off + k), scratch);
                        } else {
                            staging.set(piece.subarray(off, off + k), filled);
                            filled += k;
                            if (filled === c.size) { await plan.decode(c, staging.subarray(0, c.size), scratch); filled = 0; }
                        }
                        off += k; pos += k;
                        if (filled === 0) ci++;
                    }
                }
                if (ci < batch.length) throw new Hdf5FormatError(`Batch at ${start} ended before chunk ${ci} of ${batch.length}`);
            };
        }, (error) => controller.abort(error));
        return await plan.finish({ requests: this.src.requests - before.requests, bytesFetched: this.src.bytesFetched - before.bytes });
        } finally {
            options.signal?.removeEventListener('abort', onAbort);
        }
    }

    /** Drop the source's buffered head and blocks. Parsed metadata (links, attributes, chunk index) stays. */
    release(): void {
        this.src.release?.();
    }

    /** Size, packing, fixed-grid axes and projection of a 2-D image variable, without reading pixels. */
    async gridInfo(variable: string): Promise<AbiGridInfo> {
        const m = await this.imageMeta(variable);
        const es = m.dtype.size;
        const unsigned = str(m.attrs.get('_Unsigned')) === 'true';
        const rawFill = m.attrs.get('_FillValue');
        const fill = Array.isArray(rawFill) && rawFill.length ? (unsigned ? rawFill[0] & ((1 << (8 * es)) - 1) : rawFill[0]) : null;
        // MCMIP names its axes per band only at the file level, so x/y are shared by every variable.
        const [x, y, projection, time] = await Promise.all([this.axis('x', 0, 1), this.axis('y', 0, 1), this.projection(), this.time()]);
        const [height, width] = m.dims;
        const layout = m.layout as Extract<Layout, { kind: 'chunked' }>;
        return {
            variable, width, height, chunkRows: layout.chunk[0],
            scale: num(m.attrs.get('scale_factor'), 1), offset: num(m.attrs.get('add_offset'), 0), fill,
            units: str(m.attrs.get('units')), x, y, projection, time,
        };
    }

    /**
     * File byte ranges holding the chunks that cover rows [r0, r1), in row order. Chunks are grouped
     * into cache-friendly units: every chunk of a fully needed `bandRows` band shares one range (its
     * key names the band), and chunks of partly needed bands (halo rows) get a range each. A range
     * never spans chunks whose addresses fall as rows rise, so pieces always arrive in row order.
     */
    async bandRange(variable: string, rows: [number, number], options: { bandRows?: number } = {}): Promise<AbiByteRange[]> {
        const m = await this.imageMeta(variable);
        const layout = m.layout as Extract<Layout, { kind: 'chunked' }>;
        m.chunks ??= await this.h5.chunkIndex(layout.btree, 2);
        const [H] = m.dims;
        const ch = layout.chunk[0];
        const r0 = Math.max(0, rows[0]), r1 = Math.min(H, rows[1]);
        if (r1 <= r0) throw new RangeError('Empty row window');
        const B = Math.max(ch, options.bandRows ?? H);
        const byRow = [...m.chunks].sort((a, b) => a.offset[0] - b.offset[0]);
        const needed = byRow.filter((c) => c.offset[0] < r1 && c.offset[0] + ch > r0);
        const bandOf = (c: ChunkRef) => Math.floor(c.offset[0] / B);
        const fullBands = new Set<number>();
        for (const band of new Set(needed.map(bandOf))) {
            if (byRow.every((c) => bandOf(c) !== band || (c.offset[0] < r1 && c.offset[0] + ch > r0))) fullBands.add(band);
        }
        const out: AbiByteRange[] = [];
        let cur: ChunkRef[] = [], curKey = '';
        const flush = () => {
            if (!cur.length) return;
            const last = cur[cur.length - 1];
            out.push({ start: cur[0].address, end: last.address + last.size, chunks: cur, key: `${variable}/${curKey}@${cur[0].address}` });
            cur = [];
        };
        for (const c of needed) {
            const key = fullBands.has(bandOf(c)) ? `b${bandOf(c)}` : `c${c.address}`;
            const prev = cur[cur.length - 1];
            if (cur.length && (key !== curKey || c.address < prev.address + prev.size)) flush();
            if (!cur.length) curKey = key;
            cur.push(c);
        }
        flush();
        return out;
    }

    /**
     * Decode rows [r0, r1) of a full-width-strip image from caller-supplied bytes, handing each
     * chunk's rows to `sink` in row order. `open(range)` yields the bytes of one `bandRange` result as
     * pieces of any size (cache or network). One inflate buffer, one staging buffer and one row
     * buffer are reused throughout; the row view passed to the sink is only valid during the call.
     */
    async readRows(
        variable: string, rows: [number, number], sink: AbiRowSink,
        open: (range: AbiByteRange) => AsyncIterable<Uint8Array>,
        options: { signal?: AbortSignal; bandRows?: number; ranges?: AbiByteRange[] } = {},
    ): Promise<{ chunksDecoded: number; bytesInflated: number }> {
        const { signal } = options;
        const m = await this.imageMeta(variable);
        const layout = m.layout as Extract<Layout, { kind: 'chunked' }>;
        const [H, W] = m.dims;
        const [ch, cw] = layout.chunk;
        const es = m.dtype.size;
        const ranges = options.ranges ?? await this.bandRange(variable, rows, { bandRows: options.bandRows });
        const r0 = Math.max(0, rows[0]), r1 = Math.min(H, rows[1]);
        const chunkBytes = ch * cw * es;
        const maxStored = ranges.reduce((mx, r) => r.chunks.reduce((a, c) => Math.max(a, c.size), mx), 0);
        const scratch = this.memory.array(Uint8Array, chunkBytes);
        const staging = this.memory.array(Uint8Array, maxStored);
        const rowBuf = this.memory.array(Uint16Array, ch * W);
        const shuffleIdx = m.filters.findIndex((f) => f.id === FILTER_SHUFFLE);
        const deflateIdx = m.filters.findIndex((f) => f.id === FILTER_DEFLATE);
        let chunksDecoded = 0, bytesInflated = 0;

        const decode = (c: ChunkRef, raw: Uint8Array) => {
            let plain = raw;
            if (deflateIdx >= 0 && !(c.filterMask & (1 << deflateIdx))) {
                const n = inflate(raw, scratch);
                if (n !== chunkBytes) throw new Hdf5FormatError(`Chunk at ${c.address} inflated to ${n} bytes, expected ${chunkBytes}`);
                bytesInflated += n;
                plain = scratch;
            }
            const shuffled = es > 1 && shuffleIdx >= 0 && !(c.filterMask & (1 << shuffleIdx));
            const cr = c.offset[0];
            const a = Math.max(cr, r0), b = Math.min(cr + ch, r1);
            if (b <= a) return;
            const plane = ch * cw;
            for (let r = a; r < b; r++) {
                const src = (r - cr) * cw, dst = (r - a) * W;
                if (es === 1) for (let i = 0; i < W; i++) rowBuf[dst + i] = plain[src + i];
                else if (shuffled) for (let i = 0; i < W; i++) rowBuf[dst + i] = plain[src + i] | (plain[plane + src + i] << 8);
                else for (let i = 0; i < W; i++) rowBuf[dst + i] = plain[2 * (src + i)] | (plain[2 * (src + i) + 1] << 8);
            }
            chunksDecoded++;
            sink.rows(a, rowBuf.subarray(0, (b - a) * W), W, b - a);
        };

        for (const range of ranges) {
            signal?.throwIfAborted();
            const chunks = range.chunks;
            let ci = 0, filled = 0, pos = range.start;
            for await (const piece of open(range)) {
                signal?.throwIfAborted();
                let off = 0;
                while (off < piece.length && ci < chunks.length) {
                    const c = chunks[ci];
                    if (pos < c.address) { const k = Math.min(c.address - pos, piece.length - off); off += k; pos += k; continue; }
                    const k = Math.min(c.size - filled, piece.length - off);
                    if (filled === 0 && k === c.size) {
                        decode(c, piece.subarray(off, off + k));
                    } else {
                        staging.set(piece.subarray(off, off + k), filled);
                        filled += k;
                        if (filled === c.size) { decode(c, staging.subarray(0, c.size)); filled = 0; }
                    }
                    off += k; pos += k;
                    if (filled === 0) ci++;
                }
            }
            if (ci < chunks.length) throw new Hdf5FormatError(`Range ${range.key} ended before chunk ${ci} of ${chunks.length}`);
        }
        return { chunksDecoded, bytesInflated };
    }

    private async imageMeta(variable: string): Promise<VarMeta> {
        const m = await this.meta(variable);
        if (m.dims.length !== 2 || m.layout.kind !== 'chunked') throw new Error(`${variable} is not a chunked 2-D image`);
        if (m.dtype.cls !== 0 || (m.dtype.size !== 1 && m.dtype.size !== 2) || m.dtype.bigEndian) {
            throw new Hdf5FormatError(`${variable}: only little-endian 8/16-bit integers are supported`);
        }
        for (const f of m.filters) {
            if (f.id !== FILTER_DEFLATE && f.id !== FILTER_SHUFFLE) throw new Hdf5FormatError(`${variable}: filter ${f.id} not supported`);
        }
        if (m.layout.chunk[1] !== m.dims[1]) throw new Hdf5FormatError(`${variable}: row reads need full-width chunks`);
        return m;
    }

    /**
     * Plan a read without fetching any chunk data: which chunks are needed (sorted by file
     * address), a `decode` that writes one chunk's stored bytes into the output, and `finish` to
     * assemble the grid. `read()` drives it with ranged batches; `streamAbi()` with whole-file streams.
     */
    async prepare(options: AbiReadOptions = {}): Promise<ReadPlan> {
        const variable = options.variable ?? (this.links.has('Rad') ? 'Rad' : 'CMI');
        const m = await this.meta(variable);
        if (m.dims.length !== 2 || m.layout.kind !== 'chunked') throw new Error(`${variable} is not a chunked 2-D image`);
        if (m.dtype.cls !== 0 || (m.dtype.size !== 1 && m.dtype.size !== 2) || m.dtype.bigEndian) {
            throw new Hdf5FormatError(`${variable}: only little-endian 8/16-bit integers are supported`);
        }
        for (const f of m.filters) {
            if (f.id !== FILTER_DEFLATE && f.id !== FILTER_SHUFFLE) throw new Hdf5FormatError(`${variable}: filter ${f.id} not supported`);
        }
        const layout = m.layout;
        m.chunks ??= await this.h5.chunkIndex(layout.btree, 2);

        const [H, W] = m.dims;
        const [ch, cw] = layout.chunk;
        const es = m.dtype.size;
        const s = Math.max(1, Math.floor(options.stride ?? 1));
        const r0 = Math.max(0, options.rows?.[0] ?? 0), r1 = Math.min(H, options.rows?.[1] ?? H);
        const c0 = Math.max(0, options.cols?.[0] ?? 0), c1 = Math.min(W, options.cols?.[1] ?? W);
        if (r1 <= r0 || c1 <= c0) throw new RangeError('Empty read window');
        const outH = Math.ceil((r1 - r0) / s), outW = Math.ceil((c1 - c0) / s);
        const data = options.output ?? (es === 2 ? this.memory.array(Uint16Array, outW * outH) : this.memory.array(Uint8Array, outW * outH));
        if (data.length < outW * outH) throw new RangeError(`output holds ${data.length} elements, need ${outW * outH}`);

        // First sampled index at or after `from` on the grid start, start + s, start + 2s, ...
        const firstSample = (from: number, start: number) => start + Math.ceil(Math.max(0, from - start) / s) * s;
        const needed: ChunkRef[] = [];
        let skipped = 0;
        for (const c of m.chunks) {
            const [cr, cc] = c.offset;
            const rFirst = firstSample(Math.max(cr, r0), r0), cFirst = firstSample(Math.max(cc, c0), c0);
            if (rFirst < Math.min(cr + ch, r1) && cFirst < Math.min(cc + cw, c1)) needed.push(c);
            else skipped++;
        }
        needed.sort((a, b) => a.address - b.address);

        const chunkBytes = ch * cw * es;
        const native = options.inflate === 'native';
        const shuffleIdx = m.filters.findIndex((f) => f.id === FILTER_SHUFFLE);
        const deflateIdx = m.filters.findIndex((f) => f.id === FILTER_DEFLATE);
        let bytesInflated = 0;

        const writeOut = (c: ChunkRef, plain: Uint8Array) => {
            const shuffled = es > 1 && shuffleIdx >= 0 && !(c.filterMask & (1 << shuffleIdx));
            writeChunk(plain, shuffled, es, c.offset[0], c.offset[1], ch, cw, r0, c0, Math.min(c.offset[0] + ch, r1),
                Math.min(c.offset[1] + cw, c1), s, outW, data, firstSample);
        };
        const checkSize = (c: ChunkRef, n: number) => {
            if (n !== chunkBytes) throw new Hdf5FormatError(`Chunk at ${c.address} inflated to ${n} bytes, expected ${chunkBytes}`);
            bytesInflated += n;
        };
        // Synchronous unless `inflate: 'native'`, so streaming callers can decode without yielding.
        const decode = (c: ChunkRef, raw: Uint8Array, scratch: Uint8Array): void | Promise<void> => {
            if (deflateIdx < 0 || c.filterMask & (1 << deflateIdx)) return writeOut(c, raw);
            if (native) return inflateInto(raw, scratch).then((n) => { checkSize(c, n); writeOut(c, scratch); });
            checkSize(c, inflate(raw, scratch));
            writeOut(c, scratch);
        };

        // Coordinates, projection and time live in small objects; fetch them alongside the chunks.
        const extras = Promise.all([this.axis('x', c0, s), this.axis('y', r0, s), this.projection(), this.time()]);
        extras.catch(() => {});

        const finish = async (net: { requests: number; bytesFetched: number }): Promise<AbiGrid> => {
            const attrs = m.attrs;
            const unsigned = str(attrs.get('_Unsigned')) === 'true';
            const rawFill = attrs.get('_FillValue');
            const fill = Array.isArray(rawFill) && rawFill.length ? (unsigned ? rawFill[0] & ((1 << (8 * es)) - 1) : rawFill[0]) : null;
            const [x, y, projection, time] = await extras;
            return {
                variable, width: outW, height: outH, data,
                scale: num(attrs.get('scale_factor'), 1), offset: num(attrs.get('add_offset'), 0), fill,
                units: str(attrs.get('units')), stride: s, rows: [r0, r1], cols: [c0, c1], x, y, projection, time,
                stats: { chunksDecoded: needed.length, chunksSkipped: skipped, ...net, bytesInflated },
            };
        };
        return { needed, chunkBytes, maxStored: needed.reduce((mx, c) => Math.max(mx, c.size), 0), decode, finish };
    }
}

/** A read planned by `AbiFile.prepare`, ready to be fed chunk bytes from any transport. */
export interface ReadPlan {
    /** Chunks to decode, sorted by file address. */
    needed: ChunkRef[];
    /** Decoded bytes per chunk: the size of the scratch buffer `decode` needs. */
    chunkBytes: number;
    /** Largest stored (compressed) chunk among `needed`. */
    maxStored: number;
    /** Decode one chunk's complete stored bytes into the output. `scratch` must hold `chunkBytes`. */
    decode(c: ChunkRef, raw: Uint8Array, scratch: Uint8Array): void | Promise<void>;
    finish(net: { requests: number; bytesFetched: number }): Promise<AbiGrid>;
}

/** Group chunks (already sorted by file address) into contiguous runs for one ranged GET each. */
function planBatches(chunks: ChunkRef[], maxBytes: number, maxGap: number): ChunkRef[][] {
    const out: ChunkRef[][] = [];
    let cur: ChunkRef[] = [];
    for (const c of chunks) {
        if (cur.length) {
            const first = cur[0], prev = cur[cur.length - 1];
            const gap = c.address - (prev.address + prev.size);
            if (gap < 0 || gap > maxGap || c.address + c.size - first.address > maxBytes) { out.push(cur); cur = []; }
        }
        cur.push(c);
    }
    if (cur.length) out.push(cur);
    return out;
}

/**
 * Copy the sampled part of one decoded chunk into the output. With shuffle the chunk is stored
 * as byte planes (all low bytes, then all high bytes), so each code is rebuilt as
 * `lo[e] | hi[e] << 8` without a separate un-shuffle pass.
 */
function writeChunk(
    b: Uint8Array, shuffled: boolean, es: number, cr: number, cc: number, ch: number, cw: number,
    r0: number, c0: number, rEnd: number, cEnd: number, s: number, outW: number,
    out: Uint16Array | Uint8Array, firstSample: (from: number, start: number) => number,
): void {
    const plane = ch * cw;
    const rFirst = firstSample(Math.max(cr, r0), r0), cFirst = firstSample(Math.max(cc, c0), c0);
    const xo0 = (cFirst - c0) / s;
    for (let r = rFirst; r < rEnd; r += s) {
        const rowBase = (r - cr) * cw - cc;
        let o = ((r - r0) / s) * outW + xo0;
        if (es === 1) {
            for (let c = cFirst; c < cEnd; c += s) out[o++] = b[rowBase + c];
        } else if (shuffled) {
            for (let c = cFirst; c < cEnd; c += s) {
                const e = rowBase + c;
                out[o++] = b[e] | (b[plane + e] << 8);
            }
        } else {
            for (let c = cFirst; c < cEnd; c += s) {
                const e = 2 * (rowBase + c);
                out[o++] = b[e] | (b[e + 1] << 8);
            }
        }
    }
}

/** zlib-inflate `src` into `dst` with the platform's native DecompressionStream. Returns bytes written. */
async function inflateInto(src: Uint8Array, dst: Uint8Array): Promise<number> {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(src as Uint8Array<ArrayBuffer>).catch(() => {});
    writer.close().catch(() => {});
    const reader = ds.readable.getReader();
    let n = 0;
    for (;;) {
        const { value, done } = await reader.read();
        if (done) return n;
        if (n + value.length > dst.length) {
            reader.cancel().catch(() => {});
            throw new Hdf5FormatError('Chunk inflated past its declared size');
        }
        dst.set(value, n);
        n += value.length;
    }
}

/** Run up to `limit` workers over `items`; `makeWorker` runs once per worker so each can own buffers. */
async function forEachLimit<T>(items: T[], limit: number, makeWorker: () => (item: T) => Promise<void>, onError: (error: unknown) => void): Promise<void> {
    let next = 0;
    let stopped = false;
    let failure: { error: unknown } | undefined;
    const run = async () => {
        try {
        const fn = makeWorker();
        while (!stopped && next < items.length) await fn(items[next++]);
        } catch (error) {
            stopped = true;
            failure ??= { error };
            onError(error);
            throw error;
        }
    };
    await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, run));
    if (failure) throw failure.error;
}
