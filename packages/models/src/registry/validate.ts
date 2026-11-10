import type {
    ModelDatasetConfig,
    ModelFieldConfig,
    ModelSelector,
    ModelSource,
    ModelSurface,
} from '../configs/types.ts';
import { APPROVED_DATA_ORIGINS, OPEN_METEO_BUCKET } from '../configs/shared.ts';
import { diagnosticInputCount } from '../diagnosticRecipes.ts';
import { RECIPE_ROLES } from '../recipes.ts';
import { expandSteps, levelFactors, runEntryFor } from './compile.ts';

/**
 * Rules the types cannot express, checked over a list of configs. Used by tests (never at runtime:
 * a bad config fails CI, not the map). Each problem is one sentence naming the model and the thing.
 */
interface ValidateOptions {
    /** Names in `public/colormaps.json`; colormap names are not checked without it. */
    colormaps?: ReadonlySet<string>;
    /** The hosts a dataset may read from; defaults to `APPROVED_DATA_ORIGINS`. Only the profile host check reads it, so a test can withdraw one. */
    origins?: readonly string[];
}

const ID = /^[a-z0-9-]+$/;
const ALIAS_KEY = /^[^|\s][^|]*\|.+$/;
/** An Open-Meteo model or variable name (`temperature_850hPa`): it becomes a path segment. */
const SERIES_NAME = /^[A-Za-z0-9_]+$/;
const SURFACES: readonly ModelSurface[] = ['map', 'viewer'];

/** `YYYY-MM-DD`, a real calendar day, no later than today (UTC). */
function isPastDate(text: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const ms = Date.parse(`${text}T00:00:00Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(text) && ms <= Date.now();
}
const SAMPLE_DATE = '20261012';
const SAMPLE_CYCLES = [0, 6, 12, 18];
const SAMPLE_STEPS = [0, 1, 2, 12];

const allSelectors = (field: ModelFieldConfig): ModelSelector[] => [
    ...field.inputs,
    ...Object.values(field.overrides ?? {}).flatMap((o) => o.inputs),
];

export function validateConfigs(
    configs: readonly ModelDatasetConfig[],
    options: ValidateOptions = {},
): string[] {
    const problems: string[] = [];
    const bad = (config: { id: string }, message: string) => problems.push(`${config.id}: ${message}`);
    const ids = new Set<string>();
    for (const c of configs) {
        if (!ID.test(c.id)) bad(c, `id must match [a-z0-9-]+`);
        if (ids.has(c.id)) bad(c, 'id is used by another model');
        ids.add(c.id);
    }

    // The same field id in two models must be the same definition: one id, one meaning.
    const byId = new Map<string, ModelFieldConfig>();
    const legacy = new Map<string, string>();
    for (const c of configs) {
        for (const f of c.fields) {
            const seen = byId.get(f.id);
            if (seen && seen !== f && JSON.stringify(seen) !== JSON.stringify(f))
                bad(c, `field ${f.id} is defined differently in another model`);
            if (!seen) {
                byId.set(f.id, f);
                for (const l of f.legacyIds ?? []) {
                    const owner = legacy.get(l.toLowerCase());
                    if (owner && owner !== f.id) bad(c, `legacy id "${l}" belongs to ${owner} and ${f.id}`);
                    legacy.set(l.toLowerCase(), f.id);
                }
            }
        }
    }

    for (const c of configs) {
        const objectKeys = Object.keys(c.objects);
        const served = new Set<ModelSource>(objectKeys.flatMap((k) => c.objects[k].serves));
        const fieldIds = new Set(c.fields.map((f) => f.id));
        if (new Set(c.fields.map((f) => f.id)).size !== c.fields.length) bad(c, 'a field is listed twice');

        // URLs
        for (const key of objectKeys) {
            const seen = new Set<string>();
            for (const product of c.products) {
                for (const cycle of SAMPLE_CYCLES) {
                    for (const step of SAMPLE_STEPS) {
                        const path = c.objects[key].url({
                            date: SAMPLE_DATE,
                            cycle,
                            step,
                            product: product.id,
                        });
                        const url = `${c.bucket}/${path}`;
                        if (!url.startsWith('https://')) bad(c, `object ${key}: ${url} is not https`);
                        if (path.includes('..') || /undefined|NaN/.test(path))
                            bad(c, `object ${key}: ${path} looks malformed`);
                        if (cycle === 0 && product.id === c.products[0].id) seen.add(path);
                    }
                }
            }
            if (seen.size !== SAMPLE_STEPS.length)
                bad(c, `object ${key} gives the same path for different steps`);
        }
        if (!/^https:\/\/[^/]+$/.test(c.bucket)) bad(c, 'bucket must be an https origin without a path');
        // A computed product reads the member object and is told apart by what the worker derives, not by an object.
        // Normalized spread reads the same published spread object as `sprd`; it differs by using
        // that field as the numerator in a historical climatology, not as a separate source product.
        const filed = c.products.filter((p) => !p.computed && p.id !== 'nsprd');
        if (
            filed.length > 1 &&
            new Set(
                filed.map(
                    (p) =>
                        `${c.objects[p.object ?? '']?.url({ date: SAMPLE_DATE, cycle: 0, step: 1, product: p.id })}|${p.extra ?? ''}`,
                ),
            ).size !== filed.length
        ) {
            bad(c, 'products must read different objects or carry different extras');
        }
        for (const g of c.gate) if (!c.objects[g]) bad(c, `gate names unknown object ${g}`);
        if (!c.gate.length) bad(c, 'gate is empty, so no step could ever count as published');
        if (new Set(c.products.map((p) => p.id)).size !== c.products.length) bad(c, 'product ids repeat');
        for (const p of c.products)
            if (p.object !== undefined && !c.objects[p.object])
                bad(c, `product ${p.id} names unknown object ${p.object}`);
        for (const p of c.products) {
            for (const field of p.fields ?? [])
                if (!fieldIds.has(field)) bad(c, `product ${p.id} names unknown field ${field}`);
            for (const cycle of p.cycles ?? [])
                if (!c.cycles.includes(cycle)) bad(c, `product ${p.id} names unknown cycle ${cycle}`);
        }

        // Provenance, access and where the model is offered
        if (!c.about.provider.trim()) bad(c, 'about.provider is empty');
        if (c.about.category === 'ai' && !c.about.attribution?.trim())
            bad(c, 'an AI model needs about.attribution');
        if (c.ensemble) {
            const e = c.ensemble;
            if (!Number.isInteger(e.perturbed) || e.perturbed < 1)
                bad(c, 'ensemble.perturbed must be a positive integer');
            if (e.addressing === 'file') {
                const sample = (m: number) =>
                    Object.values(c.objects)
                        .map((o) =>
                            o.url({
                                date: SAMPLE_DATE,
                                cycle: 0,
                                step: 1,
                                product: c.products[0].id,
                                member: m,
                            }),
                        )
                        .join('|');
                if (sample(0) === sample(1) || sample(1) === sample(e.perturbed))
                    bad(c, 'ensemble.addressing "file" needs an object url that changes with the member');
            }
            if (
                e.addressing === 'index' &&
                (c.source?.kind !== 'grib2-index' || c.source.dialect !== 'ecmwf')
            )
                bad(c, 'ensemble.addressing "index" needs the ecmwf dialect');
            if (e.stats === 'files') {
                for (const id of ['mean', 'sprd'] as const) {
                    if (!c.products.some((p) => p.id === id && p.object))
                        bad(c, `ensemble.stats "files" needs a ${id} product with an object`);
                }
            }
        }
        if ((c.about.provider !== 'NOAA' || c.about.derivedFrom) && !c.about.attribution?.trim())
            bad(c, 'about.attribution is required when the provider is not NOAA or the data is derived');
        if (!isPastDate(c.access.corsVerifiedOn))
            bad(c, `access.corsVerifiedOn "${c.access.corsVerifiedOn}" is not a YYYY-MM-DD date in the past`);
        if (!APPROVED_DATA_ORIGINS.includes(c.bucket))
            bad(c, `bucket ${c.bucket} is not in APPROVED_DATA_ORIGINS (src/configs/shared.ts)`);
        if (!c.surfaces.length) bad(c, 'surfaces is empty, so the model is offered nowhere');
        for (const s of c.surfaces) if (!SURFACES.includes(s)) bad(c, `surfaces names unknown page "${s}"`);
        if (new Set(c.surfaces).size !== c.surfaces.length) bad(c, 'surfaces repeats a page');
        if (c.source?.kind === 'om' && !c.source.manifest.trim())
            bad(c, 'an om source needs a manifest path');
        for (const [key, alias] of Object.entries(c.idx.components ?? {})) {
            if (!ALIAS_KEY.test(key)) bad(c, `component alias "${key}" must look like VARIABLE|level`);
            if (!alias.variable) bad(c, `component alias "${key}" names no variable`);
        }

        // Grid
        const g = c.grid;
        const cellMetres = g.projection === 'latlon' ? ((g.dlon * Math.PI) / 180) * g.radiusM : g.dx;
        if (g.projection === 'lambert') {
            if (![g.nx, g.ny, g.dx, g.dy].every((v) => Number.isFinite(v) && v > 0))
                bad(c, 'grid nx, ny, dx, dy must be positive numbers');
            if (
                Math.abs(g.lat1) > 90 ||
                g.lon1 < 0 ||
                g.lon1 > 360 ||
                g.lov < 0 ||
                g.lov > 360 ||
                Math.abs(g.latin1) > 90 ||
                Math.abs(g.latin2) > 90
            )
                bad(c, 'grid angles are out of range');
        } else if (g.projection === 'polarStereo' || g.projection === 'mercator') {
            if (![g.nx, g.ny, g.dx, g.dy].every((v) => Number.isFinite(v) && v > 0))
                bad(c, 'grid nx, ny, dx, dy must be positive numbers');
            if (Math.abs(g.lat1) > 90 || g.lon1 < 0 || g.lon1 >= 360 || Math.abs(g.latD) > 90)
                bad(c, 'grid angles are out of range');
            if (g.projection === 'polarStereo' && (g.lov < 0 || g.lov >= 360))
                bad(c, 'grid angles are out of range');
        } else {
            if (![g.nx, g.ny, g.dlat, g.dlon].every((v) => Number.isFinite(v) && v > 0))
                bad(c, 'grid nx, ny, dlat, dlon must be positive numbers');
            const lastLat = g.lat1 + (g.scanMode === 0x00 ? -1 : 1) * (g.ny - 1) * g.dlat;
            if (Math.abs(g.lat1) > 90 || Math.abs(lastLat) > 90 + 1e-9 || g.lon1 < 0 || g.lon1 >= 360)
                bad(c, 'grid latitudes or first longitude are out of range');
            if (g.nx * g.dlon > 360 + g.dlon) bad(c, 'grid columns wrap past a full circle');
            if (g.scanMode !== 0x00 && g.scanMode !== 0x40)
                bad(c, `lat/lon grid scanMode 0x${(g.scanMode as number).toString(16)} is not 0x00 or 0x40`);
        }
        if (
            g.projection === 'latlon' &&
            g.rotation &&
            (!Number.isFinite(g.rotation.southPoleLat) ||
                Math.abs(g.rotation.southPoleLat) > 90 ||
                !Number.isFinite(g.rotation.southPoleLon) ||
                g.rotation.southPoleLon < 0 ||
                g.rotation.southPoleLon >= 360)
        )
            bad(c, 'rotated grid pole is out of range');
        if (!(g.radiusM > 6e6 && g.radiusM < 7e6)) bad(c, 'grid radiusM is not an earth radius');
        if (c.movingGrid) {
            if (g.projection !== 'latlon') bad(c, 'movingGrid is only supported on a lat/lon grid');
            else if (Math.abs(g.nx * g.dlon - 360) < g.dlon)
                bad(c, 'movingGrid cannot be a grid that closes around the globe');
        }
        const factors = levelFactors(cellMetres, c.levelTargetsKm);
        if (factors[0] !== 1 || !(factors[0] < factors[1] && factors[1] < factors[2]))
            bad(c, `levelTargetsKm give factors ${factors.join(',')}; they must start at 1 and rise`);

        // Time
        const t = c.time;
        if (t.idxUnit === 'minute' && t.stepMinutes >= 60)
            bad(c, 'a model whose .idx labels minutes steps in less than an hour');
        if (t.stepMinutes < 60 && t.fileIndex.kind !== 'hourly-file')
            bad(c, 'a sub-hourly model must address its files by hourly file index');
        for (const cycle of c.cycles) {
            try {
                runEntryFor(c, cycle);
            } catch {
                bad(c, `no run shape covers cycle ${cycle}`);
            }
        }
        for (const r of c.runs) {
            for (const cycle of r.cycles ?? [])
                if (!c.cycles.includes(cycle))
                    bad(c, `a run shape names cycle ${cycle}, which the model does not run`);
            const steps = expandSteps(r.steps);
            if (!steps.length) bad(c, 'a run shape has no steps');
            if (steps.some((s, i) => i > 0 && s <= steps[i - 1]))
                bad(c, 'run steps must ascend without repeating');
            for (const range of r.steps)
                if (range.every % t.stepMinutes !== 0 || range.from % t.stepMinutes !== 0)
                    bad(c, `run range ${JSON.stringify(range)} is off the ${t.stepMinutes}-minute grid`);
            const first = steps[0];
            const index =
                t.fileIndex.kind === 'forecast-hour'
                    ? first / 60
                    : first <= 0
                      ? 0
                      : t.fileIndex.boundary === 'exclusive'
                        ? Math.floor(first / 60) + 1
                        : Math.ceil(first / 60);
            if (index !== t.firstStep)
                bad(c, `firstStep is ${t.firstStep} but the first step ${first} min is in file ${index}`);
        }

        // Fields
        if (!fieldIds.has(c.defaultField.id)) bad(c, `defaultField ${c.defaultField.id} is not in fields`);
        if (
            c.defaultField.overlay ||
            (c.defaultField.product !== undefined && c.defaultField.product !== c.products[0].id)
        ) {
            bad(c, `defaultField ${c.defaultField.id} must be a plain field of the default product`);
        }
        for (const f of c.fields) {
            if (f.product !== undefined && !c.products.some((p) => p.id === f.product))
                bad(c, `${f.id} belongs to product ${f.product}, which the model lacks`);
            for (const s of allSelectors(f)) {
                if (!served.has(s.file))
                    bad(c, `${f.id} reads a ${s.file} object, which the model has none of`);
                if (
                    s.windowMinutes !== undefined &&
                    !(s.windowMinutes > 0 && s.windowMinutes % c.time.stepMinutes === 0)
                ) {
                    bad(
                        c,
                        `${f.id}: windowMinutes ${s.windowMinutes} must be a positive multiple of the ${c.time.stepMinutes}-minute step`,
                    );
                }
            }
            const roles = RECIPE_ROLES[f.recipe ?? 'single'];
            if (roles === undefined) bad(c, `${f.id} uses unknown recipe ${f.recipe}`);
            else if (roles && f.inputs.length !== roles.length)
                bad(
                    c,
                    `${f.id}: recipe ${f.recipe ?? 'single'} takes ${roles.length} inputs (${roles.join(', ')}), got ${f.inputs.length}`,
                );
            if (f.recipe === 'frontogenesis' && !((f.recipeParams?.levelHpa ?? 0) > 0))
                bad(c, `${f.id}: recipe frontogenesis needs recipeParams.levelHpa`);
            const counted = f.recipe ? diagnosticInputCount(f.recipe, f.recipeParams) : null;
            if (counted === -1)
                bad(
                    c,
                    `${f.id}: recipe ${f.recipe} needs recipeParams.levelsHpa${f.recipe === 'isentropic' ? ' and an output (pressure, humidity or speed)' : ''}`,
                );
            else if (counted !== null && f.inputs.length !== counted)
                bad(
                    c,
                    `${f.id}: recipe ${f.recipe} takes ${counted} inputs for its levels, got ${f.inputs.length}`,
                );
            if (f.recipe === 'potential-vorticity' && f.recipeParams?.levelsHpa?.length !== 3)
                bad(c, `${f.id}: recipe potential-vorticity needs three recipeParams.levelsHpa`);
            if (
                f.recipe === 'q-vector' &&
                !(
                    (f.recipeParams?.levelHpa ?? 0) > 0 &&
                    ['magnitude', 'convergence'].includes(f.recipeParams?.output ?? '')
                )
            )
                bad(
                    c,
                    `${f.id}: recipe q-vector needs recipeParams.levelHpa and an output (magnitude or convergence)`,
                );
            if (
                f.recipe === 'storm-relative' &&
                !f.recipeParams?.levelsHpa?.includes(f.recipeParams.targetHpa ?? 0)
            )
                bad(c, `${f.id}: recipe storm-relative needs recipeParams.targetHpa among its levelsHpa`);
            if (f.recipe === 'isentropic' && !((f.recipeParams?.thetaK ?? 0) > 0))
                bad(c, `${f.id}: recipe isentropic needs recipeParams.thetaK`);
            for (const [model, o] of Object.entries(f.overrides ?? {})) {
                if (!ids.has(model)) bad(c, `${f.id} overrides unknown model ${model}`);
                const r = RECIPE_ROLES[o.recipe ?? f.recipe ?? 'single'];
                if (r && o.inputs.length !== r.length)
                    bad(
                        c,
                        `${f.id}: the ${model} override has ${o.inputs.length} inputs for recipe ${o.recipe ?? f.recipe}`,
                    );
            }
            if (options.colormaps && !options.colormaps.has(f.colormap.name))
                bad(c, `${f.id} names colormap ${f.colormap.name}, which public/colormaps.json lacks`);
        }
        for (const f of c.notOffered ?? [])
            if (fieldIds.has(f.id)) bad(c, `${f.id} is both offered and listed as not offered`);

        // Point series
        const series = c.pointSeries;
        if (series) {
            if (!APPROVED_DATA_ORIGINS.includes(series.bucket))
                bad(c, `pointSeries bucket ${series.bucket} is not in APPROVED_DATA_ORIGINS`);
            if (!SERIES_NAME.test(series.model))
                bad(c, `pointSeries model "${series.model}" must be letters, digits and underscores`);
            if (!isPastDate(series.verifiedOn))
                bad(c, `pointSeries verifiedOn "${series.verifiedOn}" is not a YYYY-MM-DD date in the past`);
            if (!series.cycles.length && !series.spatial)
                bad(c, 'pointSeries keeps no cycle in either layout');
            for (const cycle of series.cycles)
                if (!c.cycles.includes(cycle))
                    bad(c, `pointSeries names cycle ${cycle}, which the model does not run`);
            for (const [id, f] of Object.entries(series.fields)) {
                const field = c.fields.find((x) => x.id === id);
                if (!field) {
                    bad(c, `pointSeries maps unknown field ${id}`);
                    continue;
                }
                if (field.overlay) bad(c, `pointSeries maps ${id}, an overlay the meteogram never shows`);
                const vector = (f.recipe ?? 'single') === 'vector';
                if (vector !== (field.kind === 'vector'))
                    bad(
                        c,
                        `pointSeries ${id}: recipe ${f.recipe ?? 'single'} does not fit a ${field.kind} field`,
                    );
                if (f.variables.length !== (vector ? 2 : 1))
                    bad(c, `pointSeries ${id} needs ${vector ? 2 : 1} variables, got ${f.variables.length}`);
                if (f.frame && !vector) bad(c, `pointSeries ${id}: only a vector has a frame`);
                for (const v of f.variables)
                    if (!SERIES_NAME.test(v))
                        bad(c, `pointSeries ${id}: variable "${v}" must be letters, digits and underscores`);
            }
        }

        // Isobars
        if (c.isobars) {
            const { field, borrowFrom } = c.isobars;
            if (!field.overlay) bad(c, `isobars field ${field.id} must be an overlay field`);
            if (borrowFrom) {
                const lender = configs.find((o) => o.id === borrowFrom.dataset);
                if (!lender) bad(c, `isobars borrow from unknown model ${borrowFrom.dataset}`);
                else if (!lender.fields.some((f) => f.id === field.id))
                    bad(c, `${lender.id} does not list ${field.id}, so ${c.id} cannot borrow it`);
                if (fieldIds.has(field.id)) bad(c, `${field.id} is listed, so there is nothing to borrow`);
            } else if (!fieldIds.has(field.id)) bad(c, `isobars field ${field.id} is not in fields`);
        }

        // Profiles
        const profiles = c.profiles;
        if (profiles) {
            const { borrowFrom, levels, sectionLevels, column, native } = profiles;
            const ordered = (list: readonly number[]) =>
                list.every((p, i) => Number.isFinite(p) && p > 0 && (i === 0 || p < list[i - 1]));
            if (borrowFrom) {
                if (levels || sectionLevels || column || native)
                    bad(c, 'profiles borrowFrom cannot be combined with other profile keys');
                const lender = configs.find((o) => o.id === borrowFrom.dataset);
                if (!lender) bad(c, `profiles borrow from unknown model ${borrowFrom.dataset}`);
                else if (!lender.profiles || lender.profiles.borrowFrom)
                    bad(c, `${lender.id} has no profiles of its own, so ${c.id} cannot borrow them`);
                if (!(borrowFrom.roundMinutes > 0))
                    bad(c, 'profiles borrowFrom roundMinutes must be positive');
            }
            if (levels && (!levels.length || !ordered(levels)))
                bad(c, 'profiles levels must be positive and strictly descending');
            if (sectionLevels && !levels) bad(c, 'profiles sectionLevels needs levels');
            else if (sectionLevels) {
                if (!ordered(sectionLevels))
                    bad(c, 'profiles sectionLevels must be positive and strictly descending');
                for (const p of sectionLevels)
                    if (!levels?.includes(p))
                        bad(c, `profiles sectionLevels has ${p} hPa, which levels lacks`);
            }
            if (column) {
                if (!levels) bad(c, 'profiles column needs levels');
                if (!SERIES_NAME.test(column.model) || column.model !== column.model.toLowerCase())
                    bad(
                        c,
                        `profiles column model "${column.model}" must be lower-case letters, digits and underscores`,
                    );
                if (!(options.origins ?? APPROVED_DATA_ORIGINS).includes(OPEN_METEO_BUCKET))
                    bad(
                        c,
                        `profiles column reads ${OPEN_METEO_BUCKET}, which is not in APPROVED_DATA_ORIGINS`,
                    );
                if (column.levels) {
                    if (!ordered(column.levels))
                        bad(c, 'profiles column levels must be positive and strictly descending');
                    for (const p of column.levels)
                        if (!levels?.includes(p))
                            bad(c, `profiles column levels has ${p} hPa, which levels lacks`);
                }
            }
            if (native) {
                if (!levels) bad(c, 'profiles native needs levels');
                if (!Object.values(c.objects).some((o) => o.serves.includes(native.file)))
                    bad(c, `profiles native reads the ${native.file} object, which no object serves`);
                if (!native.surface.length) bad(c, 'profiles native lists no surface components');
                for (const s of native.surface)
                    if (!Object.values(c.objects).some((o) => o.serves.includes(s.file)))
                        bad(
                            c,
                            `profiles native surface ${s.variable}:${s.level} reads the ${s.file} object, which no object serves`,
                        );
            }
        }

        // Per-field cadence
        for (const [id, ranges] of Object.entries(c.fieldSteps ?? {})) {
            if (!fieldIds.has(id)) {
                bad(c, `fieldSteps names unknown field ${id}`);
                continue;
            }
            const own = new Set(c.runs.flatMap((r) => expandSteps(r.steps)));
            for (const step of expandSteps(ranges ?? []))
                if (!own.has(step)) bad(c, `fieldSteps ${id} has step ${step} min, which no run holds`);
        }
    }
    return problems;
}
