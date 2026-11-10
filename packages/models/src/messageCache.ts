import type { ResponseStore } from '@edgewarn/web-utils/net';
import { CACHE_RETENTION_MS, TtlMap } from './internal/ttl-map.ts';

export interface ModelMessageCacheOptions {
    /** Injected persistent store. Omit or pass null to keep messages in memory only. */
    store?: ResponseStore | null;
    /** Compressed bytes kept in memory between jobs. */
    memoryBytes: number;
    now?: () => number;
}

const entryUrl = (key: string) => `https://model-msg.invalid/${encodeURIComponent(key)}`;

/**
 * Compressed messages in a bounded memory LRU and an injected persistent store. Disk eviction and expiry belong
 * to the store, so only the counters this class can see are kept here.
 */
export class ModelMessageCache {
    private readonly store: ResponseStore | null;
    private readonly memory: TtlMap<string, Uint8Array>;
    private memoryUsed = 0;
    private memoryBytes: number;
    private readonly now: () => number;
    stats = { memoryHits: 0, diskHits: 0, misses: 0, puts: 0, putFailures: 0 };

    constructor(opts: ModelMessageCacheOptions) {
        this.store = opts.store ?? null;
        this.memoryBytes = opts.memoryBytes;
        this.now = opts.now ?? (() => Date.now());
        this.memory = new TtlMap({
            now: this.now,
            ttlMs: CACHE_RETENTION_MS,
            onExpire: (bytes) => {
                this.memoryUsed -= bytes.byteLength;
            },
        });
    }
    get disabled(): boolean {
        return !this.store || this.store.disabled;
    }
    get diskBytes(): number {
        return this.store?.totalBytes ?? 0;
    }
    configure(memoryBytes: number, maxBytes: number, maxAgeMs: number): void {
        this.memoryBytes = memoryBytes;
        this.store?.configure(maxBytes, maxAgeMs);
        this.trimMemory();
    }
    async get(key: string): Promise<Uint8Array | null> {
        const mem = this.memory.get(key);
        if (mem) {
            this.memory.touch(key);
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
        this.stats.diskHits++;
        return bytes;
    }
    async put(key: string, bytes: Uint8Array): Promise<void> {
        this.remember(key, bytes);
        if (this.disabled) return;
        const stored = await this.store!.put(
            entryUrl(key),
            new Response(bytes.slice() as Uint8Array<ArrayBuffer>),
            bytes.byteLength,
        ).catch(() => false);
        if (stored) this.stats.puts++;
        else this.stats.putFailures++;
    }
    private remember(key: string, bytes: Uint8Array, storedAt = this.now()): void {
        if (bytes.byteLength > this.memoryBytes) return;
        const old = this.memory.get(key);
        if (old) this.memoryUsed -= old.byteLength;
        this.memory.set(key, bytes, Math.max(0, CACHE_RETENTION_MS - (this.now() - storedAt)));
        this.memoryUsed += bytes.byteLength;
        this.trimMemory();
    }
    private trimMemory(): void {
        for (const [key, bytes] of this.memory) {
            if (this.memoryUsed <= this.memoryBytes) break;
            this.memory.delete(key);
            this.memoryUsed -= bytes.byteLength;
        }
    }
}
