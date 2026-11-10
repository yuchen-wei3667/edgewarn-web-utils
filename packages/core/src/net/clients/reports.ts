import { normalizeNullableString, normalizeNumber, normalizeString } from '../normalize.ts';
import { parseTimestampUTC } from '../../time/timestamp.ts';
import { request } from './shared.ts';
import type { ClientConfig } from './shared.ts';
import type { CoCoRaHSFeature, CoCoRaHSFeatureProperties, CoCoRaHSGeoJSON, LSRFeature, LSRFeatureProperties, LSRGeoJSON } from './types.ts';

export interface ReportsConfig extends ClientConfig {
    /** Iowa Environmental Mesonet local storm report endpoint; defaults to {@link IEM_LSR_ENDPOINT}. */
    lsrUrl?: string;
    /** IEM CoCoRaHS endpoint; defaults to {@link COCORAHS_ENDPOINT}. */
    cocorahsUrl?: string;
}

export const IEM_LSR_ENDPOINT = 'https://mesonet.agron.iastate.edu/geojson/lsr.geojson';
const DEFAULT_LOOKBACK_HOURS = 6;
const DEFAULT_WINDOW_MINUTES = 90;

export interface LSRBounds {
    west: number;
    east: number;
    south: number;
    north: number;
}

export interface FetchLSRParams {
    currentTimestamp?: string | null;
    bounds?: LSRBounds | null;
    windowMinutes?: number;
}

function padBounds(bounds: LSRBounds, factor = 0.15): LSRBounds {
    const latPad = Math.max((bounds.north - bounds.south) * factor, 0.35);
    const lonPad = Math.max((bounds.east - bounds.west) * factor, 0.35);

    return {
        west: Math.max(-180, bounds.west - lonPad),
        east: Math.min(180, bounds.east + lonPad),
        south: Math.max(-90, bounds.south - latPad),
        north: Math.min(90, bounds.north + latPad),
    };
}

function toIEMIsoTimestamp(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function normalizeFeature(rawFeature: unknown, index: number): LSRFeature | null {
    if (!rawFeature || typeof rawFeature !== 'object') return null;

    const feature = rawFeature as Record<string, unknown>;
    const geometry = feature.geometry as Record<string, unknown> | undefined;
    const properties = feature.properties as Record<string, unknown> | undefined;
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry?.coordinates : null;

    if (geometry?.type !== 'Point' || !coordinates || coordinates.length < 2) {
        return null;
    }

    const lon = normalizeNumber(coordinates[0]);
    const lat = normalizeNumber(coordinates[1]);
    if (lon === null || lat === null) {
        return null;
    }

    const normalizedProperties: LSRFeatureProperties = {
        wfo: normalizeString(properties?.wfo),
        type: normalizeString(properties?.type),
        magf: normalizeNumber(properties?.magf),
        county: normalizeString(properties?.county),
        typetext: normalizeString(properties?.typetext),
        state: normalizeString(properties?.state),
        remark: normalizeNullableString(properties?.remark),
        city: normalizeString(properties?.city),
        source: normalizeString(properties?.source),
        unit: normalizeNullableString(properties?.unit),
        valid: normalizeString(properties?.valid),
        lon,
        lat,
        qualifier: normalizeNullableString(properties?.qualifier),
        product_id: normalizeString(properties?.product_id),
        st: normalizeString(properties?.st),
        magnitude: normalizeString(properties?.magnitude),
    };

    return {
        id: normalizeString(feature.id, String(index)),
        type: 'Feature',
        properties: normalizedProperties,
        geometry: {
            type: 'Point',
            coordinates: [lon, lat],
        },
    };
}

export async function fetchLocalStormReports(
    { currentTimestamp, bounds, windowMinutes = DEFAULT_WINDOW_MINUTES }: FetchLSRParams,
    config: ReportsConfig = {},
): Promise<LSRGeoJSON> {
    const params = new URLSearchParams();

    const parsedTimestamp = currentTimestamp ? parseTimestampUTC(currentTimestamp) : null;
    if (parsedTimestamp) {
        const halfWindowMs = Math.max(windowMinutes, 15) * 60 * 1000;
        params.set('sts', toIEMIsoTimestamp(new Date(parsedTimestamp.getTime() - halfWindowMs)));
        params.set('ets', toIEMIsoTimestamp(new Date(parsedTimestamp.getTime() + halfWindowMs)));
    } else {
        params.set('hours', String(DEFAULT_LOOKBACK_HOURS));
    }

    if (bounds) {
        const padded = padBounds(bounds);
        params.set('west', padded.west.toFixed(3));
        params.set('east', padded.east.toFixed(3));
        params.set('south', padded.south.toFixed(3));
        params.set('north', padded.north.toFixed(3));
    }

    const response = await request(config, `${config.lsrUrl ?? IEM_LSR_ENDPOINT}?${params.toString()}`, {
        headers: {
            Accept: 'application/geo+json, application/json',
        },
        cache: 'no-store',
    });

    if (!response.ok) {
        throw new Error(`LSR request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as { type?: string; features?: unknown[] };
    const rawFeatures = Array.isArray(payload.features) ? payload.features : [];

    return {
        type: 'FeatureCollection',
        features: rawFeatures
            .map((feature, index) => normalizeFeature(feature, index))
            .filter((feature): feature is LSRFeature => Boolean(feature)),
    };
}

export const COCORAHS_ENDPOINT = 'https://mesonet.agron.iastate.edu/geojson/7am.py';

function coalesceNumber(props: Record<string, unknown> | undefined, keys: string[]): number | null {
    if (!props) return null;
    for (const k of keys) {
        if (k in props) {
            const v = props[k];
            const n = normalizeNumber(v);
            if (n !== null) return n;
        }
    }
    return null;
}

function coalesceString(props: Record<string, unknown> | undefined, keys: string[], fallback = ''): string {
    if (!props) return fallback;
    for (const k of keys) {
        if (k in props && props[k] !== undefined && props[k] !== null) {
            return normalizeString(props[k]);
        }
    }
    return fallback;
}

function toUtcDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function shiftUtcDays(dateKey: string, deltaDays: number): string {
    const date = new Date(`${dateKey}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
        return dateKey;
    }

    date.setUTCDate(date.getUTCDate() + deltaDays);
    return toUtcDateKey(date);
}

function normalizeCoCoRaHSFeature(rawFeature: unknown, index: number): CoCoRaHSFeature | null {
    if (!rawFeature || typeof rawFeature !== 'object') return null;

    const feature = rawFeature as Record<string, unknown>;
    const geometry = feature.geometry as Record<string, unknown> | undefined;
    const properties = feature.properties as Record<string, unknown> | undefined;
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : null;

    if (geometry?.type !== 'Point' || !coordinates || coordinates.length < 2) {
        return null;
    }

    const lon = normalizeNumber(coordinates[0]);
    const lat = normalizeNumber(coordinates[1]);
    if (lon === null || lat === null) return null;

    const stationId = normalizeString(feature.id, `cocorahs-${index}`);
    const normalizedProperties: CoCoRaHSFeatureProperties = {
        stationId,
        // Some feeds use different property names; check common variants
        stationName: coalesceString(properties, ['name', 'station_name', 'station'], stationId),
        network: coalesceString(properties, ['network', 'station_network'], 'COCORAHS'),
        valid: coalesceString(properties, ['valid', 'time', 'obs_time'], ''),
        precipitation24h: coalesceNumber(properties, ['pday', 'precip', 'precip24', 'pday_in', 'precip_in']),
        snow24h: coalesceNumber(properties, ['snow', 'snow24', 'snow_in']),
        snowDepth: coalesceNumber(properties, ['snowd', 'snowdepth', 'snow_depth']),
        reportHourLocal: coalesceNumber(properties, ['hour', 'report_hour']),
    };

    return {
        id: stationId,
        type: 'Feature',
        properties: normalizedProperties,
        geometry: {
            type: 'Point',
            coordinates: [lon, lat],
        },
    };
}

export async function fetchCoCoRaHSReports(currentTimestamp?: string | null, config: ReportsConfig = {}): Promise<CoCoRaHSGeoJSON> {
    const now = new Date(config.now?.() ?? Date.now());
    const parsedDate = currentTimestamp ? parseTimestampUTC(currentTimestamp) : now;
    const dateKey = toUtcDateKey(parsedDate ?? now);

    const fetchForDate = async (requestedDateKey: string): Promise<{ type?: string; features?: unknown[] } | null> => {
        const params = new URLSearchParams({
            dt: requestedDateKey,
            group: 'cocorahs',
        });

        let payload: { type?: string; features?: unknown[] } | null = null;
        const candidateQueries = [params.toString(), new URLSearchParams({ date: requestedDateKey, group: 'cocorahs' }).toString(), new URLSearchParams({ dt: requestedDateKey }).toString(), ''].map(q => `${config.cocorahsUrl ?? COCORAHS_ENDPOINT}${q ? `?${q}` : ''}`);

        for (const url of candidateQueries) {
            try {
                const response = await request(config, url, {
                    headers: { Accept: 'application/geo+json, application/json' },
                    cache: 'no-store',
                });

                if (!response.ok) {
                    console.warn('[CoCoRaHS] Endpoint returned non-OK:', { url, status: response.status });
                    continue;
                }

                const json = await response.json();
                if (json && typeof json === 'object' && Array.isArray((json as { features?: unknown[] }).features)) {
                    payload = json as { type?: string; features?: unknown[] };
                    break;
                }

                console.warn('[CoCoRaHS] Unexpected payload shape from endpoint', { url });
            } catch (err) {
                console.warn('[CoCoRaHS] Failed endpoint fetch', { url, error: err });
            }
        }

        return payload;
    };

    let payload = await fetchForDate(dateKey);
    let rawFeatures = Array.isArray(payload?.features) ? payload.features : [];

    if (rawFeatures.length === 0) {
        const previousDateKey = shiftUtcDays(dateKey, -1);
        const fallbackPayload = await fetchForDate(previousDateKey);
        const fallbackFeatures = Array.isArray(fallbackPayload?.features) ? fallbackPayload.features : [];

        if (fallbackFeatures.length > 0) {
            console.warn('[CoCoRaHS] Using previous report day because requested day returned no reports', {
                requestedDateKey: dateKey,
                fallbackDateKey: previousDateKey,
                featureCount: fallbackFeatures.length,
            });
            payload = fallbackPayload;
            rawFeatures = fallbackFeatures;
        }
    }

    if (!payload) {
        throw new Error('CoCoRaHS request failed: no valid response from known endpoints');
    }

    if (rawFeatures.length === 0) {
        console.warn('[CoCoRaHS] Feed returned no reports after fallback', { dateKey });
    }

    return {
        type: 'FeatureCollection',
        features: rawFeatures
            .map((feature, index) => normalizeCoCoRaHSFeature(feature, index))
            .filter((feature): feature is CoCoRaHSFeature => Boolean(feature)),
    };
}

export function getCoCoRaHSDateKey(currentTimestamp?: string | null): string {
    const parsedDate = currentTimestamp ? parseTimestampUTC(currentTimestamp) : new Date();
    return parsedDate ? toUtcDateKey(parsedDate) : toUtcDateKey(new Date());
}

/** Local storm reports and CoCoRaHS observations from the Iowa Environmental Mesonet. */
export class ReportsClient {
    private readonly config: ReportsConfig;

    constructor(config: ReportsConfig = {}) {
        this.config = config;
    }

    fetchLocalStormReports(params: FetchLSRParams): Promise<LSRGeoJSON> {
        return fetchLocalStormReports(params, this.config);
    }

    fetchCoCoRaHSReports(currentTimestamp?: string | null): Promise<CoCoRaHSGeoJSON> {
        return fetchCoCoRaHSReports(currentTimestamp, this.config);
    }
}

export const createReportsClient = (config: ReportsConfig = {}): ReportsClient => new ReportsClient(config);
