import type { ResponseStore } from '@edgewarn/web-utils/net';
import { GoesHttpError } from './http-source.ts';
export { GoesHttpError };

/** Compressed band runs stay in memory and in the injected store for at most this long. */
export const GOES_CACHE_RETENTION_MS = 6 * 60 * 60 * 1000;

export interface GoesBandCacheOptions {
    /** Injected persistent store. Omit or pass null to keep band runs in memory only. */
    store?: ResponseStore | null;
    /** Compressed bytes kept in memory between jobs. */
    memoryBytes: number;
    now?: () => number;
    /** Longest a run stays in memory; defaults to {@link GOES_CACHE_RETENTION_MS}. */
    retentionMs?: number;
}
const entryUrl = (key: string) => `https://goes-bands.invalid/${encodeURIComponent(key)}`;

interface Held {
    bytes: Uint8Array;
    expiresAt: number;
}

/**
 * Compressed band runs, with independent memory and store retention. Disk eviction and expiry belong
 * to the injected store, so only the counters this class can see are kept here.
 */
export class GoesBandCache {
    private readonly store: ResponseStore | null;
    // Insertion order is the eviction order: the oldest entry goes first.
    private readonly memory = new Map<string, Held>();
    private memoryUsed = 0;
    stats = { hits: 0, memoryHits: 0, misses: 0, puts: 0, putFailures: 0 };
    private memoryBytes: number;
    private readonly now: () => number;
    private readonly retentionMs: number;

    constructor(opts: GoesBandCacheOptions) {
        this.store = opts.store ?? null;
        this.memoryBytes = opts.memoryBytes;
        this.now = opts.now ?? (() => Date.now());
        this.retentionMs = opts.retentionMs ?? GOES_CACHE_RETENTION_MS;
    }
    get disabled(): boolean {
        return !this.store || this.store.disabled;
    }
    get totalBytes(): number {
        return this.store?.totalBytes ?? 0;
    }
    configure(maxBytes: number, maxAgeMs: number, memoryBytes: number): void {
        this.memoryBytes = memoryBytes;
        this.store?.configure(maxBytes, maxAgeMs);
        this.trimMemory();
    }
    async get(key: string): Promise<Uint8Array | null> {
        const mem = this.recall(key);
        if (mem) {
            this.stats.memoryHits++;
            return mem;
        }
        const response = this.store ? await this.store.get(entryUrl(key)) : null;
        if (!response) {
            this.stats.misses++;
            return null;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const storedAt = response.headers.get('x-edgewarn-cache-stored-at');
        this.remember(key, bytes, storedAt === null ? this.now() : Number(storedAt));
        this.stats.hits++;
        return bytes;
    }
    async put(key: string, bytes: Uint8Array, start: number): Promise<void> {
        this.remember(key, bytes);
        if (this.disabled) return;
        const stored = await this.store!
            .put(
                entryUrl(key),
                new Response(bytes.slice() as Uint8Array<ArrayBuffer>, {
                    headers: { 'content-type': 'application/octet-stream', 'x-goes-range-start': String(start) },
                }),
                bytes.byteLength,
            )
            .catch(() => false);
        if (stored) this.stats.puts++;
        else this.stats.putFailures++;
    }
    /** A live entry, moved to the newest position without extending its lifetime. */
    private recall(key: string): Uint8Array | null {
        const held = this.memory.get(key);
        if (!held) return null;
        if (held.expiresAt <= this.now()) {
            this.drop(key, held);
            return null;
        }
        this.memory.delete(key);
        this.memory.set(key, held);
        return held.bytes;
    }
    private drop(key: string, held: Held): void {
        this.memory.delete(key);
        this.memoryUsed -= held.bytes.byteLength;
    }
    private remember(key: string, bytes: Uint8Array, storedAt = this.now()): void {
        if (bytes.byteLength > this.memoryBytes) return;
        const old = this.memory.get(key);
        if (old) this.drop(key, old);
        const expiresAt = this.now() + Math.max(0, this.retentionMs - (this.now() - storedAt));
        this.memory.set(key, { bytes, expiresAt });
        this.memoryUsed += bytes.byteLength;
        this.trimMemory();
    }
    private trimMemory(): void {
        for (const [key, held] of this.memory) {
            if (this.memoryUsed <= this.memoryBytes) break;
            this.drop(key, held);
        }
    }
}

/** One ranged GET read whole: [start, end). Copes with servers that ignore Range. */
export async function fetchRange(
    url: string,
    start: number,
    end: number,
    fetcher: typeof fetch,
    signal?: AbortSignal,
): Promise<Uint8Array> {
    const res = await fetcher(url, { headers: { Range: `bytes=${start}-${end - 1}` }, signal });
    if (res.status !== 206 && res.status !== 200) throw new GoesHttpError(res.status, url);
    const buf = new Uint8Array(await res.arrayBuffer());
    const bytes = res.status === 200 ? buf.subarray(start, end) : buf;
    if (bytes.byteLength !== end - start)
        throw new Error(`GOES range ${start}-${end} of ${url} came back with ${bytes.byteLength} bytes`);
    return bytes;
}
