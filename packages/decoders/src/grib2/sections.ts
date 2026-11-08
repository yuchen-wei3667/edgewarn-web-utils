/** GRIB2 primitives shared by the MRMS and HRRR decoders. */

export const u16 = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1];
export const u32 = (b: Uint8Array, o: number): number =>
    ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
// GRIB uses sign-magnitude integers.
const s16 = (b: Uint8Array, o: number): number => {
    const v = u16(b, o);
    return v & 0x8000 ? -(v & 0x7fff) : v;
};
export const s32 = (b: Uint8Array, o: number): number => {
    const v = u32(b, o);
    return v >= 0x80000000 ? -(v - 0x80000000) : v;
};
const f32 = (b: Uint8Array, o: number): number =>
    new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, false);
/** GRIB octet numbers are 1-based; o(n) is the 0-based offset within the section. */
export const o = (n: number): number => n - 1;

export function parseSection1(s: Uint8Array): { refTime: string } {
    const t = new Date(Date.UTC(u16(s, o(13)), s[o(15)] - 1, s[o(16)], s[o(17)], s[o(18)], s[o(19)]));
    return { refTime: t.toISOString() };
}

export function parseSection5(s: Uint8Array) {
    return {
        template: u16(s, o(10)),
        R: f32(s, o(12)),
        E: s16(s, o(16)),
        D: s16(s, o(18)),
        nbits: s[o(20)],
    };
}

export type Section5 = ReturnType<typeof parseSection5>;
