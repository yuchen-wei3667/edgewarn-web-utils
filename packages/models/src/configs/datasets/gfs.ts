import { defineDataset, pad } from '../types.ts';
import { GFS_BUCKET } from '../shared.ts';
import {
    HRRR_DPT_2M,
    HRRR_GUST_SFC,
    HRRR_MSLP,
    HRRR_RH_2M,
    HRRR_TCDC,
    HRRR_TMP_2M,
    HRRR_TMP_SFC,
    HRRR_VIS,
    HRRR_WIND_10M,
} from '../fields/surface.ts';
import { HRRR_ABSV_500MB, PRESSURE_LEVEL_FIELDS, pressureFields } from '../fields/pressure.ts';
import {
    HRRR_FRZLVL,
    HRRR_MLCAPE,
    HRRR_MLCIN,
    HRRR_MUCAPE,
    HRRR_MUCIN,
    HRRR_REFC,
    HRRR_SBCAPE,
    HRRR_SBCIN,
    HRRR_SRH_03KM,
} from '../fields/severe.ts';
import { HRRR_SNOD, HRRR_WEASD } from '../fields/winter.ts';
import { APCP_6H, APCP_TOTAL, HRRR_PRATE, HRRR_PTYPE, HRRR_PWAT } from '../fields/precip.ts';
import { HRRR_EHI_03KM, PRESSURE_LEVEL_DIAGNOSTICS } from '../fields/diagnostics.ts';
import { GFS_LEVELS, OPEN_METEO_LATLON_025, PROFILE_SURFACE_WITH_HEIGHT } from '../profiles.ts';

/** GFS publishes no dewpoint on pressure levels, so those fields are left out. */
const NO_DEWPOINT = Object.values(PRESSURE_LEVEL_FIELDS).map((level) => level.dpt);

/**
 * NOAA GFS 0.25 degree, global. One `.idx`-indexed object per forecast hour holds the surface and the
 * pressure-level fields. Hourly to 120 h, then every 3 hours to 384 h. Viewer-only: it is a global model
 * the interactive map has no use for.
 */
export const gfs = defineDataset({
    id: 'gfs',
    label: 'GFS',
    shortLabel: 'GFS',
    docs: { runs: '00, 06, 12 and 18 UTC', length: '384 hours: hourly to 120, then every 3 hours' },
    about: { provider: 'NOAA', category: 'global' },
    access: { corsVerifiedOn: '2026-10-26' },
    surfaces: ['viewer'],
    profiles: {
        levels: GFS_LEVELS,
        column: { kind: 'open-meteo', model: 'ncep_gfs025', grid: OPEN_METEO_LATLON_025 },
        // No pressure-level dewpoint, so relative humidity is the moisture.
        native: { file: 'prs', moisture: 'RH', omega: 'VVEL', surface: PROFILE_SURFACE_WITH_HEIGHT },
    },
    bucket: GFS_BUCKET,
    objects: {
        pgrb: {
            serves: ['sfc', 'prs'],
            url: ({ date, cycle, step }) =>
                `gfs.${date}/${pad(cycle, 2)}/atmos/gfs.t${pad(cycle, 2)}z.pgrb2.0p25.f${pad(step, 3)}`,
        },
    },
    gate: ['pgrb'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [
        {
            steps: [
                { from: 0, to: 120 * 60, every: 60 },
                { from: 123 * 60, to: 384 * 60, every: 180 },
            ],
        },
    ],
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
    // 0.25 degrees is 27.8 km at the equator, so the three levels are 28, 56 and 111 km.
    levelTargetsKm: [28, 56, 111],
    idx: { variables: { MSLMA: 'PRMSL' } },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [
        HRRR_TMP_2M,
        HRRR_DPT_2M,
        HRRR_RH_2M,
        HRRR_TMP_SFC,
        HRRR_MSLP,
        HRRR_WIND_10M,
        HRRR_GUST_SFC,
        HRRR_VIS,
        HRRR_TCDC,
        ...pressureFields(NO_DEWPOINT),
        HRRR_ABSV_500MB,
        HRRR_REFC,
        HRRR_SBCAPE,
        HRRR_SBCIN,
        HRRR_MLCAPE,
        HRRR_MLCIN,
        HRRR_MUCAPE,
        HRRR_MUCIN,
        HRRR_SRH_03KM,
        HRRR_FRZLVL,
        HRRR_SNOD,
        HRRR_WEASD,
        HRRR_PTYPE,
        HRRR_PRATE,
        HRRR_PWAT,
        APCP_6H,
        APCP_TOTAL,
        ...PRESSURE_LEVEL_DIAGNOSTICS,
        HRRR_EHI_03KM,
    ],
    // Past 120 h the buckets are 3 hours; a six-hour accumulation exists only at the steps that are multiples of 6 h (measured f006-f384).
    fieldSteps: { APCP_6H: [{ from: 360, to: 384 * 60, every: 360 }] },
});
