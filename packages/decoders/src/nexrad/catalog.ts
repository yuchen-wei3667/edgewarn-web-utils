/** Product ids the app already uses (`NexradProduct`) and the 3-letter moments they come from in Level II. */
type NexradProductId = 'DBZH' | 'VRADH' | 'WRADH' | 'PHIDP' | 'RHOHV' | 'ZDR';

export const NEXRAD_MOMENT_OF: Readonly<Record<NexradProductId, string>> = {
    DBZH: 'REF',
    VRADH: 'VEL',
    WRADH: 'SW',
    PHIDP: 'PHI',
    RHOHV: 'RHO',
    ZDR: 'ZDR',
};

/** The Level III product letter that carries a moment (`N1G` is velocity at the second tilt). */
export const LEVEL3_PRODUCT_LETTER: Readonly<Record<string, string>> = { REF: 'B', VEL: 'G', ZDR: 'X', RHO: 'C' };

/** Whether Level III carries `moment`. Spectrum width and differential phase have no digital radial product. */
export const hasLevel3Moment = (moment: string): boolean => moment in LEVEL3_PRODUCT_LETTER;

/** Only velocity shows range-folded gates (purple); every other product hides them. */
export const NEXRAD_FOLD_COLOR: Readonly<Partial<Record<NexradProductId, readonly [number, number, number]>>> = {
    VRADH: [0.55, 0.1, 0.65],
};

/** Raw code to physical value. 0 (no data) and 1 (range folded) are not values. */
export function codeToValue(code: number, scale: number, offset: number): number | null {
    return code < 2 ? null : (code - offset) / scale;
}

/** Angles as shown in the picker: 0.48 -> "0.5°" (one decimal, like the NWS products). */
export const formatAngle = (angle: number) => `${angle.toFixed(1)}°`;
