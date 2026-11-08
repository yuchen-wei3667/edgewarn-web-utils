import zlib from 'node:zlib';

const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
})();
export function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

const be32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
const be16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
const signMag32 = (v) => (v < 0 ? (-v | 0x80000000) >>> 0 : v);

function pngChunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    return Buffer.concat([be32(data.length), t, data, be32(crc32(Buffer.concat([t, data])))]);
}

/** Encode one raw (unfiltered) row with PNG filter `ft`, given the previous raw row. */
export function filterRow(ft, raw, prev, bpp) {
    const out = Buffer.alloc(raw.length);
    for (let i = 0; i < raw.length; i++) {
        const a = i >= bpp ? raw[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let pred = 0;
        if (ft === 1) pred = a;
        else if (ft === 2) pred = b;
        else if (ft === 3) pred = (a + b) >> 1;
        else if (ft === 4) {
            const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        out[i] = (raw[i] - pred) & 0xff;
    }
    return out;
}

/** Pack integer values (row-major, length w*h) as big-endian pixels for the given bit layout. */
export function packPixels(values, w, h, depth, ctype) {
    const channels = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 6 ? 4 : 2;
    const bitsPP = depth * channels;
    const rowBytes = Math.ceil((w * bitsPP) / 8);
    const rows = [];
    for (let y = 0; y < h; y++) {
        const row = Buffer.alloc(rowBytes);
        for (let x = 0; x < w; x++) {
            const v = values[y * w + x];
            if (bitsPP >= 8) {
                const nb = bitsPP / 8;
                for (let k = 0; k < nb; k++) row[x * nb + k] = Math.floor(v / 2 ** (8 * (nb - 1 - k))) & 0xff;
            } else {
                const per = 8 / bitsPP;
                const idx = (x / per) | 0;
                row[idx] |= v << ((per - 1 - (x % per)) * bitsPP);
            }
        }
        rows.push(row);
    }
    return { rows, rowBytes, bpp: Math.max(1, bitsPP >> 3), bitsPP };
}

/** Build a PNG whose rows use the filter chosen by `filterFor(y)` (default: cycle 0..4). */
export function buildPng(values, w, h, { depth = 16, ctype = 0, filterFor = (y) => y % 5, idatSplit = 0 } = {}) {
    const { rows, bpp } = packPixels(values, w, h, depth, ctype);
    let prev = Buffer.alloc(rows[0].length);
    const parts = [];
    for (let y = 0; y < h; y++) {
        const ft = filterFor(y);
        parts.push(Buffer.from([ft]), filterRow(ft, rows[y], prev, bpp));
        prev = rows[y];
    }
    const z = zlib.deflateSync(Buffer.concat(parts));
    const ihdr = Buffer.concat([be32(w), be32(h), Buffer.from([depth, ctype, 0, 0, 0])]);
    const idats = [];
    if (idatSplit > 0) for (let o = 0; o < z.length; o += idatSplit) idats.push(pngChunk('IDAT', z.subarray(o, o + idatSplit)));
    else idats.push(pngChunk('IDAT', z));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr), ...idats, pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

export function section(num, body) {
    return Buffer.concat([be32(body.length + 5), Buffer.from([num]), body]);
}

export const DEFAULT_GRID = { lat1: 54.995, lon1: 230.005, lat2: 20.005, lon2: 299.995, di: 0.01, dj: 0.01 };

/** Sections 1, 3, 4, 5 builders return full section buffers. */
export function buildSections({ ni, nj, template, nbits, R = 0, E = 0, D = 0, grid = DEFAULT_GRID, refTime = [2026, 10, 11, 1, 4, 40] }) {
    const s1 = Buffer.alloc(16); // octets 6..21
    s1.writeUInt16BE(161, 0); // center
    s1.writeUInt16BE(refTime[0], 7);
    s1[9] = refTime[1]; s1[10] = refTime[2]; s1[11] = refTime[3]; s1[12] = refTime[4]; s1[13] = refTime[5];
    const sec1 = section(1, s1);

    const s3 = Buffer.alloc(72 - 5 + 4);
    const w32 = (octet, v) => s3.writeUInt32BE(v >>> 0, octet - 6);
    s3.writeUInt16BE(0, 13 - 6);
    w32(7, ni * nj);
    w32(31, ni); w32(35, nj);
    w32(47, signMag32(Math.round(grid.lat1 * 1e6)));
    w32(51, Math.round(grid.lon1 * 1e6));
    w32(56, signMag32(Math.round(grid.lat2 * 1e6)));
    w32(60, Math.round(grid.lon2 * 1e6));
    w32(64, Math.round(grid.di * 1e6));
    w32(68, Math.round(grid.dj * 1e6));
    s3[72 - 6] = 0;
    const sec3 = section(3, s3);

    const sec4 = section(4, Buffer.alloc(30));

    const s5 = Buffer.alloc(20 - 5 + 1);
    s5.writeUInt32BE(ni * nj, 6 - 6);
    s5.writeUInt16BE(template, 10 - 6);
    s5.writeFloatBE(R, 12 - 6);
    s5.writeUInt16BE(E < 0 ? 0x8000 | -E : E, 16 - 6);
    s5.writeUInt16BE(D < 0 ? 0x8000 | -D : D, 18 - 6);
    s5[20 - 6] = nbits;
    const sec5 = section(5, s5);

    const sec6 = section(6, Buffer.from([255]));
    return [sec1, sec3, sec4, sec5, sec6];
}

export function wrapGrib(sections) {
    const body = Buffer.concat([...sections, Buffer.from('7777')]);
    const head = Buffer.alloc(16);
    head.write('GRIB', 0, 'ascii');
    head[7] = 2;
    head.writeBigUInt64BE(BigInt(16 + body.length), 8);
    return Buffer.concat([head, body]);
}

/** A complete DRT 5.41 message. `values` are the packed integers, row-major. */
export function buildPngGrib({ values, ni, nj, depth = 16, ctype = 0, R = 0, E = 0, D = 0, filterFor, idatSplit, gzip = false, grid }) {
    const bitsPP = depth * (ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 6 ? 4 : 2);
    const png = buildPng(values, ni, nj, { depth, ctype, filterFor, idatSplit });
    const buf = wrapGrib([...buildSections({ ni, nj, template: 41, nbits: bitsPP, R, E, D, grid }), section(7, png)]);
    return gzip ? zlib.gzipSync(buf) : buf;
}

/** A complete DRT 5.0 message with `nbits` per value. */
export function buildSimpleGrib({ values, ni, nj, nbits, R = 0, E = 0, D = 0, gzip = false, grid }) {
    const total = Math.ceil((ni * nj * nbits) / 8);
    const data = Buffer.alloc(total);
    let bit = 0;
    if (nbits > 0) {
        for (const v of values) {
            for (let k = nbits - 1; k >= 0; k--) {
                const b = Math.floor(v / 2 ** k) % 2;
                if (b) data[bit >> 3] |= 0x80 >> (bit & 7);
                bit++;
            }
        }
    }
    const buf = wrapGrib([...buildSections({ ni, nj, template: 0, nbits, R, E, D, grid }), section(7, data)]);
    return gzip ? zlib.gzipSync(buf) : buf;
}

/** ReadableStream delivering `buf` in chunks of `chunk` bytes. Tracks reads and cancellation. */
export function chunkedStream(buf, chunk = 65536) {
    const state = { reads: 0, cancelled: false, bytesDelivered: 0 };
    let pos = 0;
    const stream = new ReadableStream({
        pull(c) {
            state.reads++;
            if (pos >= buf.length) { c.close(); return; }
            const part = buf.subarray(pos, pos + chunk);
            pos += part.length;
            state.bytesDelivered = pos;
            c.enqueue(new Uint8Array(part));
        },
        cancel() { state.cancelled = true; },
    }, { highWaterMark: 0 });
    return { stream, state };
}

/** Deterministic pseudo-random packed values below 2^bits. */
export function seededValues(n, bits, seed = 1) {
    const out = new Array(n);
    let s = seed >>> 0;
    const max = 2 ** bits;
    for (let i = 0; i < n; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        out[i] = Math.floor((s / 4294967296) * max);
    }
    return out;
}
