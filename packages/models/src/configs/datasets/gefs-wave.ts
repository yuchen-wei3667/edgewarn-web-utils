import { defineDataset, pad } from '../types.ts';
import { GEFS_BUCKET } from '../shared.ts';
import { WAVE_HTSGW, WAVE_PERPW, WAVE_WVHGT, WAVE_WVPER } from '../fields/waves.ts';

/**
 * NOAA GEFS-Wave, the 30-member ensemble of the wave model plus its control, on the 0.25 degree global grid.
 * NOAA publishes the ensemble mean and spread as objects of their own, so those products cost one read each,
 * and each member is one object per step. Only the four scalar wave components that the member, mean and spread
 * inventories all carry are offered: the surface wind is absent from the statistics files (and a vector cannot be
 * reduced), and the swell and ice components are not in them either. Every run is cut at 384 h, as GEFS is.
 * Viewer-only.
 */
const ENSEMBLE_FIELDS = [WAVE_HTSGW, WAVE_PERPW, WAVE_WVHGT, WAVE_WVPER];

/** `c00` is the control, `p01`..`p30` the perturbed members. */
const memberName = (member: number | undefined): string => (member ? `p${pad(member, 2)}` : 'c00');

const object = (name: (member: number | undefined) => string) => ({
    serves: ['sfc'] as const,
    url: ({ date, cycle, step, member }: { date: string; cycle: number; step: number; member?: number }) =>
        `gefs.${date}/${pad(cycle, 2)}/wave/gridded/gefs.wave.t${pad(cycle, 2)}z.${name(member)}.global.0p25.f${pad(step, 3)}.grib2`,
});

export const gefsWave = defineDataset({
    id: 'gefs-wave',
    label: 'GEFS-Wave',
    shortLabel: 'GEFS Wave',
    docs: { runs: '00, 06, 12 and 18 UTC', length: '384 hours: every 3 hours to 240, then every 6 hours' },
    about: { provider: 'NOAA', category: 'ensemble' },
    access: { corsVerifiedOn: '2026-11-01' },
    source: { kind: 'grib2-index', dialect: 'wgrib2', jpeg2000: true },
    surfaces: ['viewer'],
    bucket: GEFS_BUCKET,
    objects: {
        mean: object(() => 'mean'),
        spread: object(() => 'spread'),
        member: object(memberName),
    },
    // `spread` is written after the mean and the members it summarises, so its presence means the step is whole.
    gate: ['spread'],
    products: [
        { id: 'mean', label: 'Ensemble mean', extra: 'ens mean', object: 'mean' },
        { id: 'sprd', label: 'Spread', extra: 'ens spread', object: 'spread' },
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
    grid: {
        projection: 'latlon',
        nx: 1440,
        ny: 721,
        lat1: 90,
        lon1: 0,
        dlat: 0.25,
        dlon: 0.25,
        scanMode: 0x00,
        radiusM: 6371229,
    },
    // 0.25 degrees is 27.8 km at the equator, so the three levels are 28, 56 and 111 km.
    levelTargetsKm: [28, 56, 111],
    idx: {},
    defaultField: WAVE_HTSGW,
    isobars: null,
    fields: ENSEMBLE_FIELDS,
});
