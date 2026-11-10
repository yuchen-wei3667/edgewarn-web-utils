import { defineDataset, defineField, pad } from './types.ts';
import type { DeclaredGrid, ModelFieldConfig, ModelSurface, StepRange } from './types.ts';
import { NBM_BUCKET } from './shared.ts';
import { K_TO_C, sfc } from './fields/selectors.ts';
import { HRRR_TMP_2M } from './fields/surface.ts';

/**
 * The NBM regions: NOAA's `noaa-nbm-grib2-pds` holds one `core` object per step and region, named by the region's
 * suffix (`blend.t12z.core.f012.ak.grib2`). `co` is CONUS; the others are Alaska, Hawaii, Puerto Rico and Guam.
 * Every region runs the same cycles and steps as CONUS, and each carries the subset of CONUS fields listed in its
 * own dataset file (`datasets/nbm.ts`, `nbm-ak.ts`, ...), with its own grid and thinning.
 */
type NbmRegion = 'co' | 'ak' | 'hi' | 'pr' | 'gu';

const SINGLE_LAYER = 'entire atmosphere (considered as a single layer)';
/** NBM files carry heights in metres; kilometres keep the "none" code (88 875 m) and the values inside float16 and the colormap. */
const TO_KM = { scale: 0.001 };
/** Anything above this many km is the "none" code, not a ceiling or an echo top. */
const NONE_ABOVE_KM = 30;

/** Wind from a speed and a direction (NBM publishes no u/v), the direction measured from north on the earth. */
const wind = (id: string, label: string, speed: string, direction: string, level: string) =>
    defineField({
        id,
        label,
        pane: 'surface',
        kind: 'vector',
        recipe: 'speed-direction',
        recipeParams: { frame: 'earth' },
        units: 'm/s',
        quantity: 'speed',
        inputs: [sfc(speed, level), sfc(direction, level)],
        colormap: { name: 'RAP_Wind_LL' },
    });

export const NBM_WIND_10M = wind('NBM_WIND_10M', '10 m Wind', 'WIND', 'WDIR', '10 m above ground');
export const NBM_WIND_30M = wind('NBM_WIND_30M', '30 m Wind', 'WIND', 'WDIR', '30 m above ground');
export const NBM_WIND_80M = wind('NBM_WIND_80M', '80 m Wind', 'WIND', 'WDIR', '80 m above ground');
export const NBM_TRANSPORT_WIND = wind(
    'NBM_TRANSPORT_WIND',
    'Transport Wind',
    'TRWSPD',
    'TRWDIR',
    SINGLE_LAYER,
);

export const NBM_GUST_10M = defineField({
    id: 'NBM_GUST_10M',
    label: '10 m Wind Gust',
    pane: 'surface',
    kind: 'extreme',
    units: 'm/s',
    quantity: 'speed',
    inputs: [sfc('GUST', '10 m above ground')],
    colormap: { name: 'RAP_Wind_LL' },
});

export const NBM_APTMP_2M = defineField({
    id: 'NBM_APTMP_2M',
    label: '2 m Apparent Temperature',
    pane: 'surface',
    kind: 'scalar',
    units: '°C',
    quantity: 'temperature',
    inputs: [sfc('APTMP', '2 m above ground', { transform: K_TO_C })],
    colormap: { name: 'RAP_Temperature_LL', toStored: K_TO_C },
});

export const NBM_TCDC = defineField({
    id: 'NBM_TCDC',
    label: 'Cloud Cover',
    pane: 'surface',
    kind: 'scalar',
    units: '%',
    inputs: [sfc('TCDC', 'surface')],
    colormap: { name: 'HRRR_CloudCover' },
});

export const NBM_CEIL = defineField({
    id: 'NBM_CEIL',
    label: 'Cloud Ceiling',
    pane: 'surface',
    kind: 'scalar',
    units: 'km',
    inputs: [sfc('CEIL', 'cloud ceiling', { transform: TO_KM, validMax: NONE_ABOVE_KM })],
    colormap: { name: 'NBM_Ceiling' },
});

export const NBM_DSWRF = defineField({
    id: 'NBM_DSWRF',
    label: 'Downward Shortwave Radiation',
    pane: 'surface',
    kind: 'scalar',
    units: 'W/m²',
    inputs: [sfc('DSWRF', 'surface')],
    colormap: { name: 'NBM_SolarRadiation' },
});

export const NBM_MIXHT = defineField({
    id: 'NBM_MIXHT',
    label: 'Mixing Height',
    pane: 'surface',
    kind: 'scalar',
    units: 'm',
    inputs: [sfc('MIXHT', SINGLE_LAYER)],
    colormap: { name: 'NBM_MixingHeight' },
});

export const NBM_VRATE = defineField({
    id: 'NBM_VRATE',
    label: 'Ventilation Rate',
    pane: 'surface',
    kind: 'scalar',
    units: 'm²/s',
    inputs: [sfc('VRATE', SINGLE_LAYER)],
    colormap: { name: 'NBM_VentilationRate' },
});

export const NBM_MAXREF_1KM = defineField({
    id: 'NBM_MAXREF_1KM',
    label: 'Max Reflectivity (1 km)',
    pane: 'severe',
    kind: 'extreme',
    units: 'dBZ',
    inputs: [sfc('MAXREF', '1000 m above ground', { timing: 'window' })],
    colormap: { name: 'NWS_Reflectivity', transparentBelow: 5 },
});

export const NBM_VIL = defineField({
    id: 'NBM_VIL',
    label: 'Vertically Integrated Liquid',
    pane: 'severe',
    kind: 'extreme',
    units: 'kg/m²',
    inputs: [sfc('VIL', 'entire atmosphere')],
    colormap: { name: 'NBM_VIL' },
});

export const NBM_RETOP = defineField({
    id: 'NBM_RETOP',
    label: 'Echo Tops',
    pane: 'severe',
    kind: 'extreme',
    units: 'km',
    inputs: [sfc('RETOP', 'cloud top', { transform: TO_KM, validMax: NONE_ABOVE_KM })],
    colormap: { name: 'NBM_EchoTops' },
});

export const NBM_CWASP = defineField({
    id: 'NBM_CWASP',
    label: 'Severe Potential',
    pane: 'severe',
    kind: 'scalar',
    units: 'index',
    // The blended value is the only CWASP component with no percentile or threshold; its descriptor is this.
    inputs: [sfc('CWASP', 'surface', { extra: 'unknown derived fcst' })],
    colormap: { name: 'NBM_SeverePotential' },
});

export const NBM_ASNOW_1H = defineField({
    id: 'NBM_ASNOW_1H',
    label: '1-h Snowfall',
    pane: 'winter',
    kind: 'accum',
    units: 'cm',
    inputs: [sfc('ASNOW', 'surface', { timing: 'window', transform: { scale: 100 } })],
    colormap: { name: 'HRRR_Snowfall' },
});

export const NBM_SNOWLVL = defineField({
    id: 'NBM_SNOWLVL',
    label: 'Snow Level',
    pane: 'winter',
    kind: 'scalar',
    units: 'm',
    inputs: [sfc('SNOWLVL', '0 m above mean sea level')],
    colormap: { name: 'RAP_FreezingLevelHeight' },
});

export const NBM_SNOWLR = defineField({
    id: 'NBM_SNOWLR',
    label: 'Snow-to-Liquid Ratio',
    pane: 'winter',
    kind: 'scalar',
    units: ':1',
    inputs: [sfc('SNOWLR', 'surface')],
    colormap: { name: 'NBM_SnowLiquidRatio' },
});

export const NBM_FICEAC = defineField({
    id: 'NBM_FICEAC',
    label: '1-h Ice Accretion',
    pane: 'winter',
    kind: 'accum',
    units: 'mm',
    inputs: [sfc('FICEAC', 'surface', { timing: 'window' })],
    colormap: { name: 'NBM_IceAccretion' },
});

/**
 * Not every field has every step of the run: the files thin out by field (a 6-hourly tail holds a third of
 * the messages of f012). These are measured, one entry per field that is short of the run's steps, from
 * the `.idx` of every step of one run (tests/fixtures/models/nbm/step-availability.json), and
 * tests/models/models-nbm.test.mjs holds them to it. A field with no entry has every step.
 * The regional files thin out the same way with their own cuts, measured from each region's `.idx` of every step
 * (see the entries of `datasets/nbm-ak.ts` and the others).
 */
/** Radar-derived and snow fields stop at 48 hours. */
export const HOURLY_TO_48H = [{ from: 60, to: 48 * 60, every: 60 }];
/** Hourly to 36 h, then every 3 h to 192 h (the hourly steps between are not published), every 6 h after. */
export const THIN_AFTER_36H = [
    { from: 60, to: 36 * 60, every: 60 },
    { from: 39 * 60, to: 192 * 60, every: 180 },
    { from: 198 * 60, to: 264 * 60, every: 360 },
];
/** The run's own cadence to f234, then only f246 and f258 (mixing height, transport wind). */
export const RUN_TO_234H = [
    { from: 60, to: 48 * 60, every: 60 },
    { from: 51 * 60, to: 192 * 60, every: 180 },
    { from: 198 * 60, to: 234 * 60, every: 360 },
    { from: 246 * 60, to: 258 * 60, every: 720 },
];
/** Thin after 36 h like THIN_AFTER_36H, and only f246 and f258 after f234 (ventilation rate). */
export const THIN_AFTER_36H_TO_234H = [
    { from: 60, to: 36 * 60, every: 60 },
    { from: 39 * 60, to: 192 * 60, every: 180 },
    { from: 198 * 60, to: 234 * 60, every: 360 },
    { from: 246 * 60, to: 258 * 60, every: 720 },
];
/** Visibility ends at f078 and the ceiling at f084. */
export const VISIBILITY = [
    { from: 60, to: 36 * 60, every: 60 },
    { from: 39 * 60, to: 78 * 60, every: 180 },
];
export const CEILING = [
    { from: 60, to: 36 * 60, every: 60 },
    { from: 39 * 60, to: 84 * 60, every: 180 },
];
/** Hourly to 36 h, then every 3 h, the ceiling ends at f072 (Hawaii and Puerto Rico). */
export const CEILING_TO_72H = [
    { from: 60, to: 36 * 60, every: 60 },
    { from: 39 * 60, to: 72 * 60, every: 180 },
];
/** Hourly to 36 h, then every 3 h, the ceiling ends at f048 (Guam). */
export const CEILING_TO_48H = [
    { from: 60, to: 36 * 60, every: 60 },
    { from: 39 * 60, to: 48 * 60, every: 180 },
];

/** What a region's dataset file sets; everything else is the same in every NBM region. */
interface NbmOptions<Id extends string> {
    id: Id;
    label: string;
    shortLabel: string;
    /** The object suffix: `co`, `ak`, `hi`, `pr` or `gu`. */
    region: NbmRegion;
    /** The region's grid, as the first message declares it. */
    grid: DeclaredGrid;
    /** Target texel size of the three levels of detail, km. */
    levelTargetsKm: readonly [number, number, number];
    surfaces: readonly ModelSurface[];
    /** `YYYY-MM-DD` the data host last passed the CORS check for this region's objects. */
    corsVerifiedOn: string;
    /** The fields the region offers, in picker order: every one of them has all its inputs in the region's f012 inventory. */
    fields: readonly ModelFieldConfig[];
    /** Per-field cadence inside a run, where it is thinner than the run: measured for this region. */
    fieldSteps: Readonly<Partial<Record<string, readonly StepRange[]>>>;
    /** Ids of the fields the p10, p50 and p90 products carry: the ones the region's inventory lists with a percentile. */
    percentileFields: readonly string[];
}

/**
 * One NBM region as a dataset. The run shape, objects, idx rules and percentile products are the same in every
 * region (measured: each region has 00, 06, 12 and 18 UTC to hour 264 with the CONUS steps); only the grid, the
 * fields and their cadence differ, and those are the options.
 */
export function defineNbm<const Id extends string>(o: NbmOptions<Id>) {
    return defineDataset({
        id: o.id,
        label: o.label,
        shortLabel: o.shortLabel,
        docs: {
            runs: '00, 06, 12 and 18 UTC',
            length: '264 hours: hourly to 48, then every 3 hours, then every 6',
        },
        about: { provider: 'NOAA', category: 'regional' },
        access: { corsVerifiedOn: o.corsVerifiedOn },
        surfaces: o.surfaces,
        bucket: NBM_BUCKET,
        // One object per step holds everything; there is no separate pressure-level file.
        objects: {
            core: {
                serves: ['sfc', 'prs'],
                url: ({ date, cycle, step }) =>
                    `blend.${date}/${pad(cycle, 2)}/core/blend.t${pad(cycle, 2)}z.core.f${pad(step, 3)}.${o.region}.grib2`,
            },
        },
        gate: ['core'],
        products: [
            { id: 'mean', label: 'Blend' },
            ...(['p10', 'p50', 'p90'] as const).map((id) => ({
                id,
                label: `${id.slice(1)}th percentile`,
                object: 'core',
                extra: `${id.slice(1)}% level`,
                // Verified in the core inventories; temperature percentiles are not in this object.
                fields: o.percentileFields,
            })),
        ],
        // NBM runs every hour, but only these cycles carry the long-range steps and a full set of fields.
        cycles: [0, 6, 12, 18],
        // There is no analysis (the first file is f001).
        time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 1, fileIndex: { kind: 'forecast-hour' } },
        runs: [
            {
                steps: [
                    { from: 60, to: 48 * 60, every: 60 },
                    { from: 51 * 60, to: 192 * 60, every: 180 },
                    { from: 198 * 60, to: 264 * 60, every: 360 },
                ],
            },
        ],
        grid: o.grid,
        levelTargetsKm: o.levelTargetsKm,
        // The file carries `ens std dev`, `10% level`, `prob >x` twins of the plain components.
        idx: { defaultExtra: 'none' },
        defaultField: HRRR_TMP_2M,
        isobars: null,
        fields: o.fields,
        fieldSteps: o.fieldSteps,
    });
}
