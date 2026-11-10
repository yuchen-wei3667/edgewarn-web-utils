import { RRFS_SATELLITE_FIELDS } from '../fields/satellite.ts';
import { defineDataset, pad } from '../types.ts';
import { RRFS_LEVELS, RRFS_OPS_BUCKET } from '../shared.ts';
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
import {
    HRRR_BLI,
    HRRR_CAPE_03KM,
    HRRR_FRZLVL,
    HRRR_LFTX,
    HRRR_MLCAPE,
    HRRR_MLCIN,
    HRRR_MUCAPE,
    HRRR_MUCIN,
    HRRR_MXUPHL_25KM,
    HRRR_REFC,
    HRRR_SBCAPE,
    HRRR_SBCIN,
    HRRR_SRH_01KM,
    HRRR_SRH_03KM,
    HRRR_STORM_MOTION,
} from '../fields/severe.ts';
import { HRRR_ASNOW_TOTAL, HRRR_SNOD, HRRR_WEASD } from '../fields/winter.ts';
import { HRRR_APCP_1H, HRRR_PRATE, HRRR_PTYPE, HRRR_PWAT } from '../fields/precip.ts';
import { RRFS_NA_EXTRA_FIELDS } from '../fields/rrfsNaExtras.ts';
import { HRRR_EHI_01KM, HRRR_EHI_03KM } from '../fields/diagnostics.ts';

/** NOAA publishes only the `2dfld` file on the North America grid: there is no `prslev` file. */
const surface = {
    serves: ['sfc'] as const,
    url: ({ date, cycle, step }: { date: string; cycle: number; step: number }) =>
        `rrfs.${date}/${pad(cycle, 2)}/rrfs.t${pad(cycle, 2)}z.2dfld.13km.f${pad(step, 3)}.na.grib2`,
};

/**
 * NOAA RRFS on its 13 km North America grid, the coarse domain that runs beside the 3 km CONUS one. The grid is
 * rotated latitude/longitude (GRIB template 3.1), 1127 x 683 cells of 0.1083 degrees on a pole at (-35, 247), which
 * covers Canada, Mexico and the nearby oceans as well as the United States. Only the 2-D (`2dfld`) set is published
 * on it, so it has no pressure-level fields. Hourly to 84 hours from the 00, 06, 12 and 18 UTC cycles. Viewer-only.
 */
export const rrfsNa = defineDataset({
    id: 'rrfs-na',
    label: 'RRFS North America',
    shortLabel: 'RRFS-NA',
    docs: { runs: '00, 06, 12 and 18 UTC', length: '84 hours, hourly' },
    about: { provider: 'NOAA', category: 'regional' },
    access: { corsVerifiedOn: '2026-11-02' },
    surfaces: ['viewer'],
    bucket: RRFS_OPS_BUCKET,
    objects: { surface },
    gate: ['surface'],
    products: [{ id: 'mean', label: 'Mean' }],
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [{ steps: [{ from: 0, to: 84 * 60, every: 60 }] }],
    grid: {
        projection: 'latlon',
        nx: 1127,
        ny: 683,
        lat1: -36.9303,
        lon1: 299,
        dlat: 0.1083,
        dlon: 0.1083,
        scanMode: 0x40,
        radiusM: 6371229,
        rotation: { southPoleLat: -35, southPoleLon: 247 },
    },
    // 0.1083 degrees is 12.0 km on the rotated equator, so the three levels merge 1, 2 and 3 cells.
    levelTargetsKm: [13, 26, 39],
    idx: { variables: { MSLMA: 'MSLET' }, levels: RRFS_LEVELS },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [
        ...RRFS_SATELLITE_FIELDS,
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
        HRRR_MXUPHL_25KM,
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
        HRRR_EHI_01KM,
        HRRR_EHI_03KM,
        ...RRFS_NA_EXTRA_FIELDS,
    ],
});
