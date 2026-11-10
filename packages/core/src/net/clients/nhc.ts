import { request } from './shared.ts';
import type { ClientConfig } from './shared.ts';
import { normalizeUpstreamBaseUrl } from '../http-config.ts';

/** NOAA/NHC operational forecast geometry; this service is not time enabled. */
export const TROPICAL_SOURCE_URL = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer';
export const CONE_DESCRIPTION = 'The cone shows uncertainty in the storm center’s track. Impacts can occur outside the cone; it does not show storm size.';
type CycloneKind = 'cone' | 'track' | 'point';
export interface CycloneProperties extends Record<string, unknown> {
    kind: CycloneKind;
    stormname?: string;
    advisnum?: string;
    advdate?: string;
    maxwind?: number;
    tau?: number;
    datelbl?: string;
    stormtype?: string;
    _color: string;
    _label: string;
}
export type CycloneCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, CycloneProperties>;
export interface CycloneStatus {
    level: 'idle' | 'loading' | 'ready' | 'empty' | 'error';
    message: string;
    updatedAt?: number;
}

export function cycloneColor(wind: unknown): string {
    if (typeof wind !== 'number' || !Number.isFinite(wind) || wind < 0 || wind > 250) return '#94a3b8';
    if (wind >= 96) return '#fb7185';
    if (wind >= 64) return '#fbbf24';
    if (wind >= 34) return '#38bdf8';
    return '#a3e635';
}

type CycloneTier = 'depression' | 'storm' | 'hurricane' | 'major';
interface CycloneCategory {
    tier: CycloneTier;
    label: string;
    /** Position on the seven-step scale: 0 depression, 1 tropical storm, 2-6 Category 1-5. */
    step: number;
}

/** Saffir-Simpson categories from max sustained wind in knots; tiers match cycloneColor. */
export function cycloneCategory(wind: unknown): CycloneCategory | null {
    if (typeof wind !== 'number' || !Number.isFinite(wind) || wind < 0 || wind > 250) return null;
    if (wind >= 137) return { tier: 'major', label: 'Category 5 hurricane', step: 6 };
    if (wind >= 113) return { tier: 'major', label: 'Category 4 hurricane', step: 5 };
    if (wind >= 96) return { tier: 'major', label: 'Category 3 hurricane', step: 4 };
    if (wind >= 83) return { tier: 'hurricane', label: 'Category 2 hurricane', step: 3 };
    if (wind >= 64) return { tier: 'hurricane', label: 'Category 1 hurricane', step: 2 };
    if (wind >= 34) return { tier: 'storm', label: 'Tropical storm', step: 1 };
    return { tier: 'depression', label: 'Tropical depression', step: 0 };
}

/** NHC names include the storm type ("Tropical Storm Rachel"); the popup shows the category separately. */
export function bareStormName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    return name.replace(/^(Major Hurricane|Hurricane|(Sub|Post-|Potential )?Tropical (Storm|Depression|Cyclone))\s+/i, '') || name;
}

export const KNOTS_TO_MPH = 1.15078;

/** NHC writes advisory times as "1100 AM PDT Sat Oct 10 2026"; add the colon. */
export function formatAdvisoryTime(value: unknown): string {
    return typeof value === 'string' ? value.replace(/^(\d{1,2})(\d{2}) (AM|PM)/, '$1:$2 $3') : '';
}

export interface NHCClientConfig extends ClientConfig {
    /** NHC tropical weather summary MapServer; defaults to {@link TROPICAL_SOURCE_URL}. */
    baseUrl?: string;
}

/** Fail closed on upstream errors rather than reporting “no active storms”. */
export async function fetchCycloneForecasts(
    signal?: AbortSignal,
    config: NHCClientConfig = {},
): Promise<CycloneCollection> {
    const layers = [{ id: 7, kind: 'cone' }, { id: 6, kind: 'track' }, { id: 5, kind: 'point' }] as const;
    const baseUrl = normalizeUpstreamBaseUrl(config.baseUrl, TROPICAL_SOURCE_URL);
    const collections = await Promise.all(layers.map(async ({ id, kind }) => {
        const features: CycloneCollection['features'] = [];
        // Page by stable object ID so a truncated ArcGIS response never silently drops storms.
        for (let offset = 0; ;) {
            const params = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'geojson',
                orderByFields: 'objectid ASC', resultOffset: String(offset), resultRecordCount: '1000' });
            const response = await request({ timeoutMs: 15000, ...config }, `${baseUrl}/${id}/query?${params}`, { signal });
            if (!response.ok) throw new Error(`NOAA tropical feed returned ${response.status}`);
            const data = await response.json();
            if (data.error || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
                throw new Error('Invalid NOAA tropical forecast response');
            }
            for (const feature of data.features as GeoJSON.Feature[]) {
                const type = feature.geometry?.type;
                const allowed = kind === 'cone' ? ['Polygon', 'MultiPolygon'] : kind === 'track' ? ['LineString', 'MultiLineString'] : ['Point'];
                if (!type || !allowed.includes(type)) throw new Error('Unexpected NOAA tropical geometry');
                const props = Object.fromEntries(Object.entries(feature.properties ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
                const current = props.tau != null && Number(props.tau) === 0;
                features.push({ ...feature, properties: { ...props, kind,
                    _color: cycloneColor(props.maxwind),
                    _label: kind === 'point' ? (current ? String(props.stormname ?? 'Cyclone') : String(props.datelbl ?? '')) : '',
                } });
            }
            if (!data.exceededTransferLimit && data.features.length < 1000) break;
            if (!data.features.length || offset >= 10000) throw new Error('Incomplete NOAA tropical forecast response');
            offset += data.features.length;
        }
        return features;
    }));
    return { type: 'FeatureCollection', features: collections.flat() };
}


/** NOAA/NHC cone, track and point forecast layers. */
export class NHCClient {
    private readonly config: NHCClientConfig;

    constructor(config: NHCClientConfig = {}) {
        this.config = config;
    }

    fetchForecasts(signal?: AbortSignal): Promise<CycloneCollection> {
        return fetchCycloneForecasts(signal, this.config);
    }
}

export const createNHCClient = (config: NHCClientConfig = {}): NHCClient => new NHCClient(config);
