/** Packing constants of a GRIB2 simple-packed field: Y = (R + X * 2^E) / 10^D. */
interface PackingInfo {
    R: number;
    E: number;
    D: number;
}

/** The packed integer that stands for a physical value, or null when the value is not representable. */
export function packedOf(value: number, g: PackingInfo): number | null {
    const x = (value * 10 ** g.D - g.R) / 2 ** g.E;
    const r = Math.round(x);
    return Math.abs(x - r) < 1e-6 && r >= 0 ? r : null;
}

/** The physical value of a packed integer. */
export const physicalOf = (x: number, g: PackingInfo): number => (g.R + x * 2 ** g.E) / 10 ** g.D;
