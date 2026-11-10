import { defineDataset, pad } from '../types.ts';
import { AIGFS_BUCKET } from '../shared.ts';
import { HRRR_DPT_2M, HRRR_MSLP, HRRR_TMP_2M, HRRR_TMP_SFC, HRRR_WIND_10M } from '../fields/surface.ts';
import { PRESSURE_LEVEL_FIELDS, pressureFields } from '../fields/pressure.ts';
import { APCP_TOTAL } from '../fields/precip.ts';
import { ECMWF_LEVELS, OPEN_METEO_LATLON_025, PROFILE_SURFACE } from '../profiles.ts';

/** AIGFS publishes neither humidity nor dewpoint on pressure levels (it has specific humidity). */
const NO_HUMIDITY = Object.values(PRESSURE_LEVEL_FIELDS).flatMap((level) => [level.dpt, level.rh]);

const object = (kind: 'sfc' | 'pres') => ({
    serves: [kind === 'sfc' ? 'sfc' : 'prs'] as const,
    url: ({ date, cycle, step }: { date: string; cycle: number; step: number }) =>
        `aigfs.${date}/${pad(cycle, 2)}/model/atmos/grib2/aigfs.t${pad(cycle, 2)}z.${kind}.f${pad(step, 3)}.grib2`,
});

/**
 * NOAA AIGFS, the operational GraphCast-based global forecast, 0.25 degree, every 6 hours to 384 h from all four
 * cycles. Two `.idx`-indexed objects per step, one for the surface and one for the pressure levels. A trained
 * model, not a physics one, so it is labelled as AI. Viewer-only.
 */
export const aigfs = defineDataset({
    id: 'aigfs',
    label: 'AIGFS',
    shortLabel: 'AIGFS',
    docs: { runs: '00, 06, 12 and 18 UTC', length: '384 hours, every 6 hours' },
    about: {
        provider: 'NOAA',
        category: 'ai',
        attribution: 'AI-generated forecast from NOAA AIGFS (GraphCast-based)',
    },
    access: { corsVerifiedOn: '2026-10-26' },
    surfaces: ['viewer'],
    profiles: {
        levels: ECMWF_LEVELS,
        column: { kind: 'open-meteo', model: 'ncep_aigfs025', grid: OPEN_METEO_LATLON_025 },
        // The pressure-level object holds specific humidity and no dewpoint, and the model publishes no terrain height.
        native: { file: 'prs', moisture: 'SPFH', omega: 'VVEL', surface: PROFILE_SURFACE },
    },
    bucket: AIGFS_BUCKET,
    objects: { sfc: object('sfc'), pres: object('pres') },
    gate: ['sfc', 'pres'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [{ steps: [{ from: 0, to: 384 * 60, every: 360 }] }],
    grid: {
        projection: 'latlon',
        nx: 1440,
        ny: 721,
        lat1: 90,
        lon1: 0,
        dlat: 0.25,
        dlon: 0.25,
        scanMode: 0x00,
        radiusM: 6371229,
    },
    levelTargetsKm: [28, 56, 111],
    idx: { variables: { MSLMA: 'PRMSL' } },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [
        HRRR_TMP_2M,
        HRRR_DPT_2M,
        HRRR_TMP_SFC,
        HRRR_MSLP,
        HRRR_WIND_10M,
        ...pressureFields(NO_HUMIDITY),
        APCP_TOTAL,
    ],
});
