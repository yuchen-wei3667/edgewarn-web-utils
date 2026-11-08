/**
 * Allocation-free zlib/DEFLATE decoder (RFC 1950/1951) that writes into a caller-owned buffer.
 * Synchronous, so run it in a worker for large images. Huffman codes up to FAST_BITS long resolve
 * with one table lookup; longer (rare) codes fall back to a canonical bit-by-bit walk. All tables
 * are module-level and rebuilt in place per block, so decoding a chunk allocates nothing.
 */

const FAST_BITS = 10;
const FAST_MASK = (1 << FAST_BITS) - 1;
const MAX_BITS = 15;

const LEN_BASE = new Uint16Array([3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]);
const LEN_EXTRA = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]);
const DIST_BASE = new Uint16Array([1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]);
const DIST_EXTRA = new Uint8Array([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]);
const CL_ORDER = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

export class InflateError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InflateError';
    }
}

/** One canonical Huffman code: a fast lookup table plus what the slow path needs. */
class Huffman {
    /** `symbol << 4 | length`, indexed by the next FAST_BITS input bits; 0 = code is longer. */
    fast = new Uint16Array(1 << FAST_BITS);
    count = new Uint16Array(MAX_BITS + 1);
    symbols: Uint16Array;
    private offs = new Uint16Array(MAX_BITS + 2);

    constructor(maxSymbols: number) {
        this.symbols = new Uint16Array(maxSymbols);
    }

    get workspaceBytes(): number { return this.fast.byteLength + this.count.byteLength + this.symbols.byteLength + this.offs.byteLength; }

    /** Build from code lengths `lengths[start .. start + n)` for symbols 0 .. n-1. */
    build(lengths: Uint8Array, start: number, n: number): void {
        const { count, offs, symbols, fast } = this;
        count.fill(0);
        for (let i = 0; i < n; i++) count[lengths[start + i]]++;
        count[0] = 0;
        offs[1] = 0;
        for (let l = 1; l <= MAX_BITS; l++) offs[l + 1] = offs[l] + count[l];
        for (let i = 0; i < n; i++) if (lengths[start + i]) symbols[offs[lengths[start + i]]++] = i;

        fast.fill(0);
        let code = 0, k = 0;
        for (let l = 1; l <= MAX_BITS; l++) {
            for (let c = 0; c < count[l]; c++, k++, code++) {
                if (l > FAST_BITS) continue;
                // Codes are MSB-first in the stream but read LSB-first, so index by the reversed code.
                let rev = 0;
                for (let b = 0; b < l; b++) rev |= ((code >> b) & 1) << (l - 1 - b);
                const entry = (symbols[k] << 4) | l;
                for (let i = rev; i <= FAST_MASK; i += 1 << l) fast[i] = entry;
            }
            code <<= 1;
        }
    }
}

const litLen = new Huffman(288);
const dist = new Huffman(32);
const codeLen = new Huffman(19);
const lengths = new Uint8Array(288 + 32);
const fixedLit = new Huffman(288);
const fixedDist = new Huffman(32);
{
    const l = new Uint8Array(288);
    l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
    fixedLit.build(l, 0, 288);
    fixedDist.build(new Uint8Array(30).fill(5), 0, 30);
}

/** Shared table backing stores, charged once per active ABI operation. */
export const INFLATE_WORKSPACE_BYTES = [LEN_BASE, LEN_EXTRA, DIST_BASE, DIST_EXTRA, CL_ORDER, lengths].reduce((n, a) => n + a.byteLength, 0)
    + [litLen, dist, codeLen, fixedLit, fixedDist].reduce((n, h) => n + h.workspaceBytes, 0);

/** Bit-reader state, used only off the hot path (block headers); the symbol loop keeps it in locals. */
interface BitState { p: number; bits: number; cnt: number }

function takeBits(src: Uint8Array, st: BitState, k: number): number {
    while (st.cnt < k) { st.bits |= (st.p < src.length ? src[st.p] : 0) << st.cnt; st.p++; st.cnt += 8; }
    const v = st.bits & ((1 << k) - 1);
    st.bits >>>= k;
    st.cnt -= k;
    return v;
}

/** Canonical decode (as in zlib's puff.c) of a code longer than FAST_BITS. Returns `symbol | length << 16`. */
function slowDecode(h: Huffman, bits: number): number {
    const count = h.count;
    let code = 0, first = 0, index = 0;
    for (let l = 1; l <= MAX_BITS; l++) {
        code |= bits & 1;
        bits >>>= 1;
        const c = count[l];
        if (code - c < first) return h.symbols[index + (code - first)] | (l << 16);
        index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new InflateError('Invalid Huffman code');
}

function decodeSlow(src: Uint8Array, st: BitState, h: Huffman): number {
    while (st.cnt < MAX_BITS) { st.bits |= (st.p < src.length ? src[st.p] : 0) << st.cnt; st.p++; st.cnt += 8; }
    const e = h.fast[st.bits & FAST_MASK];
    const r = e ? (e >> 4) | ((e & 15) << 16) : slowDecode(h, st.bits);
    st.bits >>>= r >>> 16;
    st.cnt -= r >>> 16;
    return r & 0xffff;
}

/** Read a dynamic block's code-length header and rebuild `litLen` / `dist` in place. */
function readDynamicTables(src: Uint8Array, st: BitState): void {
    const hlit = takeBits(src, st, 5) + 257, hdist = takeBits(src, st, 5) + 1, hclen = takeBits(src, st, 4) + 4;
    lengths.fill(0, 0, 19);
    for (let i = 0; i < hclen; i++) lengths[CL_ORDER[i]] = takeBits(src, st, 3);
    codeLen.build(lengths, 0, 19);
    for (let i = 0; i < hlit + hdist;) {
        const sym = decodeSlow(src, st, codeLen);
        if (sym < 16) { lengths[i++] = sym; continue; }
        let rep = 0, val = 0;
        if (sym === 16) {
            if (i === 0) throw new InflateError('Repeat with no previous length');
            val = lengths[i - 1];
            rep = 3 + takeBits(src, st, 2);
        } else if (sym === 17) rep = 3 + takeBits(src, st, 3);
        else rep = 11 + takeBits(src, st, 7);
        if (i + rep > hlit + hdist) throw new InflateError('Code lengths overrun');
        lengths.fill(val, i, i + rep);
        i += rep;
    }
    litLen.build(lengths, 0, hlit);
    dist.build(lengths, hlit, hdist);
}

const state: BitState = { p: 0, bits: 0, cnt: 0 };

/** LZ77 back-reference copy. Returns the new output position. */
function copyMatch(dst: Uint8Array, o: number, len: number, d: number, cap: number): number {
    if (d > o) throw new InflateError('Distance before start of output');
    if (o + len > cap) throw new InflateError('Output overflow');
    let from = o - d;
    if (d >= len && len > 16) {
        dst.copyWithin(o, from, from + len);
        return o + len;
    }
    // Overlapping copies repeat the window, so they must go byte by byte.
    for (const end = o + len; o < end;) dst[o++] = dst[from++];
    return o;
}

/**
 * Inflate a zlib stream (`raw` = bare DEFLATE) from `src` into `dst`. Returns the bytes written.
 * Throws if the output would overflow `dst`. The Adler-32 trailer is not checked.
 */
export function inflate(src: Uint8Array, dst: Uint8Array, raw = false): number {
    const n = src.length;
    let p = 0;
    if (!raw) {
        if (n < 2 || (src[0] & 0x0f) !== 8 || ((src[0] << 8) | src[1]) % 31 !== 0) throw new InflateError('Bad zlib header');
        if (src[1] & 0x20) throw new InflateError('Preset dictionaries are not supported');
        p = 2;
    }
    // `pos` (a bit offset into src) is the only state carried between blocks. No closures below:
    // V8 would move captured locals into a heap context and slow every access.
    let pos = p * 8, o = 0, final = 0;
    const cap = dst.length;
    const st = state;
    do {
        st.p = pos >> 3; st.bits = 0; st.cnt = 0;
        takeBits(src, st, pos & 7);
        final = takeBits(src, st, 1);
        const type = takeBits(src, st, 2);
        let lit = fixedLit, dis = fixedDist;
        if (type === 0) {
            // Stored block: byte-aligned LEN, NLEN, then LEN raw bytes.
            const q = (st.p * 8 - st.cnt + 7) >> 3;
            const len = src[q] | (src[q + 1] << 8);
            if (q + 4 + len > n || o + len > cap) throw new InflateError('Stored block overruns input or output');
            dst.set(src.subarray(q + 4, q + 4 + len), o);
            o += len;
            pos = (q + 4 + len) * 8;
            continue;
        } else if (type === 2) {
            readDynamicTables(src, st);
            lit = litLen; dis = dist;
        } else if (type !== 1) {
            throw new InflateError('Reserved block type');
        }
        pos = st.p * 8 - st.cnt;
        // Hot loop peeks 3-4 bytes at the bit position (≥ 17 valid bits), like fflate. One symbol
        // advances at most 48 bits, so below `limit` no peek runs past the end of src.
        const lf = lit.fast, df = dis.fast;
        const limit = (n - 9) * 8;
        for (;;) {
            if (pos > limit) {
                // Near the end of input: fall back to the bounds-checked reader.
                st.p = pos >> 3; st.bits = 0; st.cnt = 0;
                takeBits(src, st, pos & 7);
                const sym = decodeSlow(src, st, lit);
                if (sym < 256) {
                    if (o >= cap) throw new InflateError('Output overflow');
                    dst[o++] = sym;
                } else if (sym !== 256) {
                    const li = sym - 257;
                    if (li >= 29) throw new InflateError('Bad length symbol');
                    const len = LEN_BASE[li] + takeBits(src, st, LEN_EXTRA[li]);
                    const ds = decodeSlow(src, st, dis);
                    if (ds >= 30) throw new InflateError('Bad distance symbol');
                    const d = DIST_BASE[ds] + takeBits(src, st, DIST_EXTRA[ds]);
                    o = copyMatch(dst, o, len, d, cap);
                }
                pos = st.p * 8 - st.cnt;
                if (sym === 256) break;
                continue;
            }
            let i = pos >> 3;
            let win = (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16)) >>> (pos & 7);
            let e = lf[win & FAST_MASK], sym: number;
            if (e) { sym = e >> 4; pos += e & 15; } else { const r = slowDecode(lit, win); sym = r & 0xffff; pos += r >>> 16; }
            if (sym < 256) {
                if (o >= cap) throw new InflateError('Output overflow');
                dst[o++] = sym;
                continue;
            }
            if (sym === 256) break;
            const li = sym - 257;
            if (li >= 29) throw new InflateError('Bad length symbol');
            i = pos >> 3;
            win = (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> (pos & 7);
            const le = LEN_EXTRA[li];
            const len = LEN_BASE[li] + (win & ((1 << le) - 1));
            pos += le;
            // 32 - 7 - 5 = 20 bits left in `win`: enough for the 15-bit distance code.
            win >>>= le;
            e = df[win & FAST_MASK];
            if (e) { sym = e >> 4; pos += e & 15; } else { const r = slowDecode(dis, win); sym = r & 0xffff; pos += r >>> 16; }
            if (sym >= 30) throw new InflateError('Bad distance symbol');
            const de = DIST_EXTRA[sym];
            i = pos >> 3;
            win = (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16)) >>> (pos & 7);
            const d = DIST_BASE[sym] + (win & ((1 << de) - 1));
            pos += de;
            o = copyMatch(dst, o, len, d, cap);
        }
        if ((pos + 7) >> 3 > n) throw new InflateError('Truncated DEFLATE stream');
    } while (!final);
    return o;
}
