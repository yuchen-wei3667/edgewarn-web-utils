import { normalizeNullableString, normalizeNumber, normalizeString } from '../normalize.ts';
import { normalizeUpstreamBaseUrl } from '../http-config.ts';
import { request } from './shared.ts';
import type { ClientConfig } from './shared.ts';
import type {
    SPCStormReportFeature,
    SPCStormReportProperties,
    SPCStormReportsGeoJSON,
    SPCStormReportType,
    SPCWatchDetails,
    SPCWatchSourceUrls,
} from './types.ts';

export type SPCDay = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type SPCOutlookType = 'categorical' | 'tornado' | 'hail' | 'wind';

export const SPC_BASE_URL = 'https://www.spc.noaa.gov';

export interface SPCClientConfig extends ClientConfig {
    /** Public SPC product root; defaults to {@link SPC_BASE_URL}. */
    baseUrl?: string;
}

// Day 3-8 only support the primary outlook product.
export const AVAILABLE_OUTLOOK_TYPES: Record<SPCDay, SPCOutlookType[]> = {
    1: ['categorical', 'tornado', 'hail', 'wind'],
    2: ['categorical', 'tornado', 'hail', 'wind'],
    3: ['categorical'],
    4: ['categorical'],
    5: ['categorical'],
    6: ['categorical'],
    7: ['categorical'],
    8: ['categorical'],
};

// Map outlook types to URL suffixes
const OUTLOOK_TYPE_URL_MAP: Record<SPCOutlookType, string> = {
    'categorical': 'cat',
    'tornado': 'torn',
    'hail': 'hail',
    'wind': 'wind'
};

/**
 * Get the GeoJSON URL for a specific SPC outlook
 * @param day The day (1-8)
 * @param type The type of outlook
 * @returns The complete URL to fetch
 */
function getSPCOutlookUrl(day: SPCDay, type: SPCOutlookType, baseUrl: string): string {
    if (day >= 4) {
        return `${baseUrl}/products/exper/day4-8/day${day}prob.lyr.geojson`;
    }

    const dayStr = `day${day}`;
    const typeStr = OUTLOOK_TYPE_URL_MAP[type];
    return `${baseUrl}/products/outlook/${dayStr}otlk_${typeStr}.lyr.geojson`;
}

/**
 * Fetch SPC Outlook in GeoJSON format
 * @param day The day (1-8)
 * @param type The type of outlook to fetch (default: categorical)
 * @returns GeoJSON FeatureCollection
 */
export async function fetchSPCOutlook(
    day: SPCDay,
    type: SPCOutlookType = 'categorical',
    config: SPCClientConfig = {},
): Promise<GeoJSON.FeatureCollection> {
    // Validate that the day supports this outlook type
    if (!AVAILABLE_OUTLOOK_TYPES[day]?.includes(type)) {
        throw new Error(`Day ${day} does not support ${type} outlooks`);
    }

    const url = getSPCOutlookUrl(day, type, normalizeUpstreamBaseUrl(config.baseUrl, SPC_BASE_URL));

    try {
        const response = await request(config, url, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`SPC API error: ${response.status} ${response.statusText}`);
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

const PROBABILITY_FIELD_MAP: Record<string, keyof SPCWatchDetails['probabilities']> = {
    'PROB OF 2 OR MORE TORNADOES': 'twoOrMoreTornadoes',
    'PROB OF 1 OR MORE STRONG /EF2-EF5/ TORNADOES': 'strongTornadoes',
    'PROB OF 10 OR MORE SEVERE WIND EVENTS': 'tenOrMoreSevereWindEvents',
    'PROB OF 1 OR MORE WIND EVENTS >= 65 KNOTS': 'windEvents65KnotsOrMore',
    'PROB OF 10 OR MORE SEVERE HAIL EVENTS': 'tenOrMoreSevereHailEvents',
    'PROB OF 1 OR MORE HAIL EVENTS >= 2 INCHES': 'hailEvents2InchesOrMore',
    'PROB OF 6 OR MORE COMBINED SEVERE HAIL/WIND EVENTS': 'sixOrMoreCombinedSevereHailWindEvents',
};

function normalizeLine(line: string): string {
    return line.replace(/\s+/g, ' ').trim();
}

function parseWatchType(line: string): SPCWatchDetails['type'] {
    const normalized = normalizeLine(line).toUpperCase();
    if (normalized.startsWith('SEVERE THUNDERSTORM WATCH PROBABILITIES')) {
        return 'Severe Thunderstorm';
    }
    if (normalized.startsWith('TORNADO WATCH PROBABILITIES')) {
        return 'Tornado';
    }
    return 'Unknown';
}

function parsePercentageValue(value: string): string | null {
    const normalized = normalizeLine(value);
    return normalized.length > 0 ? normalized : null;
}

function parseNumericValue(value: string): number | null {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function parseBooleanValue(value: string): boolean | null {
    const normalized = normalizeLine(value).toUpperCase();
    if (normalized === 'YES') return true;
    if (normalized === 'NO') return false;
    return null;
}

function parseWatchText(watchNumber: number, productText: string, baseUrl?: string): SPCWatchDetails {
    const lines = productText.split(/\r?\n/).map(line => line.trimEnd());
    const cleanedLines = lines.map(normalizeLine);
    const probabilityIndex = cleanedLines.findIndex(line => line === 'PROBABILITY TABLE:');
    const attributeIndex = cleanedLines.findIndex(line => line === 'ATTRIBUTE TABLE:');

    const metadataLines = cleanedLines
        .slice(0, probabilityIndex > -1 ? probabilityIndex : cleanedLines.length)
        .filter(line => line.length > 0 && !/^(WS|WT)\s+\d{1,4}$/i.test(line));

    const details: SPCWatchDetails = {
        watchNumber,
        type: metadataLines.map(parseWatchType).find(type => type !== 'Unknown') ?? 'Unknown',
        metadataLines,
        probabilities: {
            twoOrMoreTornadoes: null,
            strongTornadoes: null,
            tenOrMoreSevereWindEvents: null,
            windEvents65KnotsOrMore: null,
            tenOrMoreSevereHailEvents: null,
            hailEvents2InchesOrMore: null,
            sixOrMoreCombinedSevereHailWindEvents: null,
        },
        attributes: {
            maxHailInches: null,
            maxWindGustKnots: null,
            maxTopsHundredsFeet: null,
            meanStormMotionVector: null,
            particularlyDangerousSituation: null,
        },
        sourceUrls: getSPCWatchSourceUrls(watchNumber, baseUrl),
    };

    if (probabilityIndex > -1) {
        const probabilityLines = cleanedLines.slice(
            probabilityIndex + 1,
            attributeIndex > -1 ? attributeIndex : cleanedLines.length,
        );

        for (const line of probabilityLines) {
            if (!line || line === '&&' || line === '$$') continue;

            const match = line.match(/^(PROB OF .*?)\s*:\s*(.+)$/i);
            if (!match) continue;

            const field = PROBABILITY_FIELD_MAP[normalizeLine(match[1]).toUpperCase()];
            if (!field) continue;

            details.probabilities[field] = parsePercentageValue(match[2]);
        }
    }

    if (attributeIndex > -1) {
        const attributeLines = cleanedLines.slice(attributeIndex + 1);

        for (const line of attributeLines) {
            if (!line || line === '&&' || line === '$$') continue;

            const match = line.match(/^(.+?)\s*:\s*(.+)$/);
            if (!match) continue;

            const label = normalizeLine(match[1]).toUpperCase();
            const value = normalizeLine(match[2]);

            if (label === 'MAX HAIL /INCHES/') {
                details.attributes.maxHailInches = parseNumericValue(value);
            } else if (label === 'MAX WIND GUSTS SURFACE /KNOTS/') {
                details.attributes.maxWindGustKnots = parseNumericValue(value);
            } else if (label === 'MAX TOPS /X 100 FEET/') {
                details.attributes.maxTopsHundredsFeet = parseNumericValue(value);
            } else if (label === 'MEAN STORM MOTION VECTOR /DEGREES AND KNOTS/') {
                details.attributes.meanStormMotionVector = value || null;
            } else if (label === 'PARTICULARLY DANGEROUS SITUATION') {
                details.attributes.particularlyDangerousSituation = parseBooleanValue(value);
            }
        }
    }

    return details;
}

export function getSPCWatchSourceUrls(watchNumber: number, baseUrl?: string): SPCWatchSourceUrls {
    const root = normalizeUpstreamBaseUrl(baseUrl, SPC_BASE_URL);
    const paddedWatchNumber = watchNumber.toString().padStart(4, '0');
    return {
        productText: `${root}/products/watch/wwp${paddedWatchNumber}.txt`,
        watchPage: `${root}/products/watch/ww${paddedWatchNumber}.html`,
    };
}

const SPC_STORM_REPORT_URLS: Record<SPCStormReportType, string> = {
    tornado: 'https://www.spc.noaa.gov/climo/reports/today_torn.csv',
    hail: 'https://www.spc.noaa.gov/climo/reports/today_hail.csv',
    wind: 'https://www.spc.noaa.gov/climo/reports/today_wind.csv',
};

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedReports {
    timestamp: number;
    data: SPCStormReportsGeoJSON;
}


function getReportTypeLabel(reportType: SPCStormReportType): string {
    switch (reportType) {
        case 'tornado':
            return 'Tornado';
        case 'hail':
            return 'Hail';
        case 'wind':
            return 'Wind';
    }
}

function getMagnitude(rawMagnitude: string, reportType: SPCStormReportType): string | null {
    const value = normalizeString(rawMagnitude);
    if (!value || value === 'UNK') return null;

    if (reportType === 'hail') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return `${(numeric / 100).toFixed(2)} in`;
        }
    }

    if (reportType === 'wind') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return `${Math.round(numeric)} mph`;
        }
    }

    if (reportType === 'tornado') {
        return value.startsWith('EF') || value.startsWith('F') ? value : `EF${value}`;
    }

    return value;
}

function parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];

        if (character === '"') {
            const nextCharacter = line[index + 1];
            if (inQuotes && nextCharacter === '"') {
                current += '"';
                index += 1;
                continue;
            }

            inQuotes = !inQuotes;
            continue;
        }

        if (character === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
            continue;
        }

        current += character;
    }

    values.push(current.trim());

    if (values.length <= 8) {
        return values;
    }

    return [
        values[0],
        values[1],
        values[2],
        values[3],
        values[4],
        values[5],
        values[6],
        values.slice(7).join(','),
    ];
}

function formatDisplayTime(rawTime: string): string {
    const digits = normalizeString(rawTime).replace(/\D/g, '');
    if (!digits) return 'Unknown';

    const padded = digits.padStart(4, '0').slice(-4);
    return `${padded.slice(0, 2)}:${padded.slice(2, 4)} UTC`;
}

function getValidTime(rawTime: string): string {
    const digits = normalizeString(rawTime).replace(/\D/g, '');
    if (!digits) return '';

    return digits.padStart(4, '0').slice(-4);
}

function buildFeature(
    reportType: SPCStormReportType,
    row: string[],
    index: number,
): SPCStormReportFeature | null {
    if (row.length < 7) return null;

    const lat = normalizeNumber(row[5]);
    const lon = normalizeNumber(row[6]);
    if (lat === null || lon === null) return null;

    const location = normalizeString(row[2]);
    const county = normalizeString(row[3]);
    const state = normalizeString(row[4]);
    const valid = getValidTime(row[0]);
    const displayTime = formatDisplayTime(row[0]);

    const properties: SPCStormReportProperties = {
        reportType,
        reportTypeLabel: getReportTypeLabel(reportType),
        magnitude: getMagnitude(row[1], reportType),
        location,
        county,
        state,
        lat,
        lon,
        comments: normalizeNullableString(row[7]),
        valid,
        displayTime,
    };

    return {
        id: `${reportType}|${valid}|${location}|${county}|${state}|${lat}|${lon}|${index}`,
        type: 'Feature',
        properties,
        geometry: {
            type: 'Point',
            coordinates: [lon, lat],
        },
    };
}

function parseStormReportCsv(csvText: string, reportType: SPCStormReportType): SPCStormReportFeature[] {
    const lines = csvText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length <= 1) return [];

    return lines
        .slice(1)
        .map((line, index) => buildFeature(reportType, parseCsvLine(line), index))
        .filter((feature): feature is SPCStormReportFeature => Boolean(feature));
}

function sortReports(features: SPCStormReportFeature[]): SPCStormReportFeature[] {
    return [...features].sort((a, b) => {
        const timeA = a.properties.valid;
        const timeB = b.properties.valid;
        if (timeA !== timeB) return timeB.localeCompare(timeA);
        return a.properties.reportType.localeCompare(b.properties.reportType);
    });
}


/**
 * SPC public products: convective outlooks, watch probability text and today's storm reports. The watch-detail and
 * storm-report caches belong to the instance.
 */
export class SPCClient {
    private readonly watchDetails = new Map<number, SPCWatchDetails | null>();
    private readonly watchInFlight = new Map<number, Promise<SPCWatchDetails | null>>();
    private readonly reportsCache = new Map<string, CachedReports>();
    private readonly now: () => number;

    private readonly config: SPCClientConfig;

    constructor(config: SPCClientConfig = {}) {
        this.config = config;
        this.now = config.now ?? (() => Date.now());
    }

    fetchOutlook(day: SPCDay, type: SPCOutlookType = 'categorical'): Promise<GeoJSON.FeatureCollection> {
        return fetchSPCOutlook(day, type, this.config);
    }

    /** The watch details already read, `undefined` when this instance has not read that watch. */
    getCachedWatchDetails(watchNumber: number): SPCWatchDetails | null | undefined {
        return this.watchDetails.get(watchNumber);
    }

    getWatchSourceUrls(watchNumber: number): SPCWatchSourceUrls {
        return getSPCWatchSourceUrls(watchNumber, this.config.baseUrl);
    }

    async fetchWatchDetails(watchNumber: number): Promise<SPCWatchDetails | null> {
        if (!Number.isInteger(watchNumber) || watchNumber < 1 || watchNumber > 9999) {
            return null;
        }

        if (this.watchDetails.has(watchNumber)) {
            return this.watchDetails.get(watchNumber) ?? null;
        }

        const existingRequest = this.watchInFlight.get(watchNumber);
        if (existingRequest) {
            return existingRequest;
        }

        const pending = (async () => {
            const productTextUrl = this.getWatchSourceUrls(watchNumber).productText;

            const response = await request(this.config, productTextUrl, {
                headers: { Accept: 'text/plain' },
                cache: 'no-store',
            });

            if (response.status === 404) {
                this.watchDetails.set(watchNumber, null);
                return null;
            }

            if (!response.ok) {
                throw new Error(`SPC watch request error: ${response.status} ${response.statusText}`);
            }

            const productText = await response.text();
            if (!productText.trim()) {
                this.watchDetails.set(watchNumber, null);
                return null;
            }

            const details = parseWatchText(watchNumber, productText, this.config.baseUrl);
            this.watchDetails.set(watchNumber, details);
            return details;
        })().finally(() => {
            this.watchInFlight.delete(watchNumber);
        });


        this.watchInFlight.set(watchNumber, pending);
        return pending;
    }

    async fetchStormReports(forceRefresh = false): Promise<SPCStormReportsGeoJSON> {
        const cachedReports = this.reportsCache.get('latest');
        if (!forceRefresh && cachedReports && (this.now() - cachedReports.timestamp) < CACHE_TTL_MS) {
            return cachedReports.data;
        }

        const settled = await Promise.allSettled(
            (Object.keys(SPC_STORM_REPORT_URLS) as SPCStormReportType[]).map(async (reportType) => {
                const url = SPC_STORM_REPORT_URLS[reportType].replace(SPC_BASE_URL, normalizeUpstreamBaseUrl(this.config.baseUrl, SPC_BASE_URL));
                const response = await request(this.config, url, {
                    headers: { Accept: 'text/csv, text/plain;q=0.9, */*;q=0.8' },
                    cache: 'no-store',
                });

                if (!response.ok) {
                    throw new Error(`SPC ${reportType} reports request failed: ${response.status} ${response.statusText}`);
                }

                return parseStormReportCsv(await response.text(), reportType);
            }),
        );

        const features: SPCStormReportFeature[] = [];
        let hasSuccess = false;

        settled.forEach((result, index) => {
            const reportType = (Object.keys(SPC_STORM_REPORT_URLS) as SPCStormReportType[])[index];
            if (result.status === 'fulfilled') {
                hasSuccess = true;
                features.push(...result.value);
                return;
            }

            console.warn(`[SPC Storm Reports] Failed to fetch ${reportType} reports:`, result.reason);
        });

        if (!hasSuccess) {
            console.warn('[SPC Storm Reports] All report feeds failed; returning empty collection.');
            const empty = { type: 'FeatureCollection', features: [] } as SPCStormReportsGeoJSON;
            this.reportsCache.set('latest', { timestamp: this.now(), data: empty });
            return empty;
        }

        const data: SPCStormReportsGeoJSON = {
            type: 'FeatureCollection',
            features: sortReports(features),
        };

        this.reportsCache.set('latest', { timestamp: this.now(), data });
        return data;
    }
}

export const createSPCClient = (config: SPCClientConfig = {}): SPCClient => new SPCClient(config);
