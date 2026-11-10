import { SOUNDING_BARB_KT, SOUNDING_KNOTS_PER_MS } from './constants.ts';

/** What a barb is made of: the speed rounded to the nearest half barb, split into pennants, full barbs and at most one half barb. */
export interface BarbSymbol {
    knots: number;
    pennants: number;
    full: number;
    half: boolean;
    calm: boolean;
}

export function barbSymbol(
    speedMs: number, barb: { readonly half: number; readonly full: number; readonly pennant: number } = SOUNDING_BARB_KT,
    knotsPerMs: number = SOUNDING_KNOTS_PER_MS,
): BarbSymbol {
    const { half, full, pennant } = barb;
    const knots = Math.round(speedMs * knotsPerMs / half) * half;
    const afterPennants = knots % pennant;
    return {
        knots,
        pennants: Math.floor(knots / pennant),
        full: Math.floor(afterPennants / full),
        half: afterPennants % full >= half,
        calm: knots === 0,
    };
}
