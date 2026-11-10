import { defineDataset, pad } from '../types.ts';
import { ECMWF_BUCKET } from '../shared.ts';
import { ECMWF_PHYSICS_ALIASES, ECMWF_STEPS_3H as STEPS_3H, ECMWF_SURFACE_ALIASES } from '../ecmwf.ts';
import {
    HRRR_DPT_2M,
    HRRR_GUST_SFC,
    HRRR_MSLP,
    HRRR_TCDC,
    HRRR_TMP_2M,
    HRRR_TMP_SFC,
    HRRR_WIND_10M,
} from '../fields/surface.ts';
import { PRESSURE_LEVEL_FIELDS, pressureFields } from '../fields/pressure.ts';
import { HRRR_MUCAPE } from '../fields/severe.ts';
import { HRRR_WEASD, SNOWFALL_WE_TOTAL } from '../fields/winter.ts';
import { APCP_TOTAL, HRRR_PRATE, HRRR_PWAT } from '../fields/precip.ts';
import { PRESSURE_LEVEL_DIAGNOSTICS } from '../fields/diagnostics.ts';
import { ECMWF_LEVELS, ECMWF_PROFILE_ALIASES, OPEN_METEO_LATLON_025, PROFILE_SURFACE } from '../profiles.ts';

/** The open data holds relative humidity on pressure levels, not dewpoint. */
const NO_DEWPOINT = Object.values(PRESSURE_LEVEL_FIELDS).map((level) => level.dpt);

/**
 * ECMWF IFS HRES, the open-data 0.25 degree deterministic forecast, global. One object per forecast hour holds the
 * surface and the pressure-level fields; the JSON `.index` beside it gives each message's byte range and the
 * messages are CCSDS-packed, so the model reads through the `ecmwf` addon (`utils/models/addons/ecmwf`). Viewer-only:
 * it is a global model the interactive map has no use for.
 *
 * ECMWF's short names stand in for the NCEP ones: `variables` renames the pressure-level ones (`TMP` is `t`) and
 * `components` the surface ones, which a single name cannot cover (`UGRD` is `u` aloft and `10u` at 10 m).
 */
export const ecmwfIfs = defineDataset({
    id: 'ecmwf-ifs',
    label: 'ECMWF IFS',
    shortLabel: 'IFS',
    docs: {
        runs: '00, 06, 12 and 18 UTC',
        length: '240 hours from 00 and 12 UTC, 144 hours from 06 and 18 UTC: every 3 hours, then every 6 after 144',
    },
    about: {
        provider: 'ECMWF',
        category: 'global',
        attribution: 'Contains ECMWF open data, licensed CC BY 4.0',
    },
    access: { corsVerifiedOn: '2026-10-26' },
    surfaces: ['viewer'],
    source: { kind: 'grib2-index', dialect: 'ecmwf' },
    profiles: {
        levels: ECMWF_LEVELS,
        column: { kind: 'open-meteo', model: 'ecmwf_ifs025', grid: OPEN_METEO_LATLON_025 },
        // The surface geopotential is in the analysis only, so a forecast step has no terrain height.
        native: { file: 'prs', moisture: 'SPFH', omega: 'VVEL', surface: PROFILE_SURFACE },
    },
    bucket: ECMWF_BUCKET,
    objects: {
        oper: {
            serves: ['sfc', 'prs'],
            url: ({ date, cycle, step }) =>
                `${date}/${pad(cycle, 2)}z/ifs/0p25/oper/${date}${pad(cycle, 2)}0000-${step}h-oper-fc.grib2`,
        },
    },
    gate: ['oper'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [
        { cycles: [0, 12], steps: [STEPS_3H, { from: 150 * 60, to: 240 * 60, every: 360 }] },
        { cycles: [6, 18], steps: [STEPS_3H] },
    ],
    // The message declares its first point at 180 degrees east: the grid runs from the date line, west to east.
    grid: {
        projection: 'latlon',
        nx: 1440,
        ny: 721,
        lat1: 90,
        lon1: 180,
        dlat: 0.25,
        dlon: 0.25,
        scanMode: 0x00,
        radiusM: 6371229,
    },
    // 0.25 degrees is 27.8 km at the equator, so the three levels are 28, 56 and 111 km.
    levelTargetsKm: [28, 56, 111],
    idx: {
        defaultExtra: 'any',
        variables: { TMP: 't', HGT: 'gh', RH: 'r', UGRD: 'u', VGRD: 'v' },
        components: { ...ECMWF_SURFACE_ALIASES, ...ECMWF_PHYSICS_ALIASES, ...ECMWF_PROFILE_ALIASES },
    },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [
        HRRR_TMP_2M,
        HRRR_DPT_2M,
        HRRR_TMP_SFC,
        HRRR_MSLP,
        HRRR_WIND_10M,
        HRRR_GUST_SFC,
        HRRR_TCDC,
        ...pressureFields(NO_DEWPOINT),
        HRRR_MUCAPE,
        HRRR_WEASD,
        SNOWFALL_WE_TOTAL,
        HRRR_PRATE,
        HRRR_PWAT,
        APCP_TOTAL,
        ...PRESSURE_LEVEL_DIAGNOSTICS,
    ],
});
