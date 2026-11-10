import { defineDataset } from '../types.ts';
import { OPEN_METEO_BUCKET } from '../shared.ts';
import { GEM_ABOUT, GEM_COMPONENTS, GEM_FIELDS, gemSpatialPath } from '../gem.ts';
import { HRRR_MSLP, HRRR_TMP_2M } from '../fields/surface.ts';
import { afterAnalysis, OM_SNOWFALL } from '../omCoverage.ts';

const STEPS = [{ from: 0, to: 84 * 60, every: 60 }];

export const gemRdps = defineDataset({
    id: 'gem-rdps',
    label: 'GEM-RDPS',
    shortLabel: 'GEM-RDPS',
    docs: { runs: '00, 06, 12 and 18 UTC', length: '84 hours, hourly' },
    about: { ...GEM_ABOUT, category: 'regional' },
    access: { corsVerifiedOn: '2026-11-01' },
    surfaces: ['viewer'],
    source: { kind: 'om', manifest: 'meta.json' },
    bucket: OPEN_METEO_BUCKET,
    objects: {
        fields: { serves: ['sfc', 'prs'], url: (params) => gemSpatialPath('cmc_gem_rdps_10km', params) },
    },
    gate: ['fields'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [{ steps: STEPS }],
    // Original ECCC axes: the OM copy preserves its rows and columns without resampling.
    grid: {
        projection: 'latlon',
        nx: 1140,
        ny: 1045,
        lat1: -48.805954,
        lon1: 306.141412,
        dlat: 0.090298,
        dlon: 0.090298,
        scanMode: 0x40,
        radiusM: 6371229,
        rotation: { southPoleLat: -31.758312, southPoleLon: 267.597031 },
    },
    levelTargetsKm: [10, 20, 40],
    idx: { components: GEM_COMPONENTS },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [...GEM_FIELDS, OM_SNOWFALL],
    fieldSteps: { OM_SNOWFALL: afterAnalysis(STEPS) },
});
