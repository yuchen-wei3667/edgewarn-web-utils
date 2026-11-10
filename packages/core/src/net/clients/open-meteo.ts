import { request } from './shared.ts';
import type { ClientConfig } from './shared.ts';

export interface OpenMeteoHour {
  time: string;
  temperature: number | null;
  apparentTemperature: number | null;
  humidity: number | null;
  dewPoint: number | null;
  precipitationProbability: number | null;
  precipitation: number | null;
  cloudCover: number | null;
  pressure: number | null;
  visibility: number | null;
  uvIndex: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  weatherCode: number | null;
  isDay: boolean;
}

export interface OpenMeteoHourlyForecast {
  timeZone: string;
  fetchedAt: string;
  hours: OpenMeteoHour[];
}

export const OPEN_METEO_CACHE_TTL_MS = 30 * 60 * 1000;
/** Stored forecasts older than this are removed. */
export const OPEN_METEO_RETENTION_MS = 6 * 60 * 60 * 1000;
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const CACHE_PREFIX = 'edgewarn-open-meteo-hourly-v3:';

/** The part of the browser storage interface the client uses. Pass one to persist forecasts across sessions; omit it for memory only. */
export interface ForecastStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OpenMeteoConfig extends ClientConfig {
  /** Forecast endpoint; defaults to {@link OPEN_METEO_FORECAST_URL}. */
  baseUrl?: string;
  /** Injected persistent storage; absent means forecasts live in memory for the instance only. */
  storage?: ForecastStorage | null;
}

function isForecast(value: unknown): value is OpenMeteoHourlyForecast {
  if (!value || typeof value !== 'object') return false;
  const forecast = value as Partial<OpenMeteoHourlyForecast>;
  return typeof forecast.timeZone === 'string'
    && typeof forecast.fetchedAt === 'string'
    && Number.isFinite(Date.parse(forecast.fetchedAt))
    && Array.isArray(forecast.hours)
    && forecast.hours.length > 0
    && forecast.hours.every(hour => hour && typeof hour.time === 'string' && Number.isFinite(Date.parse(hour.time)));
}

type HourlyResponse = {
  time?: unknown;
  temperature_2m?: unknown;
  apparent_temperature?: unknown;
  relative_humidity_2m?: unknown;
  dew_point_2m?: unknown;
  precipitation_probability?: unknown;
  precipitation?: unknown;
  cloud_cover?: unknown;
  pressure_msl?: unknown;
  visibility?: unknown;
  uv_index?: unknown;
  wind_speed_10m?: unknown;
  wind_direction_10m?: unknown;
  weather_code?: unknown;
  is_day?: unknown;
};

function numberAt(values: unknown, index: number): number | null {
  if (!Array.isArray(values)) return null;
  const value: unknown = values[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function fetchOpenMeteoHourlyForecast(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
  forecastHours = 48,
  config: OpenMeteoConfig = {},
): Promise<OpenMeteoHourlyForecast> {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('Invalid forecast coordinates.');
  }

  const url = new URL(config.baseUrl ?? OPEN_METEO_FORECAST_URL);
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,cloud_cover,pressure_msl,visibility,uv_index,wind_speed_10m,wind_direction_10m,weather_code,is_day',
    forecast_hours: String(forecastHours),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    timeformat: 'unixtime',
  }).toString();

  const response = await request(config, url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Open-Meteo request failed (${response.status}).`);

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') throw new Error('Open-Meteo returned invalid forecast data.');
  const data = payload as { timezone?: unknown; hourly?: HourlyResponse };
  const hourly = data.hourly;
  if (typeof data.timezone !== 'string' || !hourly || !Array.isArray(hourly.time) || !hourly.time.length) {
    throw new Error('Open-Meteo returned incomplete hourly forecast data.');
  }

  const hours = hourly.time.map((timestamp: unknown, index: number): OpenMeteoHour | null => {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
    const time = new Date(timestamp * 1000);
    if (Number.isNaN(time.getTime())) return null;
    return {
      time: time.toISOString(),
      temperature: numberAt(hourly.temperature_2m, index),
      apparentTemperature: numberAt(hourly.apparent_temperature, index),
      humidity: numberAt(hourly.relative_humidity_2m, index),
      dewPoint: numberAt(hourly.dew_point_2m, index),
      precipitationProbability: numberAt(hourly.precipitation_probability, index),
      precipitation: numberAt(hourly.precipitation, index),
      cloudCover: numberAt(hourly.cloud_cover, index),
      pressure: numberAt(hourly.pressure_msl, index),
      visibility: numberAt(hourly.visibility, index),
      uvIndex: numberAt(hourly.uv_index, index),
      windSpeed: numberAt(hourly.wind_speed_10m, index),
      windDirection: numberAt(hourly.wind_direction_10m, index),
      weatherCode: numberAt(hourly.weather_code, index),
      isDay: numberAt(hourly.is_day, index) === 1,
    };
  }).filter((hour): hour is OpenMeteoHour => hour !== null);

  if (!hours.length) throw new Error('Open-Meteo returned no usable forecast hours.');
  return { timeZone: data.timezone, fetchedAt: new Date(config.now?.() ?? Date.now()).toISOString(), hours };
}

// Small GPS variations at the same place share a forecast without mixing neighborhoods.
function cacheKey(latitude: number, longitude: number): string {
  return `${CACHE_PREFIX}${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

/** Hourly forecasts with a shared in-flight request, an in-memory copy and optional injected storage. */
export class OpenMeteoClient {
  private readonly config: OpenMeteoConfig;
  private readonly storage: ForecastStorage | null;
  private readonly now: () => number;
  private readonly memoryCache = new Map<string, OpenMeteoHourlyForecast>();
  private readonly pendingRequests = new Map<string, Promise<OpenMeteoHourlyForecast>>();
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: OpenMeteoConfig = {}) {
    this.config = config;
    this.storage = config.storage ?? null;
    this.now = config.now ?? (() => Date.now());
  }

  /** Location history is physically removed, rather than merely ignored by the freshness check. */
  private pruneForecasts(): void {
    if (this.cleanupTimer !== null) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = null;
    const storage = this.storage;
    const now = this.now();
    let next = Infinity;
    for (const [key, forecast] of this.memoryCache) {
      const at = Date.parse(forecast.fetchedAt);
      if (!Number.isFinite(at) || at > now || now - at >= OPEN_METEO_RETENTION_MS) this.memoryCache.delete(key);
    }
    if (storage) {
      try {
        for (let i = storage.length - 1; i >= 0; i--) {
          const key = storage.key(i);
          if (!key?.startsWith('edgewarn-open-meteo-hourly-')) continue;
          let value: unknown = null;
          try { value = JSON.parse(storage.getItem(key) ?? 'null'); } catch { /* remove malformed data */ }
          const at = isForecast(value) ? Date.parse(value.fetchedAt) : NaN;
          if (!key.startsWith(CACHE_PREFIX) || !Number.isFinite(at) || at > now || now - at >= OPEN_METEO_RETENTION_MS) {
            storage.removeItem(key);
            this.memoryCache.delete(key);
          } else next = Math.min(next, at + OPEN_METEO_RETENTION_MS);
        }
      } catch { /* Private browsing can block storage. */ }
    }
    if (Number.isFinite(next)) {
      this.cleanupTimer = setTimeout(() => this.pruneForecasts(), Math.max(1, next - now));
      (this.cleanupTimer as unknown as { unref?: () => void }).unref?.();
    }
  }

  private readStored(latitude: number, longitude: number): OpenMeteoHourlyForecast | null {
    this.pruneForecasts();
    const key = cacheKey(latitude, longitude);
    const inMemory = this.memoryCache.get(key);
    if (inMemory) return inMemory;
    try {
      if (!this.storage) return null;
      const saved = this.storage.getItem(key);
      if (!saved) return null;
      const parsed: unknown = JSON.parse(saved);
      if (!isForecast(parsed)) return null;
      this.memoryCache.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  private save(latitude: number, longitude: number, forecast: OpenMeteoHourlyForecast): void {
    const key = cacheKey(latitude, longitude);
    this.memoryCache.set(key, forecast);
    try {
      this.storage?.setItem(key, JSON.stringify(forecast));
    } catch {
      // Private browsing or storage limits can disable persistence; memory still works.
    }
    this.pruneForecasts();
  }

  /** The cached forecast when it is under {@link OPEN_METEO_CACHE_TTL_MS} old, else one network read shared by every caller. */
  getHourlyForecast(latitude: number, longitude: number): Promise<OpenMeteoHourlyForecast> {
    const cached = this.readStored(latitude, longitude);
    const age = cached ? this.now() - Date.parse(cached.fetchedAt) : Infinity;
    if (cached && age >= 0 && age < OPEN_METEO_CACHE_TTL_MS) return Promise.resolve(cached);

    const key = cacheKey(latitude, longitude);
    const existing = this.pendingRequests.get(key);
    if (existing) return existing;

    const pending = this.fetchHourlyForecast(latitude, longitude)
      .then(forecast => {
        this.save(latitude, longitude, forecast);
        return forecast;
      })
      .finally(() => this.pendingRequests.delete(key));
    this.pendingRequests.set(key, pending);
    return pending;
  }

  fetchHourlyForecast(latitude: number, longitude: number, signal?: AbortSignal, forecastHours = 48): Promise<OpenMeteoHourlyForecast> {
    return fetchOpenMeteoHourlyForecast(latitude, longitude, signal, forecastHours, this.config);
  }
}

export const createOpenMeteoClient = (config: OpenMeteoConfig = {}): OpenMeteoClient => new OpenMeteoClient(config);
