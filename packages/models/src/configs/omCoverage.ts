/**
 * What the Open-Meteo copies of ARPEGE and HRDPS carry beyond the GEM base set (UKMO borrows its fields): the heights above
 * the ground, and the surface variables that need no recipe. Each is written against canonical NCEP names, with the aliases that
 * map them onto Open-Meteo's variable names. Not a model, so it sits outside `datasets/`. Units were read from real files
 * (2026-11-02): temperatures in degrees C, speeds in m/s, heights in m, precipitation in mm of the step before the valid time
 * (one hour, or the three or six hours between steps later in a run).
 */
import {
    defineField,
    type ComponentAlias,
    type ModelFieldConfig,
    type PointSeriesConfig,
    type PointSeriesField,
    type StepRange,
} from './types.ts';
import { OPEN_METEO_BUCKET } from './shared.ts';
import { K_TO_C, sfc } from './fields/selectors.ts';
import { PRESSURE_LEVEL_FIELDS } from './fields/pressure.ts';
import { heightLevel, heightLevelFields, type LevelWind } from './fields/levels.ts';
import { omAlias, omSpeedDirectionWind } from './gem.ts';

/** The only pressure levels the Models window offers. */
const OM_LEVELS = [925, 850, 700, 500, 250] as const;

export const OM_PRECIP_STEP = defineField({
    id: 'OM_PRECIP_STEP',
    label: 'Precipitation (previous step)',
    pane: 'precip',
    kind: 'accum',
    units: 'mm',
    ratioScale: true,
    inputs: [sfc('APCP', 'surface', { timing: 'window' })],
    colormap: { name: 'MRMS_QPE_Long' },
});

export const OM_SHOWERS = defineField({
    id: 'OM_SHOWERS',
    label: 'Showers (previous step)',
    pane: 'precip',
    kind: 'accum',
    units: 'mm',
    ratioScale: true,
    inputs: [sfc('SHOWERS', 'surface', { timing: 'window' })],
    colormap: { name: 'MRMS_QPE_Long' },
});

export const OM_RAIN = defineField({
    id: 'OM_RAIN',
    label: 'Rain (previous step)',
    pane: 'precip',
    kind: 'accum',
    units: 'mm',
    ratioScale: true,
    inputs: [sfc('RAIN', 'surface', { timing: 'window' })],
    colormap: { name: 'MRMS_QPE_Long' },
});

export const OM_SNOWFALL = defineField({
    id: 'OM_SNOWFALL',
    label: 'Snowfall, 10:1 (previous step)',
    pane: 'winter',
    kind: 'accum',
    units: 'cm',
    inputs: [sfc('SNOWFALL', 'surface', { timing: 'window' })],
    colormap: { name: 'HRRR_Snowfall' },
});

export const OM_CAPE = defineField({
    id: 'OM_CAPE',
    label: 'CAPE',
    pane: 'severe',
    kind: 'scalar',
    units: 'J/kg',
    ratioScale: true,
    inputs: [sfc('CAPE', 'surface')],
    colormap: { name: 'RAP_CAPE' },
});

export const OM_CIN = defineField({
    id: 'OM_CIN',
    label: 'CIN',
    pane: 'severe',
    kind: 'scalar',
    units: 'J/kg',
    inputs: [sfc('CIN', 'surface')],
    colormap: { name: 'RAP_CIN_Surface' },
});

export const OM_CLOUD_2M = defineField({
    id: 'OM_CLOUD_2M',
    label: 'Cloud at 2 m (Fog)',
    pane: 'surface',
    kind: 'scalar',
    units: '%',
    inputs: [sfc('TCDC', '2 m above ground')],
    colormap: { name: 'HRRR_CloudCover' },
});

export const OM_SOIL_TEMPERATURE = defineField({
    id: 'OM_SOIL_TEMPERATURE',
    label: 'Soil Temperature (0-10 cm)',
    pane: 'surface',
    kind: 'scalar',
    units: '°C',
    quantity: 'temperature',
    inputs: [sfc('TSOIL', '0-0.1 m below ground', { transform: K_TO_C })],
    colormap: { name: 'RAP_Temperature_LL', toStored: K_TO_C },
});

export const OM_SOIL_MOISTURE = defineField({
    id: 'OM_SOIL_MOISTURE',
    label: 'Soil Moisture (0-10 cm)',
    pane: 'surface',
    kind: 'scalar',
    units: '%',
    inputs: [sfc('SOILW', '0-0.1 m below ground', { transform: { scale: 100 } })],
    colormap: { name: 'MRMS_SoilSaturation' },
});

/** Aliases for the surface variables above and the base set's names that the GEM models do not already map. */
export const OM_SURFACE_ALIASES: Readonly<Record<string, ComponentAlias>> = {
    'APCP|surface': omAlias('precipitation'),
    'SHOWERS|surface': omAlias('showers'),
    'SNOWFALL|surface': omAlias('snowfall_water_equivalent'),
    'CAPE|surface': omAlias('cape'),
    'CIN|surface': omAlias('convective_inhibition'),
    'LCDC|low cloud layer': omAlias('cloud_cover_low'),
    'MCDC|middle cloud layer': omAlias('cloud_cover_mid'),
    'HCDC|high cloud layer': omAlias('cloud_cover_high'),
    'TCDC|2 m above ground': omAlias('cloud_cover_2m'),
    'DSWRF|surface': omAlias('shortwave_radiation'),
    'WEASD|surface': omAlias('snow_depth_water_equivalent'),
    'TMP|surface': omAlias('surface_temperature', { offset: 273.15 }),
    'VIS|surface': omAlias('visibility'),
    'TSOIL|0-0.1 m below ground': omAlias('soil_temperature_0_to_10cm', { offset: 273.15 }),
    'SOILW|0-0.1 m below ground': omAlias('soil_moisture_0_to_10cm'),
};

/** Temperature, humidity, height and wind on the five pressure levels that have panes. */
export function omPressureFields(wind: LevelWind, windPrefix: string): ModelFieldConfig[] {
    return OM_LEVELS.flatMap((mb) => {
        const { tmp, rh, hgt, wind: vector } = PRESSURE_LEVEL_FIELDS[mb];
        return [tmp, rh, hgt, wind === 'uv' ? vector : omSpeedDirectionWind(vector, windPrefix)];
    });
}

/** Aliases for the temperature, humidity, height and wind of each of the five pressure levels. */
export function omLevelAliases(wind: LevelWind): Record<string, ComponentAlias> {
    return Object.fromEntries(
        OM_LEVELS.flatMap((mb) => [
            [`TMP|${mb} mb`, omAlias(`temperature_${mb}hPa`, { offset: 273.15 })],
            [`RH|${mb} mb`, omAlias(`relative_humidity_${mb}hPa`)],
            [`HGT|${mb} mb`, omAlias(`geopotential_height_${mb}hPa`)],
            ...(wind === 'uv'
                ? [
                      [`UGRD|${mb} mb`, omAlias(`wind_u_component_${mb}hPa`)],
                      [`VGRD|${mb} mb`, omAlias(`wind_v_component_${mb}hPa`)],
                  ]
                : [
                      [`WIND|${mb} mb`, omAlias(`wind_speed_${mb}hPa`)],
                      [`WDIR|${mb} mb`, omAlias(`wind_direction_${mb}hPa`)],
                  ]),
        ]),
    );
}

/** Temperature and wind at heights above the ground. */
export const omHeightFields = (heights: readonly number[], wind: LevelWind): ModelFieldConfig[] =>
    heightLevelFields('AGL', heights, wind);

export function omHeightAliases(heights: readonly number[], wind: LevelWind): Record<string, ComponentAlias> {
    return Object.fromEntries(
        heights.flatMap((m) => {
            const level = heightLevel('AGL', m);
            return [
                [`TMP|${level}`, omAlias(`temperature_${m}m`, { offset: 273.15 })],
                ...(wind === 'uv'
                    ? [
                          [`UGRD|${level}`, omAlias(`wind_u_component_${m}m`)],
                          [`VGRD|${level}`, omAlias(`wind_v_component_${m}m`)],
                      ]
                    : [
                          [`WIND|${level}`, omAlias(`wind_speed_${m}m`)],
                          [`WDIR|${level}`, omAlias(`wind_direction_${m}m`)],
                      ]),
            ];
        }),
    );
}

/** The same step ranges without the analysis: variables Open-Meteo writes for the previous step are absent from the first file. */
export const afterAnalysis = (ranges: readonly StepRange[]): StepRange[] =>
    ranges.map((range, i) => (i === 0 ? { ...range, from: range.from + range.every } : range));

/**
 * The meteogram's point series for a model whose maps already read Open-Meteo: the same `data_spatial/` objects, so each field
 * maps onto the variable its alias names and no unit changes beyond the field's own storage (height in decametres). Winds can
 * only be mapped where Open-Meteo publishes components; speed and direction have no vector series.
 */
export function omPointSeries(
    model: string,
    wind: LevelWind,
    scalars: Readonly<Record<string, string>>,
    pressureLevels = true,
): PointSeriesConfig {
    const fields: Record<string, PointSeriesField> = {};
    for (const [id, variable] of Object.entries(scalars)) fields[id] = { variables: [variable] };
    if (wind === 'uv')
        fields.HRRR_WIND_10M = {
            variables: ['wind_u_component_10m', 'wind_v_component_10m'],
            recipe: 'vector',
            frame: 'earth',
        };
    for (const mb of pressureLevels ? OM_LEVELS : []) {
        fields[`HRRR_TMP_${mb}MB`] = { variables: [`temperature_${mb}hPa`] };
        fields[`HRRR_RH_${mb}MB`] = { variables: [`relative_humidity_${mb}hPa`] };
        fields[`HRRR_HGT_${mb}MB`] = {
            variables: [`geopotential_height_${mb}hPa`],
            transform: { scale: 0.1 },
        };
        if (wind === 'uv')
            fields[`HRRR_WIND_${mb}MB`] = {
                variables: [`wind_u_component_${mb}hPa`, `wind_v_component_${mb}hPa`],
                recipe: 'vector',
                frame: 'earth',
            };
    }
    return {
        provider: 'open-meteo',
        bucket: OPEN_METEO_BUCKET,
        model,
        cycles: [],
        spatial: true,
        verifiedOn: '2026-11-02',
        fields,
    };
}
