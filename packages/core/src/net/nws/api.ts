/**
 * NWS API Client
 * Interfaces with api.weather.gov
 */

import { fetchWithTimeout } from '../fetch-with-timeout.ts';

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

// NWS asks every client for a User-Agent and can refuse Node's default one.
// Browsers forbid setting the header, so it is sent from the server only.
let userAgent = 'edgewarn-core (https://github.com/yuchen-wei3667/edgewarn-web-utils)';
export function setNwsUserAgent(value: string): void { userAgent = value; }

const nwsHeaders = (): Record<string, string> => typeof window === 'undefined'
    ? { Accept: 'application/geo+json', 'User-Agent': userAgent }
    : { Accept: 'application/geo+json' };

export class NWSAPI {
    static async getResource<T>(url: string, signal?: AbortSignal): Promise<T> {
        const response = await fetchWithTimeout(url, { headers: nwsHeaders(), signal });
        if (!response.ok) {
            throw new Error(`NWS request failed (${response.status}) for ${url}`);
        }
        return await response.json() as T;
    }

    /**
     * Get metadata for a lat/lon point
     */
    static async getPoint<T = NWSPointMetadata>(lat: number, lon: number, signal?: AbortSignal): Promise<T> {
        // NWS API uses 4 decimal places of precision max recommended
        const latStr = lat.toFixed(4);
        const lonStr = lon.toFixed(4);

        return this.getResource<T>(`https://api.weather.gov/points/${latStr},${lonStr}`, signal);
    }

    /**
     * Get forecast from a URL provided by getPoint
     */
    static async getForecast<T = NWSForecastResponse>(url: string, signal?: AbortSignal): Promise<T> {
        return this.getResource<T>(url, signal);
    }

    static async getHourlyForecast<T = NWSHourlyForecastResponse>(url: string, signal?: AbortSignal): Promise<T> {
        return this.getResource<T>(url, signal);
    }

    static async getGridData<T = NWSGridDataResponse>(url: string, signal?: AbortSignal): Promise<T> {
        return this.getResource<T>(url, signal);
    }

    static async getStations<T>(url: string, signal?: AbortSignal): Promise<T> {
        return this.getResource<T>(url, signal);
    }

    static async getLatestObservation<T>(stationId: string, signal?: AbortSignal): Promise<T> {
        return this.getResource<T>(`https://api.weather.gov/stations/${encodeURIComponent(stationId)}/observations/latest`, signal);
    }

    static async getAlerts<T = NWSAlertsResponse>(lat: number, lon: number, signal?: AbortSignal): Promise<T> {
        const point = `${lat.toFixed(4)},${lon.toFixed(4)}`;
        return this.getResource<T>(`https://api.weather.gov/alerts/active?point=${point}`, signal);
    }
}
