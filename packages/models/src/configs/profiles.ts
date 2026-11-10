/**
 * Pieces the `profiles` blocks share (soundings and cross sections). Not a model, so it sits outside `datasets/`.
 * Level lists are hPa, descending.
 */
import type { ComponentAlias, DeclaredGrid, ModelSelector } from './types.ts';
import { GEOPOTENTIAL_TO_M } from './ecmwf.ts';
import { sfc } from './fields/selectors.ts';

/** 1000 to 100 hPa every 25: the levels the convection-allowing NCEP models carry. */
export const NCEP_CAM_LEVELS: readonly number[] = Array.from({ length: 37 }, (_, i) => 1000 - 25 * i);
/** A cross section's default subset of `NCEP_CAM_LEVELS`: every 25 hPa up to 700 hPa, every 50 above, to bound bytes. */
export const NCEP_CAM_SECTION_LEVELS: readonly number[] = NCEP_CAM_LEVELS.filter(
    (p) => p >= 700 || p % 50 === 0,
);
/** The 21 levels at or below 100 hPa that GFS `pgrb2.0p25` carries: every 25 hPa to 900, then every 50. */
export const GFS_LEVELS: readonly number[] = [
    1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100,
];
/** What ECMWF IFS and AIFS, and NOAA AIGFS, carry at or below 100 hPa. */
export const ECMWF_LEVELS: readonly number[] = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100];

/**
 * Open-Meteo's copy of a global 0.25 degree model: BBOX [-90, -180, 90, 179.75] in its `meta.json`, so rows run south to
 * north from -180. Checked 2026-10-29 against the elevation of Denver, Lhasa, Norman and Quito in `HSURF.om`.
 */
export const OPEN_METEO_LATLON_025: DeclaredGrid = {
    projection: 'latlon',
    nx: 1440,
    ny: 721,
    lat1: -90,
    lon1: -180,
    dlat: 0.25,
    dlon: 0.25,
    scanMode: 0x40,
    radiusM: 6371229,
};

/** The bottom of a profile, in the canonical NCEP spelling. */
export const PROFILE_SURFACE: readonly ModelSelector[] = [
    sfc('PRES', 'surface'),
    sfc('TMP', '2 m above ground'),
    sfc('DPT', '2 m above ground'),
    sfc('UGRD', '10 m above ground'),
    sfc('VGRD', '10 m above ground'),
];
/** The same with the model's terrain height, for the models that publish it. */
export const PROFILE_SURFACE_WITH_HEIGHT: readonly ModelSelector[] = [
    ...PROFILE_SURFACE,
    sfc('HGT', 'surface'),
];

/**
 * ECMWF's spellings of what a profile reads that the datasets' `variables` renames do not cover: specific humidity
 * and vertical velocity (Pa/s, as NCEP's VVEL) at each level, and surface pressure.
 */
export const ECMWF_PROFILE_ALIASES: Readonly<Record<string, ComponentAlias>> = {
    ...Object.fromEntries(
        ECMWF_LEVELS.flatMap((mb) => [
            [`SPFH|${mb} mb`, { variable: 'q', level: `${mb} mb` }],
            [`VVEL|${mb} mb`, { variable: 'w', level: `${mb} mb` }],
        ]),
    ),
    'PRES|surface': { variable: 'sp', level: 'sfc' },
};
/** AIFS publishes geopotential (`z`) on pressure levels instead of height, at every profile level. */
export const AIFS_PROFILE_HEIGHT_ALIASES: Readonly<Record<string, ComponentAlias>> = Object.fromEntries(
    ECMWF_LEVELS.map((mb) => [
        `HGT|${mb} mb`,
        { variable: 'z', level: `${mb} mb`, transform: GEOPOTENTIAL_TO_M },
    ]),
);
