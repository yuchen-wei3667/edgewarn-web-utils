import { hasEASActivationRequest } from '../eas-phrase.ts';
import { DEFAULT_NWS_USER_AGENT, nwsHeaders, normalizeUpstreamBaseUrl } from '@edgewarn/web-utils/net';

const NWS_ORIGIN = 'https://api.weather.gov';

type NWSAlert = {
    properties?: {
        sent?: string;
        description?: string;
        messageType?: string;
        parameters?: Record<string, unknown>;
    };
};

type NWSTextProduct = {
    '@id'?: string;
    id?: string;
    issuanceTime?: string;
    productText?: string;
};

function strings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim().toUpperCase();
}

type VTECParts = {
    fixed: string;
    action: string;
    office: string;
    phenomenon: string;
    significance: string;
    etn: string;
};

const VTEC_PATTERN = /^\/([A-Z])\.([A-Z]{3})\.([A-Z]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\./;

/** Follow-up actions whose original issuance may carry the EAS bulletin. */
const FOLLOW_UP_ACTIONS = new Set(['CON', 'EXT', 'EXA', 'EXB']);

/** VTEC phenomenon.significance → AWIPS text-product type of the issuance. */
const ISSUANCE_TYPE_BY_EVENT: Record<string, string> = {
    'TO.W': 'TOR',
    'SV.W': 'SVR',
    'FF.W': 'FFW',
};

function parseVTEC(value: string): VTECParts | null {
    const match = VTEC_PATTERN.exec(value.trim().toUpperCase());
    if (!match) return null;
    return {
        fixed: match[1],
        action: match[2],
        office: match[3],
        phenomenon: match[4],
        significance: match[5],
        etn: match[6],
    };
}

/**
 * For a follow-up alert (CON/EXT/EXA/EXB), build the
 * VTEC marker of its original issuance (e.g. `/O.NEW.KSLC.TO.W.0004.`) plus
 * the product type to search (e.g. `TOR`). The caller scans issuance texts
 * for the marker and checks the EAS phrase there.
 */
function originalIssuanceLookup(alert: NWSAlert): { type: string; marker: string } | null {
    const vtec = strings(alert.properties?.parameters?.VTEC).filter((value) => value.length >= 15);
    for (const value of vtec) {
        const parts = parseVTEC(value);
        if (!parts || !FOLLOW_UP_ACTIONS.has(parts.action)) continue;
        const type = ISSUANCE_TYPE_BY_EVENT[`${parts.phenomenon}.${parts.significance}`];
        if (!type) continue;
        return {
            type,
            marker: `/${parts.fixed}.NEW.${parts.office}.${parts.phenomenon}.${parts.significance}.${parts.etn}.`,
        };
    }
    return null;
}

function alertProductCode(alert: NWSAlert): string | null {
    const parameters = alert.properties?.parameters;
    const awips = (
        strings(parameters?.AWIPSidentifier)[0] ??
        alert.properties?.description?.match(/^\s*([A-Z]{6})\b/)?.[1]
    )
        ?.trim()
        .toUpperCase();
    return awips && /^[A-Z]{6}$/.test(awips) ? awips : null;
}

function rawProductMatchesAlert(rawText: string, alert: NWSAlert): boolean {
    const parameters = alert.properties?.parameters;
    const vtec = strings(parameters?.VTEC).filter((value) => value.length >= 15);
    if (vtec.length > 0) return vtec.some((value) => rawText.includes(value));

    const description = normalizeText(alert.properties?.description ?? '');
    if (description.length < 80) return false;
    return normalizeText(rawText).includes(description);
}

async function getNWSJson(
    url: string,
    fetcher: typeof fetch,
    userAgent: string,
    accept = 'application/ld+json',
): Promise<unknown> {
    const response = await fetcher(url, {
        headers: { ...nwsHeaders(userAgent), Accept: accept },
        signal: AbortSignal.timeout(8000),
    } as RequestInit);
    if (!response.ok) throw new Error(`NWS API returned ${response.status}`);
    return response.json();
}

function productUrl(product: NWSTextProduct, baseUrl: string): string | null {
    const value =
        product['@id'] ?? (product.id ? `${baseUrl}/products/${encodeURIComponent(product.id)}` : null);
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.origin === new URL(baseUrl).origin && /^\/products\/[^/]+$/.test(url.pathname)
            ? url.toString()
            : null;
    } catch {
        return null;
    }
}

async function readProductText(
    candidate: NWSTextProduct,
    fetcher: typeof fetch,
    userAgent: string,
    baseUrl: string,
): Promise<string | null> {
    if (candidate.productText) return candidate.productText;
    const url = productUrl(candidate, baseUrl);
    if (!url) return null;
    const detail = (await getNWSJson(url, fetcher, userAgent)) as NWSTextProduct;
    return detail.productText ?? null;
}

const ORIGINAL_ISSUANCE_WINDOW_MS = 6 * 60 * 60_000;
const ORIGINAL_ISSUANCE_FETCH_CAP = 12;

/** Scan recent issuances of `type` for the original `marker` text. */
async function findOriginalIssuanceText(
    type: string,
    office: string,
    marker: string,
    sent: number,
    fetcher: typeof fetch,
    userAgent: string,
    baseUrl: string,
): Promise<string | null> {
    const listing = (await getNWSJson(
        `${baseUrl}/products/types/${type}/locations/${office}`,
        fetcher,
        userAgent,
    )) as { '@graph'?: NWSTextProduct[] };
    const candidates = (listing['@graph'] ?? [])
        .filter((product) => {
            const issued = Date.parse(product.issuanceTime ?? '');
            return (
                Number.isFinite(issued) &&
                issued <= sent + 5 * 60_000 &&
                sent - issued <= ORIGINAL_ISSUANCE_WINDOW_MS
            );
        })
        .sort((a, b) => Date.parse(b.issuanceTime!) - Date.parse(a.issuanceTime!))
        .slice(0, ORIGINAL_ISSUANCE_FETCH_CAP);

    for (const candidate of candidates) {
        const rawText = await readProductText(candidate, fetcher, userAgent, baseUrl);
        if (rawText && rawText.includes(marker)) return rawText;
    }
    return null;
}

export type EASVerification = {
    matched: boolean;
    /** Whether this issuance or the original issuance requested EAS activation. */
    easRequested: boolean;
    /** Only the current issuance may trigger automatic playback. */
    currentIssuanceRequestsEAS: boolean;
};

export async function checkNWSRawAlertForEAS(
    alertId: string,
    fetcher: typeof fetch = fetch,
    options?: { userAgent?: string; baseUrl?: string },
): Promise<EASVerification> {
    const userAgent = options?.userAgent ?? DEFAULT_NWS_USER_AGENT;
    const baseUrl = normalizeUpstreamBaseUrl(options?.baseUrl, NWS_ORIGIN);
    const alert = (await getNWSJson(
        `${baseUrl}/alerts/${encodeURIComponent(alertId)}`,
        fetcher,
        userAgent,
        'application/geo+json',
    )) as NWSAlert;
    // BLOCKCHANNEL=EAS means EAS delivery is blocked, not requested. Verify the
    // matched NWS text product instead. Cancellations never request playback.
    if ((alert.properties?.messageType ?? '').trim().toLowerCase() === 'cancel') {
        return { matched: false, easRequested: false, currentIssuanceRequestsEAS: false };
    }

    const code = alertProductCode(alert);
    const sent = Date.parse(alert.properties?.sent ?? '');
    if (!code || !Number.isFinite(sent))
        return { matched: false, easRequested: false, currentIssuanceRequestsEAS: false };

    const type = code.slice(0, 3);
    const office = code.slice(3);
    const listing = (await getNWSJson(
        `${baseUrl}/products/types/${type}/locations/${office}`,
        fetcher,
        userAgent,
    )) as { '@graph'?: NWSTextProduct[] };
    const candidates = (listing['@graph'] ?? [])
        .filter((product) => {
            const issued = Date.parse(product.issuanceTime ?? '');
            return Number.isFinite(issued) && Math.abs(issued - sent) <= 60 * 60_000;
        })
        .sort(
            (a, b) =>
                Math.abs(Date.parse(a.issuanceTime!) - sent) - Math.abs(Date.parse(b.issuanceTime!) - sent),
        );

    let directResult: EASVerification | null = null;
    for (const candidate of candidates) {
        const url = productUrl(candidate, baseUrl);
        if (!url) continue;
        let rawText = candidate.productText;
        if (!rawText) {
            const detail = (await getNWSJson(url, fetcher, userAgent)) as NWSTextProduct;
            rawText = detail.productText;
        }
        if (!rawText || !rawProductMatchesAlert(rawText, alert)) continue;
        const easRequested = hasEASActivationRequest(rawText);
        directResult = { matched: true, easRequested, currentIssuanceRequestsEAS: easRequested };
        break;
    }
    if (directResult?.easRequested) return directResult;

    // Fallback: a follow-up statement (CON/EXT/...) never repeats the EAS
    // bulletin, so resolve its event back to the original issuance and check
    // the phrase there.
    const lookup = originalIssuanceLookup(alert);
    if (lookup) {
        const issuanceText = await findOriginalIssuanceText(
            lookup.type,
            office,
            lookup.marker,
            sent,
            fetcher,
            userAgent,
            baseUrl,
        );
        if (issuanceText)
            return {
                matched: true,
                easRequested: hasEASActivationRequest(issuanceText),
                currentIssuanceRequestsEAS: false,
            };
    }

    return directResult ?? { matched: false, easRequested: false, currentIssuanceRequestsEAS: false };
}
