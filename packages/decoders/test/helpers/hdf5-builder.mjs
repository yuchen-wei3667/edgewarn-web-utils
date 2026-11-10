import { deflateSync } from 'node:zlib';

const UNDEFINED = 0xffffffffffffffffn;

/** Growable little-endian writer; `at` is the file address of the next byte. */
class Out {
    constructor() { this.parts = []; this.at = 0; }
    bytes(b) { const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : Buffer.from(b); this.parts.push(buf); this.at += buf.length; return this; }
    u8(v) { return this.bytes([v]); }
    u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); return this.bytes(b); }
    u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v); return this.bytes(b); }
    u64(v) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return this.bytes(b); }
    concat() { return Buffer.concat(this.parts); }
}

const message = (type, body) => new Out().u8(type).u16(body.length).u8(0).bytes(body).concat();

/** A version 2 object header holding `messages`, its checksum left zero (the reader does not check it). */
function objectHeader(messages) {
    const body = Buffer.concat(messages);
    return new Out().bytes('OHDR').u8(2).u8(0x01).u16(body.length).bytes(body).u32(0).concat();
}

const dataspace = (dims) => new Out().u8(2).u8(dims.length).u8(0).u8(1).bytes(Buffer.concat(dims.map((d) => new Out().u64(d).concat()))).concat();
/** A little-endian IEEE float32. */
const float32 = () => new Out().u8(0x11).u8(0x20).u8(0x1f).u8(0).u32(4).u16(0).u16(32).u8(23).u8(8).u8(0).u8(23).u32(127).concat();

function shuffle(bytes, width) {
    const count = bytes.length / width, out = Buffer.alloc(bytes.length);
    for (let b = 0; b < width; b++) for (let i = 0; i < count; i++) out[b * count + i] = bytes[i * width + b];
    return out;
}

/**
 * A small NetCDF-4 style file: a version 2 superblock, a root group of link messages, and float32 datasets that are
 * contiguous (`chunk` unset) or chunked with a version 1 B-tree (two levels once there are more than `leaf` chunks).
 * Chunks are stored whole, so a chunk that overhangs the dataset carries padding. `filters`: `shuffle` and/or `deflate`.
 */
export function buildHdf5(datasets, { leaf = 4 } = {}) {
    const out = new Out();
    out.bytes('\x89HDF\r\n\x1a\n').u8(2).u8(8).u8(8).u8(0).u64(0).u64(UNDEFINED).u64(0);
    const rootAt = out.at;
    out.u64(0).u32(0); // the root address is patched below
    const links = [];
    for (const ds of datasets) {
        const rank = ds.dims.length, filters = ds.filters ?? [];
        const messages = [message(0x01, dataspace(ds.dims)), message(0x03, float32())];
        if (!ds.chunk) {
            const at = out.at;
            out.bytes(Buffer.from(ds.data.buffer, ds.data.byteOffset, ds.data.byteLength));
            messages.push(message(0x08, new Out().u8(3).u8(1).u64(at).u64(ds.data.byteLength).concat()));
        } else {
            const grid = ds.dims.map((n, d) => Math.ceil(n / ds.chunk[d]));
            const refs = [];
            const total = grid.reduce((a, b) => a * b, 1);
            for (let k = 0; k < total; k++) {
                const index = new Array(rank);
                for (let d = rank - 1, rest = k; d >= 0; d--) { index[d] = rest % grid[d]; rest = Math.floor(rest / grid[d]); }
                const origin = index.map((i, d) => i * ds.chunk[d]);
                const cells = ds.chunk.reduce((a, b) => a * b, 1);
                const values = new Float32Array(cells);
                for (let c = 0; c < cells; c++) {
                    const at = new Array(rank);
                    for (let d = rank - 1, rest = c; d >= 0; d--) { at[d] = origin[d] + (rest % ds.chunk[d]); rest = Math.floor(rest / ds.chunk[d]); }
                    if (at.every((v, d) => v < ds.dims[d])) values[c] = ds.at(at);
                }
                let bytes = Buffer.from(values.buffer);
                if (filters.includes('shuffle')) bytes = shuffle(bytes, 4);
                if (filters.includes('deflate')) bytes = deflateSync(bytes);
                refs.push({ origin, address: out.at, size: bytes.length });
                out.bytes(bytes);
            }
            const key = (ref) => new Out().u32(ref?.size ?? 0).u32(0).bytes(Buffer.concat([...(ref?.origin ?? ds.dims), 0].map((v) => new Out().u64(v).concat()))).concat();
            const node = (level, entries, keys, children) => {
                const at = out.at;
                out.bytes('TREE').u8(1).u8(level).u16(entries).u64(UNDEFINED).u64(UNDEFINED);
                for (let i = 0; i < entries; i++) { out.bytes(keys[i]); out.u64(children[i]); }
                out.bytes(keys[entries]);
                return at;
            };
            let btree;
            if (refs.length <= leaf) btree = node(0, refs.length, [...refs.map(key), key(null)], refs.map((r) => r.address));
            else {
                const groups = [];
                for (let i = 0; i < refs.length; i += leaf) groups.push(refs.slice(i, i + leaf));
                const leaves = groups.map((g) => node(0, g.length, [...g.map(key), key(null)], g.map((r) => r.address)));
                btree = node(1, groups.length, [...groups.map((g) => key(g[0])), key(null)], leaves);
            }
            messages.push(message(0x08, new Out().u8(3).u8(2).u8(rank + 1).u64(btree).bytes(Buffer.concat([...ds.chunk, 4].map((v) => new Out().u32(v).concat()))).concat()));
        }
        if (filters.length) {
            const pipeline = new Out().u8(2).u8(filters.length);
            for (const name of filters) pipeline.u16(name === 'shuffle' ? 2 : 1).u16(0).u16(1).u32(name === 'shuffle' ? 4 : 6);
            messages.push(message(0x0b, pipeline.concat()));
        }
        const at = out.at;
        out.bytes(objectHeader(messages));
        links.push({ name: ds.name, address: at });
    }
    const root = out.at;
    out.bytes(objectHeader(links.map(({ name, address }) =>
        message(0x06, new Out().u8(1).u8(0).u8(name.length).bytes(name).u64(address).concat()))));
    const file = out.concat();
    file.writeBigUInt64LE(BigInt(root), rootAt);
    return file;
}
