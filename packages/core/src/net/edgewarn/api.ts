/**
 * EdgeWARN API Client
 * Provides methods to interact with the EdgeWARN Features API
 */

import type { Cell, StormCellList } from './types.ts';
import type { NWSData } from '../types.ts';
import { createJsonRequester, type RequestOptions } from './client.ts';
import { extractNWSAlertItems, toNWSFeature } from './alert-payload.ts';
import { assertValidTimestamp } from './validators.ts';

export interface EdgeWARNApiConfig {
    baseUrl: string;
    routes: { stormSnapshots: string; cells: string; alerts: string; alertSnapshots: string; health: string };
    alertQuery: Record<string, string>;
    pageSize: number;
}
export type ExpiryCache<V> = Pick<Map<string, V>, 'get' | 'set' | 'delete'>;
export interface EdgeWARNApiDeps {
    cache: <V>() => ExpiryCache<V>;
}

export class EdgeWARNAPI {
    private readonly config: EdgeWARNApiConfig;
    private baseUrl: string;
    private readonly stormSnapshotCache: ExpiryCache<Promise<{ cells?: unknown }>>;
    private readonly nwsAlertFeatureCache: ExpiryCache<NWSData['data']['features'][number]>;
    private readonly requestJson: <T>(
        path: string,
        params?: Record<string, string | number | undefined>,
        options?: RequestOptions
    ) => Promise<T>;

    /**
     * Create an API client instance
     * @param baseUrl - Base URL of the API server (e.g., 'http://localhost:3000')
     */
    constructor(config: EdgeWARNApiConfig, deps: EdgeWARNApiDeps) {
        this.config = config;
        this.stormSnapshotCache = deps.cache();
        this.nwsAlertFeatureCache = deps.cache();
        this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.requestJson = createJsonRequester(this.baseUrl);
    }

    private async resource<T>(path: string, params?: Record<string, string | number | undefined>, options?: RequestOptions): Promise<T> {
        const envelope = await this.requestJson<{ data: T; meta?: Record<string, unknown> }>(path, params, options);
        if (!envelope || typeof envelope !== 'object' || !('data' in envelope)) {
            throw new Error(`Invalid resource envelope from ${path}`);
        }
        return envelope.data;
    }

    private async collection<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T[]> {
        const all: T[] = [];
        const seen = new Set<string>();
        let cursor: string | undefined;
        do {
            const envelope = await this.requestJson<{ data: T[]; meta?: { nextCursor?: string | null } }>(path, {
                ...params, limit: this.config.pageSize, cursor,
            });
            if (!Array.isArray(envelope?.data)) throw new Error(`Invalid collection envelope from ${path}`);
            all.push(...envelope.data);
            const next = envelope.meta?.nextCursor ?? null;
            if (next !== null && (typeof next !== 'string' || !next || seen.has(next))) {
                throw new Error(`Invalid or repeating cursor from ${path}`);
            }
            if (next) seen.add(next);
            cursor = next ?? undefined;
        } while (cursor);
        return all;
    }

    /**
     * Resolve an alert payload by ID, preferring the raw OID and falling back
     * to legacy filename-safe IDs for backward compatibility.
     */
    private async fetchNWSAlertPayloadById(alertId: string): Promise<unknown> {
        return await this.resource<unknown>(`${this.config.routes.alerts}/${encodeURIComponent(alertId)}`, this.config.alertQuery);
    }

    /**
     * Fetch available stormcell timestamps
     * @returns Array of timestamps in YYYYMMDD-HHMMSS format
     */
    async fetchTimestamps(): Promise<string[]> {
        try {
            return await this.collection<string>(`${this.config.routes.stormSnapshots}`);
        } catch (error) {
            console.error(`[EdgeWARNAPI] Failed to fetch timestamps:`, error);
            throw error;
        }
    }

    /**
     * Download stormcell list data for a specific timestamp
     * @param timestamp - Timestamp in YYYYMMDD-HHMMSS format
     * @returns Stormcell list JSON data
     */
    async downloadStormcellList(timestamp: string): Promise<StormCellList | Cell[]> {
        assertValidTimestamp(timestamp);

        try {
            let request = this.stormSnapshotCache.get(timestamp);
            if (!request) {
                request = this.resource<{ cells?: unknown }>(`${this.config.routes.stormSnapshots}/${encodeURIComponent(timestamp)}`, undefined, { cache: 'no-store' });
                this.stormSnapshotCache.set(timestamp, request);
                request.catch(() => { if (this.stormSnapshotCache.get(timestamp) === request) this.stormSnapshotCache.delete(timestamp); });
            }
            const snapshot = await request;
            return (snapshot?.cells ?? snapshot) as StormCellList | Cell[];
        } catch (error) {
            console.error(`[EdgeWARNAPI] Failed to download stormcell list for timestamp ${timestamp}:`, error);
            throw error;
        }
    }

    /**
     * Download the full history (with module outputs such as StormProb
     * `leads[]`) for a single storm cell.
     *
     * Storm snapshots are lightweight:
     * each cell only lists module names (e.g. `modules: ["StormProb"]`) and
     * carries no lead polygons. The per-cell resource returns the complete
     * cell states, newest last.
     * @param cellId - Cell ID as shown in the snapshot `id` field
     * @returns Array of historical cell states (may be empty)
     */
    async downloadCellHistory(cellId: number | string): Promise<Cell[]> {
        const normalized = String(cellId).trim();
        if (!normalized) {
            throw new Error(`Invalid cell ID: ${String(cellId)}. Expected a non-empty ID.`);
        }

        try {
            const value = await this.resource<Cell[] | Cell | { history?: Cell[] }>(`${this.config.routes.cells}/${encodeURIComponent(normalized)}`);
            if (Array.isArray(value)) return value as Cell[];
            if (value && typeof value === 'object' && Array.isArray((value as { history?: Cell[] }).history)) {
                return (value as { history: Cell[] }).history;
            }
            return value ? [value as Cell] : [];
        } catch (error) {
            console.error(`[EdgeWARNAPI] Failed to download cell history for ID ${normalized}:`, error);
            throw error;
        }
    }

    /**
     * Check server health
     * @returns Health status object
     */
    async checkHealth(): Promise<Record<string, unknown>> {
        try {
            return await this.requestJson<Record<string, unknown>>(this.config.routes.health);
        } catch (error) {
            console.error(`[EdgeWARNAPI] Health check failed:`, error);
            throw error;
        }
    }

    /**
     * Fetch available NWS alert timestamps
     * @returns Array of timestamps
     */
    async fetchNWSTimestamps(): Promise<string[]> {
        return this.collection<string>(`${this.config.routes.alertSnapshots}`, this.config.alertQuery);
    }

    /**
     * Fetch the complete alert list for a specific NWS timestamp.
     * @param timestamp - Timestamp in YYYYMMDD-HHMMSS format
     */
    async fetchNWSAlertList(timestamp: string): Promise<NWSData['data']['features']> {
        assertValidTimestamp(timestamp);

        const snapshot = await this.resource<{ alerts?: unknown[] }>(`${this.config.routes.alertSnapshots}/${encodeURIComponent(timestamp)}`, this.config.alertQuery);
        const payload = snapshot.alerts ?? [];

        const rawItems = extractNWSAlertItems(payload);

        return rawItems
            .map(item => toNWSFeature(item, ''))
            .filter((f): f is NWSData['data']['features'][number] => Boolean(f));
    }

    /**
     * Download a single NWS alert feature by alert ID.
     * @param alertId - Official alert OID
     */
    async downloadNWSAlert(alertId: string): Promise<NWSData['data']['features'][number] | null> {
        const normalizedAlertId = String(alertId).trim();
        if (!normalizedAlertId) {
            console.warn('[EdgeWARNAPI] downloadNWSAlert called with empty ID');
            return null;
        }


        // Always attempt to fetch fresh data for hydration since the API
        // returns full data when queried by ID (unlike the list endpoint)
        try {
            const payload = await this.fetchNWSAlertPayloadById(normalizedAlertId);
            const feature = toNWSFeature(payload, normalizedAlertId);

            if (feature) {
                this.nwsAlertFeatureCache.set(feature.id, feature);
            }
            return feature;
        } catch (error) {
            console.warn(`[EdgeWARNAPI] Failed to fetch alert ${normalizedAlertId}:`, error);
            // Fallback to cache if fetch fails
            const cachedFeature = this.nwsAlertFeatureCache.get(normalizedAlertId);
            return cachedFeature ?? null;
        }
    }

    /**
     * Download NWS alert data for a specific timestamp
     * @param timestamp - Timestamp in YYYYMMDD-HHMMSS format
     * @returns NWS data
     */
    async downloadNWS(
        timestamp: string,
        onFeatureDownloaded?: (feature: NWSData['data']['features'][number]) => void | Promise<void>
    ): Promise<NWSData> {
        assertValidTimestamp(timestamp);

        let attempts = 0;
        const maxRetries = 3;
        const baseDelay = 500; // ms

        while (true) {
            try {
                attempts++;
                const features = await this.fetchNWSAlertList(timestamp);

                if (onFeatureDownloaded) {
                    await Promise.allSettled(
                        features.map(f => onFeatureDownloaded(f))
                    );
                }

                return {
                    type: 'nws',
                    timestamp,
                    data: {
                        type: 'FeatureCollection',
                        features
                    }
                };

            } catch (err) {
                if (attempts > maxRetries) {
                    throw err;
                }

                console.warn(`[EdgeWARNAPI] downloadNWS failed (Attempt ${attempts}/${maxRetries + 1}). Retrying... Error: ${(err as Error).message}`);

                // Exponential backoff
                const delay = baseDelay * Math.pow(2, attempts - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
}
