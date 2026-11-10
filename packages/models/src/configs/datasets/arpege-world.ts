import { defineDataset } from '../types.ts';
import { OPEN_METEO_BUCKET } from '../shared.ts';
import { GEM_COMPONENTS, gemSpatialPath, omAlias } from '../gem.ts';
import { OPEN_METEO_LATLON_025 } from '../profiles.ts';
import {
    afterAnalysis,
    OM_CAPE,
    OM_PRECIP_STEP,
    OM_SNOWFALL,
    OM_SURFACE_ALIASES,
    omHeightAliases,
    omHeightFields,
    omLevelAliases,
    omPointSeries,
    omPressureFields,
} from '../omCoverage.ts';
import { CLOUD_HIGH, CLOUD_LOW, CLOUD_MID, DSWRF_SFC } from '../fields/extras.ts';
import {
    HRRR_GUST_SFC,
    HRRR_MSLP,
    HRRR_RH_2M,
    HRRR_TCDC,
    HRRR_TMP_2M,
    HRRR_WIND_10M,
} from '../fields/surface.ts';

/** The levels a sounding reads (Open-Meteo's files, not fields): 1000 to 100 hPa. */
const ARPEGE_PROFILE_LEVELS = [
    1000, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 275, 250, 225, 200, 175,
    150, 125, 100,
] as const;
const ARPEGE_HEIGHTS = [20, 50, 100, 150, 200] as const;

/**
 * Open-Meteo carries ARPEGE's winds as east and north components, so they use the shared wind fields. The names
 * of the other variables are the ones the GEM models share.
 */
const ARPEGE_COMPONENTS = {
    ...GEM_COMPONENTS,
    ...OM_SURFACE_ALIASES,
    'UGRD|10 m above ground': omAlias('wind_u_component_10m'),
    'VGRD|10 m above ground': omAlias('wind_v_component_10m'),
    ...omLevelAliases('uv'),
    ...omHeightAliases(ARPEGE_HEIGHTS, 'uv'),
};

const STEPS = [
    { from: 0, to: 48 * 60, every: 60 },
    { from: 51 * 60, to: 102 * 60, every: 180 },
];
const fields = [
    HRRR_TMP_2M,
    HRRR_RH_2M,
    HRRR_WIND_10M,
    HRRR_GUST_SFC,
    HRRR_TCDC,
    CLOUD_LOW,
    CLOUD_MID,
    CLOUD_HIGH,
    DSWRF_SFC,
    HRRR_MSLP,
    OM_PRECIP_STEP,
    OM_SNOWFALL,
    OM_CAPE,
    ...omPressureFields('uv', ''),
    ...omHeightFields(ARPEGE_HEIGHTS, 'uv'),
];

/**
 * Meteo-France's global ARPEGE at 0.25 degrees, read from the Open-Meteo copy (`meteofrance_arpege_world025`). One
 * object per valid time holds the surface and pressure-level variables: hourly to 48 h, then every 3 hours to 102 h
 * from all four cycles. The gust, precipitation, snowfall and radiation describe the step before the valid time, so the
 * analysis lacks them. The window offers the five usual pressure levels only. Viewer-only.
 */
export const arpegeWorld = defineDataset({
    id: 'arpege-world',
    label: 'ARPEGE World',
    shortLabel: 'ARPEGE',
    docs: { runs: '00, 06, 12 and 18 UTC', length: '102 hours: hourly to 48, then every 3 hours' },
    about: {
        provider: 'Meteo-France',
        category: 'global',
        attribution:
            'Meteo-France ARPEGE, Etalab Open Licence 2.0. Weather data by Open-Meteo.com (https://open-meteo.com/), CC BY 4.0.',
        derivedFrom: 'Open-Meteo copy of Meteo-France ARPEGE output',
    },
    access: { corsVerifiedOn: '2026-11-02' },
    surfaces: ['viewer'],
    // Open-Meteo's copy carries a 2 m temperature and humidity, 10 m wind components and every level's, which is what a sounding reads.
    profiles: {
        levels: ARPEGE_PROFILE_LEVELS,
        column: { kind: 'open-meteo', model: 'meteofrance_arpege_world025', grid: OPEN_METEO_LATLON_025 },
    },
    source: { kind: 'om', manifest: 'meta.json' },
    bucket: OPEN_METEO_BUCKET,
    objects: {
        fields: {
            serves: ['sfc', 'prs'],
            url: (params) => gemSpatialPath('meteofrance_arpege_world025', params),
        },
    },
    gate: ['fields'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [{ steps: STEPS }],
    // Open-Meteo stores the global grid south to north from -180 degrees (written as 180: a first longitude is 0 to 360).
    grid: {
        projection: 'latlon',
        nx: 1440,
        ny: 721,
        lat1: -90,
        lon1: 180,
        dlat: 0.25,
        dlon: 0.25,
        scanMode: 0x40,
        radiusM: 6371229,
    },
    pointSeries: omPointSeries('meteofrance_arpege_world025', 'uv', {
        HRRR_TMP_2M: 'temperature_2m',
        HRRR_RH_2M: 'relative_humidity_2m',
        HRRR_GUST_SFC: 'wind_gusts_10m',
        HRRR_TCDC: 'cloud_cover',
        CLOUD_LOW: 'cloud_cover_low',
        CLOUD_MID: 'cloud_cover_mid',
        CLOUD_HIGH: 'cloud_cover_high',
        DSWRF_SFC: 'shortwave_radiation',
        OM_PRECIP_STEP: 'precipitation',
        OM_SNOWFALL: 'snowfall_water_equivalent',
        OM_CAPE: 'cape',
        ...Object.fromEntries(ARPEGE_HEIGHTS.map((m) => [`AGL_TMP_${m}M`, `temperature_${m}m`])),
    }),
    levelTargetsKm: [28, 56, 111],
    idx: { components: ARPEGE_COMPONENTS },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields,
    fieldSteps: Object.fromEntries(
        [HRRR_GUST_SFC, DSWRF_SFC, OM_PRECIP_STEP, OM_SNOWFALL].map((field) => [
            field.id,
            afterAnalysis(STEPS),
        ]),
    ),
});
