import { TtlMap } from '../internal/ttl-map.ts';
import { ModelCancelled, ModelHttpError } from './errors.ts';

/** One byte range of one object. `end` is inclusive; null reads to the end of the object. */
export interface ModelRange {
    url: string;
    start: number;
    end: number | null;
}

interface RangeConsumer {
    check: () => void;
    onProgress?: (done: number, total: number) => void;
}
interface PendingRead {
    consumers: Set<RangeConsumer>;
    promise: Promise<{ bytes: Uint8Array[]; fetched: number }>;
    done: number;
    total: number;
    charged: boolean;
}

/** What the fetcher needs of a message cache: `ModelMessageCache` satisfies it, and so does a Map-backed fake. */
export interface ModelByteCache {
    get(key: string): Promise<Uint8Array | null>;
    put(key: string, bytes: Uint8Array): Promise<void>;
}

interface ModelFetcherOptions {
    cache: ModelByteCache;
    fetch?: typeof fetch;
    /** Small text objects (`.idx` inventories, manifests) kept as promises, newest last. */
    textEntries?: number;
    /** Requests in flight at once. */
    concurrency?: number;
}

/**
 * The network half every source adapter shares: a concurrency limit, the memory/Cache Storage message cache
 * and the merging of byte-adjacent ranges into one request. Adapters say which ranges they need; this reads
 * them. Runs in the worker (or in Node for tests and tools).
 */
export class ModelFetcher {
    opts: ModelFetcherOptions;
    stats = { bytesFetched: 0, requests: 0 };
    private active = 0;
    private waiters: Array<() => void> = [];
    private texts = new TtlMap<string, Promise<string>>();
    private reads = new Map<string, PendingRead>();

    constructor(options: ModelFetcherOptions) {
        this.opts = options;
    }

    private get fetchImpl(): typeof fetch {
        return this.opts.fetch ?? ((input, init) => fetch(input, init));
    }

    async slot<T>(fn: () => Promise<T>): Promise<T> {
        while (this.active >= Math.max(1, this.opts.concurrency ?? 4))
            await new Promise<void>((r) => this.waiters.push(r));
        this.active++;
        try {
            return await fn();
        } finally {
            this.active--;
            this.waiters.shift()?.();
        }
    }

    /** A small text object, fetched once and remembered; a failure is forgotten so the next call tries again. */
    text(url: string): Promise<string> {
        let p = this.texts.get(url);
        if (p) {
            this.texts.touch(url);
            return p;
        }
        p = this.slot(async () => {
            const res = await this.fetchImpl(url);
            if (!res.ok) throw new ModelHttpError(res.status, url);
            const text = await res.text();
            this.stats.bytesFetched += text.length;
            this.stats.requests++;
            return text;
        });
        p.catch(() => this.texts.delete(url));
        this.texts.set(url, p);
        const max = this.opts.textEntries ?? 64;
        while (this.texts.size > max) this.texts.delete(this.texts.keys().next().value!);
        return p;
    }

    /**
     * Read ranges (memory, then Cache Storage, then the network), merging ones that touch into a single
     * request. Returns the bytes per input range, in order, and the bytes that came over the network.
     * `check` throws when the job was cancelled; it runs before each request.
     */
    async readRanges(
        ranges: readonly ModelRange[],
        check: () => void = () => {},
        onProgress?: (done: number, total: number) => void,
    ): Promise<{ bytes: Uint8Array[]; fetched: number }> {
        check();
        // Overview and detail request the same source messages in recipe order. Register before
        // any cache lookup can yield, so both jobs share the read even on a cold cache.
        const key = JSON.stringify(ranges);
        const consumer = { check, onProgress };
        let pending = this.reads.get(key);
        const joined = pending !== undefined;
        if (!pending) {
            const entry: PendingRead = {
                consumers: new Set([consumer]),
                done: 0,
                total: ranges.length,
                charged: false,
                promise: Promise.resolve({ bytes: [], fetched: 0 }),
            };
            const alive = () => {
                for (const reader of entry.consumers) {
                    try {
                        reader.check();
                        return;
                    } catch (error) {
                        if (!(error instanceof ModelCancelled)) throw error;
                    }
                }
                throw new ModelCancelled();
            };
            entry.promise = Promise.resolve()
                .then(() =>
                    this.readRangesOnce(ranges, alive, (done, total) => {
                        entry.done = done;
                        entry.total = total;
                        for (const reader of entry.consumers) {
                            try {
                                reader.check();
                                reader.onProgress?.(done, total);
                            } catch (error) {
                                if (!(error instanceof ModelCancelled)) throw error;
                            }
                        }
                    }),
                )
                .finally(() => {
                    if (this.reads.get(key) === entry) this.reads.delete(key);
                });
            this.reads.set(key, (pending = entry));
        } else {
            pending.consumers.add(consumer);
        }
        try {
            if (joined) onProgress?.(pending.done, pending.total);
            const result = await pending.promise;
            check();
            // Attribute a shared response only once, to the first consumer still interested.
            const fetched = pending.charged ? 0 : result.fetched;
            pending.charged = true;
            return { bytes: result.bytes, fetched };
        } finally {
            pending.consumers.delete(consumer);
        }
    }

    private async readRangesOnce(
        ranges: readonly ModelRange[],
        check: () => void,
        onProgress: (done: number, total: number) => void,
    ): Promise<{ bytes: Uint8Array[]; fetched: number }> {
        const keyOf = (r: ModelRange) => `${r.url}@${r.start}-${r.end ?? ''}`;
        const out: Uint8Array[] = new Array(ranges.length);
        const missing: number[] = [];
        for (let k = 0; k < ranges.length; k++) {
            const hit = await this.opts.cache.get(keyOf(ranges[k]));
            if (hit) out[k] = hit;
            else missing.push(k);
        }
        let completed = ranges.length - missing.length;
        onProgress?.(completed, ranges.length);
        let fetched = 0;
        // Group runs of adjacent ranges in the same object.
        const order = [...missing].sort(
            (a, b) => ranges[a].url.localeCompare(ranges[b].url) || ranges[a].start - ranges[b].start,
        );
        const runs: number[][] = [];
        for (const k of order) {
            const run = runs[runs.length - 1];
            const last = run ? ranges[run[run.length - 1]] : null;
            const cur = ranges[k];
            if (last && last.url === cur.url && last.end !== null && last.end + 1 === cur.start) run.push(k);
            else runs.push([k]);
        }
        await Promise.all(
            runs.map((run) =>
                this.slot(async () => {
                    check();
                    const first = ranges[run[0]];
                    const last = ranges[run[run.length - 1]];
                    const res = await this.fetchImpl(first.url, {
                        headers: { Range: `bytes=${first.start}-${last.end ?? ''}` },
                    });
                    if (!res.ok) throw new ModelHttpError(res.status, first.url);
                    const buf = new Uint8Array(await res.arrayBuffer());
                    fetched += buf.byteLength;
                    this.stats.bytesFetched += buf.byteLength;
                    this.stats.requests++;
                    for (const k of run) {
                        const r = ranges[k];
                        const msg = buf.slice(
                            r.start - first.start,
                            r.end === null ? undefined : r.end - first.start + 1,
                        );
                        out[k] = msg;
                        onProgress?.(++completed, ranges.length);
                        await this.opts.cache.put(keyOf(r), msg);
                    }
                }),
            ),
        );
        return { bytes: out, fetched };
    }
}
