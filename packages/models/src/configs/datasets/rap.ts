import { defineDataset, pad } from '../types.ts';
import { ALL_HOURS, RAP_BUCKET } from '../shared.ts';
import {
    HRRR_DPT_2M,
    HRRR_GUST_SFC,
    HRRR_MSLP,
    HRRR_RH_2M,
    HRRR_THETAE_2M,
    HRRR_TCDC,
    HRRR_TMP_2M,
    HRRR_TMP_SFC,
    HRRR_VIS,
    HRRR_WIND_10M,
} from '../fields/surface.ts';
import { HRRR_ABSV_500MB, PRESSURE_LEVEL_FIELDS, pressureFields } from '../fields/pressure.ts';
import {
    HRRR_BLI,
    HRRR_CAPE_03KM,
    HRRR_FRZLVL,
    HRRR_LFTX,
    HRRR_MLCAPE,
    HRRR_MLCIN,
    HRRR_MUCAPE,
    HRRR_MUCIN,
    HRRR_REFC,
    HRRR_SBCAPE,
    HRRR_SBCIN,
    HRRR_SHEAR_06KM,
    HRRR_SRH_01KM,
    HRRR_SRH_03KM,
    HRRR_STORM_MOTION,
} from '../fields/severe.ts';
import { HRRR_ASNOW_TOTAL, HRRR_SNOD, HRRR_WEASD } from '../fields/winter.ts';
import { APCP_6H, APCP_TOTAL, HRRR_APCP_1H, HRRR_PRATE, HRRR_PTYPE, HRRR_PWAT } from '../fields/precip.ts';
import {
    HRRR_EHI_01KM,
    HRRR_EHI_03KM,
    HRRR_STP_FIXED,
    PRESSURE_LEVEL_DIAGNOSTICS,
    STORM_RELATIVE_DIAGNOSTICS,
} from '../fields/diagnostics.ts';

/** RAP publishes no dewpoint on pressure levels, so those fields are left out. */
const NO_DEWPOINT = Object.values(PRESSURE_LEVEL_FIELDS).map((level) => level.dpt);

/**
 * NOAA Rapid Refresh, 13 km CONUS. One `.idx`-indexed object per forecast hour holds the surface and the
 * pressure-level fields. Hourly from the start of every run. The 03, 09, 15 and 21 UTC cycles run 51 hours,
 * the others 21. Viewer-only: the interactive map has no use for it yet.
 */
const object = {
    serves: ['sfc', 'prs'] as const,
    url: ({ date, cycle, step }: { date: string; cycle: number; step: number }) =>
        `rap.${date}/rap.t${pad(cycle, 2)}z.awp130pgrbf${pad(step, 2)}.grib2`,
};

/** The cycles that run to 51 hours. */
const LONG_RUN_CYCLES = [3, 9, 15, 21];

export const rap = defineDataset({
    id: 'rap',
    label: 'RAP',
    shortLabel: 'RAP',
    docs: { runs: 'Every hour', length: '51 hours at 03, 09, 15 and 21 UTC, 21 hours otherwise' },
    about: { provider: 'NOAA', category: 'regional' },
    access: { corsVerifiedOn: '2026-11-01' },
    source: { kind: 'grib2-index', dialect: 'wgrib2', jpeg2000: true },
    surfaces: ['viewer'],
    bucket: RAP_BUCKET,
    objects: { pgrb: object },
    gate: ['pgrb'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: ALL_HOURS,
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [
        { cycles: LONG_RUN_CYCLES, steps: [{ from: 0, to: 51 * 60, every: 60 }] },
        { steps: [{ from: 0, to: 21 * 60, every: 60 }] },
    ],
    grid: {
        projection: 'lambert',
        nx: 451,
        ny: 337,
        lat1: 16.281,
        lon1: 233.862,
        lov: 265,
        latin1: 25,
        latin2: 25,
        dx: 13545,
        dy: 13545,
        scanMode: 0x40,
        radiusM: 6371229,
    },
    levelTargetsKm: [13, 26, 39],
    idx: {},
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [
        HRRR_TMP_2M,
        HRRR_DPT_2M,
        HRRR_RH_2M,
        HRRR_TMP_SFC,
        HRRR_THETAE_2M,
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
        HRRR_CAPE_03KM,
        HRRR_SRH_01KM,
        HRRR_SRH_03KM,
        HRRR_SHEAR_06KM,
        HRRR_STORM_MOTION,
        HRRR_LFTX,
        HRRR_BLI,
        HRRR_FRZLVL,
        HRRR_SNOD,
        HRRR_WEASD,
        HRRR_ASNOW_TOTAL,
        HRRR_PTYPE,
        HRRR_APCP_1H,
        HRRR_PRATE,
        HRRR_PWAT,
        APCP_TOTAL,
    ],
    // Diagnostics are left out on purpose. RAP has no 6-hour windows (f12 carries 9-12 and 11-12, not 6-12), so APCP_6H is too.
    notOffered: [
        ...PRESSURE_LEVEL_DIAGNOSTICS,
        ...STORM_RELATIVE_DIAGNOSTICS,
        HRRR_STP_FIXED,
        HRRR_EHI_01KM,
        HRRR_EHI_03KM,
        APCP_6H,
    ],
});
