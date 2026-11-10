import { HRRR_SATELLITE_FIELDS } from '../fields/satellite.ts';
import { defineDataset, pad } from '../types.ts';
import { ALL_HOURS, HRRR_BUCKET } from '../shared.ts';
import {
    HRRR_DPT_2M,
    HRRR_GUST_SFC,
    HRRR_MSLP,
    HRRR_THETAE_2M,
    HRRR_TMP_2M,
    HRRR_VIS,
    HRRR_WIND_10M,
} from '../fields/surface.ts';
import { HRRR_REFC } from '../fields/severe.ts';
import { HRRR_APCP_1H, HRRR_PRATE, HRRR_PTYPE } from '../fields/precip.ts';
import { HRRR_SNOWFALL_WE_1H } from '../fields/winter.ts';

export const hrrrSubh = defineDataset({
    id: 'hrrr-subh',
    label: 'HRRR 15-min',
    shortLabel: 'HRRR 15m',
    docs: { runs: 'Every hour', length: '18 hours, every 15 minutes' },
    about: { provider: 'NOAA', category: 'convection-allowing' },
    access: { corsVerifiedOn: '2026-10-26' },
    surfaces: ['map', 'viewer'],
    // The 15-minute file has no pressure levels, so soundings read the hourly HRRR at the nearest hour.
    profiles: { borrowFrom: { dataset: 'hrrr', roundMinutes: 60 } },
    bucket: HRRR_BUCKET,
    // The native sub-hourly file is the only object, so both of the selectors' sources land on it, and
    // it carries every level, so it alone gates publication.
    objects: {
        subh: {
            serves: ['sfc', 'prs'],
            url: ({ date, cycle, step }) =>
                `hrrr.${date}/conus/hrrr.t${pad(cycle, 2)}z.wrfsubhf${pad(step, 2)}.grib2`,
        },
    },
    gate: ['subh'],
    products: [{ id: 'mean', label: 'Mean' }],
    cycles: ALL_HOURS,
    time: {
        stepMinutes: 15,
        idxUnit: 'minute',
        firstStep: 0,
        fileIndex: { kind: 'hourly-file', boundary: 'inclusive' },
    },
    // The sub-hourly product is published to 18 h whatever the hourly run's length.
    runs: [{ steps: [{ from: 0, to: 18 * 60, every: 15 }] }],
    grid: {
        projection: 'lambert',
        nx: 1799,
        ny: 1059,
        lat1: 21.138123,
        lon1: 237.280472,
        lov: 262.5,
        latin1: 38.5,
        latin2: 38.5,
        dx: 3000,
        dy: 3000,
        scanMode: 0x40,
        radiusM: 6371229,
    },
    levelTargetsKm: [3, 6, 9],
    idx: {},
    defaultField: HRRR_TMP_2M,
    // The 15-minute file has no pressure, so the isobars read the hourly HRRR at the nearest hour.
    isobars: { field: HRRR_MSLP, borrowFrom: { dataset: 'hrrr', roundMinutes: 60 } },
    fields: [
        ...HRRR_SATELLITE_FIELDS,
        HRRR_TMP_2M,
        HRRR_DPT_2M,
        HRRR_THETAE_2M,
        HRRR_WIND_10M,
        HRRR_GUST_SFC,
        HRRR_VIS,
        HRRR_REFC,
        HRRR_PTYPE,
        HRRR_APCP_1H,
        HRRR_PRATE,
        HRRR_SNOWFALL_WE_1H,
    ],
});
