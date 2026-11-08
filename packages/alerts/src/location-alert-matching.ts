import type * as GeoJSON from 'geojson';
import type { NWSAlertFeature } from '@edgewarn/web-utils/net';
import { pointInGeometry } from '@edgewarn/web-utils/geo';
import { CRITICAL_EVENTS } from './critical-events.ts';

export interface LocationAlert {
    feature: NWSAlertFeature;
    isCritical: boolean;
}

export type LocationAlertFeatureInput =
    | NWSAlertFeature
    | {
          feature: NWSAlertFeature;
          geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
      };

export type LocationAlertMinimumSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

const SEVERITY_RANK: Record<LocationAlertMinimumSeverity, number> = {
    Extreme: 4,
    Severe: 3,
    Moderate: 2,
    Minor: 1,
    Unknown: 0,
};

function isPolygonGeometry(
    geometry: GeoJSON.Geometry | GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined,
): geometry is GeoJSON.Polygon | GeoJSON.MultiPolygon {
    if (!geometry) {
        return false;
    }

    return geometry.type === 'Polygon' || geometry.type === 'MultiPolygon';
}

function toTimestampOrInfinity(iso: string | null | undefined): number {
    if (!iso) {
        return Number.POSITIVE_INFINITY;
    }

    const timestamp = Date.parse(iso);
    return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function toSeverityRank(severity: string | null | undefined): number {
    return SEVERITY_RANK[(severity ?? 'Unknown') as LocationAlertMinimumSeverity] ?? 0;
}

function toFeatureAndGeometry(item: LocationAlertFeatureInput): {
    feature: NWSAlertFeature;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
} {
    if ('feature' in item) {
        return {
            feature: item.feature,
            geometry: item.geometry,
        };
    }

    return {
        feature: item,
        geometry: isPolygonGeometry(item.geometry) ? item.geometry : null,
    };
}

function compareLocationAlerts(a: LocationAlert, b: LocationAlert): number {
    if (a.isCritical && !b.isCritical) return -1;
    if (!a.isCritical && b.isCritical) return 1;

    const severityDelta =
        toSeverityRank(b.feature.properties.severity) - toSeverityRank(a.feature.properties.severity);
    if (severityDelta !== 0) {
        return severityDelta;
    }

    return (
        toTimestampOrInfinity(a.feature.properties.expires) -
        toTimestampOrInfinity(b.feature.properties.expires)
    );
}

function sortLocationAlerts(alerts: LocationAlert[]): LocationAlert[] {
    return [...alerts].sort(compareLocationAlerts);
}

export function findAlertsAtPoint(
    lat: number,
    lon: number,
    alertFeatures: LocationAlertFeatureInput[],
    minimumSeverity: LocationAlertMinimumSeverity = 'Unknown',
): LocationAlert[] {
    if (!Array.isArray(alertFeatures) || alertFeatures.length === 0) {
        return [];
    }

    const minimumRank = SEVERITY_RANK[minimumSeverity] ?? 0;
    const matchingAlerts: LocationAlert[] = [];

    for (const item of alertFeatures) {
        const { feature, geometry } = toFeatureAndGeometry(item);
        if (!geometry) {
            continue;
        }

        const severityRank = toSeverityRank(feature.properties.severity);
        if (severityRank < minimumRank) {
            continue;
        }

        if (!pointInGeometry(lat, lon, geometry)) {
            continue;
        }

        matchingAlerts.push({
            feature,
            isCritical: CRITICAL_EVENTS.has(feature.properties.event),
        });
    }

    return sortLocationAlerts(matchingAlerts);
}
