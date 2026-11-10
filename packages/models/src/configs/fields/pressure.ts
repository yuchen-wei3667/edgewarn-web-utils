import { defineField, type ModelFieldConfig, type ModelPaneId } from '../types.ts';
import { K_TO_C, prs } from './selectors.ts';

const LEVELS = [925, 850, 700, 500, 250] as const;
type Level = (typeof LEVELS)[number];

const TEMP_CMAP: Record<Level, string> = {
    925: 'RAP_Temperature_LL',
    850: 'RAP_Temperature_LL',
    700: 'RAP_Temperature_LL',
    500: 'RAP_Temperature_HL',
    250: 'RAP_Temperature',
};
const WIND_CMAP: Record<Level, string> = {
    925: 'RAP_Wind_LL',
    850: 'RAP_Wind_LL',
    700: 'RAP_Wind_ML',
    500: 'RAP_Wind_ML',
    250: 'RAP_Wind_HL',
};
/** Height ranges per level, in decametres. */
const HEIGHT_RANGE: Record<Level, [number, number]> = {
    925: [60, 100],
    850: [120, 160],
    700: [270, 320],
    500: [500, 600],
    250: [980, 1100],
};

function levelFields(mb: Level) {
    const L = `${mb} mb`;
    const pane = String(mb) as ModelPaneId;
    return {
        tmp: defineField({
            id: `HRRR_TMP_${mb}MB`,
            label: `${L} Temperature`,
            pane,
            kind: 'scalar',
            units: '°C',
            quantity: 'temperature',
            inputs: [prs('TMP', L, { transform: K_TO_C })],
            colormap: { name: TEMP_CMAP[mb], toStored: K_TO_C },
            legacyIds: [`Temperature ${mb}mb`, `RAP_TMP_${mb}MB`],
        }),
        dpt: defineField({
            id: `HRRR_DPT_${mb}MB`,
            label: `${L} Dewpoint`,
            pane,
            kind: 'scalar',
            units: '°C',
            quantity: 'temperature',
            inputs: [prs('DPT', L, { transform: K_TO_C })],
            colormap: { name: TEMP_CMAP[mb], toStored: K_TO_C },
            legacyIds: [`Dewpoint ${mb}mb`, `RAP_DPT_${mb}MB`],
        }),
        rh: defineField({
            id: `HRRR_RH_${mb}MB`,
            label: `${L} Relative Humidity`,
            pane,
            kind: 'scalar',
            units: '%',
            inputs: [prs('RH', L)],
            colormap: { name: 'RAP_RelativeHumidity' },
            legacyIds: [`Relativehumidity ${mb}mb`, `RAP_RH_${mb}MB`],
        }),
        hgt: defineField({
            id: `HRRR_HGT_${mb}MB`,
            label: `${L} Height`,
            pane,
            kind: 'scalar',
            units: 'dam',
            contourInterval: mb === 250 ? 12 : mb === 500 ? 6 : 3,
            inputs: [prs('HGT', L, { transform: { scale: 0.1 } })],
            colormap: { name: 'HRRR_Height', range: HEIGHT_RANGE[mb] },
            legacyIds: [`Height ${mb}mb`, `RAP_HGT_${mb}MB`],
        }),
        wind: defineField({
            id: `HRRR_WIND_${mb}MB`,
            label: `${L} Wind`,
            pane,
            kind: 'vector',
            recipe: 'vector',
            recipeParams: { frame: 'grid' },
            units: 'm/s',
            ratioScale: true,
            quantity: 'speed',
            contourField: `HRRR_HGT_${mb}MB`,
            inputs: [prs('UGRD', L), prs('VGRD', L)],
            colormap: { name: WIND_CMAP[mb] },
            legacyIds: [`RAP_WIND_${mb}MB`, `RAP_UGRD_${mb}MB`, `RAP_VGRD_${mb}MB`],
        }),
    };
}

/** Temperature, dewpoint, humidity, height and wind at each pressure level. */
export const PRESSURE_LEVEL_FIELDS = {
    925: levelFields(925),
    850: levelFields(850),
    700: levelFields(700),
    500: levelFields(500),
    250: levelFields(250),
};

/** All of them in picker order (level by level), minus the ones a model does not carry. */
export function pressureFields(omit: readonly ModelFieldConfig[] = []): ModelFieldConfig[] {
    return LEVELS.flatMap((mb) => Object.values(PRESSURE_LEVEL_FIELDS[mb]) as ModelFieldConfig[]).filter(
        (f) => !omit.includes(f),
    );
}

export const HRRR_ABSV_500MB = defineField({
    id: 'HRRR_ABSV_500MB',
    label: '500 mb Absolute Vorticity',
    pane: '500',
    kind: 'scalar',
    units: '10⁻⁵ s⁻¹',
    contourField: PRESSURE_LEVEL_FIELDS[500].hgt.id,
    inputs: [prs('ABSV', '500 mb', { transform: { scale: 1e5 } })],
    colormap: { name: 'RAP_AbsoluteVorticity_500mb', toStored: { scale: 1e5 } },
    legacyIds: ['Absolutevorticity 500mb'],
});
