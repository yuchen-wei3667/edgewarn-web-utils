import { TtlMap } from '../internal/ttl-map.ts';
import type { ModelFieldRead } from '../field.ts';
import { SharedTask } from '@edgewarn/web-utils/net';
import { ModelHttpError } from './errors.ts';

/** What a random-access file reader needs of its bytes (the shape of the OM and HDF5 readers' backends). */
interface RangeBackend {
    count(): Promise<number>;
    getBytes(offset: number, size: number): Promise<Uint8Array>;
    close(): Promise<void>;
}

const TAIL_BYTES = 4096;
const MERGE_GAP_BYTES = 2048;
const MERGE_MAX_BYTES = 64 * 1024;
const NETWORK_CONCURRENCY = 6;

/** Actual body bytes and HTTP attempts. Shared I/O is attributed to its first subscriber. */
export interface RangeReadStats {
    bytesFetched: number;
    requests: number;
    reads: ModelFieldRead[];
}
interface Block {
    file: string;
    start: number;
    size: number;
    bytes: Uint8Array;
}
interface ReadJob {
    file: string;
    url: string;
    offset: number;
    size: number;
    stats: RangeReadStats;
    signal: AbortSignal;
    resolve: (block: Block) => void;
    reject: (error: unknown) => void;
}

/** Bounded LRU of tails and data ranges, cancellation-safe shared I/O and contiguous range merging. */
export class RangeSource {
    private blocks = new TtlMap<string, Block>({
        onExpire: (block) => {
            this.held -= block.bytes.byteLength;
        },
    });
    private sizes = new TtlMap<string, number>();
    private pending = new Map<string, SharedTask<Block>>();
    private queued: ReadJob[] = [];
    private held = 0;
    private activeRequests = 0;
    private waiters = new Set<() => void>();
    private readonly fetchImpl: typeof fetch;
    private readonly maxBytes: number;
    private readonly timeoutMs: number;

    private readonly sizeByHead: boolean;

    /**
     * `sizeByHead`: for a host whose CORS does not expose `Content-Range` (the Met Office bucket exposes only `ETag`), a browser cannot
     * read a file's size or a suffix range from a 206. The size then comes from a HEAD's `Content-Length` and every range is absolute.
     */
    constructor(options: {
        fetch?: typeof fetch;
        maxBytes: number;
        timeoutMs?: number;
        sizeByHead?: boolean;
    }) {
        this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
        this.maxBytes = options.maxBytes;
        this.timeoutMs = options.timeoutMs ?? 15_000;
        this.sizeByHead = options.sizeByHead ?? false;
    }

    /** Opening bytes stay reader-owned until close even if evicted from the shared cache. */
    backend(
        url: string,
        version: string,
        stats: RangeReadStats,
        signal: AbortSignal,
        tailBytes = TAIL_BYTES,
    ): RangeBackend {
        let opened: Block | undefined;
        const file = `${version}|${url}`;
        const open = async () => (opened ??= await this.tail(url, file, stats, signal, tailBytes));
        return {
            count: async () => (await open()).size,
            getBytes: async (offset, size) => {
                signal.throwIfAborted();
                const tail = opened ?? (await open());
                if (offset >= tail.start && offset + size <= tail.start + tail.bytes.byteLength) {
                    return tail.bytes.subarray(offset - tail.start, offset - tail.start + size);
                }
                const block =
                    this.covering(file, offset, size) ??
                    (await this.shared(`${file}@${offset}+${size}`, signal, (sharedSignal) =>
                        this.enqueue({ file, url, offset, size, stats, signal: sharedSignal }),
                    ));
                return block.bytes.subarray(offset - block.start, offset - block.start + size);
            },
            close: async () => {
                opened = undefined;
            },
        };
    }

    get cacheInfo() {
        const entries = this.blocks.size; // Prune before returning the accounted size.
        return { bytes: this.held, entries, pending: this.pending.size, activeRequests: this.activeRequests };
    }

    private covering(file: string, offset: number, size: number): Block | undefined {
        for (const [key, block] of this.blocks) {
            if (
                block.file !== file ||
                block.start > offset ||
                block.start + block.bytes.byteLength < offset + size
            )
                continue;
            this.blocks.touch(key);
            return block;
        }
    }

    private remember(block: Block): Block {
        this.sizes.set(block.file, block.size);
        if (block.bytes.byteLength > this.maxBytes) return block;
        const key = `${block.file}@${block.start}+${block.bytes.byteLength}`;
        this.held -= this.blocks.get(key)?.bytes.byteLength ?? 0;
        this.blocks.set(key, block);
        this.held += block.bytes.byteLength;
        for (const [old, value] of this.blocks) {
            if (this.held <= this.maxBytes) break;
            this.blocks.delete(old);
            this.held -= value.bytes.byteLength;
        }
        return block;
    }

    private shared(
        key: string,
        signal: AbortSignal,
        load: (signal: AbortSignal) => Promise<Block>,
    ): Promise<Block> {
        let task = this.pending.get(key);
        if (!task?.available) {
            task = new SharedTask(load);
            this.pending.set(key, task);
            const current = task;
            const forget = () => {
                if (this.pending.get(key) === current) this.pending.delete(key);
            };
            void task.promise.then(forget, forget);
        }
        return task.join(signal);
    }

    private tail(
        url: string,
        file: string,
        stats: RangeReadStats,
        signal: AbortSignal,
        length: number,
    ): Promise<Block> {
        const size = this.sizes.get(file);
        const start = size === undefined ? undefined : Math.max(0, size - length);
        const cached = start === undefined ? undefined : this.covering(file, start, size! - start);
        if (cached) return Promise.resolve(cached);
        return this.shared(`${file}@tail${length}`, signal, async (sharedSignal) => {
            const known = size ?? (this.sizeByHead ? await this.head(url, file, sharedSignal) : undefined);
            return this.remember(
                await this.fetchRange(
                    url,
                    file,
                    known === undefined
                        ? `bytes=-${length}`
                        : `bytes=${Math.max(0, known - length)}-${known - 1}`,
                    stats,
                    sharedSignal,
                ),
            );
        });
    }

    private async head(url: string, file: string, signal: AbortSignal): Promise<number> {
        const release = await this.acquire(signal);
        try {
            const res = await this.fetchImpl(url, {
                method: 'HEAD',
                cache: 'no-store',
                signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
            });
            const size = Number(res.headers.get('content-length'));
            if (!res.ok) throw new ModelHttpError(res.status, url);
            if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`No Content-Length for ${url}`);
            this.sizes.set(file, size);
            return size;
        } finally {
            release();
        }
    }

    private enqueue(job: Omit<ReadJob, 'resolve' | 'reject'>): Promise<Block> {
        return new Promise((resolve, reject) => {
            this.queued.push({ ...job, resolve, reject });
            if (this.queued.length === 1) queueMicrotask(() => this.flush());
        });
    }

    private flush(): void {
        const queued = this.queued;
        this.queued = [];
        const files = new Map<string, ReadJob[]>();
        for (const job of queued) {
            if (job.signal.aborted) {
                job.reject(job.signal.reason);
                continue;
            }
            const jobs = files.get(job.file) ?? [];
            jobs.push(job);
            files.set(job.file, jobs);
        }
        for (const jobs of files.values()) {
            jobs.sort((a, b) => a.offset - b.offset);
            let group: ReadJob[] = [],
                start = 0,
                end = 0;
            const send = () => {
                const first = group[0],
                    from = start,
                    to = end,
                    batch = group;
                const task = new SharedTask(async (signal) =>
                    this.remember(
                        await this.fetchRange(
                            first.url,
                            first.file,
                            `bytes=${from}-${to - 1}`,
                            first.stats,
                            signal,
                        ),
                    ),
                );
                for (const job of batch) void task.join(job.signal).then(job.resolve, job.reject);
            };
            for (const job of jobs) {
                if (
                    group.length &&
                    (job.offset - end > MERGE_GAP_BYTES ||
                        Math.max(end, job.offset + job.size) - start > MERGE_MAX_BYTES)
                ) {
                    send();
                    group = [];
                }
                if (!group.length) {
                    start = job.offset;
                    end = job.offset;
                }
                group.push(job);
                end = Math.max(end, job.offset + job.size);
            }
            if (group.length) send();
        }
    }

    private async acquire(signal: AbortSignal): Promise<() => void> {
        signal.throwIfAborted();
        if (this.activeRequests >= NETWORK_CONCURRENCY)
            await new Promise<void>((resolve, reject) => {
                const abort = () => {
                    this.waiters.delete(ready);
                    reject(signal.reason);
                };
                const ready = () => {
                    signal.removeEventListener('abort', abort);
                    this.activeRequests++;
                    resolve();
                };
                this.waiters.add(ready);
                signal.addEventListener('abort', abort, { once: true });
            });
        else this.activeRequests++;
        return () => {
            this.activeRequests--;
            const next = this.waiters.values().next().value;
            if (next) {
                this.waiters.delete(next);
                next();
            }
        };
    }

    private async fetchRange(
        url: string,
        file: string,
        range: string,
        stats: RangeReadStats,
        signal: AbortSignal,
    ): Promise<Block> {
        const release = await this.acquire(signal);
        try {
            for (let attempt = 0; ; attempt++) {
                signal.throwIfAborted();
                let res: Response;
                try {
                    stats.requests++;
                    // Avoid Chrome's same-URL cache write lock; the bounded cache above owns reuse.
                    res = await this.fetchImpl(url, {
                        headers: { Range: range },
                        cache: 'no-store',
                        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
                    });
                } catch (error) {
                    if (!signal.aborted && attempt === 0) continue;
                    throw error;
                }
                if (res.status !== 206) {
                    void res.body?.cancel();
                    if (res.status >= 500 && attempt === 0) continue;
                    throw new ModelHttpError(res.status, url);
                }
                const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
                const invalid = () => {
                    void res.body?.cancel();
                    return new Error(`Invalid Content-Range for ${url}`);
                };
                const requested = /^bytes=(\d+)-(\d+)$/.exec(range);
                const known = this.sizes.get(file);
                // Without an exposed Content-Range the answer is the range asked for, of a file whose size HEAD gave.
                if (!match && !(this.sizeByHead && requested && known !== undefined)) throw invalid();
                const [start, end, size] = match
                    ? match.slice(1).map(Number)
                    : [Number(requested![1]), Number(requested![2]), known!];
                const suffix = /^bytes=-(\d+)$/.exec(range);
                if (
                    ![start, end, size].every(Number.isSafeInteger) ||
                    size <= end ||
                    start > end ||
                    (requested && (start !== Number(requested[1]) || end !== Number(requested[2]))) ||
                    (suffix && (start !== Math.max(0, size - Number(suffix[1])) || end !== size - 1))
                )
                    throw invalid();
                const bytes = new Uint8Array(await res.arrayBuffer());
                stats.bytesFetched += bytes.byteLength;
                if (bytes.byteLength !== end - start + 1) throw new Error(`Truncated range for ${url}`);
                stats.reads.push({ url, start, end });
                return { file, bytes, start, size };
            }
        } finally {
            release();
        }
    }
}
