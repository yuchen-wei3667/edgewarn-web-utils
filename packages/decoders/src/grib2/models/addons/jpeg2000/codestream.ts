import { Memory } from '../../../../internal/memory.ts';
import { decodeCodeBlock, Orient } from './tier1.ts';

/**
 * A JPEG 2000 (ITU-T T.800) code stream decoder for the profile GRIB2 packing 5.40 uses: one tile, one component,
 * one quality layer, the reversible 5/3 wavelet and the default code-block style. That is what NCEP's encoder
 * (g2c with OpenJPEG) writes; anything else throws, with the reason, instead of decoding wrongly.
 */

interface DecodedImage {
    width: number;
    height: number;
    /** Bits per sample the stream declares. */
    precision: number;
    /** Samples in raster order, DC level shift undone. */
    samples: Int32Array;
}

const SOC = 0xff4f;
const SIZ = 0xff51;
const COD = 0xff52;
const QCD = 0xff5c;
const SOT = 0xff90;
const SOD = 0xff93;
const EOC = 0xffd9;
/** Markers that change how the tile is coded or where its data is, which this decoder does not follow. */
const COC = 0xff53;
const QCC = 0xff5d;
const UNSUPPORTED_MARKERS: Record<number, string> = {
    0xff5e: 'region of interest (RGN)',
    0xff5f: 'progression order change (POC)', 0xff60: 'packed packet headers (PPM)', 0xff61: 'packed packet headers (PPT)',
};

const ceilDiv = (a: number, b: number): number => (a <= 0 ? 0 : Math.ceil(a / b));

const u16 = (d: Uint8Array, o: number): number => (d[o] << 8) | d[o + 1];
const u32 = (d: Uint8Array, o: number): number => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;

interface CodingStyle {
    levels: number;
    xcb: number;
    ycb: number;
    /** log2 of the precinct width and height per resolution; 15 when the stream leaves them at the default. */
    ppx: number[];
    ppy: number[];
}

/** Reads the bit-stuffed packet headers: after a 0xff byte the next byte carries only seven bits. */
class HeaderBits {
    private cur = 0;
    private left = 0;
    private afterFF = false;
    pos: number;
    private readonly data: Uint8Array;
    constructor(data: Uint8Array, start: number) {
        this.data = data;
        this.pos = start;
    }
    bit(): number {
        if (this.left === 0) {
            if (this.pos >= this.data.length) throw new Error('JPEG 2000 packet header runs past the end of the stream');
            this.cur = this.data[this.pos++];
            this.left = this.afterFF ? 7 : 8;
            this.afterFF = this.cur === 0xff;
        }
        this.left--;
        return (this.cur >> this.left) & 1;
    }
    bits(n: number): number {
        let v = 0;
        for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
        return v;
    }
    /** Finish the header: the next packet body starts on a byte boundary, after a stuffed byte if the last one was 0xff. */
    align(): void {
        this.left = 0;
        if (this.afterFF) this.pos++;
        this.afterFF = false;
    }
}

/** A tag tree (T.800 B.10.2): each node holds the smallest value of the leaves below it, sent incrementally. */
class TagTree {
    private readonly widths: number[] = [];
    private readonly values: Int32Array[] = [];
    private readonly lows: Int32Array[] = [];
    release(memory: Memory): void { for (const a of [...this.values, ...this.lows]) memory.release(a); this.values.length = 0; this.lows.length = 0; }
    constructor(w: number, h: number, memory: Memory) {
        let lw = w, lh = h;
        for (;;) {
            this.widths.push(lw);
            this.values.push(memory.array(Int32Array, lw * lh).fill(0x7fffffff));
            this.lows.push(memory.array(Int32Array, lw * lh));
            if (lw <= 1 && lh <= 1) break;
            lw = Math.ceil(lw / 2);
            lh = Math.ceil(lh / 2);
        }
    }
    /** Whether the leaf's value is below `threshold`, reading what the header sends to decide. */
    decode(bits: HeaderBits, x: number, y: number, threshold: number): boolean {
        let low = 0;
        for (let k = this.widths.length - 1; k >= 0; k--) {
            const i = (y >> k) * this.widths[k] + (x >> k);
            const lows = this.lows[k];
            const values = this.values[k];
            if (low > lows[i]) lows[i] = low; else low = lows[i];
            while (low < threshold && low < values[i]) {
                if (bits.bit()) values[i] = low; else low++;
            }
            lows[i] = low;
        }
        return this.values[0][y * this.widths[0] + x] < threshold;
    }
}

interface Band {
    orient: Orient;
    /** Index of the band's exponent in the quantization marker. */
    index: number;
    width: number;
    height: number;
    coefficients: Int32Array;
}

interface Block {
    band: Band;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    zeroPlanes: number;
    passes: number;
    length: number;
}

function parseSize(d: Uint8Array, o: number) {
    const x = u32(d, o + 6), y = u32(d, o + 10);
    const x0 = u32(d, o + 14), y0 = u32(d, o + 18);
    const tx = u32(d, o + 22), ty = u32(d, o + 26);
    const tx0 = u32(d, o + 30), ty0 = u32(d, o + 34);
    const components = u16(d, o + 38);
    if (components !== 1) throw new Error(`JPEG 2000 with ${components} components not supported`);
    if (x0 !== 0 || y0 !== 0 || tx0 !== 0 || ty0 !== 0 || tx < x || ty < y) throw new Error('JPEG 2000 with an image offset or several tiles not supported');
    const ssiz = d[o + 40];
    if (d[o + 41] !== 1 || d[o + 42] !== 1) throw new Error('JPEG 2000 with subsampled components not supported');
    return { width: x, height: y, precision: (ssiz & 0x7f) + 1, signed: (ssiz & 0x80) !== 0 };
}

/** The wavelet levels, code-block size, style and precincts (SPcod/SPcoc), which start at `sp`; `scod` says whether precinct sizes follow. */
function parseCodingParams(d: Uint8Array, scod: number, sp: number): CodingStyle {
    const levels = d[sp];
    const xcb = (d[sp + 1] & 0x0f) + 2;
    const ycb = (d[sp + 2] & 0x0f) + 2;
    if (d[sp + 3] !== 0) throw new Error(`JPEG 2000 code-block style 0x${d[sp + 3].toString(16)} not supported (default style only)`);
    if (d[sp + 4] !== 1) throw new Error('JPEG 2000 irreversible (9/7) wavelet not supported');
    const ppx: number[] = [];
    const ppy: number[] = [];
    for (let r = 0; r <= levels; r++) {
        const byte = (scod & 1) !== 0 ? d[sp + 5 + r] : 0xff;
        ppx.push(byte & 0x0f);
        ppy.push(byte >> 4);
    }
    return { levels, xcb, ycb, ppx, ppy };
}

/** COD: the parameters for every component, plus the packet order, layers and component transform of the tile. */
function parseCoding(d: Uint8Array, o: number): CodingStyle {
    const scod = d[o + 4];
    if ((scod & 0x06) !== 0) throw new Error('JPEG 2000 with SOP or EPH markers not supported');
    // With one layer and one component, layer-resolution and resolution-layer order are the same packet order.
    if (d[o + 5] > 1) throw new Error('JPEG 2000 progression order not supported (layer-resolution or resolution-layer only)');
    if (u16(d, o + 6) !== 1) throw new Error('JPEG 2000 with several quality layers not supported');
    if (d[o + 8] !== 0) throw new Error('JPEG 2000 with a multiple component transform not supported');
    return parseCodingParams(d, scod, o + 9);
}

/** COC: the parameters of component 0 (the only one), which win over COD. */
function parseComponentCoding(d: Uint8Array, o: number): CodingStyle {
    if (d[o + 4] !== 0) throw new Error('JPEG 2000 component coding style for another component');
    return parseCodingParams(d, d[o + 5], o + 6);
}

/** Exponent per subband from a no-quantization (reversible) QCD marker, and the guard bits. */
function parseQuantization(d: Uint8Array, o: number, component = false): { guard: number; exponents: number[] } {
    // QCC names its component first (one octet below 257 components); component 0 is the only one here.
    if (component && d[o + 4] !== 0) throw new Error('JPEG 2000 quantization for another component');
    const at = component ? o + 5 : o + 4;
    const sqcd = d[at];
    if ((sqcd & 0x1f) !== 0) throw new Error('JPEG 2000 with quantized coefficients not supported');
    const exponents: number[] = [];
    for (let p = at + 1; p < o + 2 + u16(d, o + 2); p++) exponents.push(d[p] >> 3);
    return { guard: sqcd >> 5, exponents };
}

/** One dimension of the reversible 5/3 inverse transform, in place over `n` interleaved samples (even = low pass). */
function inverse53(a: Int32Array, offset: number, stride: number, n: number): void {
    if (n < 2) return;
    for (let i = 0; i < n; i += 2) {
        const left = a[offset + (i > 0 ? i - 1 : i + 1) * stride];
        const right = a[offset + (i + 1 < n ? i + 1 : i - 1) * stride];
        a[offset + i * stride] -= (left + right + 2) >> 2;
    }
    for (let i = 1; i < n; i += 2) {
        const left = a[offset + (i - 1) * stride];
        const right = a[offset + (i + 1 < n ? i + 1 : i - 1) * stride];
        a[offset + i * stride] += (left + right) >> 1;
    }
}

/** Decode a JPEG 2000 code stream (a bare .j2k, as GRIB2 stores it). */

export function decodeCodestream(data: Uint8Array): DecodedImage;
/** @internal */

export function decodeCodestream(data: Uint8Array, memory?: Memory): DecodedImage;
export function decodeCodestream(data: Uint8Array, memory = new Memory()): DecodedImage {
    if (u16(data, 0) !== SOC) throw new Error('Not a JPEG 2000 code stream');
    // Kept in one object because the marker reader below assigns them, which TypeScript does not see through a closure.
    const header: { size: ReturnType<typeof parseSize> | null; style: CodingStyle | null; quant: ReturnType<typeof parseQuantization> | null } = {
        size: null, style: null, quant: null,
    };
    /** A marker of the main or the tile-part header; the later ones override the earlier. */
    const readMarker = (marker: number, at: number): void => {
        if (marker === SIZ) header.size = parseSize(data, at);
        else if (marker === COD) header.style = parseCoding(data, at);
        else if (marker === COC) header.style = parseComponentCoding(data, at);
        else if (marker === QCD) header.quant = parseQuantization(data, at);
        else if (marker === QCC) header.quant = parseQuantization(data, at, true);
        else if (UNSUPPORTED_MARKERS[marker]) throw new Error(`JPEG 2000 ${UNSUPPORTED_MARKERS[marker]} not supported`);
    };
    let o = 2;
    for (;;) {
        const marker = u16(data, o);
        if (marker === SOT) break;
        readMarker(marker, o);
        o += 2 + u16(data, o + 2);
        if (o >= data.length) throw new Error('JPEG 2000 code stream has no tile');
    }
    // A tile-part header may override COD and QCD, so the tile's parameters are read after it (below).

    // The one tile-part: its header, then SOD, then the packets.
    const sotStart = o;
    if (data[o + 10] !== 0 || data[o + 11] > 1) throw new Error('JPEG 2000 with several tile-parts not supported');
    const psot = u32(data, o + 6);
    o += 2 + u16(data, o + 2);
    while (u16(data, o) !== SOD) {
        if (o + 4 > data.length) throw new Error('JPEG 2000 tile header has no SOD marker');
        readMarker(u16(data, o), o);
        o += 2 + u16(data, o + 2);
    }
    o += 2;
    let end = psot === 0 ? data.length : sotStart + psot;
    if (u16(data, end - 2) === EOC) end -= 2;
    const packets = data.subarray(0, end);

    const { size, style, quant } = header;
    if (!size || !style || !quant) throw new Error('JPEG 2000 header lacks SIZ, COD or QCD');
    const { width, height, precision } = size;
    const { levels, xcb, ycb, ppx, ppy } = style;
    const resW = (r: number): number => ceilDiv(width, 2 ** (levels - r));
    const resH = (r: number): number => ceilDiv(height, 2 ** (levels - r));

    // Subbands: the lowest resolution is the LL band, each higher one adds HL, LH and HH.
    const bands: Band[][] = [];
    for (let r = 0; r <= levels; r++) {
        if (r === 0) {
            const w = resW(0), h = resH(0);
            bands.push([{ orient: Orient.LL, index: 0, width: w, height: h, coefficients: memory.array(Int32Array, w * h) }]);
            continue;
        }
        const nb = levels - r + 1;
        const half = 2 ** (nb - 1);
        const make = (orient: Orient, xob: number, yob: number, index: number): Band => {
            const w = ceilDiv(width - half * xob, 2 ** nb);
            const h = ceilDiv(height - half * yob, 2 ** nb);
            return { orient, index, width: w, height: h, coefficients: memory.array(Int32Array, w * h) };
        };
        const base = 3 * (r - 1) + 1;
        bands.push([make(Orient.HL, 1, 0, base), make(Orient.LH, 0, 1, base + 1), make(Orient.HH, 1, 1, base + 2)]);
    }

    let pos = o;
    for (let r = 0; r <= levels; r++) {
        const precinctsX = Math.max(1, ceilDiv(resW(r), 2 ** ppx[r]));
        const precinctsY = Math.max(1, ceilDiv(resH(r), 2 ** ppy[r]));
        // Within a resolution above the lowest, a precinct covers half as many band samples as resolution ones.
        const shift = r === 0 ? 0 : 1;
        const cbX = Math.min(xcb, ppx[r] - shift);
        const cbY = Math.min(ycb, ppy[r] - shift);
        for (let py = 0; py < precinctsY; py++) {
            for (let px = 0; px < precinctsX; px++) {
                const bits = new HeaderBits(packets, pos);
                const blocks: Block[] = [];
                if (bits.bit() === 1) {
                    for (const band of bands[r]) {
                        const bx0 = px * 2 ** (ppx[r] - shift), bx1 = Math.min(band.width, (px + 1) * 2 ** (ppx[r] - shift));
                        const by0 = py * 2 ** (ppy[r] - shift), by1 = Math.min(band.height, (py + 1) * 2 ** (ppy[r] - shift));
                        if (bx0 >= bx1 || by0 >= by1) continue;
                        const col0 = Math.floor(bx0 / 2 ** cbX), col1 = Math.ceil(bx1 / 2 ** cbX);
                        const row0 = Math.floor(by0 / 2 ** cbY), row1 = Math.ceil(by1 / 2 ** cbY);
                        const inclusion = new TagTree(col1 - col0, row1 - row0, memory);
                        const zeroPlanes = new TagTree(col1 - col0, row1 - row0, memory);
                        const lblock = memory.array(Int32Array, (col1 - col0) * (row1 - row0)).fill(3);
                        for (let row = row0; row < row1; row++) {
                            for (let col = col0; col < col1; col++) {
                                const cx = col - col0, cy = row - row0;
                                if (!inclusion.decode(bits, cx, cy, 1)) continue;
                                let planes = 1;
                                while (!zeroPlanes.decode(bits, cx, cy, planes)) planes++;
                                let passes: number;
                                if (!bits.bit()) passes = 1;
                                else if (!bits.bit()) passes = 2;
                                else {
                                    const two = bits.bits(2);
                                    if (two < 3) passes = 3 + two;
                                    else {
                                        const five = bits.bits(5);
                                        passes = five < 31 ? 6 + five : 37 + bits.bits(7);
                                    }
                                }
                                const li = cy * (col1 - col0) + cx;
                                while (bits.bit()) lblock[li]++;
                                const length = bits.bits(lblock[li] + Math.floor(Math.log2(passes)));
                                blocks.push({
                                    band, x0: Math.max(col * 2 ** cbX, bx0), y0: Math.max(row * 2 ** cbY, by0),
                                    x1: Math.min((col + 1) * 2 ** cbX, bx1), y1: Math.min((row + 1) * 2 ** cbY, by1),
                                    zeroPlanes: planes - 1, passes, length,
                                });
                            }
                        }
                        inclusion.release(memory);
                        zeroPlanes.release(memory);
                        memory.release(lblock);
                    }
                }
                bits.align();
                pos = bits.pos;
                for (const block of blocks) {
                    if (pos + block.length > packets.length) throw new Error('JPEG 2000 code block runs past the end of the stream');
                    const exponent = quant.exponents[block.band.index];
                    if (exponent === undefined) throw new Error('JPEG 2000 quantization marker has too few subbands');
                    const planes = quant.guard + exponent - 1 - block.zeroPlanes;
                    const w = block.x1 - block.x0, h = block.y1 - block.y0;
                    if (planes > 0) {
                        const coefficients = decodeCodeBlock(packets.subarray(pos, pos + block.length), w, h, block.band.orient, planes, block.passes, memory);
                        for (let y = 0; y < h; y++) {
                            block.band.coefficients.set(coefficients.subarray(y * w, (y + 1) * w), (block.y0 + y) * block.band.width + block.x0);
                        }
                        memory.release(coefficients);
                    }
                    pos += block.length;
                }
            }
        }
    }

    // Synthesis: each resolution interleaves the one below with its three subbands, then undoes the filter across rows and down columns.
    let plane = bands[0][0].coefficients;
    bands[0] = [];
    for (let r = 1; r <= levels; r++) {
        const w = resW(r), h = resH(r);
        const next = memory.array(Int32Array, w * h);
        const lw = resW(r - 1);
        const [hl, lh, hh] = bands[r];
        const place = (src: Int32Array, sw: number, sh: number, xo: number, yo: number): void => {
            for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) next[(2 * y + yo) * w + 2 * x + xo] = src[y * sw + x];
        };
        place(plane, lw, resH(r - 1), 0, 0);
        place(hl.coefficients, hl.width, hl.height, 1, 0);
        place(lh.coefficients, lh.width, lh.height, 0, 1);
        place(hh.coefficients, hh.width, hh.height, 1, 1);
        for (let y = 0; y < h; y++) inverse53(next, y * w, 1, w);
        for (let x = 0; x < w; x++) inverse53(next, x, w, h);
        memory.release(plane);
        for (const band of bands[r]) memory.release(band.coefficients);
        bands[r] = [];
        plane = next;
    }

    const samples = memory.array(Int32Array, width * height);
    const shift = size.signed ? 0 : 2 ** (precision - 1);
    const max = size.signed ? 2 ** (precision - 1) - 1 : 2 ** precision - 1;
    const min = size.signed ? -(2 ** (precision - 1)) : 0;
    for (let i = 0; i < samples.length; i++) samples[i] = Math.max(min, Math.min(max, plane[i] + shift));
    memory.release(plane);
    return { width, height, precision, samples };
}
