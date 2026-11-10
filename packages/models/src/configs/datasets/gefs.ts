import { defineDataset } from '../types.ts';
import { GEFS_BUCKET } from '../shared.ts';
import { GEFS_FIELDS_BEFORE_PRECIPITATION, GEFS_GRID, GEFS_OBJECTS } from '../gefs.ts';
import { HRRR_MSLP, HRRR_TMP_2M } from '../fields/surface.ts';
import { APCP_6H, APCP_TOTAL } from '../fields/precip.ts';

const GEFS_FIELDS = [...GEFS_FIELDS_BEFORE_PRECIPITATION, APCP_TOTAL];
const GEFS_NORMALIZED_SPREAD_FIELDS = GEFS_FIELDS.filter((field) => field.kind === 'scalar').map(
    (field) => field.id,
);

/**
 * NOAA GEFS, the 30-member global ensemble plus its control, on the 0.5 degree `a` set (surface and pressure
 * levels in one object per member and step). NOAA publishes the ensemble mean (`geavg`) and standard deviation
 * (`gespr`) as objects of their own, so those two products cost one read; the min, max and exceedance products
 * are computed by the worker from the members. Every GEFS run is cut at 384 h here: 00 UTC lists steps beyond
 * it, which a timeline of the usual length cannot show (`gefs-35d` reads them). Viewer-only.
 */
export const gefs = defineDataset({
    id: 'gefs',
    label: 'GEFS',
    shortLabel: 'GEFS',
    docs: { runs: '00, 06, 12 and 18 UTC', length: '384 hours: every 3 hours to 240, then every 6 hours' },
    about: { provider: 'NOAA', category: 'ensemble' },
    access: { corsVerifiedOn: '2026-10-26' },
    surfaces: ['viewer'],
    bucket: GEFS_BUCKET,
    objects: GEFS_OBJECTS,
    // `gespr` is written after the mean and the members it summarises, so its presence means the step is whole.
    gate: ['spr'],
    products: [
        { id: 'mean', label: 'Ensemble mean', extra: 'ens mean', object: 'avg' },
        { id: 'sprd', label: 'Spread', extra: 'ens std dev', object: 'spr' },
        {
            id: 'nsprd',
            label: 'Normalized spread',
            extra: 'ens std dev',
            object: 'spr',
            fields: GEFS_NORMALIZED_SPREAD_FIELDS,
        },
        { id: 'member', label: 'Member', object: 'member' },
    ],
    ensemble: { perturbed: 30, control: true, addressing: 'file', stats: 'files' },
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [
        {
            steps: [
                { from: 0, to: 240 * 60, every: 180 },
                { from: 246 * 60, to: 384 * 60, every: 360 },
            ],
        },
    ],
    grid: GEFS_GRID,
    // 0.5 degrees is 55.6 km at the equator, so the three levels are 56, 111 and 222 km.
    levelTargetsKm: [56, 111, 222],
    idx: { variables: { MSLMA: 'PRMSL' } },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: GEFS_FIELDS,
    // The six-hour window is held from f006 on, but this model's precipitation field is the run total (`gefs-35d` offers the window).
    notOffered: [APCP_6H],
});
