/**
 * Open-Meteo's run-pinned copy of the models, read by the meteogram for point series (`PointSeriesConfig`).
 * Each mapping was checked against the GRIB2 value at the same cell, run and step (HRRR 2026-10-29 09Z at
 * Norman and Denver, `tests/models/models-point-series.test.mjs`). Left on GRIB2 on purpose: HRRR precipitation
 * (Open-Meteo's hourly amounts are distributed differently from APCP, though the totals agree), dewpoint (no
 * variable; deriving it from T and RH is 0.4 °C off HRRR's own) and everything Open-Meteo does not carry.
 */
import { OPEN_METEO_BUCKET } from './shared.ts';
import type { PointSeriesConfig, PointSeriesField } from './types.ts';

/** Shown wherever a value from Open-Meteo is: their data is CC BY 4.0. */
export const OPEN_METEO_CREDIT = {
    text: 'Weather data by Open-Meteo.com',
    url: 'https://open-meteo.com/',
} as const;

const LEVELS = [925, 850, 700, 500, 250] as const;

/** Open-Meteo carries HRRR's winds as the file has them: relative to the Lambert grid. */
const gridWind = (u: string, v: string): PointSeriesField => ({
    variables: [u, v],
    recipe: 'vector',
    frame: 'grid',
});

const HRRR_LEVEL_FIELDS: Record<string, PointSeriesField> = Object.fromEntries(
    LEVELS.flatMap((mb) => [
        [`HRRR_TMP_${mb}MB`, { variables: [`temperature_${mb}hPa`] }],
        [`HRRR_RH_${mb}MB`, { variables: [`relative_humidity_${mb}hPa`] }],
        // Metres; the field stores decametres.
        [`HRRR_HGT_${mb}MB`, { variables: [`geopotential_height_${mb}hPa`], transform: { scale: 0.1 } }],
        [`HRRR_WIND_${mb}MB`, gridWind(`wind_u_component_${mb}hPa`, `wind_v_component_${mb}hPa`)],
    ]),
);

export const HRRR_POINT_SERIES: PointSeriesConfig = {
    provider: 'open-meteo',
    bucket: OPEN_METEO_BUCKET,
    model: 'ncep_hrrr_conus',
    cycles: [0, 3, 6, 9, 12, 15, 18, 21],
    // Every hourly run, with steps appearing about an hour after the cycle (2026-10-29).
    spatial: true,
    verifiedOn: '2026-10-29',
    fields: {
        HRRR_TMP_2M: { variables: ['temperature_2m'] },
        HRRR_RH_2M: { variables: ['relative_humidity_2m'] },
        HRRR_TMP_SFC: { variables: ['surface_temperature'] },
        HRRR_WIND_10M: gridWind('wind_u_component_10m', 'wind_v_component_10m'),
        HRRR_GUST_SFC: { variables: ['wind_gusts_10m'] },
        // Metres; the field stores kilometres.
        HRRR_VIS: { variables: ['visibility'], transform: { scale: 0.001 } },
        HRRR_TCDC: { variables: ['cloud_cover'] },
        HRRR_SBCAPE: { variables: ['cape'] },
        // Open-Meteo stores inhibition as a positive number.
        HRRR_SBCIN: { variables: ['convective_inhibition'], transform: { scale: -1 } },
        HRRR_LFTX: { variables: ['lifted_index'] },
        HRRR_PWAT: { variables: ['total_column_integrated_water_vapour'] },
        HRRR_FRZLVL: { variables: ['freezing_level_height'] },
        ...HRRR_LEVEL_FIELDS,
    },
};
