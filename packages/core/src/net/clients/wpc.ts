import { request } from './shared.ts';
import type { ClientConfig } from './shared.ts';
import { parseCodsus } from './wpc-codsus.ts';
import { ICE_LAYER_IDS, WPC_PWPF_BASE_URL, buildLayerQueryUrl, getSnowLayerId } from './wpc-pwpf-constants.ts';
import type { ForecastDay, SnowThreshold } from './wpc-pwpf-constants.ts';
import { timestampToMs } from '../../time/timestamp.ts';
import { normalizeUpstreamBaseUrl } from '../http-config.ts';

export { WPC_PWPF_BASE_URL };

// NOAA WPC ArcGIS REST API Endpoint for Precip Hazards
export const WPC_HAZARDS_MAPSERVER = 'https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer';

// Layer IDs for ERO
// 0: Excessive Rainfall Day 1
// 1: Excessive Rainfall Day 2
// 2: Excessive Rainfall Day 3
// 3: Excessive Rainfall Day 4
// 4: Excessive Rainfall Day 5
const WPC_ERO_LAYERS = {
    1: 0,
    2: 1,
    3: 2,
    4: 3,
    5: 4
};

/**
 * Fetch WPC Excessive Rainfall Outlook (ERO) in GeoJSON format
 * @param day The forecast day (1 through 5)
 * @returns GeoJSON FeatureCollection
 */
export async function fetchWPCEro(day: 1 | 2 | 3 | 4 | 5, config: ClientConfig = {}, baseUrl: string = WPC_HAZARDS_MAPSERVER): Promise<GeoJSON.FeatureCollection> {
    const layerId = WPC_ERO_LAYERS[day];
    const url = `${normalizeUpstreamBaseUrl(baseUrl, WPC_HAZARDS_MAPSERVER)}/${layerId}/query?where=1%3D1&outFields=*&f=geojson`;

    try {
        const response = await request(config, url, {
            headers: {
                'Accept': 'application/json'
            },
        });

        if (!response.ok) {
            throw new Error(`WPC API error: ${response.status} ${response.statusText}`);
        }

        const text = await response.text();
        if (!text || text.trim().length === 0) {
            return {
                type: "FeatureCollection",
                features: []
            };
        }

        const data = JSON.parse(text);
        return data;
    } catch (error) {
        throw error;
    }
}


// NOAA WPC ArcGIS REST API Endpoint for WSSI
export const WSSI_MAPSERVER = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer';

// Layer IDs for WSSI Overall Impacts
// 1: Day 1 Overall
// 2: Day 2 Overall
// 3: Day 3 Overall
const WSSI_LAYERS = {
    1: 1,
    2: 2,
    3: 3
};

/**
 * Fetch WPC WSSI GeoJSON
 * @param day The forecast day (1, 2, or 3)
 * @returns GeoJSON FeatureCollection
 */
export async function fetchWSSI(day: 1 | 2 | 3, config: ClientConfig = {}, baseUrl: string = WSSI_MAPSERVER): Promise<GeoJSON.FeatureCollection> {
    const layerId = WSSI_LAYERS[day];
    // Use objectid>0 to get all features. 
    // Note: ArcGIS REST requires proper encoding.
    const url = `${normalizeUpstreamBaseUrl(baseUrl, WSSI_MAPSERVER)}/${layerId}/query?where=objectid%3E0&outFields=*&f=geojson`;

    try {
        const response = await request(config, url, {
            headers: {
                'Accept': 'application/json'
            },
        });

        if (!response.ok) {
            throw new Error(`WSSI API error: ${response.status} ${response.statusText}`);
        }

        const text = await response.text();
        if (!text || text.trim().length === 0) {
            return {
                type: "FeatureCollection",
                features: []
            };
        }

        // Sometimes ArcGIS returns error in JSON with 200 OK
        const data = JSON.parse(text);
        if (data.error) {
            throw new Error(`WSSI ArcGIS Error: ${data.error.message}`);
        }
        
        return data;
    } catch (error) {
        throw error;
    }
}

export const NWS_COD_PRODUCTS = 'https://api.weather.gov/products';
// The 0.1-degree form of the coded surface analysis (ASUS01 is the whole-degree form of the same chart).
const CODSUS_COLLECTIVE_ID = 'ASUS02';
const CODSUS_LIST_TTL_MS = 2 * 60 * 1000;

interface CodsusEntry {
    id: string;
    time: number;
}


const emptyCollection = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });
const identity = (data: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection => data;

export interface WpcPwpfConfig extends ClientConfig {
    /** Winter-precipitation MapServer URL; defaults to {@link WPC_PWPF_BASE_URL}. */
    baseUrl?: string;
    /**
     * Applied to every fetched layer after its metadata is added, for example the donut-polygon clipping
     * that needs a geometry library. Defaults to returning the layer unchanged.
     */
    postProcess?: (data: GeoJSON.FeatureCollection) => GeoJSON.FeatureCollection;
}

function addProperties(
    data: GeoJSON.FeatureCollection,
    extra: Record<string, unknown>
): GeoJSON.FeatureCollection {
    const features = data.features.map(feature => ({
        ...feature,
        properties: {
            ...(feature.properties || {}),
            ...extra,
        },
    }));

    return {
        ...data,
        features,
    };
}

async function fetchLayerGeoJson(layerId: number, config: WpcPwpfConfig): Promise<GeoJSON.FeatureCollection> {
    const url = buildLayerQueryUrl(layerId, normalizeUpstreamBaseUrl(config.baseUrl, WPC_PWPF_BASE_URL));

    const response = await request(config, url, {
        headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as GeoJSON.FeatureCollection;
    return data?.type === 'FeatureCollection' ? data : emptyCollection();
}

async function fetchSnowProbability(
    day: ForecastDay,
    threshold: SnowThreshold,
    config: WpcPwpfConfig,
): Promise<GeoJSON.FeatureCollection> {
    const layerId = getSnowLayerId(day, threshold);

    try {
        const raw = await fetchLayerGeoJson(layerId, config);
        const withMetadata = addProperties(raw, { threshold, day, type: 'snow' });
        return (config.postProcess ?? identity)(withMetadata);
    } catch (error) {
        void error;
        return emptyCollection();
    }
}

export async function fetchAllSnowProbabilities(day: ForecastDay, config: WpcPwpfConfig = {}): Promise<GeoJSON.FeatureCollection> {
    const thresholds: SnowThreshold[] = ['04', '08', '12'];

    try {
        const results = await Promise.all(
            thresholds.map(threshold => fetchSnowProbability(day, threshold, config))
        );

        return {
            type: 'FeatureCollection',
            features: results.flatMap(result => result.features || []),
        };
    } catch {
        return emptyCollection();
    }
}

export async function fetchIceProbability(day: ForecastDay, config: WpcPwpfConfig = {}): Promise<GeoJSON.FeatureCollection> {
    const layerId = ICE_LAYER_IDS[day];

    try {
        const raw = await fetchLayerGeoJson(layerId, config);
        const withMetadata = addProperties(raw, { threshold: 'ice_025', day, type: 'ice' });
        return (config.postProcess ?? identity)(withMetadata);
    } catch (error) {
        void error;
        return emptyCollection();
    }
}

export interface WPCClientConfig extends WpcPwpfConfig {
    /** Excessive-rainfall MapServer; defaults to {@link WPC_HAZARDS_MAPSERVER}. */
    hazardsUrl?: string;
    /** Winter-storm severity MapServer; defaults to {@link WSSI_MAPSERVER}. */
    wssiUrl?: string;
    /** NWS product API base; defaults to {@link NWS_COD_PRODUCTS}. */
    productsUrl?: string;
}

/** WPC and NWS public products: excessive rainfall, winter storm severity, surface analysis and winter precipitation probabilities. */
export class WPCClient {
    private readonly config: WPCClientConfig;
    private readonly productsUrl: string;
    private readonly now: () => number;
    private readonly codsusLists = new Map<string, { fetchedAt: number; entries: Promise<CodsusEntry[]> }>();
    private readonly codsusCharts = new Map<string, Promise<GeoJSON.FeatureCollection>>();

    constructor(config: WPCClientConfig = {}) {
        this.config = config;
        this.productsUrl = normalizeUpstreamBaseUrl(config.productsUrl, NWS_COD_PRODUCTS);
        this.now = config.now ?? (() => Date.now());
    }

    fetchEro(day: 1 | 2 | 3 | 4 | 5): Promise<GeoJSON.FeatureCollection> {
        return fetchWPCEro(day, this.config, this.config.hazardsUrl);
    }

    fetchWssi(day: 1 | 2 | 3): Promise<GeoJSON.FeatureCollection> {
        return fetchWSSI(day, this.config, this.config.wssiUrl);
    }

    fetchAllSnowProbabilities(day: ForecastDay): Promise<GeoJSON.FeatureCollection> {
        return fetchAllSnowProbabilities(day, this.config);
    }

    fetchIceProbability(day: ForecastDay): Promise<GeoJSON.FeatureCollection> {
        return fetchIceProbability(day, this.config);
    }

    private async fetchNwsJson<T>(url: string): Promise<T> {
        const response = await request(this.config, url, { headers: { Accept: 'application/ld+json, application/json' } });
        if (!response.ok) throw new Error(`NWS products error: ${response.status} ${response.statusText}`);
        return await response.json() as T;
    }

    private listCodsus(): Promise<CodsusEntry[]> {
        const codsusList = this.codsusLists.get('latest');
        if (codsusList && this.now() - codsusList.fetchedAt < CODSUS_LIST_TTL_MS) return codsusList.entries;
        const entries = this.fetchNwsJson<{ '@graph'?: Array<{ id: string; wmoCollectiveId: string; issuanceTime: string }> }>(`${this.productsUrl}/types/COD`)
            .then((list) => (list['@graph'] ?? [])
                .filter((product) => product.wmoCollectiveId === CODSUS_COLLECTIVE_ID)
                .map((product) => ({ id: product.id, time: Date.parse(product.issuanceTime) }))
                .filter((entry) => Number.isFinite(entry.time)));
        const record = { fetchedAt: this.now(), entries };
        this.codsusLists.set('latest', record);
        entries.catch(() => { if (this.codsusLists.get('latest') === record) this.codsusLists.delete('latest'); });
        return entries;
    }

    private loadCodsusChart(id: string): Promise<GeoJSON.FeatureCollection> {
        const cached = this.codsusCharts.get(id);
        if (cached) return cached;
        const chart = this.fetchNwsJson<{ productText?: string }>(`${this.productsUrl}/${encodeURIComponent(id)}`)
            .then((product) => parseCodsus(product.productText ?? '', true));
        this.codsusCharts.set(id, chart);
        chart.catch(() => { this.codsusCharts.delete(id); });
        return chart;
    }

    async fetchSurfaceAnalysis(requestedTimestamp?: string): Promise<GeoJSON.FeatureCollection> {
        try {
            const entries = await this.listCodsus();
            const target = (requestedTimestamp ? timestampToMs(requestedTimestamp) : null) ?? this.now();
            const selected = entries.reduce<CodsusEntry | null>((best, entry) => !best || Math.abs(entry.time - target) < Math.abs(best.time - target) ? entry : best, null);
            if (!selected) return { type: 'FeatureCollection', features: [] };
            return await this.loadCodsusChart(selected.id);
        } catch (error) {
            void error;
            return { type: "FeatureCollection", features: [] };
        }
    }

}

export const createWPCClient = (config: WPCClientConfig = {}): WPCClient => new WPCClient(config);
