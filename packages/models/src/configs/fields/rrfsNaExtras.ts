import {
    defineField,
    type ModelFieldConfig,
    type ModelPaneId,
    type ModelSelector,
    type ValueTransform,
} from '../types.ts';
import { K_TO_C, sfc } from './selectors.ts';
import { heightLevelFields } from './levels.ts';
import { APCP_TOTAL } from './precip.ts';
import { CLOUD_HIGH, CLOUD_LOW, CLOUD_MID, DSWRF_SFC } from './extras.ts';

/**
 * Every further record of RRFS's North America `2dfld` file that has a display. Written against the RRFS `.idx` names; a
 * level that RRFS's level rewrites would change (`entire atmosphere`, `0-6000 m above ground`) says `exact`. RRFS CONUS carries
 * the same records, but its config does not list these fields, so it names them in `notOffered`.
 */
const SINGLE_LAYER = 'entire atmosphere (considered as a single layer)';
const KM: ValueTransform = { scale: 0.001 };
/** RRFS marks "no echo top" and "no ceiling" with a very large height; averaged into a coarse level it would invent one. */
const NONE_ABOVE_KM = 30;

export const scalar = (
    id: string,
    label: string,
    pane: ModelPaneId,
    units: string,
    input: ModelSelector,
    colormap: ModelFieldConfig['colormap'],
    extra: Partial<ModelFieldConfig> = {},
) => defineField({ id, label, pane, kind: 'scalar', units, inputs: [input], colormap, ...extra });
const extreme = (
    id: string,
    label: string,
    pane: ModelPaneId,
    units: string,
    input: ModelSelector,
    colormap: ModelFieldConfig['colormap'],
) => defineField({ id, label, pane, kind: 'extreme', units, inputs: [input], colormap });
export const temperature = (
    id: string,
    label: string,
    pane: ModelPaneId,
    input: ModelSelector,
    colormap = 'RAP_Temperature_LL',
) =>
    defineField({
        id,
        label,
        pane,
        kind: 'scalar',
        units: '°C',
        quantity: 'temperature',
        inputs: [{ ...input, transform: K_TO_C }],
        colormap: { name: colormap, toStored: K_TO_C },
    });
const vector = (
    id: string,
    label: string,
    pane: ModelPaneId,
    inputs: readonly [ModelSelector, ModelSelector],
    colormap: string,
) =>
    defineField({
        id,
        label,
        pane,
        kind: 'vector',
        recipe: 'vector',
        recipeParams: { frame: 'grid' },
        units: 'm/s',
        ratioScale: true,
        quantity: 'speed',
        inputs,
        colormap: { name: colormap },
    });

const SEVERE: ModelFieldConfig[] = [
    extreme('RRFS_VIL', 'Vertically Integrated Liquid', 'severe', 'kg/m²', sfc('VIL', SINGLE_LAYER), {
        name: 'NBM_VIL',
    }),
    extreme(
        'RRFS_RETOP',
        'Echo Tops',
        'severe',
        'km',
        sfc('RETOP', SINGLE_LAYER, { transform: KM, validMax: NONE_ABOVE_KM }),
        { name: 'NBM_EchoTops' },
    ),
    extreme(
        'RRFS_MAXREF_1KM',
        'Max Reflectivity (1 km)',
        'severe',
        'dBZ',
        sfc('MAXREF', '1000 m above ground', { timing: 'window' }),
        { name: 'NWS_Reflectivity', transparentBelow: 5 },
    ),
    extreme(
        'RRFS_MAXREF_263K',
        'Max Reflectivity (-10 C level)',
        'severe',
        'dBZ',
        sfc('MAXREF', '263 K level', { timing: 'window' }),
        { name: 'NWS_Reflectivity', transparentBelow: 5 },
    ),
    extreme('RRFS_REFD_1KM', 'Reflectivity (1 km)', 'severe', 'dBZ', sfc('REFD', '1000 m above ground'), {
        name: 'NWS_Reflectivity',
        transparentBelow: 0,
    }),
    extreme('RRFS_REFD_4KM', 'Reflectivity (4 km)', 'severe', 'dBZ', sfc('REFD', '4000 m above ground'), {
        name: 'NWS_Reflectivity',
        transparentBelow: 0,
    }),
    extreme('RRFS_REFD_263K', 'Reflectivity (-10 C level)', 'severe', 'dBZ', sfc('REFD', '263 K level'), {
        name: 'NWS_Reflectivity',
        transparentBelow: 0,
    }),
    extreme(
        'RRFS_UPHL_25KM',
        'Updraft Helicity (2-5 km, now)',
        'severe',
        'm²/s²',
        sfc('UPHL', '5000-2000 m above ground'),
        { name: 'HRRR_UpdraftHelicity' },
    ),
    extreme(
        'RRFS_MXUPHL_03KM',
        'Max Updraft Helicity (0-3 km)',
        'severe',
        'm²/s²',
        sfc('MXUPHL', '3000-0 m above ground', { timing: 'window' }),
        { name: 'HRRR_UpdraftHelicity' },
    ),
    extreme(
        'RRFS_RELV_02KM',
        'Max Relative Vorticity (0-2 km)',
        'severe',
        '10⁻⁵ s⁻¹',
        sfc('RELV', '2000-0 m above ground', { timing: 'window', transform: { scale: 1e5 } }),
        { name: 'RAP_AbsoluteVorticity_500mb', toStored: { scale: 1e5 } },
    ),
    extreme(
        'RRFS_RELV_01KM',
        'Max Relative Vorticity (0-1 km)',
        'severe',
        '10⁻⁵ s⁻¹',
        sfc('RELV', '1000-0 m above ground', { timing: 'window', transform: { scale: 1e5 } }),
        { name: 'RAP_AbsoluteVorticity_500mb', toStored: { scale: 1e5 } },
    ),
    extreme(
        'RRFS_HAIL',
        'Max Hail Size',
        'severe',
        'mm',
        sfc('HAIL', 'surface', { timing: 'window', transform: { scale: 1000 } }),
        { name: 'MESH' },
    ),
    extreme(
        'RRFS_LTNG',
        'Lightning',
        'severe',
        'flashes/km²/5 min',
        sfc('LTNG', 'entire atmosphere', { timing: 'window', exact: true }),
        { name: 'NLDN_LightningDensity' },
    ),
    extreme(
        'RRFS_MAXUVV',
        'Max Updraft Speed (100-1000 mb)',
        'severe',
        'm/s',
        sfc('MAXUVV', '100-1000 mb', { timing: 'window' }),
        { name: 'RAP_Wind_ML' },
    ),
    scalar(
        'RRFS_DCAPE',
        'DCAPE',
        'severe',
        'J/kg',
        sfc('DCAPE', '400-0 mb above ground'),
        { name: 'RAP_CAPE' },
        { ratioScale: true },
    ),
    scalar(
        'RRFS_LCL',
        'Lifted Condensation Level',
        'severe',
        'm',
        sfc('HGT', 'level of adiabatic condensation from sfc'),
        { name: 'MRMS_Height_m' },
    ),
    scalar('RRFS_EL', 'Equilibrium Level', 'severe', 'm', sfc('HGT', 'equilibrium level'), {
        name: 'MRMS_Height_m',
    }),
    scalar(
        'RRFS_HIGH_FRZLVL',
        'Highest Freezing Level',
        'severe',
        'm',
        sfc('HGT', 'highest tropospheric freezing level'),
        { name: 'RAP_FreezingLevelHeight' },
    ),
    scalar('RRFS_HGT_253K', '-20 C Level Height', 'severe', 'm', sfc('HGT', '253 K level'), {
        name: 'RAP_FreezingLevelHeight',
    }),
    scalar(
        'RRFS_WBZ',
        'Wet-Bulb Zero Height',
        'severe',
        'm',
        sfc('HGT', 'lowest level of the wet bulb zero'),
        { name: 'RAP_WetBulbZeroHeight' },
    ),
    vector(
        'RRFS_SHEAR_01KM',
        '0-1 km Shear',
        'severe',
        [sfc('VUCSH', '0-1000 m above ground'), sfc('VVCSH', '0-1000 m above ground')],
        'RAP_Wind_LL',
    ),
    vector(
        'RRFS_SHEAR_06KM',
        '0-6 km Shear',
        'severe',
        [
            sfc('VUCSH', '0-6000 m above ground', { exact: true }),
            sfc('VVCSH', '0-6000 m above ground', { exact: true }),
        ],
        'RAP_Wind_ML',
    ),
];

const SURFACE: ModelFieldConfig[] = [
    temperature(
        'RRFS_TMAX_2M',
        'Hourly Max 2 m Temperature',
        'surface',
        sfc('TMAX', '2 m above ground', { timing: 'window' }),
    ),
    temperature(
        'RRFS_TMIN_2M',
        'Hourly Min 2 m Temperature',
        'surface',
        sfc('TMIN', '2 m above ground', { timing: 'window' }),
    ),
    extreme(
        'RRFS_WIND_MAX_10M',
        'Hourly Max 10 m Wind',
        'surface',
        'm/s',
        sfc('WIND', '10 m above ground', { timing: 'window' }),
        { name: 'RAP_Wind_LL' },
    ),
    scalar('RRFS_HPBL', 'Boundary Layer Height', 'surface', 'm', sfc('HPBL', 'surface'), {
        name: 'NBM_MixingHeight',
    }),
    scalar('RRFS_PBL_VENT', 'Ventilation Rate', 'surface', 'm²/s', sfc('VRATE', 'planetary boundary layer'), {
        name: 'NBM_VentilationRate',
    }),
    vector(
        'RRFS_PBL_WIND',
        'Boundary Layer Wind',
        'surface',
        [sfc('UGRD', 'planetary boundary layer'), sfc('VGRD', 'planetary boundary layer')],
        'RAP_Wind_LL',
    ),
    CLOUD_LOW,
    CLOUD_MID,
    CLOUD_HIGH,
    scalar(
        'RRFS_CLOUD_BL',
        'Boundary Layer Cloud Cover',
        'surface',
        '%',
        sfc('TCDC', 'boundary layer cloud layer'),
        { name: 'HRRR_CloudCover' },
    ),
    scalar(
        'RRFS_CEIL',
        'Cloud Ceiling',
        'surface',
        'km',
        sfc('CEIL', 'cloud ceiling', { transform: KM, validMax: NONE_ABOVE_KM }),
        { name: 'NBM_Ceiling' },
    ),
    scalar('RRFS_CLOUD_BASE', 'Cloud Base Height', 'surface', 'm', sfc('HGT', 'cloud base'), {
        name: 'MRMS_Height_m',
    }),
    scalar('RRFS_CLOUD_TOP', 'Cloud Top Height', 'surface', 'm', sfc('HGT', 'cloud top'), {
        name: 'MRMS_Height_m',
    }),
    temperature(
        'RRFS_CLOUD_TOP_TMP',
        'Cloud Top Temperature',
        'surface',
        sfc('TMP', 'cloud top'),
        'RAP_Temperature',
    ),
    DSWRF_SFC,
    scalar(
        'RRFS_CSDSF',
        'Clear-Sky Downward Shortwave',
        'surface',
        'W/m²',
        sfc('CSDSF', 'surface'),
        { name: 'NBM_SolarRadiation' },
        { ratioScale: true },
    ),
    scalar(
        'RRFS_USWRF_SFC',
        'Upward Shortwave Radiation',
        'surface',
        'W/m²',
        sfc('USWRF', 'surface'),
        { name: 'NBM_SolarRadiation' },
        { ratioScale: true },
    ),
    scalar(
        'RRFS_DLWRF_SFC',
        'Downward Longwave Radiation',
        'surface',
        'W/m²',
        sfc('DLWRF', 'surface'),
        { name: 'NBM_SolarRadiation', range: [150, 450] },
        { ratioScale: true },
    ),
    scalar(
        'RRFS_ULWRF_SFC',
        'Upward Longwave Radiation',
        'surface',
        'W/m²',
        sfc('ULWRF', 'surface'),
        { name: 'NBM_SolarRadiation', range: [200, 550] },
        { ratioScale: true },
    ),
    scalar(
        'RRFS_ULWRF_TOA',
        'Outgoing Longwave Radiation',
        'surface',
        'W/m²',
        sfc('ULWRF', 'top of atmosphere'),
        { name: 'NBM_SolarRadiation', range: [100, 350] },
        { ratioScale: true },
    ),
    scalar(
        'RRFS_USWRF_TOA',
        'Reflected Shortwave Radiation (top of atmosphere)',
        'surface',
        'W/m²',
        sfc('USWRF', 'top of atmosphere', { timing: 'window' }),
        { name: 'NBM_SolarRadiation' },
        { ratioScale: true },
    ),
    scalar('RRFS_LHTFL', 'Latent Heat Flux', 'surface', 'W/m²', sfc('LHTFL', 'surface'), {
        name: 'Model_Difference',
        range: [-400, 400],
    }),
    scalar('RRFS_SHTFL', 'Sensible Heat Flux', 'surface', 'W/m²', sfc('SHTFL', 'surface'), {
        name: 'Model_Difference',
        range: [-300, 300],
    }),
    scalar('RRFS_GFLUX', 'Ground Heat Flux', 'surface', 'W/m²', sfc('GFLUX', 'surface'), {
        name: 'Model_Difference',
        range: [-200, 200],
    }),
    scalar(
        'RRFS_RHPW',
        'Column Relative Humidity',
        'surface',
        '%',
        sfc('RHPW', 'entire atmosphere', { exact: true }),
        { name: 'RAP_RelativeHumidity' },
    ),
    temperature('RRFS_WTMP', 'Water Surface Temperature', 'surface', sfc('WTMP', 'surface')),
    temperature(
        'RRFS_BRTEMP',
        'Brightness Temperature (top of atmosphere)',
        'satellite',
        sfc('BRTEMP', 'top of atmosphere'),
        'GOES_IR',
    ),
    scalar('RRFS_TROP_HGT', 'Tropopause Height', 'surface', 'm', sfc('HGT', 'tropopause'), {
        name: 'MRMS_Height_m',
    }),
    temperature(
        'RRFS_TROP_TMP',
        'Tropopause Temperature',
        'surface',
        sfc('TMP', 'tropopause'),
        'RAP_Temperature',
    ),
    vector(
        'RRFS_TROP_WIND',
        'Tropopause Wind',
        'surface',
        [sfc('UGRD', 'tropopause'), sfc('VGRD', 'tropopause')],
        'RAP_Wind_HL',
    ),
    vector(
        'RRFS_MAXWIND',
        'Maximum Wind',
        'surface',
        [sfc('UGRD', 'max wind'), sfc('VGRD', 'max wind')],
        'RAP_Wind_HL',
    ),
    scalar('RRFS_MAXWIND_HGT', 'Maximum Wind Height', 'surface', 'm', sfc('HGT', 'max wind'), {
        name: 'MRMS_Height_m',
    }),
];

const SOIL_DEPTHS = [
    '0-0',
    '0.01-0.01',
    '0.04-0.04',
    '0.1-0.1',
    '0.3-0.3',
    '0.6-0.6',
    '1-1',
    '1.6-1.6',
    '3-3',
] as const;
/** Soil temperature and moisture at the nine depths RRFS writes (the label of a depth is the layer's top and bottom, equal for each). */
const SOIL: ModelFieldConfig[] = SOIL_DEPTHS.flatMap((depth) => {
    const centimetres = Number(depth.split('-')[0]) * 100;
    const level = `${depth} m below ground`;
    const name = `${centimetres} cm`;
    return [
        temperature(
            `RRFS_TSOIL_${centimetres}CM`,
            `Soil Temperature (${name})`,
            'surface',
            sfc('TSOIL', level),
        ),
        scalar(
            `RRFS_SOILW_${centimetres}CM`,
            `Soil Moisture (${name})`,
            'surface',
            '%',
            sfc('SOILW', level, { transform: { scale: 100 } }),
            { name: 'MRMS_SoilSaturation' },
        ),
    ];
});

const PRECIP: ModelFieldConfig[] = [
    scalar(
        'RRFS_TSNOWP_TOTAL',
        'Total Snowfall (run total, water)',
        'winter',
        'mm',
        sfc('TSNOWP', 'surface', { timing: 'total' }),
        { name: 'MRMS_QPE_Long' },
        { kind: 'accum', ratioScale: true },
    ),
    scalar(
        'RRFS_SNOM',
        'Snow Melt (1-h)',
        'winter',
        'mm',
        sfc('SNOM', 'surface', { timing: 'window' }),
        { name: 'MRMS_QPE_Long' },
        { kind: 'accum', ratioScale: true },
    ),
    scalar(
        'RRFS_SSRUN',
        'Surface Runoff (1-h)',
        'precip',
        'mm',
        sfc('SSRUN', 'surface', { timing: 'window' }),
        { name: 'MRMS_QPE_Long' },
        { kind: 'accum', ratioScale: true },
    ),
    scalar('RRFS_CPOFP', 'Frozen Precipitation Fraction', 'precip', '%', sfc('CPOFP', 'surface'), {
        name: 'RAP_RelativeHumidity',
    }),
    scalar('RRFS_SNOWC', 'Snow Cover', 'winter', '%', sfc('SNOWC', 'surface'), {
        name: 'RAP_RelativeHumidity',
    }),
];

/** Heights above the ground and above mean sea level that RRFS writes temperature and wind on. */
const RRFS_AGL_HEIGHTS = [30, 50, 80, 100, 160, 320] as const;
const RRFS_AMSL_HEIGHTS = [305, 457, 610, 914, 1524, 1829, 2134, 2743, 3658, 4572] as const;

export const RRFS_NA_EXTRA_FIELDS: readonly ModelFieldConfig[] = [
    APCP_TOTAL,
    ...SEVERE,
    ...SURFACE,
    ...SOIL,
    ...PRECIP,
    ...heightLevelFields('AGL', RRFS_AGL_HEIGHTS, 'uv'),
    ...heightLevelFields('AMSL', RRFS_AMSL_HEIGHTS, 'uv'),
];
