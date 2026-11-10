import { listS3Pages } from '@edgewarn/web-utils/net';
import { TtlMap } from './internal/ttl-map.ts';
import { MODEL_PROBE_ATTEMPTS, MODEL_PROBE_RETRY_MS, MODEL_RUN_LOOKBACK } from './limits.ts';
import type { ModelDataset, ModelFile } from './datasets.ts';
import { probeUrlFor } from './sources/probe.ts';

export const HOUR_MS = 3_600_000;

/** One model run as far as it has been published. */
export interface ModelRunInfo {
    /** Init (cycle) time, ms since epoch, on the hour. */
    initMs: number;
    /** The highest file index this cycle runs to (18 or 48 for HRRR, 84 for RRFS, 60 for REFS, 264 for NBM). */
    maxSteps: number;
    /**
     * The highest published file index plus one. 0 means the run is not out; maxSteps + 1 is complete.
     * A model whose steps thin out (NBM: hourly, then 3-hourly) has indices no step uses, so a step is
     * published when its file index is below this, whatever the indices before it.
     */
    published: number;
}

/**
 * What a probe learned: the object is there (`yes`), the host answered that it is not (`no`), or the host
 * could not be asked (`error`: a network or CORS failure, or repeated 5xx/429). A plain boolean stands for `yes`/`no`.
 */
export type ProbeResult = 'yes' | 'no' | 'error';

/**
 * Must not throw for a missing object. `listKeys`, when present, lists every key under `prefix` of the bucket at
 * `baseUrl` in one ListObjectsV2 call (paged), so a run's whole publication state costs one request instead of a
 * probe per step; it throws when the host will not list, and the probes are used instead.
 */
export type ModelProbe = ((url: string, signal?: AbortSignal) => Promise<ProbeResult | boolean>) & {
    listKeys?: (baseUrl: string, prefix: string, signal?: AbortSignal) => Promise<ReadonlySet<string>>;
    /** Run metadata, revalidated while it is being written. Null means not published. */
    text?: (url: string, signal?: AbortSignal) => Promise<string | null>;
};

/** The text of a listing error when the data host could not be asked; the viewer matches on it. */
export const HOST_UNREACHABLE = 'Data host unreachable';

/** The data host could not be reached, as opposed to answering that a run is not out yet. */
export class ModelHostError extends Error {
    readonly url: string;
    constructor(url: string) {
        super(HOST_UNREACHABLE);
        this.name = 'ModelHostError';
        this.url = url;
    }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export const floorHour = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS;
export function roundStep(ms: number, dataset: ModelDataset): number {
    const step = dataset.stepMinutes * 60_000;
    const snapped = Math.round(ms / step) * step;
    return dataset.hourBoundaryInHourly && snapped % HOUR_MS === 0 ? snapped - step : snapped;
}

/** Cycle hour of a run, 0-23. */
export const runCycle = (initMs: number): number => new Date(initMs).getUTCHours();

/** Object URL for one step of one file of a run. */
export function modelFileUrl(
    dataset: ModelDataset,
    initMs: number,
    file: ModelFile,
    step: number,
    member?: number,
): string {
    const d = new Date(initMs);
    const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    return dataset.url(date, d.getUTCHours(), file, step, member);
}

/**
 * The bucket answers cross-origin HEAD without an Access-Control-Allow-Origin header, so browsers
 * cannot read it. A one-byte ranged GET is allowed and costs the same.
 */
export function makeRangeProbe(
    options: {
        fetch?: typeof fetch;
        attempts?: number;
        retryMs?: number;
        sleep?: (ms: number) => Promise<void>;
    } = {},
): ModelProbe {
    const attempts = options.attempts ?? MODEL_PROBE_ATTEMPTS;
    const retryMs = options.retryMs ?? MODEL_PROBE_RETRY_MS;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const listKeys = async (baseUrl: string, prefix: string, signal?: AbortSignal) => {
        const keys = new Set<string>();
        // `cache: 'no-store'` as for the probes: a run's listing changes every few minutes while it publishes.
        const fetcher: typeof fetch = (input, init) =>
            (options.fetch ?? fetch)(input, { ...init, cache: 'no-store' });
        await listS3Pages(baseUrl, { prefix }, { fetcher, signal, label: 'Model run' }, (page) => {
            for (const object of page.objects) keys.add(object.key);
        });
        return keys;
    };
    const text = async (url: string, signal?: AbortSignal): Promise<string | null> => {
        let res: Response;
        try {
            res = await (options.fetch ?? fetch)(url, { signal, cache: 'no-store' });
        } catch (error) {
            if ((error as Error)?.name === 'AbortError') throw error;
            throw new ModelHostError(url);
        }
        if (res.status === 404 || res.status === 403) {
            void res.body?.cancel();
            return null;
        }
        if (!res.ok) {
            void res.body?.cancel();
            throw new ModelHostError(url);
        }
        return res.text();
    };
    return Object.assign(
        async (url: string, signal?: AbortSignal): Promise<ProbeResult> => {
            for (let attempt = 1; ; attempt++) {
                let res: Response;
                try {
                    res = await (options.fetch ?? fetch)(url, {
                        headers: { Range: 'bytes=0-0' },
                        signal,
                        cache: 'no-store',
                    });
                } catch (error) {
                    if ((error as Error)?.name === 'AbortError') throw error;
                    // A network or CORS failure says nothing about the run: the host could not be asked.
                    return 'error';
                }
                void res.body?.cancel();
                if (res.ok) return 'yes';
                const busy = res.status >= 500 || res.status === 429;
                if (!busy) return 'no';
                if (attempt >= attempts) return 'error';
                await sleep(retryMs * attempt);
            }
        },
        { listKeys, text },
    );
}

export const rangeProbe: ModelProbe = makeRangeProbe();

/** Probe an object; an unreachable host throws `ModelHostError` instead of reading as "not published". */
async function published(probe: ModelProbe, url: string, signal?: AbortSignal): Promise<boolean> {
    const result = await probe(url, signal);
    if (result === 'error') throw new ModelHostError(url);
    return result === true || result === 'yes';
}

/**
 * Count the published steps of a run: the highest published file index plus one. Files are published
 * in order, so a binary search over the run's file indices (all of them, or only the ones the run
 * has, for a model whose steps thin out) finds the last one in a handful of probes.
 */
export async function countPublishedSteps(
    dataset: ModelDataset,
    initMs: number,
    probe: ModelProbe,
    signal?: AbortSignal,
    knownAtLeast = 0,
): Promise<number> {
    const indices = dataset.fileIndices(runCycle(initMs));
    if (dataset.source.kind === 'om' && probe.text) {
        const manifest = dataset.source.manifest;
        const times = await Promise.all(
            dataset.files.map(async (file) => {
                const object = modelFileUrl(dataset, initMs, file, indices[0]);
                const url = new URL(manifest, object).href;
                const body = await probe.text!(url, signal);
                if (body === null) return new Set<number>();
                const meta = JSON.parse(body) as { reference_time?: string; valid_times?: unknown };
                if (
                    Date.parse(meta.reference_time ?? '') !== initMs ||
                    !Array.isArray(meta.valid_times) ||
                    !meta.valid_times.every((t) => typeof t === 'string' && Number.isFinite(Date.parse(t)))
                ) {
                    throw new Error(`Invalid forecast run manifest: ${url}`);
                }
                return new Set(meta.valid_times.map((t) => Date.parse(t)));
            }),
        );
        const gap = indices.findIndex((index) => !times.every((set) => set.has(initMs + index * HOUR_MS)));
        return gap === 0 || !indices.length ? 0 : indices[(gap < 0 ? indices.length : gap) - 1] + 1;
    }
    // A NetCDF run holds a file per variable per step (thousands of keys under one prefix): a few probes are cheaper than listing it.
    if (probe.listKeys && indices.length && dataset.source.kind !== 'netcdf') {
        try {
            return await countListedSteps(dataset, initMs, indices, probe.listKeys, signal);
        } catch (error) {
            if ((error as Error)?.name === 'AbortError') throw error;
            // The host would not list (no ListBucket, no CORS on it, a 5xx): fall back to probing.
        }
    }
    // A step is out only when every file the fields read is out.
    const exists = async (index: number) => {
        for (const file of dataset.files) {
            if (
                !(await published(
                    probe,
                    probeUrlFor(dataset, modelFileUrl(dataset, initMs, file, index)),
                    signal,
                ))
            )
                return false;
        }
        return true;
    };
    // Position in `indices` of the highest one known to exist (-1: none).
    let lo = -1;
    for (let k = 0; k < indices.length && indices[k] < knownAtLeast; k++) lo = k;
    if (lo < 0) {
        if (!indices.length || !(await exists(indices[0]))) return 0;
        lo = 0;
    }
    let hi = indices.length; // lowest position known to be missing
    while (hi - lo > 1) {
        const mid = (lo + hi) >>> 1;
        if (await exists(indices[mid])) lo = mid;
        else hi = mid;
    }
    return indices[lo] + 1;
}

/**
 * `countPublishedSteps` from bucket listings: one listing per file of the run, under the longest key prefix its
 * steps' probe objects share, then the last index of the unbroken run of steps whose probe object exists in every file.
 */
async function countListedSteps(
    dataset: ModelDataset,
    initMs: number,
    indices: readonly number[],
    listKeys: NonNullable<ModelProbe['listKeys']>,
    signal?: AbortSignal,
): Promise<number> {
    const perFile = await Promise.all(
        dataset.files.map(async (file) => {
            const urls = indices.map(
                (index) => new URL(probeUrlFor(dataset, modelFileUrl(dataset, initMs, file, index))),
            );
            const keys = urls.map((url) => decodeURIComponent(url.pathname.slice(1)));
            let prefix = keys[0];
            for (const key of keys) while (!key.startsWith(prefix)) prefix = prefix.slice(0, -1);
            const listed = await listKeys(urls[0].origin, prefix, signal);
            return keys.map((key) => listed.has(key));
        }),
    );
    // Steps finish out of order (HRRR's prs f10 can land before f09), so only the unbroken run from the first step counts.
    const gap = indices.findIndex((_, k) => !perFile.every((found) => found[k]));
    if (gap === 0) return 0;
    return indices[(gap < 0 ? indices.length : gap) - 1] + 1;
}

/** Init time of the newest cycle of `dataset` strictly before `ms`, or `ms` itself when none is found in a day. */
function cycleBefore(ms: number, dataset: ModelDataset): number {
    for (let k = 1; k <= 24; k++) {
        const t = floorHour(ms - 1) - (k - 1) * HOUR_MS;
        if (dataset.cycleHours.includes(runCycle(t))) return t;
    }
    return ms;
}

/** The newest run whose first step is out in every file, searching back from the current hour through the cycles the model runs. */
export async function findNewestRun(
    nowMs: number,
    probe: ModelProbe,
    signal: AbortSignal | undefined,
    dataset: ModelDataset,
    lookback = MODEL_RUN_LOOKBACK,
): Promise<ModelRunInfo | null> {
    for (let k = 0; k <= lookback; k++) {
        const initMs = floorHour(nowMs) - k * HOUR_MS;
        if (!dataset.cycleHours.includes(runCycle(initMs))) continue;
        const published = await countPublishedSteps(dataset, initMs, probe, signal);
        if (published > 0) return { initMs, maxSteps: dataset.runSteps(runCycle(initMs)), published };
    }
    return null;
}

/** The newest run and the `count - 1` cycles of the model before it, each with how far it has been published. */
export async function listRecentRuns(
    newest: ModelRunInfo,
    count: number,
    probe: ModelProbe,
    signal: AbortSignal | undefined,
    dataset: ModelDataset,
): Promise<ModelRunInfo[]> {
    const inits: number[] = [];
    for (let k = 1, at = newest.initMs; k < count; k++) {
        at = cycleBefore(at, dataset);
        inits.push(at);
    }
    const older = await Promise.all(
        inits.map(async (initMs) => ({
            initMs,
            maxSteps: dataset.runSteps(runCycle(initMs)),
            published: await countPublishedSteps(dataset, initMs, probe, signal),
        })),
    );
    return [newest, ...older];
}

export interface ModelStepSource {
    initMs: number;
    /** Minutes since the cycle. The `.idx` label and the file index both come off this. */
    minutes: number;
}

export interface ChooseStepContext {
    /** Current wall-clock time. Frames at or before it are observed; later ones are forecast. */
    nowMs: number;
    /** Newest run with its first step out. */
    newest: ModelRunInfo;
    /** Run that drives forecast frames: the newest one, or a pinned older cycle. */
    selected: ModelRunInfo;
    /** The field needs a forecast window, which the earliest step does not carry. */
    forecastOnly: boolean;
    /** The field being drawn: a step the field does not have (its cadence is thinner than the run's) resolves to nothing. */
    fieldId?: string | null;
}

/** The index a run's `published` count is measured in: a forecast hour, or a sub-hourly file index. */
export function stepIndexOf(dataset: ModelDataset, minutes: number): number {
    return dataset.fileIndexOf(minutes);
}

/**
 * The newest cycle of `dataset` at or before `ms`. A field with a forecast window needs the previous
 * run's first windowed step, and "the previous run" is not simply an hour earlier: REFS runs every
 * six hours, so for a frame at 12:10 the covering window is the 06z run's f01.
 */
function previousCycleMs(ms: number, dataset: ModelDataset): number {
    const target = floorHour(ms);
    for (let k = 0; k < 24; k++) {
        const t = target - k * HOUR_MS;
        if (dataset.cycleHours.includes(new Date(t).getUTCHours())) return t;
    }
    return target;
}

const stepSets = new WeakMap<ModelDataset, TtlMap<string, ReadonlySet<number>>>();
/** The valid times of a run (or of one field in it) as a set. */
function stepSet(
    dataset: ModelDataset,
    cycle: number,
    fieldId: string | null | undefined,
): ReadonlySet<number> {
    let byKey = stepSets.get(dataset);
    if (!byKey) stepSets.set(dataset, (byKey = new TtlMap()));
    const key = `${cycle}|${fieldId ?? ''}`;
    let set = byKey.get(key);
    if (!set) byKey.set(key, (set = new Set(dataset.fieldSteps(fieldId, cycle) ?? dataset.stepsFor(cycle))));
    return set;
}

/**
 * The valid times the timeline offers while these fields are on: the union of each field's own steps.
 * A field with no thinner cadence of its own has every step of the run, and so does a layer with no
 * field (null), so any of those makes it the whole run (returned as null). Ascending, minutes since the cycle.
 */
export function activeStepList(
    dataset: ModelDataset,
    cycle: number,
    fieldIds: ReadonlyArray<string | null | undefined>,
): readonly number[] | null {
    if (fieldIds.length === 0) return null;
    const union = new Set<number>();
    for (const id of fieldIds) {
        const own = dataset.fieldSteps(id, cycle);
        if (!own) return null;
        for (const m of own) union.add(m);
    }
    return [...union].sort((a, b) => a - b);
}

/**
 * Which run and valid time show a frame, in minutes since that run's cycle.
 *
 * Observed frames use the analysis of the run for that time, or the previous run's first windowed
 * step when the field needs a forecast window. Times after the newest run use its forecast, as do
 * future frames, which follow the selected run. A forecast time that is not one of the run's steps
 * (or of the field's, when it is thinner) is not snapped to a neighbour: the timeline lays its slots
 * from the same list, so such a time has no slot. Returns null when the step is not published yet.
 */
export function chooseModelStep(
    validMs: number,
    ctx: ChooseStepContext,
    dataset: ModelDataset,
): ModelStepSource | null {
    const time = roundStep(validMs, dataset);
    // The earliest step a field may use. REFS and the RRFS sub-hourly files publish no analysis, and
    // a windowed field needs one step past whatever the dataset's first step is.
    const firstMinutes = (ctx.forecastOnly ? dataset.minStep + 1 : dataset.minStep) * 60;
    /** The previous cycle's first usable step: what an observed frame falls back to. */
    const fallback = (): ModelStepSource => {
        const initMs = previousCycleMs(time - firstMinutes * 60_000, dataset);
        return { initMs, minutes: firstMinutes };
    };
    const from = (run: ModelRunInfo): ModelStepSource | null => {
        const minutes = Math.round((time - run.initMs) / 60_000);
        if (minutes < firstMinutes) return fallback();
        if (!stepSet(dataset, runCycle(run.initMs), ctx.fieldId).has(minutes)) return null;
        const index = stepIndexOf(dataset, minutes);
        if (index > run.maxSteps || index >= run.published) return null;
        return { initMs: run.initMs, minutes };
    };
    if (validMs <= ctx.nowMs) {
        if (time <= ctx.newest.initMs) return fallback();
        // The newest run has not published this time yet (e.g. :42 rounds forward): the previous
        // run's first forecast step covers it.
        return from(ctx.newest) ?? fallback();
    }
    return from(ctx.selected);
}
