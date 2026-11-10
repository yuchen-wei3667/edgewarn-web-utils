import { defineField, type ModelFieldConfig } from '../types.ts';
import { K_TO_C, sfc } from './selectors.ts';

/**
 * Temperature and wind at fixed heights above the ground or sea level. They share one pane (`levels`) and are written
 * against the canonical NCEP spelling (`UGRD|100 m above ground`), so a model whose source spells them differently lists
 * aliases. Winds come as east and north components (`uv`) or as speed and direction (`speed`, Open-Meteo's GEM models).
 */
export type LevelWind = 'uv' | 'speed';

/** The same wind, built from speed and direction: Open-Meteo publishes those for GEM, and the Met Office for UKMO. */
function speedDirection(field: ModelFieldConfig, from: string, to: string): ModelFieldConfig {
    const selector = field.inputs[0];
    return defineField({
        ...field,
        id: field.id.replace(from, to),
        recipe: 'speed-direction',
        recipeParams: { frame: 'earth' },
        inputs: [
            { ...selector, variable: 'WIND' },
            { ...selector, variable: 'WDIR' },
        ],
    });
}

/** Where a height is measured from: above the ground (`AGL`) or above mean sea level (`AMSL`). */
type HeightDatum = 'AGL' | 'AMSL';
const DATUM_TEXT: Record<HeightDatum, string> = { AGL: 'above ground', AMSL: 'above mean sea level' };

/** The canonical level text of a height. */
export const heightLevel = (datum: HeightDatum, metres: number): string => `${metres} m ${DATUM_TEXT[datum]}`;

/** Temperature and wind at fixed heights (metres), written against the near-surface (`sfc`) object. */
export function heightLevelFields(
    datum: HeightDatum,
    heights: readonly number[],
    wind: LevelWind,
): ModelFieldConfig[] {
    return heights.flatMap((m) => {
        const level = heightLevel(datum, m);
        const name = `${m} m ${datum}`;
        // The wind palette follows the height: low levels like the surface, the kilometres above like the mid levels.
        const palette = m >= 3000 ? 'RAP_Wind_HL' : m >= 1500 ? 'RAP_Wind_ML' : 'RAP_Wind_LL';
        const uv = defineField({
            id: `${datum}_WIND_${m}M`,
            label: `${name} Wind`,
            pane: 'levels',
            kind: 'vector',
            recipe: 'vector',
            recipeParams: { frame: 'grid' },
            units: 'm/s',
            ratioScale: true,
            quantity: 'speed',
            inputs: [sfc('UGRD', level), sfc('VGRD', level)],
            colormap: { name: palette },
        });
        return [
            defineField({
                id: `${datum}_TMP_${m}M`,
                label: `${name} Temperature`,
                pane: 'levels',
                kind: 'scalar',
                units: '°C',
                quantity: 'temperature',
                inputs: [sfc('TMP', level, { transform: K_TO_C })],
                colormap: { name: m >= 3000 ? 'RAP_Temperature_HL' : 'RAP_Temperature_LL', toStored: K_TO_C },
            }),
            wind === 'uv' ? uv : speedDirection(uv, `${datum}_WIND_`, `${datum}_SWIND_`),
        ];
    });
}
