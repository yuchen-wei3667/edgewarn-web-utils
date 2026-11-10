import { defineField } from '../types.ts';
import { sfc } from './selectors.ts';

/** Winter fields shared by several models. */
export const HRRR_SNOD = defineField({
    id: 'HRRR_SNOD',
    label: 'Snow Depth',
    pane: 'winter',
    kind: 'scalar',
    units: 'm',
    inputs: [sfc('SNOD', 'surface')],
    colormap: { name: 'RAP_SnowDepth_Surface' },
    legacyIds: ['Snowdepth Surface'],
});

export const HRRR_WEASD = defineField({
    id: 'HRRR_WEASD',
    label: 'Snow Water Equivalent',
    pane: 'winter',
    kind: 'scalar',
    units: 'mm',
    ratioScale: true,
    inputs: [sfc('WEASD', 'surface')],
    colormap: { name: 'RAP_SnowWaterEquivalent_Surface' },
    legacyIds: ['Snowwaterequivalent Surface'],
});

export const HRRR_ASNOW_TOTAL = defineField({
    id: 'HRRR_ASNOW_TOTAL',
    label: 'Snowfall (run total)',
    pane: 'winter',
    kind: 'accum',
    units: 'cm',
    inputs: [sfc('ASNOW', 'surface', { timing: 'total', transform: { scale: 100 } })],
    colormap: { name: 'HRRR_Snowfall' },
});

/** Snow that fell since the run started, at 10:1, from models that publish snowfall as water (ECMWF `sf`): 1 mm of water is 1 cm of snow. */
export const SNOWFALL_WE_TOTAL = defineField({
    id: 'SNOWFALL_WE_TOTAL',
    label: 'Snowfall, 10:1 (run total)',
    pane: 'winter',
    kind: 'accum',
    units: 'cm',
    inputs: [sfc('TSNOWP', 'surface', { timing: 'total' })],
    colormap: { name: 'HRRR_Snowfall' },
});

/**
 * One hour of snowfall at 10:1, for HRRR sub-hourly. Its `WEASD` components are 15-minute water accumulations (`60-75 min acc fcst`),
 * so an hour is four of them, as `HRRR_APCP_1H` does for precipitation; 1 mm of water is 1 cm of snow.
 */
export const HRRR_SNOWFALL_WE_1H = defineField({
    id: 'HRRR_SNOWFALL_WE_1H',
    label: '1-h Snowfall, 10:1',
    pane: 'winter',
    kind: 'accum',
    units: 'cm',
    recipe: 'sum',
    inputs: [sfc('WEASD', 'surface', { timing: 'sum-window', sumMinutes: 15, sumCount: 4 })],
    colormap: { name: 'HRRR_Snowfall' },
});
