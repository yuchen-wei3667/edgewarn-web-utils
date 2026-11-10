/**
 * The shape of a weather-model config file. A model is added by writing one file in `datasets/`
 * (its settings plus the fields only it offers) and registering it in `index.ts`; nothing in the
 * decoder, listing, pipeline or layer changes. See README.md for the checklist.
 *
 * Config files import only this module, `panes.ts` and each other: no engine code, so there is no
 * import cycle and the worker and the main thread read the same data.
 */
import type { MODEL_PANES } from './panes.ts';

export type ModelPaneId = (typeof MODEL_PANES)[number]['id'];

/**
 * Ensemble products, in picker order. A dataset lists the ones it has in `products`; the first is the default.
 * Statistics prefer a configured published object; ensembles can fall back to member reduction.
 * Percentiles are source products only: they never trigger member downloads.
 */
export type EnsembleProduct =
    'mean' | 'sprd' | 'nsprd' | 'prob' | 'member' | 'min' | 'max' | 'exceed' | 'p10' | 'p50' | 'p90';

/** Members of an ensemble dataset. Member 0 is the control. */
export interface EnsembleConfig {
    /** Perturbed members, excluding the control. */
    perturbed: number;
    /** Whether member 0 (the control) exists. */
    control: boolean;
    /** `file`: the object URL carries the member. `index`: one object holds every member and the inventory's number selects it. */
    addressing: 'file' | 'index';
    /** `files`: `mean` and `sprd` are published objects. `computed`: the worker reduces the members. */
    stats: 'files' | 'computed';
    /** Members read at once by one job; bounds memory and request fan-out. Default 6. */
    batch?: number;
}

/**
 * Which kind of GRIB object a field selector reads: `sfc` is the near-surface and 2-D set, `prs` the
 * pressure-level set, `sat` the simulated satellite channels. A dataset maps each onto its own objects (`objects[...].serves`).
 */
export type ModelSource = 'sfc' | 'prs' | 'sat';

/** Pad a number with leading zeros, for URL builders. */
export const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** Valid-time offsets, in minutes since the cycle: `from`, `from + every`, ... up to and including `to`. */
export interface StepRange {
    from: number;
    to: number;
    every: number;
}

// ── Fields ──

/**
 * scalar: plain field, mean when downsampled. vector: U+V rotated to earth-relative, drawn as speed.
 * categorical: integer codes, most common value, nearest sampling. extreme: max when downsampled so
 * storms survive. accum: accumulations.
 */
export type ModelFieldKind = 'scalar' | 'vector' | 'categorical' | 'extreme' | 'accum';

/**
 * instant: `anl` at the analysis step, `N hour fcst` later. window: the hour ending at the step
 * (`N-1-N hour acc/max fcst`), absent at the analysis. total: accumulated since the run started.
 * sum-window: the sum of several adjacent windowed components, used for the 15-minute products that
 * only publish quarter-hour accumulations.
 */
export type ModelTiming = 'instant' | 'window' | 'total' | 'sum-window';

/** Affine transform folded into the unpack constants, e.g. Pa -> hPa so values fit float16 range. */
export interface ValueTransform {
    scale?: number;
    offset?: number;
}

/** How a level merges the source cells under one output texel. */
export type LevelReducer = 'mean' | 'max' | 'mode';

export interface ModelSelector {
    file: ModelSource;
    /** `.idx` variable, e.g. 'TMP', or a raw `var discipline=… parmcat=… parm=…` description. */
    variable: string;
    level: string;
    timing: ModelTiming;
    /** Transform folded into decode so values sit in float16's precise range. */
    transform?: ValueTransform;
    /** Reducer for this input when it differs from the field's (precip-type masks use 'max'). */
    reducer?: LevelReducer;
    /**
     * Values above this, in stored units (after `transform`), are the field's "none" code and become missing.
     * NBM writes 88 875 m for an unlimited ceiling or no echo top; averaged into a coarse level it would
     * turn clear air into a made-up ceiling.
     */
    validMax?: number;
    /**
     * `.idx` column 6 that picks one component out of many sharing a variable, level and forecast.
     * REFS's `prob` file lists seven `VIS|surface|1 hour fcst` components, one per threshold.
     */
    threshold?: string;
    /**
     * Which descriptor columns (7 onwards) the component must carry: a string the columns must
     * include (`10% level`), `none` for a component with no descriptor at all (the plain forecast, not
     * its `ens std dev` twin) or `any`. Beats the product's `extra`, which beats the dataset's `defaultExtra`.
     */
    extra?: string;
    /**
     * Match the variable and level exactly, skipping the dataset's renames and level rewrites. The
     * probability object words its levels per variable — `REFC` is `entire atmosphere (considered as
     * a single layer)` while `LTNG` is plain `entire atmosphere` — which no single rewrite covers.
     */
    exact?: boolean;
    /** Window length in minutes for `sum-window`, and the number of components to add. */
    sumMinutes?: number;
    sumCount?: number;
    /**
     * Length in minutes of the accumulation window for timing `window`, when it is not the model's usual one
     * (60 for an hourly dataset, 15 for a sub-hourly one). GFS `APCP` holds `6-12 hour acc` at f012, so its
     * 6-hour field says 360. Must be a positive multiple of the dataset's `time.stepMinutes`.
     */
    windowMinutes?: number;
}

/**
 * How a dataset spells a canonical (wgrib2/NCEP) component, keyed `${VARIABLE}|${level}`. A field is written once
 * against the NCEP names; a source that words it differently (an Open-Meteo variable name, a level in Pa)
 * says so here instead of growing a second field.
 */
export interface ComponentAlias {
    variable: string;
    level: string;
    /** Applied before the selector's own transform (e.g. a source in Pa where the field expects hPa). */
    transform?: ValueTransform;
}

/** How several inputs become one field. The recipes are code (`utils/models/recipes.ts`); a config only picks one. */
export type ModelRecipe =
    | 'single'
    | 'vector'
    | 'ptype'
    | 'thetae'
    | 'sum'
    | 'speed-direction'
    // Diagnostics (phase 5.9): derived from several model-computed fields at full resolution, then decimated.
    | 'advection'
    | 'frontogenesis'
    | 'moisture-flux'
    | 'stp-fixed'
    | 'ehi'
    | 'lapse-rate'
    // Phase 5.10: column integrals, vertical-derivative and quasi-geostrophic diagnostics, and wind relative to a storm.
    | 'ivt'
    | 'potential-vorticity'
    | 'q-vector'
    | 'differential-advection'
    | 'isentropic'
    | 'storm-relative'
    // Absolute vorticity (relative plus Coriolis) of a wind given as a speed and the direction it blows from.
    | 'absolute-vorticity';

/** Options of the recipes that have any. */
export interface ModelRecipeParams {
    /** `frontogenesis`: the pressure level, hPa, at which potential temperature is taken from temperature. */
    levelHpa?: number;
    /**
     * Pressure levels, hPa, descending, of the recipes that read several: `ivt` (integrated, with surface pressure last),
     * `potential-vorticity` (lower, middle, upper), `isentropic` and `storm-relative` (the profile).
     */
    levelsHpa?: readonly number[];
    /** `isentropic`: the potential temperature of the surface, K. */
    thetaK?: number;
    /** What a recipe with several outputs gives: `q-vector` `magnitude` or `convergence`; `isentropic` `pressure`, `humidity` or `speed`. */
    output?: string;
    /** `storm-relative`: the level, one of `levelsHpa`, whose wind is taken relative to the storm. */
    targetHpa?: number;
    /**
     * `vector`: whether the two components follow the grid's axes (`grid`, rotated to east/north with
     * the projection) or are already east/north (`earth`). Without one the message's component flag
     * decides, which is wrong for HRRR, RRFS and REFS (they carry the "earth" flag on grid-relative
     * winds), so their fields say `grid`.
     * `speed-direction`: the frame of the direction input, same meaning. Default `earth`.
     */
    frame?: 'grid' | 'earth';
}

/** Which user unit setting applies to the stored values. */
export type ModelQuantity = 'temperature' | 'speed' | 'other';

export interface ModelColormapRef {
    /** Bundled colormap name (public/colormaps.json). */
    name: string;
    /** Maps colormap values into stored units (e.g. K -> °C is offset -273.15). */
    toStored?: ValueTransform;
    /** Stretch the colormap's thresholds onto this range (stored units), for per-level ranges. */
    range?: [number, number];
    /** Stored values below this are no-data and drawn transparent (e.g. REFC's negative dBZ). */
    transparentBelow?: number;
}

/** Components to use for one dataset instead of a field's usual ones. Keyed by dataset id. */
export interface ModelFieldOverride {
    inputs: readonly ModelSelector[];
    recipe?: ModelRecipe;
    kind?: ModelFieldKind;
}

export interface ModelFieldConfig {
    id: string;
    /**
     * Set when the field only exists inside one product (REFS's `prob`). The dataset maps a
     * selector onto whichever product is chosen, so without this a probability field would be
     * offered while the `mean` product is selected and then fail to resolve.
     */
    product?: EnsembleProduct;
    /** Full name, e.g. "500 mb Temperature". */
    label: string;
    /** Name inside its pane, e.g. "Temperature" in the 500 mb pane. */
    shortLabel?: string;
    pane: ModelPaneId;
    kind: ModelFieldKind;
    recipe?: ModelRecipe;
    recipeParams?: ModelRecipeParams;
    inputs: readonly ModelSelector[];
    overrides?: Readonly<Record<string, ModelFieldOverride>>;
    /** Units of the stored values (after `display`). Temperatures are °C, speeds m/s. */
    units: string;
    quantity?: ModelQuantity;
    /** True when ratios and percent differences have a physical meaning. */
    ratioScale?: boolean;
    /** Stored -> display units, when storage is offset to fit float16 (MSLP is stored as hPa - 1000). */
    display?: ValueTransform;
    /** Automatic labeled contours, spaced in display units. */
    contourInterval?: number;
    /** Matching height field drawn as automatic contours over this field. */
    contourField?: string;
    colormap: ModelColormapRef;
    legacyIds?: readonly string[];
    /** Never drawn as a field of its own: another layer reads it (MSLP feeds the isobars). Not offered in the picker. */
    overlay?: boolean;
    /** Shown with the legend when what the field draws needs a caveat (a composite built from the model's own computed inputs). */
    note?: string;
}

/** Identity with checking, and keeps the literal `id` so the dataset's field list stays typed. */
export function defineField<const T extends ModelFieldConfig>(field: T): T {
    return field;
}

// ── Datasets ──

export interface ModelUrlParams {
    /** `YYYYMMDD`, UTC. */
    date: string;
    /** Cycle hour, 0-23. */
    cycle: number;
    /** The index in the file name: a forecast hour, or a sub-hourly file index. */
    step: number;
    product: EnsembleProduct;
    /** Ensemble member, 0 = control. Set only for datasets with an `ensemble` block. */
    member?: number;
}

/** One GRIB object of a run, keyed in `objects` by the dataset's own name for it. */
export interface ModelObjectConfig {
    /** The selector sources this object holds. */
    serves: readonly ModelSource[];
    /** Path under `bucket`, without the `.idx` suffix. */
    url: (params: ModelUrlParams) => string;
}

export interface ModelProductConfig {
    id: EnsembleProduct;
    label: string;
    /** `.idx` descriptor columns that separate this product's components from another's (REFS `wt ens mean`). */
    extra?: string;
    /** The object this product reads, when each product has its own file (REFS). Otherwise the source picks it. */
    object?: string;
    /** Fields available in this product; omitted when it has the dataset's usual fields. */
    fields?: readonly string[];
    /** Cycles carrying the published object; other cycles use the computed fallback, when available. */
    cycles?: readonly number[];
    /** Member reduction fallback. With `object`, try the published product first. */
    computed?: 'mean' | 'sd' | 'min' | 'max' | 'exceed';
}

/** Where a message's forecast step is addressed: the hour in the file name, or a sub-hourly file index. */
export type ModelFileIndex =
    | { kind: 'forecast-hour' }
    /**
     * Sub-hourly files are numbered by hour. `inclusive`: file N holds the four quarter-hours ending at
     * hour N (HRRR: ceil(m / 60)). `exclusive`: it holds only the three interior ones and the hour
     * boundary belongs to the hourly object (RRFS: floor(m / 60) + 1).
     */
    | { kind: 'hourly-file'; boundary: 'inclusive' | 'exclusive' };

/** Lambert conformal (GRIB template 3.30). */
export interface LambertGrid {
    projection: 'lambert';
    nx: number;
    ny: number;
    lat1: number;
    lon1: number;
    lov: number;
    latin1: number;
    latin2: number;
    dx: number;
    dy: number;
    /** 0x40, or 0x50 when adjacent rows scan in opposite directions. */
    scanMode: 0x40 | 0x50;
    /** Radius of the spherical earth, metres. */
    radiusM: number;
}

/** Regular latitude/longitude (GRIB template 3.0). */
export interface GridRotation {
    southPoleLat: number;
    southPoleLon: number;
}

export interface LatLonGrid {
    /** First point and increments are in rotated coordinates when a pole is present. */
    rotation?: GridRotation;
    projection: 'latlon';
    nx: number;
    ny: number;
    /** First point in scan order, degrees; lon in [0, 360). */
    lat1: number;
    lon1: number;
    /** Positive increments, degrees. */
    dlat: number;
    dlon: number;
    /** 0x00: rows run north to south (GFS); 0x40: south to north. Columns always run west to east. */
    scanMode: 0x00 | 0x40;
    /** Radius of the spherical earth, metres. */
    radiusM: number;
}

/** Polar stereographic (GRIB template 3.20), north pole. */
export interface PolarStereoGrid {
    projection: 'polarStereo';
    nx: number;
    ny: number;
    lat1: number;
    lon1: number;
    /** The meridian parallel to the grid's y axis, degrees. */
    lov: number;
    /** The latitude where dx and dy are true, degrees. */
    latD: number;
    dx: number;
    dy: number;
    /** 0x40, or 0x50 when adjacent rows scan in opposite directions. */
    scanMode: 0x40 | 0x50;
    /** Radius of the spherical earth, metres. */
    radiusM: number;
}

/** Mercator (GRIB template 3.10), axes along the equator and the meridians. */
export interface MercatorGrid {
    projection: 'mercator';
    nx: number;
    ny: number;
    lat1: number;
    lon1: number;
    /** The latitude where dx and dy are true, degrees. */
    latD: number;
    dx: number;
    dy: number;
    /** 0x40, or 0x50 when adjacent rows scan in opposite directions. */
    scanMode: 0x40 | 0x50;
    /** Radius of the spherical earth, metres. */
    radiusM: number;
}

/** The grid every message of the dataset declares; checked against the first decoded message. */
export type DeclaredGrid = LambertGrid | LatLonGrid | PolarStereoGrid | MercatorGrid;

export type ModelCategory =
    'global' | 'regional' | 'convection-allowing' | 'ensemble' | 'ai' | 'hurricane' | 'climate';

/** Who produces the model and what the viewer must say about the bytes it shows. */
export interface ModelAbout {
    /** `NOAA`, `DWD`. */
    provider: string;
    category: ModelCategory;
    /** Shown while the model is on. Required when the provider is not NOAA, or the bytes come from a third party. */
    attribution?: string;
    /** Set when the source is a third party's post-processed copy rather than the producer's own output. */
    derivedFrom?: string;
}

export interface ModelAccess {
    /** `YYYY-MM-DD` the data host last passed `scripts/verify-url-cors.mjs --range` (206 plus `Access-Control-Allow-Origin`). */
    corsVerifiedOn: string;
}

/**
 * The pages a model may be offered on: `viewer` is the `/models` route, `map` the interactive map (Models
 * window, split pane, map URL params). Required with no default, so a model is never added to the map by accident.
 */
export type ModelSurface = 'map' | 'viewer';

/**
 * Where a dataset's bytes come from and how a published step is found. Named apart from `ModelSource`
 * above, which says which kind of object a selector reads.
 */
export type ModelDataSource =
    /**
     * GRIB2 objects with an inventory beside each. `wgrib2`: NOAA's `.idx`. `ecmwf`: ECMWF open data's JSON-lines
     * `.index`, whose objects are CCSDS-packed; both are read by the ECMWF adapter in `sources/index.ts`.
     * `jpeg2000`: the objects use packing 5.40 (RAP, CFS, the wave models), which `sources/index.ts` registers the decoder for.
     */
    | { kind: 'grib2-index'; dialect: 'wgrib2' | 'ecmwf'; jpeg2000?: boolean }
    /** OM spatial step files; manifest is the run metadata path relative to a step object. */
    | { kind: 'om'; manifest: string }
    /**
     * NetCDF-4 (HDF5) files, one per variable per valid time, read by `utils/models/netcdf/`. An object's `url` names one
     * representative file of the step (`<valid time>-PT<hhh>H00M-<name>.nc`), which the gate probes; a component alias
     * names the file of any other variable (`variable`, replacing `<name>`) and, for a pressure-level file, the level in hPa.
     */
    | { kind: 'netcdf' };

/**
 * One field of a point series: the provider's variables in recipe order (`vector`: u then v), and how their
 * values become the field's stored units. `frame: 'grid'` rotates the components like the `vector` recipe does.
 */
export interface PointSeriesField {
    variables: readonly string[];
    recipe?: 'single' | 'vector';
    frame?: 'grid' | 'earth';
    transform?: ValueTransform;
}

/**
 * Where the `/models` meteogram reads a whole run at one point in a few small requests, instead of decoding a
 * GRIB2 message per step. Maps keep reading GRIB2. A field not listed here, a run the provider does not hold
 * and a step its files lack all fall back to the GRIB2 tile path, step by step.
 */
export interface PointSeriesConfig {
    /**
     * Open-Meteo's run-pinned copies under `<model>/YYYY/MM/DD/HH00Z/`, each beside a `meta.json`: `data_run/` (one
     * `<variable>.om` per variable, all steps) and `data_spatial/` (one `YYYY-MM-DDTHHMM.om` per valid time).
     */
    provider: 'open-meteo';
    /** Origin of the copy; must be in `APPROVED_DATA_ORIGINS`. */
    bucket: string;
    /** The provider's name for the model, e.g. `ncep_hrrr_conus`. */
    model: string;
    /** Cycles `data_run/` keeps, measured (HRRR: every third hour); tried first, being the cheapest. */
    cycles: readonly number[];
    /** Whether `data_spatial/` keeps every cycle (measured), read for the cycles `data_run/` lacks or has not written yet. */
    spatial: boolean;
    /** The provider's grid when it is not the dataset's. */
    grid?: DeclaredGrid;
    /** Keyed by field id. Only fields whose values were checked against the GRIB2 ones at the same cell. */
    fields: Readonly<Record<string, PointSeriesField>>;
    /** `YYYY-MM-DD` the mapping was last checked against GRIB2 values. */
    verifiedOn: string;
}

/**
 * Names the engine uses for a profile's variables; a dataset maps each onto its own spelling. Read by the profile
 * job and the sounding sources, which come after the config.
 * @public
 */
export type ProfileVariable = 'z' | 't' | 'td' | 'rh' | 'q' | 'u' | 'v' | 'omega' | 'w';

/**
 * Vertical profiles (soundings, cross sections). A dataset either lists its own, or borrows its hourly
 * parent's (`borrowFrom`, exclusive with every other key), like `isobars.borrowFrom`.
 */
export interface ModelProfileConfig {
    /** Use another dataset's profiles (sub-hourly -> hourly). The lender must have its own. */
    borrowFrom?: { dataset: string; roundMinutes: number };
    /** Pressure levels in hPa, descending, that profiles and sections use. A subset of what the sources carry. */
    levels?: readonly number[];
    /** Levels a cross section reads by default (a subset of `levels`, to bound bytes). */
    sectionLevels?: readonly number[];
    /** A point source serving whole columns. */
    column?: {
        kind: 'open-meteo';
        /** The provider's model slug, e.g. `ncep_hrrr_conus`. */
        model: string;
        /** Levels it serves, when fewer than `levels`. */
        levels?: readonly number[];
        /** The provider's grid when it is not the dataset's (Open-Meteo stores global models south to north from -180). */
        grid?: DeclaredGrid;
    };
    /** Native bundle for cross sections only (a grid product, never points). */
    native?: {
        /** The object kind holding the levels. */
        file: ModelSource;
        /** The moisture variable in canonical NCEP spelling; ECMWF goes through the idx aliases. */
        moisture: 'DPT' | 'RH' | 'SPFH';
        omega?: 'VVEL' | 'DZDT';
        /** Surface components (canonical selectors) for the profile's bottom. */
        surface: readonly ModelSelector[];
    };
}

export interface ModelDatasetConfig {
    /** `[a-z0-9-]+`, unique and stable: saved layers and `?model=` links carry it. */
    id: string;
    /** Full name for the picker, tooltips and legends. */
    label: string;
    /** Compact name for the window subtitle and status lines. */
    shortLabel: string;
    /** Prose for the documentation page. */
    docs: { runs: string; length: string };
    about: ModelAbout;
    access: ModelAccess;
    /** Where the model may be offered. Required: see `ModelSurface`. */
    surfaces: readonly ModelSurface[];
    /** Where the bytes come from; default `{ kind: 'grib2-index', dialect: 'wgrib2' }`. */
    source?: ModelDataSource;
    /** A second copy the meteogram reads point series from (see `PointSeriesConfig`). */
    pointSeries?: PointSeriesConfig;
    /** Vertical profiles for the sounding and cross-section tools; absent where the model has too few levels. */
    profiles?: ModelProfileConfig;
    bucket: string;
    objects: Readonly<Record<string, ModelObjectConfig>>;
    /** Objects whose `.idx` must exist for a step to count as published. */
    gate: readonly string[];
    /** Products on offer; the first is the default and more than one shows the Product select. */
    products: readonly ModelProductConfig[];
    /** Present on an ensemble: how members are addressed and whether statistics are published or computed. */
    ensemble?: EnsembleConfig;
    /** Cycle hours this model runs at, ascending. */
    cycles: readonly number[];
    time: {
        /** Minutes between steps inside one file: 60 hourly, 15 sub-hourly. */
        stepMinutes: number;
        /** Whether `.idx` labels its forecast column in hours or minutes. */
        idxUnit: 'hour' | 'minute';
        /** Smallest file index present, in hours: 0 with an analysis, 1 for the datasets that publish none. */
        firstStep: number;
        fileIndex: ModelFileIndex;
    };
    /**
     * Which valid times a run holds, as minutes since the cycle; the first entry whose `cycles`
     * contains the run's cycle (or has none) wins. Contiguous for most models, ranges of different
     * cadence for the ones that thin out (NBM: hourly, then 3-hourly, then 6-hourly).
     */
    runs: ReadonlyArray<{ cycles?: readonly number[]; steps: readonly StepRange[] }>;
    grid: DeclaredGrid;
    /**
     * Set when the grid follows a feature (HAFS's storm nest): every message has the declared shape (projection, size,
     * spacing, scan order) but its own corner, so `grid` is only the shape and a placeholder corner. The decoder then
     * checks the shape alone, and every frame carries the grid its own message declared.
     */
    movingGrid?: boolean;
    /** Target texel size of the three levels of detail, km. The cells merged per texel are derived from the grid's spacing. */
    levelTargetsKm: readonly [number, number, number];
    idx: {
        /** `any` (default): descriptor columns are not looked at; `none`: a component must carry none. */
        defaultExtra?: 'any' | 'none';
        /** Variable renames applied before matching, e.g. HRRR's `MSLMA` is RRFS's `MSLET`. */
        variables?: Readonly<Record<string, string>>;
        /** Exact-string level rewrites applied before matching. */
        levels?: ReadonlyArray<readonly [string, string]>;
        /** Aliases keyed `VARIABLE|level` (the canonical NCEP spelling), applied before `variables` and `levels`. */
        components?: Readonly<Record<string, ComponentAlias>>;
    };
    /** The field shown when the model is switched on with nothing picked. Must be one of `fields`. */
    defaultField: ModelFieldConfig;
    /** Isobars, Highs and Lows: the MSLP field, optionally read from another dataset's run. */
    isobars: null | {
        field: ModelFieldConfig;
        borrowFrom?: { dataset: string; roundMinutes: number };
    };
    /** Every field this dataset offers, in picker order (overlay fields included). */
    fields: readonly ModelFieldConfig[];
    /** Per-field cadence inside a run, where it differs: measured, never guessed (`tests/models/models-nbm.test.mjs`). */
    fieldSteps?: Readonly<Partial<Record<string, readonly StepRange[]>>>;
    /** Shared fields this dataset leaves out on purpose, so the catalog test can tell that from a mistake. */
    notOffered?: readonly ModelFieldConfig[];
}

type DatasetInput<
    Id extends string,
    F extends readonly ModelFieldConfig[],
    O extends Readonly<Record<string, ModelObjectConfig>>,
> = Omit<
    ModelDatasetConfig,
    'id' | 'fields' | 'objects' | 'gate' | 'defaultField' | 'isobars' | 'fieldSteps'
> & {
    id: Id;
    fields: F;
    objects: O;
    gate: readonly (keyof O & string)[];
    defaultField: F[number];
    isobars: null | { field: ModelFieldConfig; borrowFrom?: { dataset: string; roundMinutes: number } };
    fieldSteps?: { readonly [K in F[number]['id']]?: readonly StepRange[] };
};

/**
 * Identity with checking: a field list the default is not in, a gate naming no object or a `fieldSteps`
 * key naming no field is a compile error, and the literal `id` flows into `ModelId`.
 */
export function defineDataset<
    const Id extends string,
    const F extends readonly ModelFieldConfig[],
    const O extends Readonly<Record<string, ModelObjectConfig>>,
>(config: DatasetInput<Id, F, O>): DatasetInput<Id, F, O> {
    return config;
}
