/**
 * NWS API Client
 * Interfaces with api.weather.gov
 */

import { fetchWithTimeout } from '../fetch-with-timeout.ts';
import { DEFAULT_NWS_USER_AGENT, nwsHeaders, normalizeUpstreamBaseUrl } from '../http-config.ts';

export { DEFAULT_NWS_USER_AGENT };

interface NWSAlertFeature {
    id: string;
    properties: {
        event: string;
        headline: string;
        description: string;
        instruction: string | null;
        severity: string;
        certainty: string;
        urgency: string;
        onset: string | null;
        effective: string | null;
        expires: string;
        ends: string | null;
        areaDesc: string;
        senderName: string;
    };
}

interface NWSAlertsResponse {
    type: string;
    features: NWSAlertFeature[];
    title: string;
    updated: string;
}

interface NWSPointMetadata {
    id: string;
    type: string;
    geometry: {
        type: string;
        coordinates: [number, number];
    };
    properties: {
        gridId: string;
        gridX: number;
        gridY: number;
        forecast: string;
        forecastHourly: string;
        forecastGridData: string;
        relativeLocation: {
            properties: {
                city: string;
                state: string;
            };
        };
        timeZone: string;
    };
}

export interface NWSForecastPeriod {
    number: number;
    name: string;
    startTime: string;
    endTime: string;
    isDaytime: boolean;
    temperature: number;
    temperatureUnit: string;
    temperatureTrend: string | null;
    windSpeed: string;
    windDirection: string;
    icon: string;
    shortForecast: string;
    detailedForecast: string;
}

interface NWSHourlyPeriod extends NWSForecastPeriod {
    probabilityOfPrecipitation?: {
        value: number | null;
        unitCode: string;
    };
    dewpoint?: {
        value: number | null;
        unitCode: string;
    };
    relativeHumidity?: {
        value: number | null;
        unitCode: string;
    };
    windGust?: string;
    apparentTemperature?: {
        value: number | null;
        unitCode: string;
    };
}

interface NWSForecastResponse {
    properties: {
        updated: string;
        units: string;
        forecastGenerator: string;
        generatedAt: string;
        updateTime: string;
        validTimes: string;
        elevation: {
            value: number;
            unitCode: string;
        };
        periods: NWSForecastPeriod[];
    };
}

interface NWSHourlyForecastResponse {
    properties: {
        updated: string;
        units: string;
        forecastGenerator: string;
        generatedAt: string;
        updateTime: string;
        validTimes: string;
        elevation: {
            value: number;
            unitCode: string;
        };
        periods: NWSHourlyPeriod[];
    };
}

interface NWSGridDataValue {
    validTime: string; // ISO 8601 duration (e.g. 2026-02-22T12:00:00+00:00/PT1H)
    value: number | null;
}

interface NWSGridDataProperty {
    uom: string; // Unit of measure (e.g. wmoUnit:mm, wmoUnit:degC)
    values: NWSGridDataValue[];
}

interface NWSGridDataResponse {
    id: string;
    properties: {
        updateTime: string;
        validTimes: string;
        elevation: {
            unitCode: string;
            value: number;
        };
        temperature: NWSGridDataProperty;
        dewpoint: NWSGridDataProperty;
        maxTemperature: NWSGridDataProperty;
        minTemperature: NWSGridDataProperty;
        relativeHumidity: NWSGridDataProperty;
        apparentTemperature: NWSGridDataProperty; // Feels like
        heatIndex: NWSGridDataProperty;
        windChill: NWSGridDataProperty;
        skyCover: NWSGridDataProperty;
        windDirection: NWSGridDataProperty;
        windSpeed: NWSGridDataProperty;
        windGust: NWSGridDataProperty;
        probabilityOfPrecipitation: NWSGridDataProperty;
        quantitativePrecipitation: NWSGridDataProperty; // QPF (liquid equivalent)
        iceAccumulation: NWSGridDataProperty;
        snowfallAmount: NWSGridDataProperty;
        snowLevel: NWSGridDataProperty;
    };
}

export interface NWSClientConfig {
    /** User-Agent sent on every request. Defaults to {@link DEFAULT_NWS_USER_AGENT}. */
    userAgent?: string;
    /** Upstream origin override (no trailing slash needed). Defaults to api.weather.gov. */
    baseUrl?: string;
}

export type NWSAlertRegion = { area: string[] } | { region: string[] } | { zone: string[] };

/**
 * NWS API client. Each instance carries its own User-Agent and upstream
 * base URL — create one per consumer with {@link createNWSClient}.
 * Instances are immutable after construction, so clients never share state.
 */
export class NWSAPI {
    private readonly userAgent: string;
    private readonly baseUrl: string;

    constructor(config: NWSClientConfig = {}) {
        this.userAgent = config.userAgent ?? DEFAULT_NWS_USER_AGENT;
        this.baseUrl = normalizeUpstreamBaseUrl(config.baseUrl, 'https://api.weather.gov');
    }

    async getRegionAlerts<T = NWSAlertsResponse>(region: NWSAlertRegion, signal?: AbortSignal): Promise<T> {
        const entries = Object.entries(region);
        if (entries.length !== 1 || !['area', 'region', 'zone'].includes(entries[0][0]))
            throw new Error('unsupported region type');
        const [kind, values] = entries[0];
        if (
            !Array.isArray(values) ||
            !values.length ||
            values.some((v) => typeof v !== 'string' || !v.trim())
        )
            throw new Error('Region requires non-empty codes');
        return this.getResource<T>(
            `${this.baseUrl}/alerts/active?${kind}=${encodeURIComponent(values.join(','))}`,
            signal,
        );
    }

    async getAlertById<T = import('../types.ts').NWSAlertFeature>(
        capId: string,
        signal?: AbortSignal,
    ): Promise<T> {
        if (!capId.trim()) throw new Error('Alert ID must not be empty');
        return this.getResource<T>(`${this.baseUrl}/alerts/${encodeURIComponent(capId)}`, signal);
    }

    async getResource<T>(url: string, signal?: AbortSignal): Promise<T> {
        const response = await fetchWithTimeout(url, { headers: nwsHeaders(this.userAgent), signal });
        if (!response.ok) {
            throw new Error(`NWS request failed (${response.status}) for ${url}`);
        }
        return (await response.json()) as T;
    }

    /**
     * Get metadata for a lat/lon point
     */
    async getPoint<T = NWSPointMetadata>(lat: number, lon: number, signal?: AbortSignal): Promise<T> {
        // NWS API uses 4 decimal places of precision max recommended
        const latStr = lat.toFixed(4);
        const lonStr = lon.toFixed(4);

        return this.getResource<T>(`${this.baseUrl}/points/${latStr},${lonStr}`, signal);
    }

    /**
     * Get forecast from a URL provided by getPoint
     */
    async getForecast<T = NWSForecastResponse>(url: string, signal?: AbortSignal): Promise<T> {
        return this.getResource<T>(url, signal);
    }

    async getHourlyForecast<T = NWSHourlyForecastResponse>(url: string, signal?: AbortSignal): Promise<T> {
        return this.getResource<T>(url, signal);
    }

    async getGridData<T = NWSGridDataResponse>(url: string, signal?: AbortSignal): Promise<T> {
        return this.getResource<T>(url, signal);
    }

    async getStations<T>(url: string, signal?: AbortSignal): Promise<T> {
        return this.getResource<T>(url, signal);
    }

    async getLatestObservation<T>(stationId: string, signal?: AbortSignal): Promise<T> {
        return this.getResource<T>(
            `${this.baseUrl}/stations/${encodeURIComponent(stationId)}/observations/latest`,
            signal,
        );
    }

    async getAlerts<T = NWSAlertsResponse>(lat: number, lon: number, signal?: AbortSignal): Promise<T> {
        const point = `${lat.toFixed(4)},${lon.toFixed(4)}`;
        return this.getResource<T>(`${this.baseUrl}/alerts/active?point=${point}`, signal);
    }
}

/** Create an NWS client with its own User-Agent and optional base-URL override. */
export function createNWSClient(config: NWSClientConfig = {}): NWSAPI {
    return new NWSAPI(config);
}
