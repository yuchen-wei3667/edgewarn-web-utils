import { defineField } from '../types.ts';
import { sfc } from './selectors.ts';

/** Severe-weather fields shared by several models. */
export const HRRR_REFC = defineField({
    id: 'HRRR_REFC',
    label: 'Composite Reflectivity',
    pane: 'severe',
    kind: 'extreme',
    units: 'dBZ',
    inputs: [sfc('REFC', 'entire atmosphere')],
    colormap: { name: 'NWS_Reflectivity', transparentBelow: 0 },
});

export const HRRR_SBCAPE = defineField({
    id: 'HRRR_SBCAPE',
    label: 'SBCAPE',
    pane: 'severe',
    kind: 'scalar',
    units: 'J/kg',
    ratioScale: true,
    inputs: [sfc('CAPE', 'surface')],
    colormap: { name: 'RAP_CAPE' },
    legacyIds: ['RAP_CAPE_Surface', 'CAPE Surface'],
});

export const HRRR_SBCIN = defineField({
    id: 'HRRR_SBCIN',
    label: 'SBCIN',
    pane: 'severe',
    kind: 'scalar',
    units: 'J/kg',
    inputs: [sfc('CIN', 'surface')],
    colormap: { name: 'RAP_CIN_Surface' },
    legacyIds: ['RAP_CIN_Surface', 'CIN Surface'],
});

export const HRRR_MLCAPE = defineField({
    id: 'HRRR_MLCAPE',
    label: 'MLCAPE',
    pane: 'severe',
    kind: 'scalar',
    units: 'J/kg',
    ratioScale: true,
    inputs: [sfc('CAPE', '90-0 mb above ground')],
    colormap: { name: 'RAP_CAPE' },
    legacyIds: ['MLCAPE'],
});

export const HRRR_MLCIN = defineField({
    id: 'HRRR_MLCIN',
    label: 'MLCIN',
    pane: 'severe',
    kind: 'scalar',
    units: 'J/kg',
    inputs: [sfc('CIN', '90-0 mb above ground')],
    colormap: { name: 'RAP_MLCIN' },
    legacyIds: ['MLCIN'],
});

export const HRRR_MUCAPE = defineField({
    id: 'HRRR_MUCAPE',
    label: 'MUCAPE',
    pane: 'severe',
    kind: 'scalar',
    units: 'J/kg',
    ratioScale: true,
    inputs: [sfc('CAPE', '255-0 mb above ground')],
    colormap: { name: 'RAP_CAPE' },
    legacyIds: ['MUCAPE'],
});

export const HRRR_MUCIN = defineField({
    id: 'HRRR_MUCIN',
    label: 'MUCIN',
    pane: 'severe',
    kind: 'scalar',
    units: 'J/kg',
    inputs: [sfc('CIN', '255-0 mb above ground')],
    colormap: { name: 'RAP_MUCIN' },
    legacyIds: ['MUCIN'],
});

export const HRRR_CAPE_03KM = defineField({
    id: 'HRRR_CAPE_03KM',
    label: '0-3 km CAPE',
    pane: 'severe',
    kind: 'scalar',
    units: 'J/kg',
    ratioScale: true,
    inputs: [sfc('CAPE', '0-3000 m above ground')],
    colormap: { name: 'RAP_CAPE', range: [0, 500] },
    legacyIds: ['CAPE 0-3km'],
});

export const HRRR_SRH_01KM = defineField({
    id: 'HRRR_SRH_01KM',
    label: '0-1 km SRH',
    pane: 'severe',
    kind: 'scalar',
    units: 'm²/s²',
    inputs: [sfc('HLCY', '1000-0 m above ground')],
    colormap: { name: 'RAP_SRH' },
    legacyIds: ['Srh-0-1km'],
});

export const HRRR_SRH_03KM = defineField({
    id: 'HRRR_SRH_03KM',
    label: '0-3 km SRH',
    pane: 'severe',
    kind: 'scalar',
    units: 'm²/s²',
    inputs: [sfc('HLCY', '3000-0 m above ground')],
    colormap: { name: 'RAP_SRH' },
    legacyIds: ['SRH 0-3km'],
});

export const HRRR_MXUPHL_25KM = defineField({
    id: 'HRRR_MXUPHL_25KM',
    label: '2-5 km Updraft Helicity',
    pane: 'severe',
    kind: 'extreme',
    units: 'm²/s²',
    inputs: [sfc('MXUPHL', '5000-2000 m above ground', { timing: 'window' })],
    colormap: { name: 'HRRR_UpdraftHelicity' },
});

export const HRRR_HAIL = defineField({
    id: 'HRRR_HAIL',
    label: 'Max Hail Size',
    pane: 'severe',
    kind: 'extreme',
    units: 'mm',
    ratioScale: true,
    inputs: [sfc('HAIL', 'entire atmosphere', { timing: 'window', transform: { scale: 1000 } })],
    colormap: { name: 'MESH' },
});

export const HRRR_LTNG = defineField({
    id: 'HRRR_LTNG',
    label: 'Lightning',
    pane: 'severe',
    kind: 'extreme',
    units: 'flashes/km²/5 min',
    inputs: [sfc('LTNG', 'entire atmosphere')],
    colormap: { name: 'NLDN_LightningDensity' },
});

export const HRRR_SHEAR_06KM = defineField({
    id: 'HRRR_SHEAR_06KM',
    label: '0-6 km Shear',
    pane: 'severe',
    kind: 'vector',
    recipe: 'vector',
    recipeParams: { frame: 'grid' },
    units: 'm/s',
    ratioScale: true,
    quantity: 'speed',
    inputs: [sfc('VUCSH', '0-6000 m above ground'), sfc('VVCSH', '0-6000 m above ground')],
    colormap: { name: 'RAP_Wind_ML' },
});

export const HRRR_STORM_MOTION = defineField({
    id: 'HRRR_STORM_MOTION',
    label: 'Storm Motion',
    pane: 'severe',
    kind: 'vector',
    recipe: 'vector',
    recipeParams: { frame: 'grid' },
    units: 'm/s',
    ratioScale: true,
    quantity: 'speed',
    inputs: [sfc('USTM', '0-6000 m above ground'), sfc('VSTM', '0-6000 m above ground')],
    colormap: { name: 'RAP_Wind_LL' },
});

export const HRRR_LFTX = defineField({
    id: 'HRRR_LFTX',
    label: 'Surface Lifted Index',
    pane: 'severe',
    kind: 'scalar',
    units: 'K',
    inputs: [sfc('LFTX', '500-1000 mb')],
    colormap: { name: 'RAP_LiftedIndex_Surface_500_1000mb' },
    legacyIds: ['Liftedindex Surface 500-1000mb'],
});

export const HRRR_BLI = defineField({
    id: 'HRRR_BLI',
    label: 'Best Lifted Index',
    pane: 'severe',
    kind: 'scalar',
    units: 'K',
    inputs: [sfc('4LFTX', '180-0 mb above ground')],
    colormap: { name: 'RAP_BestLiftedIndex_180_0mbAGL' },
    legacyIds: ['Bestliftedindex 180-0mbagl'],
});

export const HRRR_FRZLVL = defineField({
    id: 'HRRR_FRZLVL',
    label: 'Freezing Level Height',
    pane: 'severe',
    kind: 'scalar',
    units: 'm',
    inputs: [sfc('HGT', '0C isotherm')],
    colormap: { name: 'RAP_FreezingLevelHeight' },
    legacyIds: ['Freezinglevelheight'],
});
