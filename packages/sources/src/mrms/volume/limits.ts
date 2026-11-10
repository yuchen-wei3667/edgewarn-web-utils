const MILES_TO_METERS = 1609.344;

/** Defaults for the radar volume tools. Each function takes the one it needs as an optional argument. */
export const MRMS_VOLUME_LIMITS = {
    /** Longest cross-section line, in metres (96 mi). */
    maxLineMeters: 96 * MILES_TO_METERS,
    /** Longest side of the 3D box, in metres (96 mi). */
    maxBoxMeters: 96 * MILES_TO_METERS,
    /** The region grows by this fraction of the shape's span on every side. */
    padFraction: 0.25,
    /** Cells added around the shape so interpolation at its edge never reads outside the region. */
    haloCells: 1,
    /** Profile columns per cell of the line, clamped to this range. */
    minProfileColumns: 64,
    maxProfileColumns: 600,
    /** Levels fetched first (km MSL); the rest follow by bisecting the largest gap. */
    seedLevelsKm: [0.5, 3, 6, 10, 14, 19] as readonly number[],
} as const;
