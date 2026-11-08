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

    // Accept alert URLs from any NWS origin (default or a configured mirror)
    // rather than hardcoding one upstream host into a parser.
    if (/^https?:\/\//i.test(normalized)) {
        try {
            const matched = new URL(normalized).pathname.match(/\/alerts\/([^/]+)$/);
            if (matched) return decodeURIComponent(matched[1]);
        } catch {
            return normalized;
        }
    }

    return normalized;
}

function getAlertCacheKey(id: unknown): string {
    const normalizedId = normalizeAlertId(id);
    return normalizedId ? `official:${normalizedId}` : '';
}

export function getFeatureAlertCacheKey(
    feature: Pick<NWSAlertFeature, 'id' | 'properties'> | null | undefined,
): string {
    if (!feature) {
        return '';
    }

    return getAlertCacheKey(feature.id || feature.properties.id);
}
