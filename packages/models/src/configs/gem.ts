import {
    defineField,
    pad,
    type ComponentAlias,
    type ModelFieldConfig,
    type ModelUrlParams,
} from './types.ts';
import {
    HRRR_GUST_SFC,
    HRRR_MSLP,
    HRRR_RH_2M,
    HRRR_TCDC,
    HRRR_TMP_2M,
    HRRR_WIND_10M,
} from './fields/surface.ts';
import { PRESSURE_LEVEL_FIELDS } from './fields/pressure.ts';
import { HRRR_SNOD } from './fields/winter.ts';

/**
 * Open-Meteo publishes meteorological wind speed/direction, relative to geographic north. The copy's id swaps
 * the `HRRR_` prefix for the model family's, so one model's wind field is never another's.
 */
export function omSpeedDirectionWind(field: ModelFieldConfig, prefix: string) {
    const selector = field.inputs[0];
    return defineField({
        ...field,
        id: field.id.replace('HRRR_', prefix),
        legacyIds: [],
        recipe: 'speed-direction',
        recipeParams: { frame: 'earth' },
        inputs: [
            { ...selector, variable: 'WIND' },
            { ...selector, variable: 'WDIR' },
        ],
    });
}

const wind = (field: ModelFieldConfig) => omSpeedDirectionWind(field, 'GEM_');

export const GEM_SURFACE_FIELDS = [
    HRRR_TMP_2M,
    HRRR_RH_2M,
    wind(HRRR_WIND_10M),
    HRRR_GUST_SFC,
    HRRR_TCDC,
    HRRR_MSLP,
    HRRR_SNOD,
];
export const GEM_PRESSURE_FIELDS = Object.values(PRESSURE_LEVEL_FIELDS).flatMap(
    ({ tmp, rh, hgt, wind: vector }) => [tmp, rh, hgt, wind(vector)],
);
export const GEM_FIELDS = [...GEM_SURFACE_FIELDS, ...GEM_PRESSURE_FIELDS];

/** Alias transforms convert OM units to the canonical selector units before its usual storage transform. */
export const omAlias = (variable: string, transform?: ComponentAlias['transform']): ComponentAlias => ({
    variable,
    level: '',
    ...(transform ? { transform } : {}),
});
const alias = omAlias;
export const GEM_COMPONENTS: Readonly<Record<string, ComponentAlias>> = {
    'TMP|2 m above ground': alias('temperature_2m', { offset: 273.15 }),
    'RH|2 m above ground': alias('relative_humidity_2m'),
    'WIND|10 m above ground': alias('wind_speed_10m'),
    'WDIR|10 m above ground': alias('wind_direction_10m'),
    'GUST|surface': alias('wind_gusts_10m'),
    'TCDC|entire atmosphere': alias('cloud_cover'),
    'MSLMA|mean sea level': alias('pressure_msl', { scale: 100 }),
    'SNOD|surface': alias('snow_depth'),
    'SNOWFALL|surface': alias('snowfall_water_equivalent'),
    ...Object.fromEntries(
        [925, 850, 700, 500, 250].flatMap((mb) => [
            [`TMP|${mb} mb`, alias(`temperature_${mb}hPa`, { offset: 273.15 })],
            [`RH|${mb} mb`, alias(`relative_humidity_${mb}hPa`)],
            [`HGT|${mb} mb`, alias(`geopotential_height_${mb}hPa`)],
            [`WIND|${mb} mb`, alias(`wind_speed_${mb}hPa`)],
            [`WDIR|${mb} mb`, alias(`wind_direction_${mb}hPa`)],
        ]),
    ),
};

export function gemSpatialPath(model: string, { date, cycle, step }: ModelUrlParams): string {
    const init = Date.UTC(
        Number(date.slice(0, 4)),
        Number(date.slice(4, 6)) - 1,
        Number(date.slice(6, 8)),
        cycle,
    );
    const valid = new Date(init + step * 3_600_000).toISOString().slice(0, 16).replace(':', '');
    return `data_spatial/${model}/${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}/${pad(cycle, 2)}00Z/${valid}.om`;
}

export const GEM_ABOUT = {
    provider: 'ECCC',
    attribution:
        'Environment and Climate Change Canada (ECCC). Weather data by Open-Meteo.com (https://open-meteo.com/), CC BY 4.0.',
    derivedFrom: 'Open-Meteo copy of ECCC GEM output',
};
