/**
 * The model datasets the Models window can draw, compiled from the config files in
 * `src/configs/` (one per model, registered in `index.ts`). A dataset says where its bytes
 * live, which cycles run, how a step inside a run is labelled, what grid it is on and how a field
 * names its levels, so `listing.ts`, `catalog.ts` and `jobRunner.ts` never branch on a model name.
 *
 * Every dataset is fetched component-wise: the `.idx` inventory (5-34 KB) selects the byte range of
 * the one or two GRIB messages a field needs out of an object of 50-600 MB. Nothing here ever
 * downloads a whole `.grib2`.
 */
import { MODEL_CONFIGS } from './configs/index.ts';
import type {
    ComponentAlias,
    EnsembleConfig,
    EnsembleProduct,
    ModelAbout,
    ModelAccess,
    ModelDataSource,
    ModelPaneId,
    ModelProductConfig,
    ModelProfileConfig,
    ModelSource,
    ModelSurface,
    PointSeriesField,
} from './configs/types.ts';
import type { ModelGrid } from '@edgewarn/web-utils/grib2';
import { compileDataset } from './registry/compile.ts';

export type { EnsembleProduct };

/**
 * What a model can do, derived in `registry/compile.ts` from what its config already declares. A missing
 * capability means a missing control in the UI, never an error.
 */
export interface ModelCapabilities {
    projection: ModelGrid['projection'];
    /** A lat/lon grid that closes around the globe is `global`; everything else covers a region. */
    coverage: 'regional' | 'global';
    /** [west, south, east, north], degrees. A global grid is [-180, -90, 180, 90]. */
    bounds: readonly [number, number, number, number];
    cycles: readonly number[];
    /** Longest run any cycle reaches, hours. */
    maxLeadHours: number;
    stepMinutes: number;
    subHourly: boolean;
    /** The run has a step 0 (an analysis). */
    analysis: boolean;
    /** At least one field has fewer steps than the run. */
    thinnedFields: boolean;
    products: readonly EnsembleProduct[];
    /** Panes at least one product can fill, in display order. */
    panes: readonly ModelPaneId[];
    /** Pressure levels (hPa) of the level panes the model fills. */
    pressureLevels: readonly number[];
    isobars: boolean;
    /** Some field is a wind (two components), so barbs can be drawn. */
    barbs: boolean;
    /** `column` when soundings are served from a point column source (its own, or a borrowed one); null otherwise. */
    profiles: 'column' | null;
    /** How a published step is found: range probes of the gate objects, or a manifest. */
    discovery: 'probe' | 'manifest';
    /** Derived from the `ensemble` config; null for a deterministic model. */
    ensemble: null | {
        /** Members including the control. */
        members: number;
        control: boolean;
        stats: 'files' | 'computed';
        /** Statistics the worker can derive, so the picker offers only these. */
        computed: readonly ('mean' | 'sd' | 'min' | 'max' | 'exceed')[];
    };
}

type Config = (typeof MODEL_CONFIGS)[number];

/** The id of every registered model: an exact literal union, so a wrong id is a compile error. */
export type ModelId = Config['id'];

/**
 * Which object inside a dataset a selector reads, by the dataset's own name for it: HRRR splits by
 * file kind (`sfc`/`prs`), RRFS by field family (`surface`/`levels`), the 15-minute products have one
 * native file (`subh`/`surface`) and REFS has one per ensemble product (`mean`/`sprd`/`prob`).
 */
export type ModelFile = Config extends infer C
    ? C extends { objects: infer O }
        ? keyof O & string
        : never
    : never;

/** The meteogram's point-series copy of a dataset (config `pointSeries`), compiled. */
export interface ModelPointSeries {
    provider: 'open-meteo';
    model: string;
    /** Cycles `data_run/` keeps. */
    cycles: readonly number[];
    /** Whether `data_spatial/` keeps every cycle. */
    spatial: boolean;
    /** The copy's grid: the dataset's unless the config names another. */
    grid: ModelGrid;
    fields: Readonly<Record<string, PointSeriesField>>;
    /** The run's `data_run/` directory (`meta.json` and one `<variable>.om` per variable). No trailing slash. */
    runUrl: (initMs: number) => string;
    /** The run's `data_spatial/` directory (`meta.json` and one `.om` per valid time). No trailing slash. */
    spatialUrl: (initMs: number) => string;
    credit: { text: string; url: string };
}

/** A dataset's `profiles` config, compiled: the point column source's grid is resolved, and a borrowing dataset names its lender. */
export interface ModelProfiles {
    borrowFrom: { dataset: string; roundMinutes: number } | null;
    levels: readonly number[];
    sectionLevels: readonly number[];
    column: null | {
        kind: 'open-meteo';
        /** The provider's model slug. */
        model: string;
        /** Levels the column source serves. */
        levels: readonly number[];
        /** The provider's grid: the dataset's unless the config names another. */
        grid: ModelGrid;
    };
    native: ModelProfileConfig['native'] | null;
}

export interface ModelDataset {
    id: ModelId;
    /** Full name for the picker, tooltips and legends. */
    label: string;
    /** Compact name for the window subtitle and status lines. */
    shortLabel: string;
    /** Prose for the documentation page. */
    docs: { runs: string; length: string };
    about: ModelAbout;
    access: ModelAccess;
    /** Pages the model may be offered on. */
    surfaces: readonly ModelSurface[];
    /** Where the bytes come from (config default applied). */
    source: ModelDataSource;
    /** Where the meteogram reads whole-run point series, when anywhere. */
    pointSeries: ModelPointSeries | null;
    /** Vertical profiles (soundings, sections), when the model has them. */
    profiles: ModelProfiles | null;
    capabilities: ModelCapabilities;
    bucket: string;
    /**
     * Object URL for one run step. `date` is `YYYYMMDD` UTC, `cycleHour` 0-23, and `step` is the
     * index in the file name: a forecast hour for hourly datasets, a sub-hourly file index otherwise.
     */
    url: (date: string, cycleHour: number, file: ModelFile, step: number, member?: number) => string;
    /**
     * Which object holds what a selector asks for. Selectors are written once against a two-way split
     * (`sfc`/`prs`); a dataset maps that onto its own objects, and REFS puts each product in its own.
     */
    fileOf: (source: ModelSource, product: EnsembleProduct) => ModelFile;
    /** Objects probed to decide whether a step has been published at all. */
    files: readonly ModelFile[];
    /** Cycle hours this model runs at, ascending. */
    cycleHours: readonly number[];
    /** Largest step a complete run reaches for a given cycle, in hours. */
    runSteps: (cycleHour: number) => number;
    /** Smallest step present. 1 for the datasets that publish no analysis. */
    minStep: number;
    /** Minutes between sub-steps inside one file: 60 hourly, 15 sub-hourly. */
    stepMinutes: number;
    /** Whether `.idx` labels its forecast column in hours or minutes. */
    forecastUnit: 'hour' | 'minute';
    /**
     * True when the sub-hourly object stops short of the clock hour, so the hour belongs to the
     * hourly one. RRFS's `subh` files carry the three interior quarter-hours (:15, :30, :45) and no
     * `:00`; HRRR's `wrfsubhfNN` include the hour boundary, so they do not set this.
     */
    hourBoundaryInHourly?: boolean;
    /**
     * Maps a valid time in minutes onto a sub-hourly file index. HRRR's `wrfsubhf06` holds the four
     * quarter-hour steps ending at 6 h, so `ceil(m/60)` finds the file. RRFS's `subh.f006` holds only
     * the three interior steps (:15, :30, :45) and leaves the hour boundary to the hourly file.
     */
    subHourlyStep: (minutes: number) => number;
    /** The file index (forecast hour, or sub-hourly file number) holding a valid time, in minutes since the cycle. */
    fileIndexOf: (minutes: number) => number;
    /** Every valid time a run of this cycle holds, in minutes since the cycle, ascending. */
    stepsFor: (cycleHour: number) => readonly number[];
    /** Distinct file indices of a run, ascending: what is probed to find how far it has been published. */
    fileIndices: (cycleHour: number) => readonly number[];
    /**
     * The valid times at which a field exists, when that is fewer than the run's (NBM thins out by
     * field, measured); null means every step of the run.
     */
    fieldSteps: (fieldId: string | null | undefined, cycleHour: number) => readonly number[] | null;
    /** Products this dataset offers, for the picker. Every dataset offers at least one; the first is the default. */
    ensembles: readonly EnsembleProduct[];
    products: readonly ModelProductConfig[];
    /** Member layout of an ensemble dataset (see `EnsembleConfig`). */
    ensemble?: EnsembleConfig;
    /** `.idx` descriptor column that separates one product's components, e.g. `wt ens mean`. */
    qualifiers: Readonly<Partial<Record<EnsembleProduct, string>>>;
    /** What a component's descriptor columns must look like when neither the field nor the product says. */
    defaultExtra: 'any' | 'none';
    /** Variable renames applied before matching, e.g. HRRR's `MSLMA` is RRFS's `MSLET`. */
    variables?: Readonly<Record<string, string>>;
    /** Level-string rewrites applied before matching. */
    levels?: ReadonlyArray<readonly [string, string]>;
    /** Dataset-specific spellings of canonical components, keyed `VARIABLE|level`. */
    components?: Readonly<Record<string, ComponentAlias>>;
    /** The grid every message of the dataset declares, as plan tiles before the first decode. */
    grid: ModelGrid;
    /**
     * Present (true) when the grid follows a feature: `grid` is then only the shape plus a placeholder corner, and each
     * frame's own grid (on its tiles and `ModelFieldFrame.grid`) is the one to project with. Absent on every other model.
     */
    movingGrid?: true;
    /** Source cells merged per texel at each of the three levels of detail. */
    factors: readonly [number, number, number];
    /** The field shown when the model is switched on with nothing picked. */
    defaultField: string;
    /** The MSLP field behind the isobars, and the dataset it is read from when this one has none. */
    isobars: null | { fieldId: string; borrowFrom?: { dataset: ModelId; roundMinutes: number } };
}

export const MODEL_DATASETS = Object.fromEntries(
    MODEL_CONFIGS.map((c) => [c.id, compileDataset(c)]),
) as Readonly<Record<ModelId, ModelDataset>>;

/** Every registered model: the `/models` route, the documentation and the tests list these. */
export const MODEL_IDS = MODEL_CONFIGS.map((c) => c.id) as readonly ModelId[];

/** The models the interactive map offers (Models window, split pane, URL params): those whose `surfaces` include `map`. */
export const MAP_MODEL_IDS = MODEL_IDS.filter((id) =>
    MODEL_DATASETS[id].surfaces.includes('map'),
) as readonly ModelId[];

/** The models the `/models` route offers: those whose `surfaces` include `viewer`. */
export const VIEWER_MODEL_IDS = MODEL_IDS.filter((id) =>
    MODEL_DATASETS[id].surfaces.includes('viewer'),
) as readonly ModelId[];

/** The viewer models a comparison may use: not a moving-grid one (a storm nest), which has no fixed grid to align to. */
export const COMPARE_MODEL_IDS = VIEWER_MODEL_IDS.filter(
    (id) => !MODEL_DATASETS[id].movingGrid,
) as readonly ModelId[];

export function isModelId(value: unknown): value is ModelId {
    return typeof value === 'string' && value in MODEL_DATASETS;
}

/** A registered model the interactive map may show. */
export function isMapModelId(value: unknown): value is ModelId {
    return isModelId(value) && MAP_MODEL_IDS.includes(value);
}

/** The field each model shows when it is switched on with nothing picked yet (every model's `defaultField`). */
export const initialModelFields = (): Record<ModelId, string> =>
    Object.fromEntries(MODEL_IDS.map((id) => [id, MODEL_DATASETS[id].defaultField])) as Record<
        ModelId,
        string
    >;

/** Every model starts on its newest run. */
export const initialModelRuns = (): Record<ModelId, 'latest' | number> =>
    Object.fromEntries(MODEL_IDS.map((id) => [id, 'latest'])) as Record<ModelId, 'latest' | number>;

/** The dataset of a registered id. An id that is not registered is a bug, not a request for HRRR: it throws. */
export function getDataset(id: ModelId): ModelDataset {
    const dataset = MODEL_DATASETS[id];
    if (!dataset) throw new Error(`Unknown model "${id}"`);
    return dataset;
}
