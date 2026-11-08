import type { GridInfo } from './types.ts';

import { o, s32, u16, u32, type Section5 } from '../sections.ts';

export { o, parseSection1, parseSection5, u32 } from '../sections.ts';
export type { Section5 } from '../sections.ts';

export function parseSection3(s: Uint8Array) {
    const tmpl = u16(s, o(13));
    if (tmpl !== 0) throw new Error(`Grid template 3.${tmpl} not supported (MRMS uses 3.0)`);
    return {
        ni: u32(s, o(31)),
        nj: u32(s, o(35)),
        lat1: s32(s, o(47)) * 1e-6,
        lon1: u32(s, o(51)) * 1e-6,
        lat2: s32(s, o(56)) * 1e-6,
        lon2: u32(s, o(60)) * 1e-6,
        di: u32(s, o(64)) * 1e-6,
        dj: u32(s, o(68)) * 1e-6,
        scanMode: s[o(72)],
    };
}

export type Section3 = ReturnType<typeof parseSection3>;

export function makeGridInfo(g: Section3, d: Section5, refTime: string): GridInfo {
    return { ...g, ...d, refTime };
}
