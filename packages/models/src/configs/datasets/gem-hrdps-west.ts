import { defineDataset } from '../types.ts';
import { OPEN_METEO_BUCKET } from '../shared.ts';
import { GEM_ABOUT, GEM_COMPONENTS, GEM_SURFACE_FIELDS, gemSpatialPath } from '../gem.ts';
import {
    afterAnalysis,
    OM_SNOWFALL,
    OM_SOIL_MOISTURE,
    OM_SURFACE_ALIASES,
    omHeightAliases,
    omHeightFields,
    omPointSeries,
} from '../omCoverage.ts';
import { DSWRF_SFC } from '../fields/extras.ts';
import { HRRR_APCP_1H } from '../fields/precip.ts';
import { HRRR_MSLP, HRRR_TMP_2M } from '../fields/surface.ts';

const HEIGHTS = [40, 80, 120] as const;
const STEPS = [{ from: 0, to: 48 * 60, every: 60 }];

/**
 * ECCC's HRDPS West, the 1 km nest over British Columbia and Alberta, from the Open-Meteo copy (`cmc_gem_hrdps_west`).
 * It is a second domain with its own grid, so it is a model of its own beside `gem-hrdps`. Open-Meteo keeps surface
 * fields only: no pressure levels, but temperature and wind at 40, 80 and 120 m. Precipitation, snowfall and radiation
 * describe the hour before the valid time, so the analysis lacks them. Runs at 00 and 12 UTC. Viewer-only.
 */
export const gemHrdpsWest = defineDataset({
    id: 'gem-hrdps-west',
    label: 'GEM-HRDPS West',
    shortLabel: 'HRDPS-W',
    docs: { runs: '00 and 12 UTC', length: '48 hours, hourly' },
    about: { ...GEM_ABOUT, category: 'convection-allowing' },
    access: { corsVerifiedOn: '2026-11-02' },
    surfaces: ['viewer'],
    source: { kind: 'om', manifest: 'meta.json' },
    bucket: OPEN_METEO_BUCKET,
    objects: { surface: { serves: ['sfc'], url: (params) => gemSpatialPath('cmc_gem_hrdps_west', params) } },
    gate: ['surface'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: [0, 12],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [{ steps: STEPS }],
    // The nest's own GRIB header is not public, so the corner and spacing come from the extent Open-Meteo states for the
    // grid (its south-west and north-east corners) on the HRDPS rotation. Checked against HRDPS Continental on shared cells.
    grid: {
        projection: 'latlon',
        nx: 1330,
        ny: 1180,
        lat1: -5.299602,
        lon1: 337.815115,
        dlat: 0.00899,
        dlon: 0.00899,
        scanMode: 0x40,
        radiusM: 6371229,
        rotation: { southPoleLat: -33.443382, southPoleLon: 266.46358 },
    },
    pointSeries: omPointSeries(
        'cmc_gem_hrdps_west',
        'speed',
        {
            HRRR_TMP_2M: 'temperature_2m',
            HRRR_RH_2M: 'relative_humidity_2m',
            HRRR_GUST_SFC: 'wind_gusts_10m',
            HRRR_TCDC: 'cloud_cover',
            DSWRF_SFC: 'shortwave_radiation',
            HRRR_APCP_1H: 'precipitation',
            OM_SNOWFALL: 'snowfall_water_equivalent',
            OM_SOIL_MOISTURE: 'soil_moisture_0_to_10cm',
            ...Object.fromEntries(HEIGHTS.map((m) => [`AGL_TMP_${m}M`, `temperature_${m}m`])),
        },
        false,
    ),
    levelTargetsKm: [1, 2, 4],
    idx: { components: { ...GEM_COMPONENTS, ...OM_SURFACE_ALIASES, ...omHeightAliases(HEIGHTS, 'speed') } },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [
        ...GEM_SURFACE_FIELDS,
        DSWRF_SFC,
        OM_SOIL_MOISTURE,
        HRRR_APCP_1H,
        OM_SNOWFALL,
        ...omHeightFields(HEIGHTS, 'speed'),
    ],
    fieldSteps: Object.fromEntries(
        [DSWRF_SFC, HRRR_APCP_1H, OM_SNOWFALL].map((field) => [field.id, afterAnalysis(STEPS)]),
    ),
});
