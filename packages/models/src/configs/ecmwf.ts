/**
 * Pieces the ECMWF open-data models share (IFS, IFS ENS, AIFS, AIFS ENS). Not a model, so it sits outside `datasets/`.
 * ECMWF's short names stand in for the NCEP ones the fields are written against.
 */
import type { ComponentAlias, StepRange } from './types.ts';

/** Metres (of water or of precipitation) to millimetres. */
const M_TO_MM = { scale: 1000 };

/** The open data holds geopotential (m²/s²) where the fields expect metres: divided by g, then the field's own metres to decametres. */
export const GEOPOTENTIAL_TO_M = { scale: 1 / 9.80665 };

export const ECMWF_SURFACE_ALIASES: Readonly<Record<string, ComponentAlias>> = {
    'TMP|2 m above ground': { variable: '2t', level: 'sfc' },
    'DPT|2 m above ground': { variable: '2d', level: 'sfc' },
    'TMP|surface': { variable: 'skt', level: 'sfc' },
    'MSLMA|mean sea level': { variable: 'msl', level: 'sfc' },
    'UGRD|10 m above ground': { variable: '10u', level: 'sfc' },
    'VGRD|10 m above ground': { variable: '10v', level: 'sfc' },
    // A fraction, not a percentage.
    'TCDC|entire atmosphere': { variable: 'tcc', level: 'sfc', transform: { scale: 100 } },
    'APCP|surface': { variable: 'tp', level: 'sfc', transform: M_TO_MM },
    // Accumulated since the run started, like `tp`; the open data carries it for IFS, IFS ENS, AIFS and AIFS ENS.
    'TSNOWP|surface': { variable: 'sf', level: 'sfc', transform: M_TO_MM },
};

/**
 * AIFS and AIFS ENS publish `tp` and `sf` in kg/m² (1 kg/m² of water is 1 mm), where IFS publishes metres. Left unscaled; the metres
 * aliases above would make them 1000 times too large (a 53 m snowfall). Spread after `ECMWF_SURFACE_ALIASES`.
 */
export const AIFS_PRECIP_ALIASES: Readonly<Record<string, ComponentAlias>> = {
    'APCP|surface': { variable: 'tp', level: 'sfc' },
    'TSNOWP|surface': { variable: 'sf', level: 'sfc' },
};

/** Components only the physics models (IFS, IFS ENS) publish. */
export const ECMWF_PHYSICS_ALIASES: Readonly<Record<string, ComponentAlias>> = {
    // The maximum over the three (after 144 h, six) hours before the step; its message is labelled with the step.
    'GUST|surface': { variable: '10fg', level: 'sfc' },
    'PWAT|entire atmosphere (considered as a single layer)': { variable: 'tcwv', level: 'sfc' },
    'CAPE|255-0 mb above ground': { variable: 'mucape', level: 'sfc' },
    'WEASD|surface': { variable: 'sd', level: 'sfc', transform: M_TO_MM },
    'PRATE|surface': { variable: 'tprate', level: 'sfc' },
};

/** AIFS publishes geopotential (`z`) on pressure levels instead of height, at the levels the fields use. */
export const AIFS_HEIGHT_ALIASES: Readonly<Record<string, ComponentAlias>> = Object.fromEntries(
    [925, 850, 700, 500, 250].map((mb) => [
        `HGT|${mb} mb`,
        { variable: 'z', level: `${mb} mb`, transform: GEOPOTENTIAL_TO_M },
    ]),
);

/** Every 3 hours to 144 h. */
export const ECMWF_STEPS_3H: StepRange = { from: 0, to: 144 * 60, every: 180 };
/** Every 6 hours to 360 h. */
export const ECMWF_STEPS_6H: StepRange = { from: 0, to: 360 * 60, every: 360 };
