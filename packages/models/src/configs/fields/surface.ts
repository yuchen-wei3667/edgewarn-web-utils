import { defineField } from '../types.ts';
import { K_TO_C, sfc } from './selectors.ts';

/**
 * Surface fields shared by several models. A model lists the ones it carries in its `fields`; the ids
 * keep their `HRRR_` prefix because that is what saved layers and `?model=` links have always stored.
 */
export const HRRR_TMP_2M = defineField({
    id: 'HRRR_TMP_2M',
    label: '2 m Temperature',
    pane: 'surface',
    kind: 'scalar',
    units: '°C',
    quantity: 'temperature',
    inputs: [sfc('TMP', '2 m above ground', { transform: K_TO_C })],
    colormap: { name: 'RAP_Temperature_LL', toStored: K_TO_C },
    legacyIds: ['RAP_TMP_2M', 'Temperature 2m'],
});

export const HRRR_DPT_2M = defineField({
    id: 'HRRR_DPT_2M',
    label: '2 m Dewpoint',
    pane: 'surface',
    kind: 'scalar',
    units: '°C',
    quantity: 'temperature',
    inputs: [sfc('DPT', '2 m above ground', { transform: K_TO_C })],
    colormap: { name: 'RAP_Dewpoint_2m', toStored: K_TO_C },
    legacyIds: ['RAP_DPT_2M', 'Dewpoint 2m'],
});

export const HRRR_RH_2M = defineField({
    id: 'HRRR_RH_2M',
    label: '2 m Relative Humidity',
    pane: 'surface',
    kind: 'scalar',
    units: '%',
    inputs: [sfc('RH', '2 m above ground')],
    colormap: { name: 'RAP_RelativeHumidity' },
    legacyIds: ['RAP_RH_2M', 'Relativehumidity 2m'],
});

export const HRRR_TMP_SFC = defineField({
    id: 'HRRR_TMP_SFC',
    label: 'Surface Temperature',
    pane: 'surface',
    kind: 'scalar',
    units: '°C',
    quantity: 'temperature',
    inputs: [sfc('TMP', 'surface', { transform: K_TO_C })],
    colormap: { name: 'RAP_Temperature_LL', toStored: K_TO_C },
    legacyIds: ['RAP_TMP_Surface', 'Temperature Surface'],
});

export const HRRR_THETAE_2M = defineField({
    id: 'HRRR_THETAE_2M',
    label: 'Surface Theta-E',
    pane: 'surface',
    kind: 'scalar',
    recipe: 'thetae',
    units: 'K',
    inputs: [
        sfc('TMP', '2 m above ground', { transform: K_TO_C }),
        sfc('DPT', '2 m above ground', { transform: K_TO_C }),
        sfc('PRES', 'surface', { transform: { scale: 0.01 } }),
    ],
    colormap: { name: 'RAP_ThetaE_Surface' },
    legacyIds: ['Thetae Surface'],
});

export const HRRR_MSLP = defineField({
    id: 'HRRR_MSLP',
    label: 'MSLP',
    pane: 'surface',
    kind: 'scalar',
    units: 'hPa',
    display: { offset: 1000 },
    inputs: [sfc('MSLMA', 'mean sea level', { transform: { scale: 0.01, offset: -1000 } })],
    colormap: { name: 'HRRR_MSLP', toStored: { offset: -1000 } },
    legacyIds: ['RAP_MSLP_Surface'],
    overlay: true,
});

export const HRRR_WIND_10M = defineField({
    id: 'HRRR_WIND_10M',
    label: '10 m Wind',
    pane: 'surface',
    kind: 'vector',
    recipe: 'vector',
    recipeParams: { frame: 'grid' },
    units: 'm/s',
    ratioScale: true,
    quantity: 'speed',
    inputs: [sfc('UGRD', '10 m above ground'), sfc('VGRD', '10 m above ground')],
    colormap: { name: 'RAP_Wind_LL' },
    legacyIds: ['RAP_WIND_10M', 'RAP_UGRD_10M', 'RAP_VGRD_10M'],
});

export const HRRR_GUST_SFC = defineField({
    id: 'HRRR_GUST_SFC',
    label: '10 m Wind Gust',
    pane: 'surface',
    kind: 'extreme',
    units: 'm/s',
    ratioScale: true,
    quantity: 'speed',
    inputs: [sfc('GUST', 'surface')],
    colormap: { name: 'RAP_Wind_LL' },
    legacyIds: ['RAP_GUST_10M'],
});

export const HRRR_VIS = defineField({
    id: 'HRRR_VIS',
    label: 'Visibility',
    pane: 'surface',
    kind: 'scalar',
    units: 'km',
    inputs: [sfc('VIS', 'surface', { transform: { scale: 0.001 } })],
    colormap: { name: 'HRRR_Visibility' },
});

export const HRRR_TCDC = defineField({
    id: 'HRRR_TCDC',
    label: 'Cloud Cover',
    pane: 'surface',
    kind: 'scalar',
    units: '%',
    inputs: [sfc('TCDC', 'entire atmosphere')],
    colormap: { name: 'HRRR_CloudCover' },
});
