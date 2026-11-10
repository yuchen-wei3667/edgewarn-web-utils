import type { IdxEntry } from '@edgewarn/web-utils/grib2';
import { MODEL_CONFIGS } from './configs/index.ts';
import { MODEL_PANES } from './configs/panes.ts';
import type {
    ComponentAlias,
    ModelColormapRef,
    ModelFieldKind,
    ModelPaneId,
    ModelQuantity,
    ModelRecipe,
    ModelRecipeParams,
    ModelSelector,
    ModelTiming,
    LevelReducer,
    ValueTransform,
} from './configs/types.ts';
import {
    getDataset,
    type EnsembleProduct,
    type ModelDataset,
    type ModelFile,
    type ModelId,
} from './datasets.ts';
import { compileFields } from './registry/compile.ts';
import { isComputedProduct } from './ensemble.ts';
import { derivedField, type DerivedFieldInfo } from './compare/derived.ts';

export type { EnsembleProduct, ModelFile };
export { MODEL_PANES };
export type {
    ModelColormapRef,
    ModelFieldKind,
    ModelPaneId,
    ModelQuantity,
    ModelRecipe,
    ModelRecipeParams,
    ModelSelector,
};

/**
 * Fields the map offers, per model. Each field names the GRIB components it needs (matched against
 * the `.idx` inventory), how they are stored as float16, how they merge when downsampled, and which
 * bundled colormap draws them. The field definitions live in `src/configs/` (shared ones under
 * `fields/`, a model's own in its file under `datasets/`); a field is offered by the datasets that
 * list it. The datasets that spell a level or variable differently rewrite it through their `idx`
 * config, and the ones that genuinely need different components list them under `overrides`. Old RAP
 * layer IDs resolve through `legacyIds`.
 *
 * Only component ranges are fetched — see `datasets.ts`.
 */

export interface ModelPane {
    id: ModelPaneId;
    label: string;
    level: boolean;
}

export interface ModelFieldDef {
    id: string;
    /** Models that offer this field: the datasets whose config lists it, in registry order. */
    models: readonly ModelId[];
    /**
     * Set when the field only exists inside one ensemble product (REFS's `prob`). The dataset maps a
     * selector's file onto whichever product is chosen, so without this a probability field would be
     * offered while the `mean` product is selected and then fail to resolve.
     */
    product?: EnsembleProduct;
    /** Full name, e.g. "500 mb Temperature". */
    label: string;
    /** Name inside its pane, e.g. "Temperature" in the 500 mb pane. */
    shortLabel: string;
    pane: ModelPaneId;
    kind: ModelFieldKind;
    recipe: ModelRecipe;
    recipeParams?: ModelRecipeParams;
    inputs: readonly ModelSelector[];
    /** Components to use instead of `inputs` for a particular model. */
    overrides?: Readonly<
        Partial<
            Record<ModelId, { inputs: readonly ModelSelector[]; recipe?: ModelRecipe; kind?: ModelFieldKind }>
        >
    >;
    /** Units of the stored values (after `display`). Temperatures are °C, speeds m/s. */
    units: string;
    quantity: ModelQuantity;
    ratioScale?: boolean;
    /** Stored -> display units, when storage is offset to fit float16 (MSLP is stored as hPa - 1000). */
    display?: ValueTransform;
    /** Automatic labeled contours, spaced in display units. */
    contourInterval?: number;
    /** Matching height field drawn as automatic contours over this field. */
    contourField?: string;
    colormap: ModelColormapRef;
    legacyIds: readonly string[];
    /** Never drawn as a field of its own: another layer reads it (MSLP feeds the isobars). Not offered in the picker. */
    overlay?: boolean;
    /** A caveat for the legend (see `ModelFieldConfig.note`). */
    note?: string;
    searchTerms: readonly string[];
    /** Set only on a comparison field registered at runtime (`compare/fieldMeta.ts`). */
    derived?: DerivedFieldInfo;
}

/** Precip-type codes produced by the 'ptype' recipe. 0 means no precipitation (drawn transparent). */
export const PTYPE_CODES = { none: 0, rain: 1, snow: 2, sleet: 3, freezingRain: 4 } as const;

export const MODEL_FIELDS: readonly ModelFieldDef[] = compileFields(MODEL_CONFIGS);

const BY_ID = new Map(MODEL_FIELDS.map((f) => [f.id, f]));

/** Old RAP IDs with no HRRR equivalent: they resolve to null and are dropped. */
const DROPPED_LEGACY_IDS: ReadonlySet<string> = new Set(['Wetbulbzeroheight']);

const normalize = (id: string) =>
    id
        .trim()
        .toLowerCase()
        .replace(/[_\s-]+/g, ' ');
const LEGACY = new Map<string, string | null>();
for (const f of MODEL_FIELDS) for (const legacy of f.legacyIds) LEGACY.set(normalize(legacy), f.id);
for (const legacy of DROPPED_LEGACY_IDS) LEGACY.set(normalize(legacy), null);

export function getModelField(id: string | null | undefined): ModelFieldDef | null {
    return id ? (BY_ID.get(id) ?? derivedField(id)) : null;
}

/** True when `id` is a field id or an old RAP name (even one dropped with no equivalent), whether or not the model in view offers it. */
export function knowsModelField(id: string): boolean {
    return BY_ID.has(id) || LEGACY.has(normalize(id));
}

/** Every field a model offers in the given ensemble product, in catalogue order. */
export function fieldsForModel(model: ModelId, product: EnsembleProduct = 'mean'): readonly ModelFieldDef[] {
    return MODEL_FIELDS.filter((f) => !f.overlay && modelHasField(f.id, model, product));
}

/** Whether the isobar overlay can be drawn for a model (HRRR 15-minute borrows the hourly HRRR). */
export const modelHasIsobars = (model: ModelId): boolean => getDataset(model).isobars !== null;

/** Panes a model can actually fill, in display order. */
export function panesForModel(model: ModelId, product: EnsembleProduct = 'mean'): readonly ModelPane[] {
    const offered = new Set(fieldsForModel(model, product).map((f) => f.pane));
    return MODEL_PANES.filter((p) => offered.has(p.id));
}

/** The selectors a model reads for a field, honouring any per-model override. */
export function inputsFor(def: ModelFieldDef, model: ModelId): readonly ModelSelector[] {
    return def.overrides?.[model]?.inputs ?? def.inputs;
}

/** The recipe a model uses for a field, honouring any per-model override. */
export function recipeFor(def: ModelFieldDef, model: ModelId): ModelRecipe {
    return def.overrides?.[model]?.recipe ?? def.recipe;
}

/** True when the model offers the field, in the given ensemble product. */
export function modelHasField(
    id: string | null | undefined,
    model: ModelId,
    product: EnsembleProduct = 'mean',
): boolean {
    const def = getModelField(id);
    const dataset = getDataset(model);
    const fields = dataset.products.find((p) => p.id === product)?.fields;
    return (
        def !== null &&
        def.models.includes(model) &&
        (def.product === undefined || def.product === product) &&
        (!fields || fields.includes(def.id)) &&
        (!isComputedProduct(dataset, product) ||
            (def.kind !== 'categorical' &&
                def.kind !== 'vector' &&
                def.overrides?.[model]?.kind !== 'categorical' &&
                def.overrides?.[model]?.kind !== 'vector' &&
                !isVectorField(def, model)))
    );
}

/** Automatic height contours use the selected model/product and the field's matching pressure level. */
export function heightContourFieldForModel(
    fieldId: string | null | undefined,
    model: ModelId,
    product: EnsembleProduct = 'mean',
): ModelFieldDef | null {
    const field = getModelField(fieldId);
    // Comparison fields and probability products do not represent absolute heights.
    if (!field || field.derived || ['prob', 'exceed', 'nsprd'].includes(product)) return null;
    const height = field.contourField ? getModelField(field.contourField) : field;
    return height?.contourInterval && modelHasField(height.id, model, product) ? height : null;
}

/**
 * Resolve a stored layer ID (a current field ID or an old RAP ID) to a field ID that `model` offers.
 * Returns null for unknown IDs, for RAP fields no model has, and for fields the model lacks.
 */
export function resolveModelFieldId(
    id: string | null | undefined,
    model: ModelId,
    product: EnsembleProduct = 'mean',
): string | null {
    if (!id) return null;
    const exact = BY_ID.get(id);
    if (exact) return !exact.overlay && modelHasField(id, model, product) ? id : null;
    const legacyId = LEGACY.get(normalize(id));
    if (legacyId === undefined || legacyId === null) {
        if (typeof console !== 'undefined') console.warn(`Model: "${id}" has no equivalent and was dropped`);
        return null;
    }
    if (BY_ID.get(legacyId)?.overlay) return null;
    if (!modelHasField(legacyId, model, product)) {
        if (typeof console !== 'undefined') console.warn(`Model: "${id}" is not offered by ${model}`);
        return null;
    }
    return legacyId;
}

/** True when a model draws the field as a wind: two components, shown as speed and direction (and as barbs). */
export function isVectorField(def: ModelFieldDef, model: ModelId): boolean {
    const recipe = recipeFor(def, model);
    return recipe === 'vector' || recipe === 'speed-direction';
}

/** Just above zero, in stored units: what "masks 0" means to a floor, which hides what is below it. */
const ABOVE_ZERO = 1e-6;

/**
 * The value under which a field has nothing to show: neither drawn nor read out by the hover tooltip.
 * A field's own no-data cut (negative dBZ), or zero for anything drawn with a precipitation colormap (rates, accumulations,
 * snowfall), where dry ground is not a value. (Precipitable water is moisture, so zero there is data.)
 */
export function fieldFloor(def: ModelFieldDef): number {
    if (def.colormap.transparentBelow !== undefined) return def.colormap.transparentBelow;
    return PRECIPITATION_COLORMAPS.has(def.colormap.name) ? ABOVE_ZERO : -Infinity;
}

const PRECIPITATION_COLORMAPS: ReadonlySet<string> = new Set([
    'PrecipRate',
    'QPE_01H',
    'MRMS_QPE_Long',
    'HRRR_Snowfall',
]);

/** True when any input needs a forecast window, so the field never comes from an analysis step. */
export function needsForecastStep(def: ModelFieldDef, model: ModelId): boolean {
    return inputsFor(def, model).some((s) => s.timing !== 'instant');
}

export function fieldReducer(def: ModelFieldDef, model: ModelId): LevelReducer {
    const kind = def.overrides?.[model]?.kind ?? def.kind;
    if (kind === 'extreme') return 'max';
    if (kind === 'categorical') return 'mode';
    return 'mean';
}

/**
 * Every forecast-column spelling a selector's component may carry, most specific first.
 *
 * Hourly objects label in hours. The 15-minute objects label in minutes, but also carry a set of
 * hour-labelled components (39 of the 156 in an RRFS `subh` file, including a `6 hour fcst` 2-m
 * temperature alongside its four quarter-hour ones), so the minute form is tried first and the hour
 * form only second — otherwise a 15-minute model silently serves hourly data.
 *
 * `minutes` is always the offset from the cycle; each unit converts it to what that unit writes.
 */
function forecastPatterns(
    timing: ModelTiming,
    minutes: number,
    dataset: ModelDataset,
    windowMinutes?: number,
): RegExp[] {
    const out: RegExp[] = [];
    const push = (re: RegExp | null) => {
        if (re && !out.some((r) => r.source === re.source)) out.push(re);
    };
    const hours = (n: number) => (n % 60 === 0 ? n / 60 : null);
    const instant = (n: number, unit: 'hour' | 'minute') => {
        if (n === 0) return /^anl$/;
        if (unit === 'minute') return new RegExp(`^${n} min fcst$`);
        const h = hours(n);
        return h === null ? null : new RegExp(`^${h} hour fcst$`);
    };
    // A window ends at the step and starts `windowMinutes` earlier: an hour in the hour-labelled files, a quarter hour in the minute-labelled ones.
    const windowed = (n: number, unit: 'hour' | 'minute') => {
        if (n <= 0) return null;
        const span = windowMinutes ?? (unit === 'minute' ? 15 : 60);
        if (n - span < 0) return null;
        if (unit === 'minute') return new RegExp(`^${n - span}-${n} min (acc|max|min|ave) fcst$`);
        const h = hours(n);
        const w = hours(span);
        return h === null || w === null || w < 1
            ? null
            : new RegExp(`^${h - w}-${h} hour (acc|max|min|ave) fcst$`);
    };
    const total = (n: number, unit: 'hour' | 'minute') => {
        if (n <= 0) return null;
        if (unit === 'minute') return new RegExp(`^0-${n} min acc fcst$`);
        const h = hours(n);
        if (h === null) return null;
        const days = h % 24 === 0 ? `|0-${h / 24} day` : '';
        return new RegExp(`^(0-${h} hour${days}) acc fcst$`);
    };
    const order: Array<'minute' | 'hour'> = dataset.forecastUnit === 'minute' ? ['minute', 'hour'] : ['hour'];
    if (timing === 'sum-window') return []; // the caller sums the located components instead
    if (timing === 'instant') for (const unit of order) push(instant(minutes, unit));
    else if (timing === 'window') for (const unit of order) push(windowed(minutes, unit));
    else for (const unit of order) push(total(minutes, unit));
    return out;
}

/** Raw local-table parameters as the .idx prints them: `var discipline=0 center=7 local_table=1 parmcat=16 parm=201`. */
const RAW_PARAM = /^var discipline=(\d+) .*parmcat=(\d+) parm=(\d+)$/;

function variableMatches(entry: string, wanted: string): boolean {
    if (entry === wanted) return true;
    const a = RAW_PARAM.exec(entry);
    const b = RAW_PARAM.exec(wanted);
    return Boolean(a && b && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);
}

/** The dataset's own spelling of a canonical `VARIABLE|level` component, or undefined when it has none. */
export function componentAlias(
    dataset: ModelDataset,
    sel: Pick<ModelSelector, 'variable' | 'level' | 'exact'>,
): ComponentAlias | undefined {
    return sel.exact ? undefined : dataset.components?.[`${sel.variable}|${sel.level}`];
}

/**
 * Apply a dataset's variable spelling: its component alias first, else its rename, else the selector's own.
 * `exact` selectors are matched as written.
 */
export function resolveVariable(
    dataset: ModelDataset,
    variable: string,
    exact?: boolean,
    level?: string,
): string {
    if (exact) return variable;
    const alias = level === undefined ? undefined : dataset.components?.[`${variable}|${level}`];
    return alias?.variable ?? dataset.variables?.[variable] ?? variable;
}

/** Apply a dataset's level spelling: its component alias first, else its exact-string rewrites. */
export function resolveLevel(
    dataset: ModelDataset,
    level: string,
    exact?: boolean,
    variable?: string,
): string {
    if (exact) return level;
    const alias = variable === undefined ? undefined : dataset.components?.[`${variable}|${level}`];
    if (alias) return alias.level;
    for (const [from, to] of dataset.levels ?? []) if (from === level) return to;
    return level;
}

/**
 * Compose two affine transforms into one: apply `inner` first, then `outer`. A component alias's transform
 * (the source's unit to the canonical one) is the inner one; the selector's own is the outer.
 */
export function composeTransforms(
    inner: ValueTransform | undefined,
    outer: ValueTransform | undefined,
): ValueTransform | undefined {
    if (!inner) return outer;
    if (!outer) return inner;
    const scale = (inner.scale ?? 1) * (outer.scale ?? 1);
    const offset = (inner.offset ?? 0) * (outer.scale ?? 1) + (outer.offset ?? 0);
    return { scale, offset };
}

/**
 * Whether a component's descriptor columns (7 onwards) are the ones wanted. The rule is the selector's
 * `extra`, else the product's (REFS `wt ens mean`), else the dataset's default: `any` looks at nothing,
 * `none` takes only a component with no descriptor (the plain forecast, not its `ens std dev` or
 * `10% level` twin), anything else must be among the columns.
 */
function extraMatches(
    entry: IdxEntry,
    sel: ModelSelector,
    dataset: ModelDataset,
    product: EnsembleProduct,
): boolean {
    // A percentile replaces even a field's deterministic descriptor (NBM CWASP, for example).
    const rule =
        product === 'p10' || product === 'p50' || product === 'p90'
            ? (dataset.qualifiers[product] ?? sel.extra ?? dataset.defaultExtra)
            : (sel.extra ?? dataset.qualifiers[product] ?? dataset.defaultExtra);
    if (rule === 'any') return true;
    if (rule === 'none') return entry.extra.length === 0;
    return entry.extra.includes(rule);
}

/** Find one component in an inventory, or null when it is not there. */
export function findIdxEntry(
    entries: readonly IdxEntry[],
    sel: ModelSelector,
    minutes: number,
    dataset: ModelDataset,
    product: EnsembleProduct = 'mean',
    member?: number,
): IdxEntry | null {
    const patterns = forecastPatterns(sel.timing, minutes, dataset, sel.windowMinutes);
    if (!patterns.length) return null;
    const variable = resolveVariable(dataset, sel.variable, sel.exact, sel.level);
    const level = resolveLevel(dataset, sel.level, sel.exact, sel.variable);
    // One object holding every member (ECMWF) is told apart by the inventory's member number.
    const byMember = member !== undefined && dataset.ensemble?.addressing === 'index';
    return (
        entries.find(
            (e) =>
                (!byMember || e.member === member) &&
                variableMatches(e.variable, variable) &&
                e.level === level &&
                patterns.some((p) => p.test(e.forecast)) &&
                extraMatches(e, sel, dataset, product) &&
                (sel.threshold === undefined || e.extra.includes(sel.threshold)),
        ) ?? null
    );
}

/**
 * The `sum-window` components: `sumCount` consecutive windows ending at `minutes`, each a quarter of
 * `sumMinutes` long. HRRR's sub-hourly files publish them back to back, so all of them come down in
 * one range request.
 */
export function findIdxWindowEntries(
    entries: readonly IdxEntry[],
    sel: ModelSelector,
    minutes: number,
    dataset: ModelDataset,
    product: EnsembleProduct = 'mean',
    member?: number,
): IdxEntry[] {
    const count = sel.sumCount ?? 1;
    const width = sel.sumMinutes ?? 15;
    const out: IdxEntry[] = [];
    for (let k = count - 1; k >= 0; k--) {
        const end = minutes - k * width;
        if (end <= 0) return [];
        const entry = findIdxEntry(entries, { ...sel, timing: 'window' }, end, dataset, product, member);
        if (!entry) return [];
        out.push(entry);
    }
    return out;
}
