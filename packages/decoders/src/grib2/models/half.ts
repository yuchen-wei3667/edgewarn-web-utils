const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** IEEE 754 half-precision NaN bit pattern, used for missing values. */
export const HALF_NAN = 0x7e00;

/** Float32 -> float16 bits, round-to-nearest-even. Values beyond ±65504 become ±Infinity. */
export function toHalf(v: number): number {
    f32[0] = v;
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    const e = ((x >>> 23) & 0xff) - 112; // rebias 127 -> 15
    const m = x & 0x7fffff;
    if (e >= 31) return (x & 0x7fffffff) > 0x7f800000 ? HALF_NAN : sign | 0x7c00;
    if (e <= 0) {
        // subnormal or zero
        if (e < -10) return sign;
        const full = m | 0x800000;
        const shift = 14 - e;
        const h = full >>> shift;
        const rem = full & ((1 << shift) - 1);
        const halfway = 1 << (shift - 1);
        return sign | (h + (rem > halfway || (rem === halfway && h & 1) ? 1 : 0));
    }
    const h = sign | (e << 10) | (m >>> 13);
    const rem = m & 0x1fff;
    return rem > 0x1000 || (rem === 0x1000 && h & 1) ? h + 1 : h; // carry into the exponent is correct
}

/** float16 bits -> number (for inspection / CPU-side sampling). */
export function fromHalf(h: number): number {
    const e = (h >>> 10) & 0x1f;
    const m = h & 0x3ff;
    const s = h & 0x8000 ? -1 : 1;
    if (e === 0) return s * m * 2 ** -24;
    if (e === 31) return m ? NaN : s * Infinity;
    return s * (1 + m / 1024) * 2 ** (e - 15);
}
