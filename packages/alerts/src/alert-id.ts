import type { NWSAlertFeature } from '@edgewarn/web-utils/net';
export function normalizeAlertId(value: unknown): string {
    return String(value ?? '').trim();
}

export function normalizeOfficialAlertId(value: unknown): string {
    const normalized = normalizeAlertId(value);
    if (!normalized) {
        return '';
    }

    if (normalized.startsWith('official:')) {
        return normalized.slice('official:'.length);
    }

    if (normalized.startsWith('https://api.weather.gov/alerts/')) {
        return normalized.slice('https://api.weather.gov/alerts/'.length);
    }

    return normalized;
}

function getAlertCacheKey(id: unknown): string {
    const normalizedId = normalizeAlertId(id);
    return normalizedId ? `official:${normalizedId}` : '';
}

export function getFeatureAlertCacheKey(feature: Pick<NWSAlertFeature, 'id' | 'properties'> | null | undefined): string {
    if (!feature) {
        return '';
    }

    return getAlertCacheKey(feature.id || feature.properties.id);
}

