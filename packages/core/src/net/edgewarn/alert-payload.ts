import type { NWSData } from '../types.ts';

type NWSFeature = NWSData['data']['features'][number];

function asObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ''): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return fallback;
    return String(value);
}

export function toNWSFeature(payload: unknown, fallbackId: string): NWSFeature | null {
    const payloadObj = asObject(payload);
    const candidate = asObject(payloadObj?.feature) ?? payloadObj;

    if (!candidate) return null;

    const candidateProperties = asObject(candidate.properties);
    if (candidate.type === 'Feature' && candidateProperties) {
        const resolvedId = asString(candidate.id ?? candidateProperties.id ?? fallbackId).trim();
        if (!resolvedId) return null;

        return {
            ...(candidate as unknown as NWSFeature),
            id: resolvedId,
            properties: {
                ...(candidateProperties as unknown as NWSFeature['properties']),
                id: resolvedId,
            },
        };
    }

    const eventName = asString(candidate.name ?? candidate.event ?? candidate.alert_type).trim();
    const resolvedId = asString(candidate.id ?? candidate.urn_oid ?? fallbackId).trim();
    if (!resolvedId || !eventName) return null;

    const effective = asString(candidate.effective).trim();
    const expires = asString(candidate.expires).trim();

    return {
        id: resolvedId,
        type: 'Feature',
        geometry: (candidate.geometry ?? null) as NWSFeature['geometry'],
        properties: {
            '@id': asString(candidate.urn_oid, resolvedId),
            '@type': 'Alert',
            id: resolvedId,
            areaDesc: asString(candidate.areaDesc),
            geocode: (candidate.geocode as NWSFeature['properties']['geocode']) ?? { SAME: [], UGC: [] },
            affectedZones: (candidate.affectedZones as string[]) ?? [],
            sent: effective,
            effective,
            onset: effective,
            expires,
            ends: expires,
            status: asString(candidate.status, 'Actual'),
            messageType: asString(candidate.messageType, 'Alert'),
            category: asString(candidate.category, 'Met'),
            severity: toTitleCaseSeverity(asString(candidate.severity, 'Unknown')),
            certainty: asString(candidate.certainty),
            urgency: asString(candidate.urgency),
            event: eventName,
            sender: asString(candidate.sender),
            senderName: asString(candidate.senderName, asString(candidate.source)),
            headline: asString(candidate.headline, eventName),
            description: asString(candidate.description),
            instruction: asString(candidate.instruction),
            response: asString(candidate.response),
        },
    };
}

function toTitleCaseSeverity(value: string): NWSFeature['properties']['severity'] {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'extreme') return 'Extreme';
    if (normalized === 'severe' || normalized === 'warning') return 'Severe';
    if (normalized === 'moderate' || normalized === 'watch') return 'Moderate';
    if (normalized === 'minor' || normalized === 'advisory') return 'Minor';
    return 'Unknown';
}

export function extractNWSAlertItems(alertIdsPayload: unknown): unknown[] {
    if (Array.isArray(alertIdsPayload)) {
        return alertIdsPayload;
    }

    const wrapped = asObject(alertIdsPayload);
    const wrappedData = asObject(wrapped?.data);
    return asArray(wrapped?.ids).length > 0
        ? asArray(wrapped?.ids)
        : asArray(wrappedData?.ids);
}
