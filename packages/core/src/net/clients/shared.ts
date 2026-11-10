import { fetchWithTimeout } from '../fetch-with-timeout.ts';
import { DEFAULT_NWS_USER_AGENT } from '../http-config.ts';

/**
 * Configuration every public-feed client takes. Each client instance owns its caches (plain Maps that live as long
 * as the instance); nothing is module-global.
 */
export interface ClientConfig {
    /** Upstream request identity; pass null to omit the browser-controlled header. */
    userAgent?: string | null;
    /** Fetch implementation; defaults to the global `fetch`. */
    fetch?: typeof fetch;
    /** Request timeout in ms; defaults to the `fetchWithTimeout` default (15 s). */
    timeoutMs?: number;
    /** Clock for cache freshness; defaults to `Date.now`. */
    now?: () => number;
}

/** `fetchWithTimeout` through the client's own fetch and timeout. */
export async function request(config: ClientConfig, url: string | URL, init: Omit<RequestInit, 'signal'> & { signal?: AbortSignal } = {}): Promise<Response> {
    if (new URL(url).protocol !== 'https:') throw new Error('Upstream URL must be an https URL');
    const headers = new Headers(init.headers);
    if (config.userAgent !== null) headers.set('User-Agent', config.userAgent ?? DEFAULT_NWS_USER_AGENT);
    return fetchWithTimeout(url, { ...init, headers, fetcher: config.fetch, ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}) });
}
