import type * as GeoJSON from 'geojson';
/**
 * Geodesic area helpers for GeoJSON Polygon and MultiPolygon geometry.
 * Coordinates are expected in GeoJSON order: [lon, lat] in decimal degrees.
 *
 * Uses the spherical-excess algorithm (the same math as @turf/area) so no
 * additional dependency is required.
 */

import { toRad } from './math.ts';

const EARTH_RADIUS_M = 6371008.8;
const SQ_M_PER_SQ_MI = 2589988.110336;

function ringAreaM2(ring: number[][]): number {
    const len = ring.length;
    if (len < 3) return 0;

    let total = 0;
    for (let i = 0; i < len; i++) {
        let lowerIndex: number;
        let middleIndex: number;
        let upperIndex: number;
        if (i === len - 2) {
            lowerIndex = len - 2;
            middleIndex = len - 1;
            upperIndex = 0;
        } else if (i === len - 1) {
            lowerIndex = len - 1;
            middleIndex = 0;
            upperIndex = 1;
        } else {
            lowerIndex = i;
            middleIndex = i + 1;
            upperIndex = i + 2;
        }
        const p1 = ring[lowerIndex];
        const p2 = ring[middleIndex];
        const p3 = ring[upperIndex];
        if (!p1 || !p2 || !p3 || p1.length < 2 || p2.length < 2 || p3.length < 2) continue;
        total += (toRad(p3[0]) - toRad(p1[0])) * Math.sin(toRad(p2[1]));
    }

    return (total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

function polygonAreaM2(coordinates: number[][][]): number {
    if (!coordinates || coordinates.length === 0) return 0;
    let total = Math.abs(ringAreaM2(coordinates[0]));
    for (let i = 1; i < coordinates.length; i++) {
        total -= Math.abs(ringAreaM2(coordinates[i]));
    }
    return total;
}

/**
 * Geodesic area of a Polygon or MultiPolygon in square meters.
 * Returns null when the geometry is missing or has no computable area.
 */
export function geometryAreaM2(
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined,
): number | null {
    if (!geometry) return null;
    if (geometry.type === 'Polygon') {
        const area = polygonAreaM2(geometry.coordinates);
        return area > 0 ? area : null;
    }
    if (geometry.type === 'MultiPolygon') {
        const area = geometry.coordinates.reduce((sum, poly) => sum + polygonAreaM2(poly), 0);
        return area > 0 ? area : null;
    }
    return null;
}

/**
 * Compact US-style coverage label for an alert polygon, e.g. "≈ 4,821 sq mi".
 * Returns null when the geometry has no computable area.
 */
export function formatAlertCoverage(
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined,
): string | null {
    const areaM2 = geometryAreaM2(geometry);
    if (areaM2 === null) return null;
    const sqMi = areaM2 / SQ_M_PER_SQ_MI;
    const rounded = sqMi < 10 ? Math.round(sqMi * 10) / 10 : Math.round(sqMi);
    return `≈ ${rounded.toLocaleString('en-US')} sq mi`;
}
