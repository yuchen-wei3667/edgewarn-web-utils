import { defineField } from '../types.ts';
import { sfc } from './selectors.ts';

/** Fields of the near-surface set that several models carry under the same NCEP names: cloud layers and downward solar radiation. */
export const CLOUD_LOW = defineField({
    id: 'CLOUD_LOW',
    label: 'Low Cloud Cover',
    pane: 'surface',
    kind: 'scalar',
    units: '%',
    inputs: [sfc('LCDC', 'low cloud layer')],
    colormap: { name: 'HRRR_CloudCover' },
});

export const CLOUD_MID = defineField({
    id: 'CLOUD_MID',
    label: 'Middle Cloud Cover',
    pane: 'surface',
    kind: 'scalar',
    units: '%',
    inputs: [sfc('MCDC', 'middle cloud layer')],
    colormap: { name: 'HRRR_CloudCover' },
});

export const CLOUD_HIGH = defineField({
    id: 'CLOUD_HIGH',
    label: 'High Cloud Cover',
    pane: 'surface',
    kind: 'scalar',
    units: '%',
    inputs: [sfc('HCDC', 'high cloud layer')],
    colormap: { name: 'HRRR_CloudCover' },
});

export const DSWRF_SFC = defineField({
    id: 'DSWRF_SFC',
    label: 'Downward Shortwave Radiation',
    pane: 'surface',
    kind: 'scalar',
    units: 'W/m²',
    ratioScale: true,
    inputs: [sfc('DSWRF', 'surface')],
    colormap: { name: 'NBM_SolarRadiation' },
});
