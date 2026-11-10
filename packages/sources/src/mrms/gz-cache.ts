import type { ResponseStore } from '@edgewarn/web-utils/net';

export class MrmsHttpError extends Error {
    status: number;
    constructor(status: number, url: string) {
        super(`MRMS request failed: HTTP ${status} for ${url}`);
        this.name = 'MrmsHttpError';
        this.status = status;
    }
}

export interface GzCacheOptions {
    /** Injected persistent store. Omit or pass null to download every file uncached. */
    store?: ResponseStore | null;
}
interface OpenOptions {
    signal?: AbortSignal;
    fetcher?: typeof fetch;
}
export interface OpenedSource {
    body: ReadableStream<Uint8Array>;
    fromCache: boolean;
}

/**
 * Compressed files stay in the injected store, streamed to it while they decode. Eviction and
 * expiry belong to the store, so only the counters this class can see are kept here.
 */
export class GzCache {
    private readonly store: ResponseStore | null;
    stats = { hits: 0, misses: 0, puts: 0, putFailures: 0 };
    constructor(options: GzCacheOptions = {}) {
        this.store = options.store ?? null;
    }
    get disabled(): boolean {
        return !this.store || this.store.disabled;
    }
    get totalBytes(): number {
        return this.store?.totalBytes ?? 0;
    }
    configure(maxBytes: number, maxAgeMs: number): void {
        this.store?.configure(maxBytes, maxAgeMs);
    }

    async open(url: string, options: OpenOptions = {}): Promise<OpenedSource> {
        const hit = this.store ? await this.store.get(url) : null;
        if (hit?.body) {
            this.stats.hits++;
            return { body: hit.body, fromCache: true };
        }
        this.stats.misses++;
        const response = await (options.fetcher ?? globalThis.fetch)(url, { signal: options.signal });
        if (!response.ok || !response.body) throw new MrmsHttpError(response.status, url);
        if (this.disabled) return { body: response.body, fromCache: false };
        const [forDecode, forCache] = response.body.tee();
        void this.persist(url, forCache);
        return { body: forDecode, fromCache: false };
    }

    /** Drains the tee even when the decoder stops early, without buffering a file on the JS heap. */
    private async persist(url: string, body: ReadableStream<Uint8Array>): Promise<void> {
        let size = 0;
        const counted = body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                    size += chunk.byteLength;
                    controller.enqueue(chunk);
                },
            }),
        );
        const stored = await this.store!
            .put(url, new Response(counted, { headers: { 'content-type': 'application/gzip' } }), () => size)
            .catch(() => false);
        if (stored) this.stats.puts++;
        else this.stats.putFailures++;
    }
}
