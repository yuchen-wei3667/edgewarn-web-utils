import { defineDataset } from '../types.ts';
import { GEFS_BUCKET } from '../shared.ts';
import { GEFS_FIELDS_BEFORE_PRECIPITATION, GEFS_GRID, GEFS_OBJECTS } from '../gefs.ts';
import { HRRR_MSLP, HRRR_TMP_2M } from '../fields/surface.ts';
import { APCP_6H, APCP_TOTAL } from '../fields/precip.ts';

/**
 * NOAA GEFS to 35 days: the 00 UTC cycle's tail past day 16, which NOAA writes into the same `pgrb2ap5` objects as the
 * first 16 days, with the same 0.5 degree fields (measured 2026-11-01: 85 records per file at f006, f246, f600 and f840,
 * ensemble mean, spread and all 31 members). Steps are every 3 hours to 240 h, then every 6 hours to 840 h. The 06, 12 and
 * 18 UTC cycles stop at 384 h, so they stay with `gefs`. Precipitation is the six-hour window the files hold. The normalised
 * spread is left out: it would need 30 earlier 00 UTC runs read to 35 days. Viewer-only.
 */
export const gefs35d = defineDataset({
    id: 'gefs-35d',
    label: 'GEFS Subseasonal',
    shortLabel: 'GEFS-35D',
    docs: { runs: '00 UTC', length: '840 hours (35 days): every 3 hours to 240, then every 6 hours' },
    about: { provider: 'NOAA', category: 'climate' },
    access: { corsVerifiedOn: '2026-11-02' },
    surfaces: ['viewer'],
    bucket: GEFS_BUCKET,
    objects: GEFS_OBJECTS,
    gate: ['spr'],
    products: [
        { id: 'mean', label: 'Ensemble mean', extra: 'ens mean', object: 'avg' },
        { id: 'sprd', label: 'Spread', extra: 'ens std dev', object: 'spr' },
        { id: 'member', label: 'Member', object: 'member' },
    ],
    ensemble: { perturbed: 30, control: true, addressing: 'file', stats: 'files' },
    cycles: [0],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [
        {
            steps: [
                { from: 0, to: 240 * 60, every: 180 },
                { from: 246 * 60, to: 840 * 60, every: 360 },
            ],
        },
    ],
    grid: GEFS_GRID,
    levelTargetsKm: [56, 111, 222],
    idx: { variables: { MSLMA: 'PRMSL' } },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [...GEFS_FIELDS_BEFORE_PRECIPITATION, APCP_6H],
    // The run total (`0-N hour acc`) is held only by the first two steps; later files hold the window ending at the step.
    notOffered: [APCP_TOTAL],
    // Every 6-hour window ends on a multiple of 6 hours: the 3-hourly steps in between hold 3-hour windows.
    fieldSteps: { APCP_6H: [{ from: 6 * 60, to: 840 * 60, every: 360 }] },
});
