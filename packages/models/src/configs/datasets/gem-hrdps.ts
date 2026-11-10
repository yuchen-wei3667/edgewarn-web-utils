import { defineDataset } from '../types.ts';
import { OPEN_METEO_BUCKET } from '../shared.ts';
import { GEM_ABOUT, GEM_COMPONENTS, GEM_SURFACE_FIELDS, gemSpatialPath } from '../gem.ts';
import {
    afterAnalysis,
    OM_CAPE,
    OM_SHOWERS,
    OM_SNOWFALL,
    OM_SOIL_MOISTURE,
    OM_SOIL_TEMPERATURE,
    OM_SURFACE_ALIASES,
    omHeightAliases,
    omHeightFields,
    omLevelAliases,
    omPointSeries,
    omPressureFields,
} from '../omCoverage.ts';
import { DSWRF_SFC } from '../fields/extras.ts';
import { HRRR_APCP_1H } from '../fields/precip.ts';
import { HRRR_MSLP, HRRR_TMP_2M } from '../fields/surface.ts';

const HRDPS_HEIGHTS = [40, 80, 120] as const;
const STEPS = [{ from: 0, to: 48 * 60, every: 60 }];

/**
 * ECCC's High Resolution Deterministic Prediction System, the 2.5 km Continental domain, read from the Open-Meteo
 * copy like the other GEM models. Surface and pressure-level fields come in one object per hour (Open-Meteo's
 * `cmc_gem_hrdps`), on the original 2540 x 1290 rotated latitude/longitude grid. The 1 km West nest has its own grid
 * and is its own model (`gem-hrdps-west`). Precipitation, showers, snowfall and radiation describe the hour before the
 * valid time, so the analysis lacks them. Viewer-only.
 */
export const gemHrdps = defineDataset({
    id: 'gem-hrdps',
    label: 'GEM-HRDPS',
    shortLabel: 'HRDPS',
    docs: { runs: '00, 06, 12 and 18 UTC', length: '48 hours, hourly' },
    about: { ...GEM_ABOUT, category: 'convection-allowing' },
    access: { corsVerifiedOn: '2026-11-02' },
    surfaces: ['viewer'],
    source: { kind: 'om', manifest: 'meta.json' },
    bucket: OPEN_METEO_BUCKET,
    objects: { fields: { serves: ['sfc', 'prs'], url: (params) => gemSpatialPath('cmc_gem_hrdps', params) } },
    gate: ['fields'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [{ steps: STEPS }],
    // Read from the ECCC GRIB header (template 3.1) and checked cell by cell against the Open-Meteo array.
    grid: {
        projection: 'latlon',
        nx: 2540,
        ny: 1290,
        lat1: -12.302501,
        lon1: 345.17878,
        dlat: 0.0225,
        dlon: 0.0225,
        scanMode: 0x40,
        radiusM: 6371229,
        rotation: { southPoleLat: -36.08852, southPoleLon: 245.305142 },
    },
    pointSeries: omPointSeries('cmc_gem_hrdps', 'speed', {
        HRRR_TMP_2M: 'temperature_2m',
        HRRR_RH_2M: 'relative_humidity_2m',
        HRRR_GUST_SFC: 'wind_gusts_10m',
        HRRR_TCDC: 'cloud_cover',
        DSWRF_SFC: 'shortwave_radiation',
        HRRR_APCP_1H: 'precipitation',
        OM_SHOWERS: 'showers',
        OM_SNOWFALL: 'snowfall_water_equivalent',
        OM_CAPE: 'cape',
        OM_SOIL_TEMPERATURE: 'soil_temperature_0_to_10cm',
        OM_SOIL_MOISTURE: 'soil_moisture_0_to_10cm',
        ...Object.fromEntries(HRDPS_HEIGHTS.map((m) => [`AGL_TMP_${m}M`, `temperature_${m}m`])),
    }),
    levelTargetsKm: [2.5, 5, 10],
    idx: {
        components: {
            ...GEM_COMPONENTS,
            ...OM_SURFACE_ALIASES,
            ...omLevelAliases('speed'),
            ...omHeightAliases(HRDPS_HEIGHTS, 'speed'),
        },
    },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [
        ...GEM_SURFACE_FIELDS,
        DSWRF_SFC,
        OM_SOIL_TEMPERATURE,
        OM_SOIL_MOISTURE,
        HRRR_APCP_1H,
        OM_SHOWERS,
        OM_SNOWFALL,
        OM_CAPE,
        ...omPressureFields('speed', 'GEM_'),
        ...omHeightFields(HRDPS_HEIGHTS, 'speed'),
    ],
    fieldSteps: Object.fromEntries(
        [DSWRF_SFC, HRRR_APCP_1H, OM_SHOWERS, OM_SNOWFALL].map((field) => [field.id, afterAnalysis(STEPS)]),
    ),
});
