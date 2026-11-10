import { HRRR_DPT_2M, HRRR_RH_2M, HRRR_TMP_2M, HRRR_VIS } from '../fields/surface.ts';
import { HRRR_SBCAPE } from '../fields/severe.ts';
import { HRRR_APCP_1H, HRRR_PWAT } from '../fields/precip.ts';
import {
    CEILING,
    CEILING_TO_48H,
    HOURLY_TO_48H,
    NBM_CEIL,
    NBM_GUST_10M,
    NBM_MAXREF_1KM,
    NBM_RETOP,
    NBM_TCDC,
    NBM_VIL,
    NBM_WIND_10M,
    NBM_WIND_30M,
    NBM_WIND_80M,
    THIN_AFTER_36H,
    defineNbm,
} from '../nbmRegion.ts';

/**
 * NBM over Guam: the `gu` Mercator grid of the same `core` product. Measured 2026-11-01: the same runs and steps as CONUS,
 * with fewer fields: no radiation, mixing height, ventilation, transport wind, apparent temperature, snow or severe potential.
 * Percentiles exist for PWAT only.
 */
export const nbmGu = defineNbm({
    id: 'nbm-gu',
    label: 'NBM Guam',
    shortLabel: 'NBM GU',
    region: 'gu',
    grid: {
        projection: 'mercator',
        nx: 193,
        ny: 193,
        lat1: 12.349884,
        lon1: 143.686538,
        latD: 20,
        dx: 2500,
        dy: 2500,
        scanMode: 0x50,
        radiusM: 6371200,
    },
    levelTargetsKm: [3, 6, 9],
    surfaces: ['viewer'],
    corsVerifiedOn: '2026-11-01',
    fields: [
        HRRR_TMP_2M,
        HRRR_DPT_2M,
        HRRR_RH_2M,
        NBM_WIND_10M,
        NBM_WIND_30M,
        NBM_WIND_80M,
        NBM_GUST_10M,
        HRRR_VIS,
        NBM_CEIL,
        NBM_TCDC,
        HRRR_SBCAPE,
        NBM_MAXREF_1KM,
        NBM_VIL,
        NBM_RETOP,
        HRRR_APCP_1H,
        HRRR_PWAT,
    ],
    fieldSteps: {
        HRRR_VIS: CEILING,
        NBM_CEIL: CEILING_TO_48H,
        HRRR_SBCAPE: THIN_AFTER_36H,
        NBM_MAXREF_1KM: HOURLY_TO_48H,
        NBM_VIL: HOURLY_TO_48H,
        NBM_RETOP: HOURLY_TO_48H,
        HRRR_APCP_1H: HOURLY_TO_48H,
    },
    percentileFields: [HRRR_PWAT.id],
});
