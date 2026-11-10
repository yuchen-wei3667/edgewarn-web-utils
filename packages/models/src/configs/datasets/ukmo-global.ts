import {
    defineDataset,
    pad,
    type ComponentAlias,
    type ModelFieldConfig,
    type ModelUrlParams,
} from '../types.ts';
import { MET_OFFICE_BUCKET } from '../shared.ts';
import { omSpeedDirectionWind } from '../gem.ts';
import {
    afterAnalysis,
    OM_CAPE,
    OM_CIN,
    OM_CLOUD_2M,
    OM_PRECIP_STEP,
    OM_RAIN,
    omPressureFields,
} from '../omCoverage.ts';
import { CLOUD_HIGH, CLOUD_LOW, CLOUD_MID, DSWRF_SFC } from '../fields/extras.ts';
import { HRRR_PRATE } from '../fields/precip.ts';
import { HRRR_MLCAPE, HRRR_MLCIN, HRRR_MUCAPE, HRRR_MUCIN } from '../fields/severe.ts';
import {
    HRRR_DPT_2M,
    HRRR_GUST_SFC,
    HRRR_MSLP,
    HRRR_RH_2M,
    HRRR_TCDC,
    HRRR_TMP_2M,
    HRRR_TMP_SFC,
    HRRR_VIS,
    HRRR_WIND_10M,
} from '../fields/surface.ts';
import { HRRR_WEASD } from '../fields/winter.ts';
import {
    MO_ABSV_500MB,
    MO_CLOUD_HEIGHT_FIELDS,
    MO_PRECIP_FIELDS,
    MO_PRESSURE_FIELDS,
    MO_SURFACE_FIELDS,
} from '../fields/metOffice.ts';

const wind = (field: ModelFieldConfig) => omSpeedDirectionWind(field, 'UKMO_');

/** The 00 and 12 UTC runs; the 06 and 18 UTC runs stop at 69 h (hourly to 54, then every 3 hours). */
const LONG_STEPS = [
    { from: 0, to: 54 * 60, every: 60 },
    { from: 57 * 60, to: 144 * 60, every: 180 },
    { from: 150 * 60, to: 168 * 60, every: 360 },
];

/**
 * The key of the file `name` for one valid time: `<model>/<run>/<valid time>-PT<hhhh>H00M-<name>.nc`. Every variable has a file
 * of its own, so the dataset's objects name the one the gate probes (its `name`) and the NetCDF reader swaps in the others.
 */
function ukmoPath({ date, cycle, step }: ModelUrlParams, name: string): string {
    const init = Date.UTC(
        Number(date.slice(0, 4)),
        Number(date.slice(4, 6)) - 1,
        Number(date.slice(6, 8)),
        cycle,
    );
    const valid = new Date(init + step * 3_600_000).toISOString().slice(0, 16).replace(/[-:]/g, '');
    return `global-deterministic-10km/${date}T${pad(cycle, 2)}00Z/${valid}Z-PT${pad(step, 4)}H00M-${name}.nc`;
}

/**
 * The Met Office file of each component (`variable` is its name in the file name), with the transform to the canonical unit:
 * fractions become percent, a depth in m or a rate in m/s becomes kg/m2 or kg/m2/s. Pressure-level files take the level in hPa.
 */
const FRACTION = { scale: 100 };
/** A rate in m/s of liquid water is kg/m2/s ten to the third times larger; a depth in metres is millimetres. */
const MM_PER_SECOND = { scale: 1000 };
const METRES_TO_MM = { scale: 1000 };
const stem = (variable: string, transform?: ComponentAlias['transform']): ComponentAlias => ({
    variable,
    level: '',
    ...(transform ? { transform } : {}),
});
const UKMO_COMPONENTS: Readonly<Record<string, ComponentAlias>> = {
    'TMP|2 m above ground': stem('temperature_at_screen_level'),
    'RH|2 m above ground': stem('relative_humidity_at_screen_level', FRACTION),
    'WIND|10 m above ground': stem('wind_speed_at_10m'),
    'WDIR|10 m above ground': stem('wind_direction_at_10m'),
    'GUST|surface': stem('wind_gust_at_10m'),
    'TCDC|entire atmosphere': stem('cloud_amount_of_total_cloud', FRACTION),
    'LCDC|low cloud layer': stem('cloud_amount_of_low_cloud', FRACTION),
    'MCDC|middle cloud layer': stem('cloud_amount_of_medium_cloud', FRACTION),
    'HCDC|high cloud layer': stem('cloud_amount_of_high_cloud', FRACTION),
    'TCDC|2 m above ground': stem('fog_fraction_at_screen_level', FRACTION),
    'MSLMA|mean sea level': stem('pressure_at_mean_sea_level'),
    'TMP|surface': stem('temperature_at_surface'),
    'VIS|surface': stem('visibility_at_screen_level'),
    'PRATE|surface': stem('precipitation_rate', { scale: 1000 }),
    'CAPE|surface': stem('CAPE_surface'),
    'CIN|surface': stem('CIN_surface'),
    'WEASD|surface': stem('snow_depth_water_equivalent', { scale: 1000 }),
    'DPT|2 m above ground': stem('temperature_of_dew_point_at_screen_level'),
    'DSWRF|surface': stem('radiation_flux_in_shortwave_total_downward_at_surface'),
    'SWDIR|surface': stem('radiation_flux_in_shortwave_direct_downward_at_surface'),
    'DLWRF|surface': stem('radiation_flux_in_longwave_downward_at_surface'),
    'UVDOWN|surface': stem('radiation_flux_in_uv_downward_at_surface'),
    'PRES|tropopause': stem('pressure_at_tropopause'),
    'TMP|tropopause': stem('temperature_at_tropopause'),
    'TCDC|1000 ft above mean sea level': stem('cloud_amount_below_1000ft_ASL', FRACTION),
    'TCDC|convective cloud layer': stem('cloud_amount_of_total_convective_cloud', FRACTION),
    'CAPE|90-0 mb above ground': stem('CAPE_mixed_layer_lowest_500m'),
    'CIN|90-0 mb above ground': stem('CIN_mixed_layer_lowest_500m'),
    'CAPE|255-0 mb above ground': stem('CAPE_most_unstable_below_500hPa'),
    'CIN|255-0 mb above ground': stem('CIN_most_unstable_below_500hPa'),
    'RRATE|surface': stem('rainfall_rate', MM_PER_SECOND),
    'SRATE|surface': stem('snowfall_rate', MM_PER_SECOND),
    'CRRATE|surface': stem('rainfall_rate_from_convection', MM_PER_SECOND),
    'CSRATE|surface': stem('snowfall_rate_from_convection', MM_PER_SECOND),
    // Statistics of the period ending at the step; `{window}` is that period (PT01H, PT03H or PT06H).
    'CRRATEMAX|surface': stem('rainfall_rate_from_convection_max-{window}', MM_PER_SECOND),
    'CSRATEMAX|surface': stem('snowfall_rate_from_convection_max-{window}', MM_PER_SECOND),
    'CSRATEMEAN|surface': stem('snowfall_rate_from_convection_mean-{window}', MM_PER_SECOND),
    'APCP|surface': stem('precipitation_accumulation-{window}', METRES_TO_MM),
    'RAIN|surface': stem('rainfall_accumulation-{window}', METRES_TO_MM),
    'LHTFL|surface': stem('latent_heat_flux_at_surface_mean-{window}'),
    'TMAX|2 m above ground': stem('temperature_at_screen_level_max-{window}'),
    'TMIN|2 m above ground': stem('temperature_at_screen_level_min-{window}'),
    'GUSTMAX|surface': stem('wind_gust_at_10m_max-{window}'),
    ...Object.fromEntries(
        [500, 1000, 2000, 3000, 5000].map((m) => [
            `CLDVOL|${m} m above ground`,
            { ...stem('cloud_amount_on_height_levels', FRACTION), level: String(m) },
        ]),
    ),
    ...Object.fromEntries(
        [925, 850, 700, 500, 250].flatMap((mb) => {
            const level = (variable: string, transform?: ComponentAlias['transform']): ComponentAlias => ({
                ...stem(variable, transform),
                level: String(mb),
            });
            return [
                [`TMP|${mb} mb`, level('temperature_on_pressure_levels')],
                [`RH|${mb} mb`, level('relative_humidity_on_pressure_levels', FRACTION)],
                [`HGT|${mb} mb`, level('geopotential_height_on_pressure_levels')],
                [`WIND|${mb} mb`, level('wind_speed_on_pressure_levels')],
                [`WDIR|${mb} mb`, level('wind_direction_on_pressure_levels')],
                [`THETAW|${mb} mb`, level('wet_bulb_potential_temperature_on_pressure_levels')],
                [`W|${mb} mb`, level('wind_vertical_velocity_on_pressure_levels')],
            ];
        }),
    ),
};

/**
 * The Met Office Unified Model, global deterministic at about 10 km (2560 x 1920 cells, 0.140625 by 0.09375 degrees), read from the
 * Met Office's own NetCDF-4 files on AWS Open Data: one file per variable per valid time, range-read by `utils/models/netcdf/`.
 * Hourly to 54 h. The 00 and 12 UTC cycles go on every 3 hours to 144 h and every 6 hours to 168 h; the 06 and 18 UTC cycles stop at
 * 69 h. Winds come as speed and direction; precipitation is the instantaneous rate. Only the five usual pressure levels are offered
 * (the files hold 37). Viewer-only.
 */
export const ukmoGlobal = defineDataset({
    id: 'ukmo-global',
    label: 'UKMO Global',
    shortLabel: 'UKMO',
    docs: {
        runs: '00, 06, 12 and 18 UTC',
        length: '168 hours at 00 and 12 UTC (hourly to 54, every 3 hours to 144, then every 6 hours); 69 hours at 06 and 18 UTC (hourly to 54, then every 3 hours)',
    },
    about: {
        provider: 'Met Office',
        category: 'global',
        attribution: 'Contains Met Office data, licensed CC BY-SA 4.0.',
    },
    access: { corsVerifiedOn: '2026-11-02' },
    surfaces: ['viewer'],
    source: { kind: 'netcdf' },
    bucket: MET_OFFICE_BUCKET,
    objects: {
        surface: { serves: ['sfc'], url: (params) => ukmoPath(params, 'temperature_at_screen_level') },
        levels: { serves: ['prs'], url: (params) => ukmoPath(params, 'temperature_on_pressure_levels') },
    },
    gate: ['surface', 'levels'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [
        { cycles: [0, 12], steps: LONG_STEPS },
        {
            cycles: [6, 18],
            steps: [
                { from: 0, to: 54 * 60, every: 60 },
                { from: 57 * 60, to: 69 * 60, every: 180 },
            ],
        },
    ],
    // Cell centres, south to north from -179.93 degrees (written as 180.07: a first longitude is 0 to 360).
    grid: {
        projection: 'latlon',
        nx: 2560,
        ny: 1920,
        lat1: -89.953125,
        lon1: 180.0703125,
        dlat: 0.09375,
        dlon: 0.140625,
        scanMode: 0x40,
        radiusM: 6371229,
    },
    // 0.140625 degrees is 15.6 km at the equator, so the three levels merge 1, 2 and 4 cells.
    levelTargetsKm: [16, 31, 63],
    idx: { components: UKMO_COMPONENTS },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [
        HRRR_TMP_2M,
        HRRR_RH_2M,
        HRRR_TMP_SFC,
        wind(HRRR_WIND_10M),
        HRRR_GUST_SFC,
        HRRR_VIS,
        HRRR_TCDC,
        CLOUD_LOW,
        CLOUD_MID,
        CLOUD_HIGH,
        OM_CLOUD_2M,
        HRRR_MSLP,
        HRRR_DPT_2M,
        DSWRF_SFC,
        ...MO_SURFACE_FIELDS,
        HRRR_PRATE,
        ...MO_PRECIP_FIELDS,
        OM_PRECIP_STEP,
        OM_RAIN,
        HRRR_WEASD,
        OM_CAPE,
        OM_CIN,
        HRRR_MLCAPE,
        HRRR_MLCIN,
        HRRR_MUCAPE,
        HRRR_MUCIN,
        ...omPressureFields('speed', 'UKMO_'),
        ...MO_PRESSURE_FIELDS,
        MO_ABSV_500MB,
        ...MO_CLOUD_HEIGHT_FIELDS,
    ],
    // Statistics over the previous step have no analysis; the longwave file stops at 162 h and the UV file is three-hourly throughout.
    fieldSteps: {
        ...Object.fromEntries(
            [
                'OM_PRECIP_STEP',
                'OM_RAIN',
                'MO_LHTFL',
                'MO_TMAX',
                'MO_TMIN',
                'MO_GUST_MAX',
                'MO_CRAIN_MAX',
                'MO_CSNOW_MAX',
                'MO_CSNOW_MEAN',
            ].map((id) => [id, afterAnalysis(LONG_STEPS)]),
        ),
        MO_DLWRF: [
            { from: 0, to: 54 * 60, every: 60 },
            { from: 57 * 60, to: 144 * 60, every: 180 },
            { from: 150 * 60, to: 162 * 60, every: 360 },
        ],
        MO_UV: [
            { from: 0, to: 144 * 60, every: 180 },
            { from: 150 * 60, to: 162 * 60, every: 360 },
        ],
    },
});
