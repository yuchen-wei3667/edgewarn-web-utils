import { defineDataset, pad } from '../types.ts';
import { RRFS_LEVELS, RRFS_OPS_BUCKET } from '../shared.ts';
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
import { HRRR_ASNOW_TOTAL } from '../fields/winter.ts';
import { HRRR_PRATE, HRRR_PTYPE } from '../fields/precip.ts';
import { RRFS_NA_EXTRA_FIELDS } from '../fields/rrfsNaExtras.ts';

export const rrfsSubh = defineDataset({
    id: 'rrfs-subh',
    label: 'RRFS 15-min',
    shortLabel: 'RRFS 15m',
    docs: { runs: 'Every 3 hours', length: '18 hours, every 15 minutes' },
    about: { provider: 'NOAA', category: 'convection-allowing' },
    access: { corsVerifiedOn: '2026-10-26' },
    surfaces: ['map', 'viewer'],
    // The 15-minute file has no pressure levels, so soundings read the hourly RRFS at the nearest hour.
    profiles: { borrowFrom: { dataset: 'rrfs', roundMinutes: 60 } },
    bucket: RRFS_OPS_BUCKET,
    objects: {
        surface: {
            serves: ['sfc', 'prs'],
            url: ({ date, cycle, step }) =>
                `rrfs.${date}/${pad(cycle, 2)}/rrfs.t${pad(cycle, 2)}z.2dfld.3km.subh.f${pad(step, 3)}.conus.grib2`,
        },
    },
    gate: ['surface'],
    products: [{ id: 'mean', label: 'Mean' }],
    cycles: [0, 3, 6, 9, 12, 15, 18, 21],
    // The sub-hourly files start at f001; the analysis hour lives in the hourly 2dfld file. They hold
    // only the three interior quarter-hours, so the hour boundary belongs to the hourly object.
    time: {
        stepMinutes: 15,
        idxUnit: 'minute',
        firstStep: 1,
        fileIndex: { kind: 'hourly-file', boundary: 'exclusive' },
    },
    runs: [{ steps: [{ from: 15, to: 18 * 60, every: 15 }] }],
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
    idx: { variables: { MSLMA: 'MSLET' }, levels: RRFS_LEVELS },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [
        HRRR_TMP_2M,
        HRRR_DPT_2M,
        HRRR_THETAE_2M,
        HRRR_MSLP,
        HRRR_WIND_10M,
        HRRR_GUST_SFC,
        HRRR_VIS,
        HRRR_REFC,
        HRRR_ASNOW_TOTAL,
        HRRR_PTYPE,
        HRRR_PRATE,
    ],
    notOffered: RRFS_NA_EXTRA_FIELDS,
});
