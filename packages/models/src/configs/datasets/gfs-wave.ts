import { defineDataset, pad } from '../types.ts';
import { GFS_BUCKET } from '../shared.ts';
import { WAVE_HTSGW, WAVE_PERPW, WAVE_WIND_SFC, WAVE_WVHGT, WAVE_WVPER } from '../fields/waves.ts';

/**
 * NOAA GFS-Wave 0.25 degree, global: the WAVEWATCH III wave model driven by GFS winds. One GRIB2 object per
 * forecast hour holds every surface wave component (no pressure levels, so no isobars or profiles). Hourly to
 * 120 h, then every 3 hours to 384 h, the same cadence as GFS. Viewer-only.
 */
export const gfsWave = defineDataset({
    id: 'gfs-wave',
    label: 'GFS-Wave',
    shortLabel: 'GFS Wave',
    docs: { runs: '00, 06, 12 and 18 UTC', length: '384 hours: hourly to 120, then every 3 hours' },
    about: { provider: 'NOAA', category: 'global' },
    access: { corsVerifiedOn: '2026-11-01' },
    source: { kind: 'grib2-index', dialect: 'wgrib2', jpeg2000: true },
    surfaces: ['viewer'],
    bucket: GFS_BUCKET,
    objects: {
        wave: {
            serves: ['sfc'],
            url: ({ date, cycle, step }) =>
                `gfs.${date}/${pad(cycle, 2)}/wave/gridded/gfswave.t${pad(cycle, 2)}z.global.0p25.f${pad(step, 3)}.grib2`,
        },
    },
    gate: ['wave'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [
        {
            steps: [
                { from: 0, to: 120 * 60, every: 60 },
                { from: 123 * 60, to: 384 * 60, every: 180 },
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
    fields: [WAVE_HTSGW, WAVE_PERPW, WAVE_WVHGT, WAVE_WVPER, WAVE_WIND_SFC],
});
