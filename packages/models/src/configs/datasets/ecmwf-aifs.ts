import { defineDataset, pad } from '../types.ts';
import { ECMWF_BUCKET } from '../shared.ts';
import { AIFS_HEIGHT_ALIASES, AIFS_PRECIP_ALIASES, ECMWF_STEPS_6H, ECMWF_SURFACE_ALIASES } from '../ecmwf.ts';
import {
    HRRR_DPT_2M,
    HRRR_MSLP,
    HRRR_TCDC,
    HRRR_TMP_2M,
    HRRR_TMP_SFC,
    HRRR_WIND_10M,
} from '../fields/surface.ts';
import { PRESSURE_LEVEL_FIELDS, pressureFields } from '../fields/pressure.ts';
import { APCP_TOTAL } from '../fields/precip.ts';
import { SNOWFALL_WE_TOTAL } from '../fields/winter.ts';
import { PRESSURE_LEVEL_DIAGNOSTICS } from '../fields/diagnostics.ts';
import {
    AIFS_PROFILE_HEIGHT_ALIASES,
    ECMWF_LEVELS,
    ECMWF_PROFILE_ALIASES,
    OPEN_METEO_LATLON_025,
    PROFILE_SURFACE,
} from '../profiles.ts';

/** AIFS publishes neither humidity nor dewpoint on pressure levels. */
const NO_HUMIDITY = Object.values(PRESSURE_LEVEL_FIELDS).flatMap((level) => [level.dpt, level.rh]);

/**
 * ECMWF AIFS Single, the open-data 0.25 degree forecast of ECMWF's machine-learning model, global. Laid out like IFS
 * HRES (one object per step, JSON `.index`, CCSDS packing) but every 6 hours to 360 h from all four cycles, and with
 * geopotential in place of height. A trained model, not a physics one, so it is labelled as AI. Viewer-only.
 */
export const ecmwfAifs = defineDataset({
    id: 'ecmwf-aifs',
    label: 'ECMWF AIFS',
    shortLabel: 'AIFS',
    docs: { runs: '00, 06, 12 and 18 UTC', length: '360 hours, every 6 hours' },
    about: {
        provider: 'ECMWF',
        category: 'ai',
        attribution: 'AI-generated forecast. Contains ECMWF open data, licensed CC BY 4.0',
    },
    access: { corsVerifiedOn: '2026-10-26' },
    surfaces: ['viewer'],
    source: { kind: 'grib2-index', dialect: 'ecmwf' },
    profiles: {
        levels: ECMWF_LEVELS,
        column: { kind: 'open-meteo', model: 'ecmwf_aifs025_single', grid: OPEN_METEO_LATLON_025 },
        // No terrain height in the surface fields.
        native: { file: 'prs', moisture: 'SPFH', omega: 'VVEL', surface: PROFILE_SURFACE },
    },
    bucket: ECMWF_BUCKET,
    objects: {
        oper: {
            serves: ['sfc', 'prs'],
            url: ({ date, cycle, step }) =>
                `${date}/${pad(cycle, 2)}z/aifs-single/0p25/oper/${date}${pad(cycle, 2)}0000-${step}h-oper-fc.grib2`,
        },
    },
    gate: ['oper'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [{ steps: [ECMWF_STEPS_6H] }],
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
    levelTargetsKm: [28, 56, 111],
    idx: {
        defaultExtra: 'any',
        variables: { TMP: 't', UGRD: 'u', VGRD: 'v' },
        components: {
            ...ECMWF_SURFACE_ALIASES,
            ...AIFS_PRECIP_ALIASES,
            ...AIFS_HEIGHT_ALIASES,
            ...ECMWF_PROFILE_ALIASES,
            ...AIFS_PROFILE_HEIGHT_ALIASES,
        },
    },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [
        HRRR_TMP_2M,
        HRRR_DPT_2M,
        HRRR_TMP_SFC,
        HRRR_MSLP,
        HRRR_WIND_10M,
        HRRR_TCDC,
        ...pressureFields(NO_HUMIDITY),
        APCP_TOTAL,
        SNOWFALL_WE_TOTAL,
        ...PRESSURE_LEVEL_DIAGNOSTICS,
    ],
});
