import { inflate } from './inflate.ts';
import type { ByteSource } from './source.ts';

/**
 * Minimal read-only HDF5 reader covering what NetCDF-4 writes for GOES-R ABI files: superblock
 * v2/v3, v1/v2 object headers, compact and dense (fractal heap + v2 B-tree) links and attributes,
 * contiguous/compact/chunked (v1 B-tree) layouts, and the shuffle + deflate filters. Anything else
 * throws instead of guessing. Checksums are not verified.
 */

const UNDEF = -1;
/** Entries per v1 B-tree node HDF5 writes by default (2 × K, K = 32); larger nodes cost a second read. */
const V1_BTREE_GUESS_ENTRIES = 64;
const TEXT = new TextDecoder();
/** Chunks whose bytes lie closer than this are fetched in one request, up to `MAX_REQUEST_BYTES`. */
const CHUNK_GAP_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

export class Hdf5FormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'Hdf5FormatError';
    }
}

class Cursor {
    b: Uint8Array;
    p: number;
    dv: DataView;
    private offsetSize: number;
    private lengthSize: number;
    constructor(b: Uint8Array, p = 0, offsetSize = 8, lengthSize = 8) {
        this.b = b;
        this.p = p;
        this.offsetSize = offsetSize;
        this.lengthSize = lengthSize;
        this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    }
    u8(): number {
        return this.b[this.p++];
    }
    u16(): number {
        const v = this.dv.getUint16(this.p, true);
        this.p += 2;
        return v;
    }
    u32(): number {
        const v = this.dv.getUint32(this.p, true);
        this.p += 4;
        return v;
    }
    /** Little-endian unsigned of `n` bytes; all-ones decodes to UNDEF (HDF5's "undefined address"). */
    uN(n: number): number {
        if (!Number.isSafeInteger(n) || n < 0 || this.p + n > this.b.length)
            throw new Hdf5FormatError('Truncated HDF5 integer');
        let v = 0,
            ones = true;
        for (let i = 0; i < n; i++) {
            const byte = this.b[this.p + i];
            if (byte !== 0xff) ones = false;
            v += byte * 2 ** (8 * i);
        }
        this.p += n;
        return ones && n > 0 ? UNDEF : v;
    }
    addr(): number {
        return this.uN(this.offsetSize);
    }
    len(): number {
        return this.uN(this.lengthSize);
    }
    bytes(n: number): Uint8Array {
        if (!Number.isSafeInteger(n) || n < 0 || this.p + n > this.b.length)
            throw new Hdf5FormatError('Truncated HDF5 message');
        const s = this.b.subarray(this.p, this.p + n);
        this.p += n;
        return s;
    }
    sig(expected: string): void {
        const got = TEXT.decode(this.bytes(4));
        if (got !== expected)
            throw new Hdf5FormatError(`Expected ${expected} signature, found ${JSON.stringify(got)}`);
    }
}

export interface Datatype {
    /** 0 fixed-point, 1 float, 3 string; others are carried but not decoded. */
    cls: number;
    size: number;
    signed: boolean;
    bigEndian: boolean;
}

export interface Filter {
    id: number;
    values: number[];
}

export type Layout =
    | { kind: 'compact'; data: Uint8Array }
    | { kind: 'contiguous'; address: number; size: number }
    | { kind: 'chunked'; btree: number; chunk: number[] };

export type AttrValue = string | number[];

/** A dataset's shape, type, layout and filter pipeline, from its object header. */
export interface Hdf5Dataset {
    dims: readonly number[];
    type: Datatype;
    layout: Layout;
    filters: readonly Filter[];
}

export interface ChunkRef {
    /** Element offset of the chunk's first element in each dimension. */
    offset: number[];
    address: number;
    size: number;
    /** Bit i set: filter i of the pipeline was skipped for this chunk. */
    filterMask: number;
}

interface Message {
    type: number;
    body: Uint8Array;
}

/** Bytes needed to store `n` (H5VM_limit_enc_size). */
const encSize = (n: number) => Math.floor(Math.log2(n) / 8) + 1;

export class Hdf5File {
    readonly offsetSize: number;
    readonly lengthSize: number;
    readonly rootAddress: number;
    private src: ByteSource;
    private base: number;

    private constructor(
        src: ByteSource,
        offsetSize: number,
        lengthSize: number,
        base: number,
        rootAddress: number,
    ) {
        this.src = src;
        this.offsetSize = offsetSize;
        this.lengthSize = lengthSize;
        this.base = base;
        this.rootAddress = rootAddress;
    }

    static async open(src: ByteSource, signal?: AbortSignal): Promise<Hdf5File> {
        // The superblock may sit after a user block at 0, 512, 1024, 2048, ...
        for (let at = 0; at <= 8192; at = at ? at * 2 : 512) {
            const b = await src.read(at, 48, signal);
            if (b[0] !== 0x89 || b[1] !== 0x48 || b[2] !== 0x44 || b[3] !== 0x46) continue;
            const version = b[8];
            if (version !== 2 && version !== 3)
                throw new Hdf5FormatError(`Superblock v${version} not supported (need v2/v3)`);
            const c = new Cursor(b, 9);
            const offsetSize = c.u8(),
                lengthSize = c.u8();
            c.u8(); // file consistency flags
            const cur = new Cursor(b, 12, offsetSize, lengthSize);
            const base = cur.addr();
            cur.addr(); // superblock extension
            cur.addr(); // end of file
            const root = cur.addr();
            return new Hdf5File(src, offsetSize, lengthSize, base, root);
        }
        throw new Hdf5FormatError('No HDF5 signature found');
    }

    private cursor(b: Uint8Array, p = 0): Cursor {
        return new Cursor(b, p, this.offsetSize, this.lengthSize);
    }

    read(address: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
        return this.src.read(this.base + address, length, signal);
    }

    /** The range as streamed pieces, or one read when the source cannot stream. */
    stream(address: number, length: number, signal?: AbortSignal): AsyncIterable<Uint8Array> {
        if (this.src.stream) return this.src.stream(this.base + address, length, signal);
        const read = () => this.read(address, length, signal);
        return (async function* () {
            yield await read();
        })();
    }

    // ---- Object headers ------------------------------------------------------------------------

    async messages(address: number): Promise<Message[]> {
        const pre = await this.read(address, 24);
        return pre[0] === 0x4f && pre[1] === 0x48 && pre[2] === 0x44 && pre[3] === 0x52
            ? this.messagesV2(address, pre)
            : this.messagesV1(address, pre);
    }

    private async messagesV2(address: number, pre: Uint8Array): Promise<Message[]> {
        const c = this.cursor(pre, 4);
        if (c.u8() !== 2) throw new Hdf5FormatError('Unknown object header version');
        const flags = c.u8();
        if (flags & 0x20) c.p += 16;
        if (flags & 0x10) c.p += 4;
        const chunk0 = c.uN(1 << (flags & 3));
        const blocks: Uint8Array[] = [await this.read(address + c.p, chunk0)];
        const seen = new Set([address]);
        const out: Message[] = [];
        const hdr = flags & 0x04 ? 6 : 4;
        for (let i = 0; i < blocks.length; i++) {
            const b = this.cursor(blocks[i]);
            while (b.p + hdr <= b.b.length) {
                const type = b.u8(),
                    size = b.u16();
                b.p += hdr - 3;
                const body = b.bytes(size);
                if (type === 0x10) {
                    const cc = this.cursor(body);
                    const at = cc.addr(),
                        len = cc.len();
                    if (seen.has(at)) throw new Hdf5FormatError('Cyclic HDF5 continuation');
                    seen.add(at);
                    const blk = await this.read(at, len);
                    this.cursor(blk).sig('OCHK');
                    blocks.push(blk.subarray(4, len - 4));
                } else if (type !== 0) {
                    out.push({ type, body });
                }
            }
        }
        return out;
    }

    private async messagesV1(address: number, pre: Uint8Array): Promise<Message[]> {
        const c = this.cursor(pre);
        if (c.u8() !== 1) throw new Hdf5FormatError(`Unknown object header version at ${address}`);
        c.p = 2;
        let remaining = c.u16();
        c.u32(); // reference count
        const size = c.u32();
        const blocks: Uint8Array[] = [await this.read(address + 16, size)];
        const out: Message[] = [];
        for (let i = 0; i < blocks.length && remaining > 0; i++) {
            const b = this.cursor(blocks[i]);
            while (b.p + 8 <= b.b.length && remaining > 0) {
                const type = b.u16(),
                    sz = b.u16();
                b.p += 4;
                const body = b.bytes(sz);
                remaining--;
                if (type === 0x10) {
                    const cc = this.cursor(body);
                    const at = cc.addr(),
                        len = cc.len();
                    blocks.push(await this.read(at, len));
                } else if (type !== 0) {
                    out.push({ type, body });
                }
            }
        }
        return out;
    }

    // ---- Groups --------------------------------------------------------------------------------

    /** Hard links of a group: name -> object header address. */
    async links(groupAddress = this.rootAddress): Promise<Map<string, number>> {
        const links = new Map<string, number>();
        for (const m of await this.messages(groupAddress)) {
            if (m.type === 0x06) {
                const l = this.parseLink(m.body);
                if (l) links.set(l.name, l.address);
            } else if (m.type === 0x02) {
                const c = this.cursor(m.body);
                c.u8();
                const flags = c.u8();
                if (flags & 1) c.p += 8;
                const heapAddr = c.addr(),
                    nameBtree = c.addr();
                if (heapAddr === UNDEF) continue;
                const heap = await FractalHeap.open(this, heapAddr);
                for (const rec of await this.btree2Records(nameBtree)) {
                    // Type-5 record: 4-byte name hash, then the heap ID.
                    const l = this.parseLink(await heap.get(rec.subarray(4)));
                    if (l) links.set(l.name, l.address);
                }
            } else if (m.type === 0x11) {
                throw new Hdf5FormatError('Old-style (symbol table) groups are not supported');
            }
        }
        return links;
    }

    private parseLink(b: Uint8Array): { name: string; address: number } | null {
        const c = this.cursor(b);
        if (c.u8() !== 1) throw new Hdf5FormatError('Unknown link message version');
        const flags = c.u8();
        const type = flags & 0x08 ? c.u8() : 0;
        if (flags & 0x04) c.p += 8;
        if (flags & 0x10) c.p += 1;
        const name = TEXT.decode(c.bytes(c.uN(1 << (flags & 3))));
        return type === 0 ? { name, address: c.addr() } : null; // soft/external links are ignored
    }

    // ---- Attributes ----------------------------------------------------------------------------

    async attributes(msgs: Message[]): Promise<Map<string, AttrValue>> {
        const attrs = new Map<string, AttrValue>();
        for (const m of msgs) {
            if (m.type === 0x0c) {
                const a = this.parseAttribute(m.body);
                attrs.set(a.name, a.value);
            } else if (m.type === 0x15) {
                const c = this.cursor(m.body);
                c.u8();
                const flags = c.u8();
                if (flags & 1) c.p += 2;
                const heapAddr = c.addr(),
                    nameBtree = c.addr();
                if (heapAddr === UNDEF) continue;
                const heap = await FractalHeap.open(this, heapAddr);
                for (const rec of await this.btree2Records(nameBtree)) {
                    // Type-8 record: 8-byte heap ID, flags, creation order, hash.
                    const a = this.parseAttribute(await heap.get(rec.subarray(0, 8)));
                    attrs.set(a.name, a.value);
                }
            }
        }
        return attrs;
    }

    private parseAttribute(b: Uint8Array): { name: string; value: AttrValue } {
        const c = this.cursor(b);
        const version = c.u8();
        c.u8();
        const nameSize = c.u16(),
            dtSize = c.u16(),
            dsSize = c.u16();
        if (version === 3) c.u8(); // name encoding
        const pad = (n: number) => (version === 1 ? Math.ceil(n / 8) * 8 : n);
        const name = TEXT.decode(c.b.subarray(c.p, c.p + nameSize - 1));
        c.p += pad(nameSize);
        const dtype = parseDatatype(c.b.subarray(c.p, c.p + dtSize));
        c.p += pad(dtSize);
        const dims = this.parseDataspace(c.b.subarray(c.p, c.p + dsSize));
        c.p += pad(dsSize);
        const count = dims === null ? 0 : dims.reduce((a, d) => a * d, 1);
        return { name, value: decodeValues(c.b.subarray(c.p, c.p + count * dtype.size), dtype, count) };
    }

    // ---- Datasets ------------------------------------------------------------------------------

    /** Dataspace dims; [] for a scalar, null for a null dataspace. */
    parseDataspace(b: Uint8Array): number[] | null {
        const c = this.cursor(b);
        const version = c.u8(),
            rank = c.u8();
        c.u8(); // flags
        if (version === 1) c.p += 5;
        else if (c.u8() === 2) return null;
        const dims: number[] = [];
        for (let i = 0; i < rank; i++) dims.push(c.len());
        return dims;
    }

    parseLayout(b: Uint8Array): Layout {
        const c = this.cursor(b);
        const version = c.u8();
        if (version !== 3) throw new Hdf5FormatError(`Layout message v${version} not supported (need v3)`);
        const cls = c.u8();
        if (cls === 0) return { kind: 'compact', data: c.bytes(c.u16()) };
        if (cls === 1) return { kind: 'contiguous', address: c.addr(), size: c.len() };
        if (cls === 2) {
            const ndims = c.u8();
            const btree = c.addr();
            const chunk: number[] = [];
            for (let i = 0; i < ndims; i++) chunk.push(c.u32());
            return { kind: 'chunked', btree, chunk: chunk.slice(0, -1) }; // last entry is the element size
        }
        throw new Hdf5FormatError(`Layout class ${cls} not supported`);
    }

    parseFilters(b: Uint8Array): Filter[] {
        const c = this.cursor(b);
        const version = c.u8(),
            n = c.u8();
        if (version === 1) c.p += 6;
        const filters: Filter[] = [];
        for (let i = 0; i < n; i++) {
            const id = c.u16();
            const nameLen = version === 1 || id >= 256 ? c.u16() : 0;
            c.u16(); // flags
            const nvalues = c.u16();
            c.p += version === 1 ? Math.ceil(nameLen / 8) * 8 : nameLen;
            const values: number[] = [];
            for (let k = 0; k < nvalues; k++) values.push(c.u32());
            if (version === 1 && nvalues % 2) c.p += 4;
            filters.push({ id, values });
        }
        return filters;
    }

    /**
     * Every chunk of a v1 B-tree chunk index, in key order. Leaves are scattered between the data
     * chunks, so each node is fetched in one read (sized for the default 2K = 64 entries) and
     * siblings are walked in parallel: one round trip per tree level.
     */
    async chunkIndex(btree: number, rank: number): Promise<ChunkRef[]> {
        const keySize = 8 + 8 * (rank + 1);
        const headSize = 8 + 2 * this.offsetSize;
        const nodeSize = (entries: number) => headSize + entries * (keySize + this.offsetSize) + keySize;
        const seen = new Set<number>();
        const walk = async (addr: number): Promise<ChunkRef[]> => {
            if (seen.has(addr)) throw new Hdf5FormatError('Cyclic HDF5 chunk B-tree');
            seen.add(addr);
            let b = await this.read(addr, nodeSize(V1_BTREE_GUESS_ENTRIES));
            const head = this.cursor(b);
            head.sig('TREE');
            if (head.u8() !== 1) throw new Hdf5FormatError('Expected a chunk (type 1) B-tree node');
            const level = head.u8(),
                entries = head.u16();
            if (nodeSize(entries) > b.length) b = await this.read(addr, nodeSize(entries));
            const c = this.cursor(b, headSize);
            const leaves: ChunkRef[] = [];
            const children: number[] = [];
            for (let i = 0; i < entries; i++) {
                const size = c.u32(),
                    filterMask = c.u32();
                const offset: number[] = [];
                for (let d = 0; d < rank; d++) offset.push(c.uN(8));
                c.p += 8;
                const child = c.addr();
                if (level === 0) leaves.push({ offset, address: child, size, filterMask });
                else children.push(child);
            }
            if (level === 0) return leaves;
            return (await Promise.all(children.map(walk))).flat();
        };
        return btree === UNDEF ? [] : walk(btree);
    }

    // ---- Float datasets ------------------------------------------------------------------------

    /** The dataset whose object header is at `address`. */
    async dataset(address: number): Promise<Hdf5Dataset> {
        let dims: number[] | null | undefined, type: Datatype | undefined, layout: Layout | undefined;
        let filters: Filter[] = [];
        for (const m of await this.messages(address)) {
            if (m.type === 0x01) dims = this.parseDataspace(m.body);
            else if (m.type === 0x03) type = parseDatatype(m.body);
            else if (m.type === 0x08) layout = this.parseLayout(m.body);
            else if (m.type === 0x0b) filters = this.parseFilters(m.body);
        }
        if (!dims || !type || !layout) throw new Hdf5FormatError('The object is not a dataset');
        return { dims, type, layout, filters };
    }

    /**
     * The values of a dataset as float32: the whole of a 1-D or 2-D one, or one `index` along the first
     * axis of a 3-D one (a 2-D slab). Fill values are the caller's to interpret. Only the chunks that
     * hold the slab are located and read, neighbouring chunks in one request.
     */
    async floats(ds: Hdf5Dataset, index?: number, signal?: AbortSignal): Promise<Float32Array> {
        if (ds.type.cls !== 1 || ds.type.size !== 4 || ds.type.bigEndian)
            throw new Hdf5FormatError('Only little-endian float32 datasets can be read as floats');
        const slab = index === undefined ? ds.dims : ds.dims.slice(1);
        const count = slab.reduce((a, b) => a * b, 1);
        if (ds.layout.kind === 'compact') return toFloats(ds.layout.data.subarray(index === undefined ? 0 : index * count * 4), count);
        if (ds.layout.kind === 'contiguous') {
            const skip = index === undefined ? 0 : index * count * 4;
            return toFloats(await this.read(ds.layout.address + skip, count * 4, signal), count);
        }
        return this.readChunkedFloats(ds, ds.layout, slab, index, signal);
    }

    private async readChunkedFloats(
        ds: Hdf5Dataset,
        layout: Extract<Layout, { kind: 'chunked' }>,
        slab: readonly number[],
        index: number | undefined,
        signal?: AbortSignal,
    ): Promise<Float32Array> {
        const rank = ds.dims.length,
            chunk = layout.chunk;
        if (chunk.length !== rank) throw new Hdf5FormatError('Chunk dimensions do not match the dataspace');
        // Offsets are compared across all axes, so a slab is the chunks whose first offset lies in one range.
        const lo = new Array<number>(rank).fill(0),
            hi = new Array<number>(rank).fill(index === undefined ? Infinity : 0);
        if (index !== undefined) {
            lo[0] = index - (index % chunk[0]);
            hi[0] = lo[0] + chunk[0];
        }
        const refs = await this.chunkRefsInRange(layout.btree, rank, lo, hi);
        const out = new Float32Array(slab.reduce((a, b) => a * b, 1));
        const dimsInSlab = index === undefined ? rank : rank - 1;
        const first = index === undefined ? 0 : 1;
        const stride = new Array<number>(dimsInSlab).fill(1);
        for (let d = dimsInSlab - 2; d >= 0; d--) stride[d] = stride[d + 1] * slab[d + 1];
        const chunkStride = new Array<number>(rank).fill(1);
        for (let d = rank - 2; d >= 0; d--) chunkStride[d] = chunkStride[d + 1] * chunk[d + 1];
        const chunkValues = chunkStride[0] * chunk[0];

        const fetched = await this.fetchChunkRuns(refs, signal);
        for (let k = 0; k < refs.length; k++) {
            const ref = refs[k];
            if (ref.filterMask !== 0) throw new Hdf5FormatError('A chunk with a skipped filter is not supported');
            let bytes = fetched[k];
            for (const f of [...ds.filters].reverse()) {
                if (f.id === 1) {
                    const scratch = new Uint8Array(chunkValues * 4);
                    const n = inflate(bytes, scratch);
                    if (n < chunkValues * 4) throw new Hdf5FormatError('A chunk decoded short');
                    bytes = scratch;
                } else if (f.id === 2) bytes = unshuffle(bytes, ds.type.size);
                else throw new Hdf5FormatError(`Filter ${f.id} is not supported`);
            }
            if (bytes.byteLength < chunkValues * 4) throw new Hdf5FormatError('A chunk decoded short');
            const values = toFloats(bytes, chunkValues);
            // Copy this chunk's cells that fall inside the slab; edge chunks are stored whole and may overhang.
            const base = index === undefined ? 0 : (index - ref.offset[0]) * chunkStride[0];
            copyBlock(values, base, chunkStride.slice(first), chunk.slice(first), out, stride, slab, ref.offset.slice(first));
        }
        return out;
    }

    /** The chunks whose offsets lie in `[lo, hi)`, found by descending the v1 B-tree and pruning by key. */
    private async chunkRefsInRange(
        btree: number,
        rank: number,
        lo: readonly number[],
        hi: readonly number[],
    ): Promise<ChunkRef[]> {
        if (btree === UNDEF) return [];
        const keySize = 8 + 8 * (rank + 1);
        const headSize = 8 + 2 * this.offsetSize;
        const nodeSize = (entries: number) => headSize + entries * (keySize + this.offsetSize) + keySize;
        const seen = new Set<number>();
        const walk = async (addr: number): Promise<ChunkRef[]> => {
            if (seen.has(addr)) throw new Hdf5FormatError('Cyclic HDF5 chunk B-tree');
            seen.add(addr);
            let b = await this.read(addr, nodeSize(V1_BTREE_GUESS_ENTRIES));
            const head = this.cursor(b);
            head.sig('TREE');
            if (head.u8() !== 1) throw new Hdf5FormatError('Expected a chunk (type 1) B-tree node');
            const level = head.u8(),
                entries = head.u16();
            if (nodeSize(entries) > b.length) b = await this.read(addr, nodeSize(entries));
            const c = this.cursor(b, headSize);
            const keys: number[][] = [],
                sizes: number[] = [],
                masks: number[] = [],
                children: number[] = [];
            for (let i = 0; i <= entries; i++) {
                const size = c.u32(),
                    mask = c.u32();
                const offset: number[] = [];
                for (let d = 0; d < rank; d++) offset.push(c.uN(8));
                c.p += 8; // the element-size "dimension"
                keys.push(offset);
                sizes.push(size);
                masks.push(mask);
                if (i < entries) children.push(c.addr());
            }
            const found: Promise<ChunkRef[]>[] = [];
            for (let i = 0; i < entries; i++) {
                if (level > 0) {
                    // A child covers the offsets from its key up to the next one.
                    if (compareOffsets(keys[i + 1], lo) > 0 && compareOffsets(keys[i], hi) < 0) found.push(walk(children[i]));
                } else if (compareOffsets(keys[i], lo) >= 0 && compareOffsets(keys[i], hi) < 0) {
                    found.push(
                        Promise.resolve([{ offset: keys[i], address: children[i], size: sizes[i], filterMask: masks[i] }]),
                    );
                }
            }
            return (await Promise.all(found)).flat();
        };
        return walk(btree);
    }

    /** The bytes of every chunk, neighbouring chunks in one request. */
    private async fetchChunkRuns(refs: readonly ChunkRef[], signal?: AbortSignal): Promise<Uint8Array[]> {
        const order = refs.map((_, k) => k).sort((a, b) => refs[a].address - refs[b].address);
        const out = new Array<Uint8Array>(refs.length);
        const requests: Promise<void>[] = [];
        for (let i = 0; i < order.length; ) {
            const start = refs[order[i]].address;
            let end = start + refs[order[i]].size,
                j = i + 1;
            while (
                j < order.length &&
                refs[order[j]].address - end <= CHUNK_GAP_BYTES &&
                refs[order[j]].address + refs[order[j]].size - start <= MAX_REQUEST_BYTES
            ) {
                end = Math.max(end, refs[order[j]].address + refs[order[j]].size);
                j++;
            }
            const members = order.slice(i, j);
            requests.push(
                this.read(start, end - start, signal).then((block) => {
                    for (const k of members)
                        out[k] = block.subarray(refs[k].address - start, refs[k].address - start + refs[k].size);
                }),
            );
            i = j;
        }
        await Promise.all(requests);
        return out;
    }

    // ---- v2 B-trees ----------------------------------------------------------------------------

    /** Raw records of a v2 B-tree, in key order. */
    async btree2Records(address: number): Promise<Uint8Array[]> {
        if (address === UNDEF) return [];
        const h = this.cursor(await this.read(address, 16 + this.offsetSize + 2 + this.lengthSize + 4));
        h.sig('BTHD');
        h.u8();
        h.u8();
        const nodeSize = h.u32(),
            recSize = h.u16(),
            depth = h.u16();
        h.p += 2;
        const root = h.addr(),
            rootNrec = h.u16();

        // Child-pointer field widths per depth, as H5B2__hdr_init computes them.
        const PREFIX = 10;
        const maxNrec = [Math.floor((nodeSize - PREFIX) / recSize)];
        const cumMax = [maxNrec[0]];
        const cumSize = [0];
        const nrecSize = encSize(maxNrec[0]);
        for (let d = 1; d <= depth; d++) {
            const ptr = this.offsetSize + nrecSize + (d > 1 ? cumSize[d - 1] : 0);
            maxNrec[d] = Math.floor((nodeSize - (PREFIX + ptr)) / (recSize + ptr));
            cumMax[d] = (maxNrec[d] + 1) * cumMax[d - 1] + maxNrec[d];
            cumSize[d] = encSize(cumMax[d]);
        }

        const out: Uint8Array[] = [];
        const seen = new Set<number>();
        const walk = async (addr: number, nrec: number, d: number): Promise<void> => {
            if (seen.has(addr)) throw new Hdf5FormatError('Cyclic HDF5 B-tree');
            seen.add(addr);
            const ptr = d > 0 ? this.offsetSize + nrecSize + (d > 1 ? cumSize[d - 1] : 0) : 0;
            const c = this.cursor(await this.read(addr, 6 + nrec * recSize + (d > 0 ? (nrec + 1) * ptr : 0)));
            c.sig(d > 0 ? 'BTIN' : 'BTLF');
            c.p += 2;
            const recs: Uint8Array[] = [];
            for (let i = 0; i < nrec; i++) recs.push(c.bytes(recSize));
            if (d === 0) {
                out.push(...recs);
                return;
            }
            for (let i = 0; i <= nrec; i++) {
                const child = c.addr(),
                    childNrec = c.uN(nrecSize);
                if (d > 1) c.p += cumSize[d - 1];
                await walk(child, childNrec, d - 1);
                if (i < nrec) out.push(recs[i]);
            }
        };
        if (root !== UNDEF && rootNrec > 0) await walk(root, rootNrec, depth);
        return out;
    }
}

/** Fractal heap: managed and tiny objects (huge objects never appear in ABI metadata). */
class FractalHeap {
    private f: Hdf5File;
    private width: number;
    private startSize: number;
    private rootAddr: number;
    private rootRows: number;
    private offBytes: number;
    private lenBytes: number;
    private maxDirectRows: number;
    private firstRowBits: number;

    private constructor(
        f: Hdf5File,
        width: number,
        startSize: number,
        maxDirect: number,
        maxHeapBits: number,
        rootAddr: number,
        rootRows: number,
        maxManaged: number,
    ) {
        this.f = f;
        this.width = width;
        this.startSize = startSize;
        this.rootAddr = rootAddr;
        this.rootRows = rootRows;
        this.offBytes = Math.ceil(maxHeapBits / 8);
        this.lenBytes = Math.min(Math.floor((Math.log2(maxDirect) + 7) / 8), encSize(maxManaged));
        this.maxDirectRows = Math.log2(maxDirect) - Math.log2(startSize) + 2;
        this.firstRowBits = Math.log2(startSize) + Math.log2(width);
    }

    static async open(f: Hdf5File, address: number): Promise<FractalHeap> {
        const O = f.offsetSize,
            L = f.lengthSize;
        const c = new Cursor(await f.read(address, 22 + 12 * L + 3 * O + 12), 0, O, L);
        c.sig('FRHP');
        c.u8();
        c.u16(); // heap ID length
        const filtersLen = c.u16();
        if (filtersLen) throw new Hdf5FormatError('Filtered fractal heaps are not supported');
        c.u8();
        const maxManaged = c.u32();
        c.len();
        c.addr();
        c.len();
        c.addr(); // huge-object ID/B-tree, free space and its manager
        for (let i = 0; i < 8; i++) c.len(); // managed/huge/tiny space and object counts
        const width = c.u16(),
            startSize = c.len(),
            maxDirect = c.len(),
            maxHeapBits = c.u16();
        c.u16(); // starting rows of the root indirect block
        const rootAddr = c.addr(),
            rootRows = c.u16();
        return new FractalHeap(f, width, startSize, maxDirect, maxHeapBits, rootAddr, rootRows, maxManaged);
    }

    private rowSize(r: number): number {
        return r === 0 ? this.startSize : this.startSize * 2 ** (r - 1);
    }
    private rowStart(r: number): number {
        return r === 0 ? 0 : this.startSize * this.width * 2 ** (r - 1);
    }

    async get(id: Uint8Array): Promise<Uint8Array> {
        const kind = (id[0] >> 4) & 3;
        if (kind === 2) return id.subarray(1, 1 + (id[0] & 0x0f) + 1);
        if (kind !== 0) throw new Hdf5FormatError('Huge fractal-heap objects are not supported');
        const c = new Cursor(id, 1);
        const offset = c.uN(this.offBytes),
            length = c.uN(this.lenBytes);
        const block = await this.locate(offset);
        return this.f.read(block.address + (offset - block.heapOffset), length);
    }

    /** File address and heap offset of the direct block holding heap offset `off`. */
    private async locate(off: number): Promise<{ address: number; heapOffset: number }> {
        if (this.rootRows === 0) return { address: this.rootAddr, heapOffset: 0 };
        let addr = this.rootAddr,
            rows = this.rootRows,
            base = 0;
        const seen = new Set<number>();
        for (;;) {
            if (seen.has(addr)) throw new Hdf5FormatError('Cyclic HDF5 heap');
            seen.add(addr);
            const rel = off - base;
            let r = 0;
            while (r + 1 < rows && this.rowStart(r + 1) <= rel) r++;
            const col = Math.floor((rel - this.rowStart(r)) / this.rowSize(r));
            const childBase = base + this.rowStart(r) + col * this.rowSize(r);
            const entry = r * this.width + col;
            const headLen = 4 + 1 + this.f.offsetSize + this.offBytes;
            const b = await this.f.read(addr + headLen + entry * this.f.offsetSize, this.f.offsetSize);
            const child = new Cursor(b, 0, this.f.offsetSize).addr();
            if (child === UNDEF)
                throw new Hdf5FormatError(`Heap offset ${off} falls in an unallocated block`);
            if (r < this.maxDirectRows) return { address: child, heapOffset: childBase };
            addr = child;
            base = childBase;
            rows = Math.log2(this.rowSize(r)) - this.firstRowBits + 1;
        }
    }
}

export function parseDatatype(b: Uint8Array): Datatype {
    const cls = b[0] & 0x0f;
    const size = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true);
    return {
        cls,
        size,
        signed: cls === 0 && (b[1] & 0x08) !== 0,
        bigEndian: (cls === 0 || cls === 1) && (b[1] & 0x01) !== 0,
    };
}

export function decodeValues(b: Uint8Array, t: Datatype, count: number): AttrValue {
    if (t.cls === 3) return TEXT.decode(b).replace(/\0+$/, '');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const le = !t.bigEndian;
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        const p = i * t.size;
        if (t.cls === 1) out.push(t.size === 4 ? dv.getFloat32(p, le) : dv.getFloat64(p, le));
        else if (t.cls === 0) {
            if (t.size === 1) out.push(t.signed ? dv.getInt8(p) : dv.getUint8(p));
            else if (t.size === 2) out.push(t.signed ? dv.getInt16(p, le) : dv.getUint16(p, le));
            else if (t.size === 4) out.push(t.signed ? dv.getInt32(p, le) : dv.getUint32(p, le));
            else out.push(Number(t.signed ? dv.getBigInt64(p, le) : dv.getBigUint64(p, le)));
        }
    }
    return out;
}

function compareOffsets(a: readonly number[], b: readonly number[]): number {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
}

/** `count` little-endian float32s from the start of `bytes`, copied so they are aligned whatever the view's offset. */
function toFloats(bytes: Uint8Array, count: number): Float32Array {
    const copy = new Uint8Array(count * 4);
    copy.set(bytes.subarray(0, count * 4));
    return new Float32Array(copy.buffer);
}

function unshuffle(bytes: Uint8Array, width: number): Uint8Array {
    const count = Math.floor(bytes.length / width),
        out = new Uint8Array(bytes.length);
    for (let b = 0; b < width; b++) for (let i = 0; i < count; i++) out[i * width + b] = bytes[b * count + i];
    out.set(bytes.subarray(count * width), count * width);
    return out;
}

/** Copy the part of one chunk that lies inside the slab, row by row along the last axis. */
function copyBlock(
    values: Float32Array,
    base: number,
    chunkStride: readonly number[],
    chunkDims: readonly number[],
    out: Float32Array,
    stride: readonly number[],
    slab: readonly number[],
    origin: readonly number[],
): void {
    const rank = slab.length;
    const extent = chunkDims.map((n, d) => Math.max(0, Math.min(n, slab[d] - origin[d])));
    const index = new Array<number>(rank).fill(0);
    const rows = extent.slice(0, -1).reduce((a, b) => a * b, 1);
    for (let r = 0; r < rows; r++) {
        let from = base,
            to = 0;
        for (let d = 0; d < rank - 1; d++) {
            from += index[d] * chunkStride[d];
            to += (origin[d] + index[d]) * stride[d];
        }
        to += origin[rank - 1];
        out.set(values.subarray(from, from + extent[rank - 1]), to);
        for (let d = rank - 2; d >= 0; d--) {
            if (++index[d] < extent[d]) break;
            index[d] = 0;
        }
    }
}
