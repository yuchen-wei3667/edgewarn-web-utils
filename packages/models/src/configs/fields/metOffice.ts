import { defineField, type ModelFieldConfig, type ModelPaneId } from '../types.ts';
import { K_TO_C, prs, sfc } from './selectors.ts';
import { scalar, temperature } from './rrfsNaExtras.ts';
import { PRESSURE_LEVEL_FIELDS } from './pressure.ts';

/**
 * Fields only the Met Office's own files carry beyond the shared set, written against canonical names the dataset's
 * component aliases map onto its files (`datasets/ukmo-global.ts`). The `previous step` ones are statistics of the window
 * ending at the valid time: an hour to 54 h, then three hours, then six.
 */

const MM_PER_HOUR = { scale: 3600 };
const rate = (id: string, label: string, variable: string, kind: 'scalar' | 'extreme' = 'scalar') =>
    defineField({
        id,
        label,
        pane: 'precip',
        kind,
        units: 'mm/h',
        ratioScale: true,
        inputs: [
            sfc(variable, 'surface', {
                transform: MM_PER_HOUR,
                ...(kind === 'extreme' ? { timing: 'window' as const } : {}),
            }),
        ],
        colormap: { name: 'PrecipRate' },
    });
const radiation = (id: string, label: string, variable: string, range?: [number, number]) =>
    scalar(
        id,
        label,
        'surface',
        'W/m²',
        sfc(variable, 'surface'),
        { name: 'NBM_SolarRadiation', ...(range ? { range } : {}) },
        { ratioScale: true },
    );

export const MO_SURFACE_FIELDS: readonly ModelFieldConfig[] = [
    radiation('MO_SWDIR', 'Direct Shortwave Radiation', 'SWDIR'),
    radiation('MO_DLWRF', 'Downward Longwave Radiation', 'DLWRF', [150, 450]),
    radiation('MO_UV', 'Downward UV Radiation', 'UVDOWN', [0, 4]),
    scalar(
        'MO_LHTFL',
        'Latent Heat Flux (mean, previous step)',
        'surface',
        'W/m²',
        sfc('LHTFL', 'surface', { timing: 'window' }),
        { name: 'Model_Difference', range: [-400, 400] },
    ),
    temperature(
        'MO_TMAX',
        '2 m Max Temperature (previous step)',
        'surface',
        sfc('TMAX', '2 m above ground', { timing: 'window' }),
    ),
    temperature(
        'MO_TMIN',
        '2 m Min Temperature (previous step)',
        'surface',
        sfc('TMIN', '2 m above ground', { timing: 'window' }),
    ),
    defineField({
        id: 'MO_GUST_MAX',
        label: '10 m Max Wind Gust (previous step)',
        pane: 'surface',
        kind: 'extreme',
        units: 'm/s',
        ratioScale: true,
        quantity: 'speed',
        inputs: [sfc('GUSTMAX', 'surface', { timing: 'window' })],
        colormap: { name: 'RAP_Wind_LL' },
    }),
    scalar(
        'MO_CLOUD_1000FT',
        'Cloud Below 1000 ft ASL',
        'surface',
        '%',
        sfc('TCDC', '1000 ft above mean sea level'),
        { name: 'HRRR_CloudCover' },
    ),
    scalar('MO_CLOUD_CONV', 'Convective Cloud Cover', 'surface', '%', sfc('TCDC', 'convective cloud layer'), {
        name: 'HRRR_CloudCover',
    }),
    scalar(
        'MO_TROP_PRES',
        'Tropopause Pressure',
        'surface',
        'hPa',
        sfc('PRES', 'tropopause', { transform: { scale: 0.01 } }),
        { name: 'HRRR_Height', range: [100, 450] },
    ),
    temperature(
        'MO_TROP_TMP',
        'Tropopause Temperature',
        'surface',
        sfc('TMP', 'tropopause'),
        'RAP_Temperature',
    ),
];

export const MO_PRECIP_FIELDS: readonly ModelFieldConfig[] = [
    rate('MO_RAINRATE', 'Rain Rate', 'RRATE'),
    rate('MO_SNOWRATE', 'Snowfall Rate (water equivalent)', 'SRATE'),
    rate('MO_CRAINRATE', 'Convective Rain Rate', 'CRRATE'),
    rate('MO_CSNOWRATE', 'Convective Snowfall Rate (water equivalent)', 'CSRATE'),
    rate('MO_CRAIN_MAX', 'Convective Rain Rate, Max (previous step)', 'CRRATEMAX', 'extreme'),
    rate('MO_CSNOW_MAX', 'Convective Snowfall Rate, Max (previous step)', 'CSRATEMAX', 'extreme'),
    rate('MO_CSNOW_MEAN', 'Convective Snowfall Rate, Mean (previous step)', 'CSRATEMEAN', 'extreme'),
];

/** The panes of the levels the pressure fields are offered on, and the palette of each level's temperatures. */
const LEVELS = [925, 850, 700, 500, 250] as const;
const TEMPERATURE_PALETTE = {
    925: 'RAP_Temperature_LL',
    850: 'RAP_Temperature_LL',
    700: 'RAP_Temperature_LL',
    500: 'RAP_Temperature_HL',
    250: 'RAP_Temperature',
} as const;
/** Half range of the vertical velocity colormap, cm/s. */
const OMEGA_RANGE = 15;

/** Wet-bulb potential temperature and vertical velocity on the five pressure levels. */
export const MO_PRESSURE_FIELDS: readonly ModelFieldConfig[] = LEVELS.flatMap((mb) => {
    const pane = String(mb) as ModelPaneId;
    return [
        defineField({
            id: `MO_THETAW_${mb}MB`,
            label: `${mb} mb Wet-Bulb Potential Temperature`,
            pane,
            kind: 'scalar',
            units: '°C',
            quantity: 'temperature',
            inputs: [prs('THETAW', `${mb} mb`, { transform: K_TO_C })],
            colormap: { name: TEMPERATURE_PALETTE[mb], toStored: K_TO_C },
        }),
        defineField({
            id: `MO_W_${mb}MB`,
            label: `${mb} mb Vertical Velocity`,
            pane,
            kind: 'scalar',
            units: 'cm/s',
            inputs: [prs('W', `${mb} mb`, { transform: { scale: 100 } })],
            colormap: { name: 'Model_Advection', range: [-OMEGA_RANGE, OMEGA_RANGE] },
        }),
    ];
});

/**
 * 500 mb absolute vorticity, which the Met Office does not publish: the relative vorticity of its 500 mb wind plus the
 * Coriolis parameter, derived here at full resolution (the same centred difference as the other diagnostics).
 */
export const MO_ABSV_500MB = defineField({
    id: 'MO_ABSV_500MB',
    label: '500 mb Absolute Vorticity',
    pane: '500',
    kind: 'scalar',
    units: '10⁻⁵ s⁻¹',
    recipe: 'absolute-vorticity',
    contourField: PRESSURE_LEVEL_FIELDS[500].hgt.id,
    inputs: [prs('WIND', '500 mb'), prs('WDIR', '500 mb')],
    colormap: { name: 'RAP_AbsoluteVorticity_500mb', toStored: { scale: 1e5 } },
    note: "Derived here from the model's 500 mb wind speed and direction by a centred difference over about 12 km; the model does not output it.",
});

/** Cloud volume fraction on the model's height levels (metres above the ground), at the heights the picker offers. */
const CLOUD_HEIGHTS = [500, 1000, 2000, 3000, 5000] as const;
export const MO_CLOUD_HEIGHT_FIELDS: readonly ModelFieldConfig[] = CLOUD_HEIGHTS.map((m) =>
    scalar(
        `MO_CLOUD_${m}M`,
        `${m} m AGL Cloud Fraction`,
        'levels',
        '%',
        sfc('CLDVOL', `${m} m above ground`),
        { name: 'HRRR_CloudCover' },
    ),
);
