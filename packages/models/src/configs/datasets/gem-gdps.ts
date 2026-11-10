import { defineDataset } from '../types.ts';
import { OPEN_METEO_BUCKET } from '../shared.ts';
import { GEM_ABOUT, GEM_COMPONENTS, GEM_FIELDS, GEM_PRESSURE_FIELDS, gemSpatialPath } from '../gem.ts';
import { HRRR_MSLP, HRRR_TMP_2M } from '../fields/surface.ts';
import { afterAnalysis, OM_SNOWFALL } from '../omCoverage.ts';

const STEPS = [
    { from: 0, to: 84 * 60, every: 60 },
    { from: 87 * 60, to: 240 * 60, every: 180 },
];

export const gemGdps = defineDataset({
    id: 'gem-gdps',
    label: 'GEM-GDPS',
    shortLabel: 'GEM-GDPS',
    docs: {
        runs: '00 and 12 UTC',
        length: '240 hours: hourly to 84, then every 3 hours; pressure levels every 3 hours',
    },
    about: { ...GEM_ABOUT, category: 'global' },
    access: { corsVerifiedOn: '2026-11-01' },
    surfaces: ['viewer'],
    source: { kind: 'om', manifest: 'meta.json' },
    bucket: OPEN_METEO_BUCKET,
    objects: {
        surface: { serves: ['sfc'], url: (params) => gemSpatialPath('cmc_gem_gdps_15km', params) },
        pressure: {
            serves: ['prs'],
            url: (params) => gemSpatialPath('cmc_gem_gdps_15km_upper_level', params),
        },
    },
    gate: ['surface'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: [0, 12],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [{ steps: STEPS }],
    // Open-Meteo shifts the original global grid's columns by 180 degrees.
    grid: {
        projection: 'latlon',
        nx: 2400,
        ny: 1201,
        lat1: -90,
        lon1: 180,
        dlat: 0.15,
        dlon: 0.15,
        scanMode: 0x40,
        radiusM: 6371229,
    },
    levelTargetsKm: [17, 34, 67],
    idx: { components: GEM_COMPONENTS },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [...GEM_FIELDS, OM_SNOWFALL],
    fieldSteps: {
        ...Object.fromEntries(
            GEM_PRESSURE_FIELDS.map((field) => [field.id, [{ from: 0, to: 240 * 60, every: 180 }]]),
        ),
        OM_SNOWFALL: afterAnalysis(STEPS),
    },
});
