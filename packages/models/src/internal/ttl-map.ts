/** Longest any cache entry of this package lives, whatever TTL a caller asks for. */
export const CACHE_RETENTION_MS = 6 * 60 * 60 * 1000;

export interface TtlMapOptions<K, V> {
    ttlMs?: number;
    now?: () => number;
    onExpire?: (value: V, key: K) => void;
}

/**
 * A Map with absolute expiry. Entries are dropped when the map is next used after their deadline; no timer is
 * created, so the package keeps no background work and a cache never holds a process open.
 */
export class TtlMap<K, V> extends Map<K, V> {
    private readonly deadlines = new Map<K, number>();
    private readonly options: TtlMapOptions<K, V>;

    constructor(options: TtlMapOptions<K, V> = {}) {
        super();
        this.options = options;
    }

    private now(): number {
        return this.options.now?.() ?? Date.now();
    }

    prune(): void {
        const now = this.now();
        for (const [key, deadline] of this.deadlines) {
            if (deadline > now) continue;
            const value = super.get(key)!;
            super.delete(key);
            this.deadlines.delete(key);
            this.options.onExpire?.(value, key);
        }
    }

    override set(key: K, value: V, ttlMs = this.options.ttlMs ?? CACHE_RETENTION_MS): this {
        this.prune();
        super.set(key, value);
        this.deadlines.set(key, this.now() + Math.min(ttlMs, CACHE_RETENTION_MS));
        return this;
    }

    override get(key: K): V | undefined {
        this.prune();
        return super.get(key);
    }

    /** Move to the LRU tail without extending absolute expiry. */
    touch(key: K): void {
        this.prune();
        if (!super.has(key)) return;
        const value = super.get(key)!;
        super.delete(key);
        super.set(key, value);
    }

    override has(key: K): boolean {
        this.prune();
        return super.has(key);
    }
    override get size(): number {
        this.prune();
        return super.size;
    }
    override entries(): MapIterator<[K, V]> {
        this.prune();
        return super.entries();
    }
    override keys(): MapIterator<K> {
        this.prune();
        return super.keys();
    }
    override values(): MapIterator<V> {
        this.prune();
        return super.values();
    }
    override [Symbol.iterator](): MapIterator<[K, V]> {
        return this.entries();
    }
    override forEach(callback: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
        this.prune();
        super.forEach(callback, thisArg);
    }
    override delete(key: K): boolean {
        this.deadlines.delete(key);
        return super.delete(key);
    }
    override clear(): void {
        super.clear();
        this.deadlines.clear();
    }
}
