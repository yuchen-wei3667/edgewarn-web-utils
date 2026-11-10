import { defineField } from '../types.ts';
import { sfc } from './selectors.ts';

/**
 * Wave fields shared by the wave models (GFS-Wave, GEFS-Wave). Each is a surface component of the wave
 * object; a model lists the ones its inventory carries. Directions are left out: they do not average, so an
 * ensemble mean of them would be wrong. The wind is the 10 m-equivalent surface wind the wave model drives
 * its spectrum with, as earth-relative components.
 */
export const WAVE_HTSGW = defineField({
    id: 'WAVE_HTSGW',
    label: 'Significant Wave Height',
    pane: 'waves',
    kind: 'scalar',
    units: 'm',
    ratioScale: true,
    inputs: [sfc('HTSGW', 'surface')],
    colormap: { name: 'Wave_Height' },
});

export const WAVE_PERPW = defineField({
    id: 'WAVE_PERPW',
    label: 'Peak Wave Period',
    pane: 'waves',
    kind: 'scalar',
    units: 's',
    inputs: [sfc('PERPW', 'surface')],
    colormap: { name: 'Wave_Period' },
});

export const WAVE_WVHGT = defineField({
    id: 'WAVE_WVHGT',
    label: 'Wind-Wave Height',
    pane: 'waves',
    kind: 'scalar',
    units: 'm',
    ratioScale: true,
    inputs: [sfc('WVHGT', 'surface')],
    colormap: { name: 'Wave_Height' },
});

export const WAVE_WVPER = defineField({
    id: 'WAVE_WVPER',
    label: 'Wind-Wave Period',
    pane: 'waves',
    kind: 'scalar',
    units: 's',
    inputs: [sfc('WVPER', 'surface')],
    colormap: { name: 'Wave_Period' },
});

export const WAVE_WIND_SFC = defineField({
    id: 'WAVE_WIND_SFC',
    label: 'Surface Wind',
    pane: 'waves',
    kind: 'vector',
    recipe: 'vector',
    recipeParams: { frame: 'earth' },
    units: 'm/s',
    ratioScale: true,
    quantity: 'speed',
    inputs: [sfc('UGRD', 'surface'), sfc('VGRD', 'surface')],
    colormap: { name: 'RAP_Wind_LL' },
});
