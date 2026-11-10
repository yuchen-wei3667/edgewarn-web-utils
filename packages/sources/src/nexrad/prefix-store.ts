import type { ResponseStore } from '@edgewarn/web-utils/net';

export interface NexradPrefixStore {
    /** The longest prefix kept for `key`, or null. */
    get(key: string): Promise<Uint8Array | null>;
    /** Keep `bytes` as the prefix of `key` if it is longer than what is held. */
    put(key: string, bytes: Uint8Array): Promise<void>;
    /** Drop the entry (it could not be decoded). */
    forget?(key: string): Promise<void>;
}

export interface CacheStoragePrefixStoreOptions {
    /** Injected persistent store. Omit or pass null and every call is a no-op miss. */
    store?: ResponseStore | null;
    /** Prefixes longer than this are not kept. */
    maxBytes: number;
}

/**
 * Archive prefixes in an injected `ResponseStore` (for example one backed by Cache Storage). Age and
 * byte-budget eviction belong to the store; this class only keeps the longest prefix per key.
 */
export class CacheStoragePrefixStore implements NexradPrefixStore {
    private readonly store: ResponseStore | null;
    private readonly maxBytes: number;
    constructor(options: CacheStoragePrefixStoreOptions) {
        this.store = options.store ?? null;
        this.maxBytes = options.maxBytes;
    }
    async get(key: string): Promise<Uint8Array | null> {
        const response = this.store ? await this.store.get(key) : null;
        return response ? new Uint8Array(await response.arrayBuffer()) : null;
    }
    async forget(key: string): Promise<void> {
        await this.store?.forget(key);
    }
    async put(key: string, bytes: Uint8Array): Promise<void> {
        if (!this.store || !bytes.length || bytes.length > this.maxBytes) return;
        await this.store
            .put(
                key,
                new Response(bytes.slice() as Uint8Array<ArrayBuffer>, { headers: { 'x-nexrad-bytes': String(bytes.byteLength) } }),
                bytes.byteLength,
                (held) => Number(held?.headers.get('x-nexrad-bytes') ?? 0) < bytes.byteLength,
            )
            .catch(() => false);
    }
}
