import { Memory } from '../../../../internal/memory.ts';
import { CTX_RUN, CTX_UNIFORM, MqDecoder } from './mq.ts';

/** Per-sample flags, kept in a one-cell border so neighbours need no bounds checks. */
const SIG = 1;
const NEG = 2;
/** Visited in this bit plane's significance-propagation pass. */
const VIS = 4;
/** Refined at least once. */
const REF = 8;

/** The orientation of a subband, which picks the zero-coding context table. */
export const Orient = { LL: 0, HL: 1, LH: 2, HH: 3 } as const;
export type Orient = (typeof Orient)[keyof typeof Orient];

/** Zero-coding context from the counts of significant horizontal (h), vertical (v) and diagonal (d) neighbours. */
function zeroContext(orient: Orient, h: number, v: number, d: number): number {
    if (orient === Orient.HH) {
        const hv = h + v;
        if (d >= 3) return 8;
        if (d === 2) return hv >= 1 ? 7 : 6;
        if (d === 1) return hv >= 2 ? 5 : hv === 1 ? 4 : 3;
        return hv >= 2 ? 2 : hv;
    }
    // The HL table is the LL/LH one with horizontal and vertical swapped.
    if (orient === Orient.HL) {
        const t = h;
        h = v;
        v = t;
    }
    if (h === 2) return 8;
    if (h === 1) return v >= 1 ? 7 : d >= 1 ? 6 : 5;
    if (v === 2) return 4;
    if (v === 1) return 3;
    return d >= 2 ? 2 : d;
}

/** Sign-coding context (9-13) and the bit the decoded symbol is XORed with, by horizontal and vertical contribution (each -1, 0, 1). */
const SIGN_CONTEXT = [
    // index (h + 1) * 3 + (v + 1)
    13, 12, 11, 10, 9, 10, 11, 12, 13,
];
const SIGN_XOR = [1, 1, 1, 1, 0, 0, 0, 0, 0];

/**
 * Decode the coding passes of one code block (T.800 annex D). `numBitPlanes` is the number of magnitude bit planes
 * that carry data (the subband's Mb less the block's missing most significant planes) and `passes` the passes the
 * packet header announced; the first is a cleanup pass on the top plane. The block uses the default coding style:
 * no bypass, reset, termination on each pass, vertically causal contexts or segmentation symbols. Returns the
 * signed coefficients in raster order.
 */

export function decodeCodeBlock(
    data: Uint8Array,
    w: number,
    h: number,
    orient: Orient,
    numBitPlanes: number,
    passes: number,
): Int32Array;
/** @internal */

export function decodeCodeBlock(
    data: Uint8Array,
    w: number,
    h: number,
    orient: Orient,
    numBitPlanes: number,
    passes: number,
    memory?: Memory,
): Int32Array;
export function decodeCodeBlock(
    data: Uint8Array,
    w: number,
    h: number,
    orient: Orient,
    numBitPlanes: number,
    passes: number,
    memory = new Memory(),
): Int32Array {
    const stride = w + 2;
    const flags = memory.array(Uint8Array, stride * (h + 2));
    const magnitude = memory.array(Int32Array, w * h);
    const mq = new MqDecoder(data, memory);
    const at = (x: number, y: number): number => (y + 1) * stride + x + 1;

    const neighbours = (i: number): number => {
        const hh = (flags[i - 1] & SIG) + (flags[i + 1] & SIG);
        const vv = (flags[i - stride] & SIG) + (flags[i + stride] & SIG);
        const dd =
            (flags[i - stride - 1] & SIG) +
            (flags[i - stride + 1] & SIG) +
            (flags[i + stride - 1] & SIG) +
            (flags[i + stride + 1] & SIG);
        return zeroContext(orient, hh, vv, dd);
    };
    const anyNeighbour = (i: number): boolean =>
        ((flags[i - 1] |
            flags[i + 1] |
            flags[i - stride] |
            flags[i + stride] |
            flags[i - stride - 1] |
            flags[i - stride + 1] |
            flags[i + stride - 1] |
            flags[i + stride + 1]) &
            SIG) !==
        0;
    const contribution = (f: number): number => ((f & SIG) === 0 ? 0 : (f & NEG) !== 0 ? -1 : 1);

    /** Decode a newly significant sample's sign and record it. */
    const becomeSignificant = (i: number, mIndex: number, plane: number): void => {
        const hc = Math.max(-1, Math.min(1, contribution(flags[i - 1]) + contribution(flags[i + 1])));
        const vc = Math.max(
            -1,
            Math.min(1, contribution(flags[i - stride]) + contribution(flags[i + stride])),
        );
        const k = (hc + 1) * 3 + (vc + 1);
        const negative = mq.decode(SIGN_CONTEXT[k]) ^ SIGN_XOR[k];
        flags[i] |= negative ? SIG | NEG : SIG;
        magnitude[mIndex] = 1 << plane;
    };

    let plane = numBitPlanes - 1;
    // 0 significance propagation, 1 magnitude refinement, 2 cleanup; the first pass of a block is a cleanup.
    let kind = 2;
    for (let pass = 0; pass < passes && plane >= 0; pass++) {
        for (let y0 = 0; y0 < h; y0 += 4) {
            const rows = Math.min(4, h - y0);
            for (let x = 0; x < w; x++) {
                if (kind === 0) {
                    for (let k = 0; k < rows; k++) {
                        const i = at(x, y0 + k);
                        if ((flags[i] & SIG) !== 0) continue;
                        const ctx = neighbours(i);
                        if (ctx === 0) continue;
                        if (mq.decode(ctx) === 1) becomeSignificant(i, (y0 + k) * w + x, plane);
                        flags[i] |= VIS;
                    }
                } else if (kind === 1) {
                    for (let k = 0; k < rows; k++) {
                        const i = at(x, y0 + k);
                        const f = flags[i];
                        if ((f & SIG) === 0 || (f & VIS) !== 0) continue;
                        const ctx = (f & REF) !== 0 ? 16 : anyNeighbour(i) ? 15 : 14;
                        if (mq.decode(ctx) === 1) magnitude[(y0 + k) * w + x] |= 1 << plane;
                        flags[i] |= REF;
                    }
                } else {
                    let k = 0;
                    if (rows === 4) {
                        let eligible = true;
                        for (let r = 0; r < 4 && eligible; r++) {
                            const i = at(x, y0 + r);
                            eligible = (flags[i] & (SIG | VIS)) === 0 && neighbours(i) === 0;
                        }
                        if (eligible) {
                            if (mq.decode(CTX_RUN) === 0) continue;
                            k = (mq.decode(CTX_UNIFORM) << 1) | mq.decode(CTX_UNIFORM);
                            becomeSignificant(at(x, y0 + k), (y0 + k) * w + x, plane);
                            k++;
                        }
                    }
                    for (; k < rows; k++) {
                        const i = at(x, y0 + k);
                        if ((flags[i] & (SIG | VIS)) !== 0) continue;
                        if (mq.decode(neighbours(i)) === 1) becomeSignificant(i, (y0 + k) * w + x, plane);
                    }
                }
            }
        }
        if (kind === 2) {
            // The visited marks belong to one bit plane.
            for (let i = 0; i < flags.length; i++) flags[i] &= ~VIS;
            plane--;
            kind = 0;
        } else {
            kind++;
        }
    }

    const out = memory.array(Int32Array, w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const m = magnitude[y * w + x];
            out[y * w + x] = (flags[at(x, y)] & NEG) !== 0 ? -m : m;
        }
    }
    memory.release(flags);
    memory.release(magnitude);
    mq.release();
    return out;
}
