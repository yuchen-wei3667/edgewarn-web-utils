/**
 * Injection point for every byte cache in the package (MRMS gz files, GOES band runs, NEXRAD
 * archive prefixes, model messages). The package never touches Cache Storage or any
 * browser store itself: the host passes an implementation (for example one backed by Cache
 * Storage) or nothing, in which case the consumer runs uncached.
 */
export interface ResponseStore {
    /** True when persistence is unavailable; callers then skip `put`. */
    readonly disabled: boolean;
    /** Bytes currently held, for stats. */
    readonly totalBytes: number;
    /** Change the byte budget and maximum age; the store prunes to fit. */
    configure(maxBytes: number, maxAgeMs: number): void;
    /** The stored response, or null. Its `x-edgewarn-cache-stored-at` header carries the store time (ms). */
    get(url: string): Promise<Response | null>;
    /**
     * Store a response. `size` may be a function evaluated after the body is drained, so a streamed
     * body never has to sit on the JS heap. `replace` is asked first when an entry already exists
     * and returns false to keep it. Resolves true when the entry was stored.
     */
    put(
        url: string,
        response: Response,
        size: number | (() => number),
        replace?: (held: Response | undefined) => boolean,
    ): Promise<boolean>;
    /** Drop one entry. */
    forget(url: string): Promise<void>;
}
