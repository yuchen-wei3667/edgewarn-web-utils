/**
 * Shared HTTP identity for upstream clients (NWS, NOAA WWA, ...).
 * One default User-Agent and one base-URL normalizer for every client, so
 * independent consumers configure their own instance instead of sharing
 * module-level mutable state.
 */

/**
 * Single default User-Agent for every NWS/NOAA client in this package.
 * NWS asks every client for a User-Agent and can refuse Node's default one.
 * Browsers treat `User-Agent` as a forbidden header and silently drop it,
 * so it is safe (and correct) to send it unconditionally — no environment
 * sniffing is needed or wanted.
 */
export const DEFAULT_NWS_USER_AGENT =
    'edgewarn-web-utils (https://github.com/yuchen-wei3667/edgewarn-web-utils)';

export function nwsHeaders(userAgent: string = DEFAULT_NWS_USER_AGENT): Record<string, string> {
    return { Accept: 'application/geo+json', 'User-Agent': userAgent };
}

/** Validate and trim an upstream base URL; only https upstreams are accepted. */
export function normalizeUpstreamBaseUrl(baseUrl: string | undefined, fallback: string): string {
    const value = (baseUrl ?? fallback).replace(/\/+$/, '');
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') throw new Error('Upstream baseUrl must be an https URL');
    return value;
}
