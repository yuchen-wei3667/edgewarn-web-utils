/**
 * Host allow-list for URLs that originate from external feeds (KML NetworkLinks,
 * scraped hrefs, etc.). Following such URLs blindly is an SSRF vector — a
 * compromised or spoofed upstream could redirect fetches to arbitrary hosts.
 * Only `https` URLs whose host matches one of these suffixes are permitted. NOAA and NWS cover the SPC, WPC, NHC
 * and NWS clients; the Iowa Environmental Mesonet (storm reports, CoCoRaHS, radiosondes) and Open-Meteo are the
 * other upstreams the package's clients read.
 */
const ALLOWED_HOST_SUFFIXES = ['.noaa.gov', '.weather.gov', '.agron.iastate.edu', '.open-meteo.com'];

/**
 * Returns a normalized `https` URL string if `value` parses to an http(s) URL
 * on an allow-listed host, or `null` otherwise. `http` is upgraded to `https`.
 */
export function resolveAllowedFeedUrl(value: unknown): string | null {
    if (value === null || value === undefined) return null;

    const raw = String(value).trim();
    if (!raw) return null;

    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
    }
    parsed.protocol = 'https:';

    const host = parsed.hostname.toLowerCase();
    const allowed = ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));

    return allowed ? parsed.toString() : null;
}
