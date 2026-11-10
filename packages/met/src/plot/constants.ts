/**
 * Defaults for the sounding plot geometry. Conventions follow SPC/SHARPpy. Lengths are viewBox units, not CSS:
 * the caller scales the whole drawing. Functions that read one take an optional override.
 */

/* Skew-T and hodograph geometry (phase 5.4). Lengths are viewBox units, not CSS; the page scales the whole drawing. */
/** The Skew-T frame: a square viewBox, log-p from the bottom to the top pressure, temperature across the bottom edge, isotherms leaning right by `skew` units per unit of height (1 is 45 degrees). */
export const SOUNDING_SKEWT = {
    size: 1000,
    pBottomHpa: 1050,
    pTopHpa: 100,
    tMinC: -40,
    tMaxC: 50,
    skew: 1,
    /** Spacing of the sampled adiabats and mixing-ratio lines. */
    lineStepHpa: 10,
} as const;
/** Background lines: isobars, isotherms, dry adiabats (potential temperature, degC), moist adiabats (degC at 1000 hPa), mixing ratios (g/kg). */
export const SOUNDING_SKEWT_ISOBARS_HPA = [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100] as const;
export const SOUNDING_SKEWT_ISOTHERM_STEP_C = 10;
export const SOUNDING_SKEWT_ISOTHERM_RANGE_C = { min: -150, max: 50 } as const;
export const SOUNDING_SKEWT_DRY_ADIABAT_STEP_C = 10;
export const SOUNDING_SKEWT_DRY_ADIABAT_RANGE_C = { min: -50, max: 250 } as const;
export const SOUNDING_SKEWT_MOIST_ADIABATS_C = [-20, -12, -4, 4, 12, 20, 28, 36] as const;
export const SOUNDING_SKEWT_MIXING_RATIOS_GKG = [1, 2, 4, 8, 12, 16, 20, 24] as const;
/** Mixing-ratio lines stop here; they crowd the upper half of the chart. */
export const SOUNDING_SKEWT_MIXING_RATIO_TOP_HPA = 600;
/** Height-above-ground ticks, km. */
export const SOUNDING_SKEWT_HEIGHT_TICKS_KM = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14] as const;
/** Wind barbs are thinned so two are never closer than this many viewBox units along the pressure axis. */
export const SOUNDING_SKEWT_BARB_MIN_GAP = 24;

/** The hodograph frame: a square viewBox centred on the origin, rings every `ringStepMs`, out to `maxSpeedMs`. */
export const SOUNDING_HODOGRAPH = { size: 1000, maxSpeedMs: 40, ringStepMs: 5 } as const;
/** Height layers (m AGL) that colour the hodograph trace; a layer includes its lower bound. */
export const SOUNDING_HODOGRAPH_LAYER_BOUNDS_M = [0, 1000, 3000, 6000, 9000, 12000] as const;

/** Wind barb arithmetic: speeds round to the nearest half barb, and a pennant is worth the most. */
export const SOUNDING_KNOTS_PER_MS = 1.943844;
export const SOUNDING_BARB_KT = { half: 5, full: 10, pennant: 50 } as const;
