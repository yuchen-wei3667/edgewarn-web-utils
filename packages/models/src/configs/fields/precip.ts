import { defineField } from '../types.ts';
import { sfc } from './selectors.ts';

/** Precipitation fields shared by several models. */
export const HRRR_PTYPE = defineField({
    id: 'HRRR_PTYPE',
    label: 'Precipitation Type',
    pane: 'precip',
    kind: 'categorical',
    recipe: 'ptype',
    units: '',
    inputs: [
        sfc('CRAIN', 'surface', { reducer: 'max' }),
        sfc('CSNOW', 'surface', { reducer: 'max' }),
        sfc('CICEP', 'surface', { reducer: 'max' }),
        sfc('CFRZR', 'surface', { reducer: 'max' }),
    ],
    colormap: { name: 'HRRR_PrecipType' },
});

export const HRRR_APCP_1H = defineField({
    id: 'HRRR_APCP_1H',
    label: '1-h Precipitation',
    pane: 'precip',
    kind: 'accum',
    units: 'mm',
    ratioScale: true,
    inputs: [sfc('APCP', 'surface', { timing: 'window' })],
    colormap: { name: 'QPE_01H' },
    // The 15-minute product publishes quarter-hour accumulations back to back rather than hourly
    // ones, so an hour is the sum of four of them. They are NOT byte-adjacent in the `.idx`
    // (each sits about 61 MB from the next, with ~48 other components in between), so this costs
    // four range requests and roughly four times the bytes of the hourly component it replaces.
    overrides: {
        'hrrr-subh': {
            recipe: 'sum',
            inputs: [sfc('APCP', 'surface', { timing: 'sum-window', sumMinutes: 15, sumCount: 4 })],
        },
    },
});

/**
 * A six-hour accumulation, for models that publish one (GFS holds `6-12 hour acc` at f012, `12-18 hour acc`
 * at f018). The window is longer than the model's usual one, so the selector says so.
 */
export const APCP_6H = defineField({
    id: 'APCP_6H',
    label: '6-h Precipitation',
    pane: 'precip',
    kind: 'accum',
    units: 'mm',
    ratioScale: true,
    inputs: [sfc('APCP', 'surface', { timing: 'window', windowMinutes: 360 })],
    colormap: { name: 'MRMS_QPE_Long' },
});

/** Accumulated since the run started (`0-N hour acc`). */
export const APCP_TOTAL = defineField({
    id: 'APCP_TOTAL',
    label: 'Precipitation (run total)',
    pane: 'precip',
    kind: 'accum',
    units: 'mm',
    ratioScale: true,
    inputs: [sfc('APCP', 'surface', { timing: 'total' })],
    colormap: { name: 'MRMS_QPE_Long' },
});

export const HRRR_PRATE = defineField({
    id: 'HRRR_PRATE',
    label: 'Precipitation Rate',
    pane: 'precip',
    kind: 'scalar',
    units: 'mm/h',
    inputs: [sfc('PRATE', 'surface', { transform: { scale: 3600 } })],
    colormap: { name: 'PrecipRate' },
});

export const HRRR_PWAT = defineField({
    id: 'HRRR_PWAT',
    label: 'Precipitable Water',
    pane: 'precip',
    kind: 'scalar',
    units: 'mm',
    ratioScale: true,
    inputs: [sfc('PWAT', 'entire atmosphere (considered as a single layer)')],
    colormap: { name: 'HRRR_PWAT' },
});
