import { TtlMap } from '../internal/ttl-map.ts';
import type {
    DeclaredGrid,
    EnsembleProduct,
    ModelDataSource,
    ModelDatasetConfig,
    ModelFieldConfig,
    ModelSource,
    StepRange,
} from '../configs/types.ts';
import { MODEL_PANES } from '../configs/panes.ts';
import { OPEN_METEO_CREDIT } from '../configs/openMeteo.ts';
import type { ModelFieldDef } from '../catalog.ts';
import type {
    ModelCapabilities,
    ModelDataset,
    ModelFile,
    ModelId,
    ModelPointSeries,
    ModelProfiles,
} from '../datasets.ts';
import type { ModelGrid } from '@edgewarn/web-utils/grib2';
import { gridRectLngLatBounds, lambertProjection } from '../lambert.ts';
import { projectionFor } from '../projection/index.ts';

/** The source of a dataset that names none: wgrib2 `.idx` inventories next to GRIB2 objects. */
const DEFAULT_SOURCE: ModelDataSource = { kind: 'grib2-index', dialect: 'wgrib2' };

/**
 * Turns the config files into the shapes the engine reads. Config is data; this is the only place
 * that knows how a config key becomes a function (`url`, `runSteps`, `subHourlyStep`), so listing,
 * catalog matching and the job runner never look at a config directly.
 */

/**
 * Cells merged per texel at each level of detail: the whole number of cells nearest each target size,
 * and always more than the level before (a 3 km grid gives 1, 2, 3 for 3, 6 and 9 km; NBM's 2.54 km gives 1, 2, 4).
 */
export function levelFactors(
    dx: number,
    targetsKm: readonly [number, number, number],
): readonly [number, number, number] {
    const out: number[] = [];
    for (const km of targetsKm) out.push(Math.max(Math.round((km * 1000) / dx), (out.at(-1) ?? 0) + 1));
    return out as unknown as readonly [number, number, number];
}

/** Every valid time of a list of ranges, ascending, minutes since the cycle. */
export function expandSteps(ranges: readonly StepRange[]): number[] {
    const out: number[] = [];
    for (const { from, to, every } of ranges) for (let m = from; m <= to; m += every) out.push(m);
    return out;
}

/** The run entry that applies to a cycle: the first one naming it, else the first with no cycles listed. */
export function runEntryFor(config: ModelDatasetConfig, cycle: number): ModelDatasetConfig['runs'][number] {
    const entry = config.runs.find((r) => r.cycles?.includes(cycle)) ?? config.runs.find((r) => !r.cycles);
    if (!entry) throw new Error(`${config.id} has no run shape for cycle ${cycle}`);
    return entry;
}

const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/** The grid as the engine reads it: the declared one, with the same keys a decoded message has. */
function modelGridOf(f: DeclaredGrid): ModelGrid {
    return { ...f };
}

/** Metres between neighbouring cells along a row: at the equator for a lat/lon grid, whose cells narrow poleward. */
function nativeCellMetres(g: ModelGrid): number {
    return g.projection === 'latlon' ? ((g.dlon * Math.PI) / 180) * (g.radiusM ?? 0) : g.dx;
}

/** Whether a lat/lon grid's columns close around the globe. */
const wrapsGlobe = (g: ModelGrid): boolean =>
    g.projection === 'latlon' && !g.rotation && Math.abs(g.nx * g.dlon - 360) < g.dlon;

/** [west, south, east, north] of the cells' extent. East exceeds 180 when a regional lat/lon grid crosses the antimeridian. */
function gridBounds(g: ModelGrid): readonly [number, number, number, number] {
    if (g.projection === 'lambert')
        return gridRectLngLatBounds(lambertProjection(g), -0.5, -0.5, g.nx - 0.5, g.ny - 0.5);
    if (
        g.projection === 'polarStereo' ||
        g.projection === 'mercator' ||
        (g.projection === 'latlon' && g.rotation)
    ) {
        const boxes = projectionFor(g).rectBounds(-0.5, -0.5, g.nx - 0.5, g.ny - 0.5);
        if (boxes.length === 1) return boxes[0];
        // Two boxes: the grid crosses the antimeridian, so the east edge is expressed past 180.
        return [boxes[0][0], boxes[0][1], boxes[1][2] + 360, boxes[0][3]];
    }
    if (wrapsGlobe(g)) return [-180, -90, 180, 90];
    const south = g.scanMode === 0x00 ? g.lat1 - (g.ny - 1) * g.dlat : g.lat1;
    const north = g.scanMode === 0x00 ? g.lat1 : g.lat1 + (g.ny - 1) * g.dlat;
    const west = wrapLon(g.lon1);
    return [west, south, west + (g.nx - 1) * g.dlon, north];
}

const isWind = (f: ModelFieldConfig, id: string): boolean => {
    const recipe = f.overrides?.[id]?.recipe ?? f.recipe;
    return recipe === 'vector' || recipe === 'speed-direction';
};

/** `min`, `max` and `exceed` are always the worker's; `mean` and `sd` only when the dataset publishes no statistic files. */
function computedStats(config: ModelDatasetConfig): ('mean' | 'sd' | 'min' | 'max' | 'exceed')[] {
    const stats: ('mean' | 'sd' | 'min' | 'max' | 'exceed')[] = ['min', 'max', 'exceed'];
    if (config.ensemble?.stats === 'computed') stats.unshift('mean', 'sd');
    return stats;
}

function deriveCapabilities(
    config: ModelDatasetConfig,
    grid: ModelGrid,
    source: ModelDataSource,
): ModelCapabilities {
    const offered = (product: EnsembleProduct) =>
        config.fields.filter((f) => !f.overlay && (f.product === undefined || f.product === product));
    const panes = new Set(config.products.flatMap((p) => offered(p.id).map((f) => f.pane)));
    const orderedPanes = MODEL_PANES.filter((p) => panes.has(p.id));
    const maxMinutes = Math.max(...config.runs.flatMap((r) => r.steps.map((s) => s.to)));
    return {
        projection: grid.projection,
        coverage: wrapsGlobe(grid) ? 'global' : 'regional',
        bounds: gridBounds(grid),
        cycles: config.cycles,
        maxLeadHours: Math.floor(maxMinutes / 60),
        stepMinutes: config.time.stepMinutes,
        subHourly: config.time.stepMinutes < 60,
        analysis: config.time.firstStep === 0,
        thinnedFields: Object.keys(config.fieldSteps ?? {}).length > 0,
        products: config.products.map((p) => p.id),
        panes: orderedPanes.map((p) => p.id),
        pressureLevels: orderedPanes.filter((p) => p.level).map((p) => Number(p.id)),
        isobars: config.isobars !== null,
        barbs: config.fields.some((f) => !f.overlay && isWind(f, config.id)),
        profiles: config.profiles?.column || config.profiles?.borrowFrom ? 'column' : null,
        discovery: source.kind === 'om' ? 'manifest' : 'probe',
        ensemble: config.ensemble
            ? {
                  members: config.ensemble.perturbed + (config.ensemble.control ? 1 : 0),
                  control: config.ensemble.control,
                  stats: config.ensemble.stats,
                  computed: computedStats(config),
              }
            : null,
    };
}

function compilePointSeries(config: ModelDatasetConfig, grid: ModelGrid): ModelPointSeries | null {
    const series = config.pointSeries;
    if (!series) return null;
    const dir = (layout: string, initMs: number) => {
        const t = new Date(initMs).toISOString();
        return `${series.bucket}/${layout}/${series.model}/${t.slice(0, 4)}/${t.slice(5, 7)}/${t.slice(8, 10)}/${t.slice(11, 13)}00Z`;
    };
    return {
        provider: series.provider,
        model: series.model,
        cycles: series.cycles,
        spatial: series.spatial,
        grid: series.grid ? modelGridOf(series.grid) : grid,
        fields: series.fields,
        runUrl: (initMs) => dir('data_run', initMs),
        spatialUrl: (initMs) => dir('data_spatial', initMs),
        credit: OPEN_METEO_CREDIT,
    };
}

function compileProfiles(config: ModelDatasetConfig, grid: ModelGrid): ModelProfiles | null {
    const profiles = config.profiles;
    if (!profiles) return null;
    const { column } = profiles;
    return {
        borrowFrom: profiles.borrowFrom ?? null,
        levels: profiles.levels ?? [],
        sectionLevels: profiles.sectionLevels ?? profiles.levels ?? [],
        column: column
            ? {
                  kind: column.kind,
                  model: column.model,
                  levels: column.levels ?? profiles.levels ?? [],
                  grid: column.grid ? modelGridOf(column.grid) : grid,
              }
            : null,
        native: profiles.native ?? null,
    };
}

export function compileDataset(config: ModelDatasetConfig): ModelDataset {
    const { id, objects, products, time } = config;
    const productById = (product: EnsembleProduct) => products.find((p) => p.id === product) ?? products[0];
    const objectServing = (source: ModelSource): string => {
        const key = Object.keys(objects).find((k) => objects[k].serves.includes(source));
        if (!key) throw new Error(`${id} has no object serving ${source}`);
        return key;
    };
    const exclusiveHourly = time.fileIndex.kind === 'hourly-file' && time.fileIndex.boundary === 'exclusive';
    const qualifiers: Partial<Record<EnsembleProduct, string>> = {};
    for (const p of products) if (p.extra !== undefined) qualifiers[p.id] = p.extra;
    const grid = modelGridOf(config.grid);
    const source = config.source ?? DEFAULT_SOURCE;
    const subHourlyStep = (minutes: number) =>
        minutes <= 0 ? 0 : exclusiveHourly ? Math.floor(minutes / 60) + 1 : Math.ceil(minutes / 60);
    const fileIndexOf = (minutes: number) =>
        time.fileIndex.kind === 'forecast-hour' ? minutes / 60 : subHourlyStep(minutes);
    // A run's list and its files' indices are looked up often (every timeline frame), and never change.
    const stepCache = new TtlMap<number, readonly number[]>();
    const stepsFor = (cycleHour: number): readonly number[] => {
        let steps = stepCache.get(cycleHour);
        if (!steps) stepCache.set(cycleHour, (steps = expandSteps(runEntryFor(config, cycleHour).steps)));
        return steps;
    };
    const fieldStepLists = new TtlMap<string, readonly number[]>();
    const fieldSteps = (fieldId: string | null | undefined, cycleHour: number): readonly number[] | null => {
        const ranges = fieldId ? config.fieldSteps?.[fieldId] : undefined;
        if (!ranges) return null;
        const key = `${fieldId}@${cycleHour}`;
        let list = fieldStepLists.get(key);
        if (!list) {
            const own = new Set(expandSteps(ranges));
            fieldStepLists.set(key, (list = stepsFor(cycleHour).filter((m) => own.has(m))));
        }
        return list;
    };

    return {
        id: id as ModelId,
        label: config.label,
        shortLabel: config.shortLabel,
        docs: config.docs,
        about: config.about,
        access: config.access,
        surfaces: config.surfaces,
        source,
        pointSeries: compilePointSeries(config, grid),
        profiles: compileProfiles(config, grid),
        capabilities: deriveCapabilities(config, grid, source),
        bucket: config.bucket,
        url: (date, cycleHour, file, step, member) => {
            const object = objects[file];
            if (!object) throw new Error(`${id} has no object "${file}"`);
            const product = products.find((p) => p.object === file)?.id ?? products[0].id;
            return `${config.bucket}/${object.url({ date, cycle: cycleHour, step, product, member })}`;
        },
        ensemble: config.ensemble,
        fileOf: (source, product) => (productById(product).object ?? objectServing(source)) as ModelFile,
        files: config.gate as readonly ModelFile[],
        cycleHours: config.cycles,
        runSteps: (cycleHour) =>
            Math.floor(
                runEntryFor(config, cycleHour).steps.reduce((last, r) => Math.max(last, r.to), 0) / 60,
            ),
        minStep: time.firstStep,
        stepMinutes: time.stepMinutes,
        forecastUnit: time.idxUnit,
        hourBoundaryInHourly: exclusiveHourly || undefined,
        subHourlyStep,
        fileIndexOf,
        stepsFor,
        fieldSteps,
        fileIndices: (cycleHour) => {
            // The hour boundary of an exclusive sub-hourly dataset lives in the hourly object, so it names no file here.
            const steps = stepsFor(cycleHour).filter((m) => !(exclusiveHourly && m % 60 === 0));
            return [...new Set(steps.map(fileIndexOf))];
        },
        ensembles: products.map((p) => p.id),
        products,
        qualifiers,
        defaultExtra: config.idx.defaultExtra ?? 'any',
        variables: config.idx.variables,
        levels: config.idx.levels,
        components: config.idx.components,
        grid,
        ...(config.movingGrid ? { movingGrid: true as const } : {}),
        factors: levelFactors(nativeCellMetres(grid), config.levelTargetsKm),
        defaultField: config.defaultField.id,
        isobars: config.isobars && {
            fieldId: config.isobars.field.id,
            borrowFrom: config.isobars.borrowFrom && {
                dataset: config.isobars.borrowFrom.dataset as ModelId,
                roundMinutes: config.isobars.borrowFrom.roundMinutes,
            },
        },
    };
}

/** One field per distinct id, in first-appearance order, carrying the datasets that list it. */
export function compileFields(configs: readonly ModelDatasetConfig[]): ModelFieldDef[] {
    const byId = new Map<string, { field: ModelFieldConfig; models: ModelId[] }>();
    for (const config of configs) {
        for (const field of config.fields) {
            let entry = byId.get(field.id);
            if (!entry) byId.set(field.id, (entry = { field, models: [] }));
            entry.models.push(config.id as ModelId);
        }
    }
    return [...byId.values()].map(({ field, models }) => finishField(field, models));
}

function finishField(init: ModelFieldConfig, models: readonly ModelId[]): ModelFieldDef {
    const pane = MODEL_PANES.find((p) => p.id === init.pane)!;
    const shortLabel =
        init.shortLabel ??
        (pane.level && init.label.startsWith(`${pane.label} `)
            ? init.label.slice(pane.label.length + 1)
            : init.label);
    const legacyIds = init.legacyIds ?? [];
    return {
        recipe: 'single',
        quantity: 'other',
        ...init,
        models,
        shortLabel,
        legacyIds,
        overrides: init.overrides as ModelFieldDef['overrides'],
        searchTerms: [
            init.id,
            init.label,
            pane.label,
            ...models,
            'model',
            ...init.inputs.map((s) => s.variable),
            ...legacyIds,
        ].map((t) => t.toLowerCase()),
    };
}
