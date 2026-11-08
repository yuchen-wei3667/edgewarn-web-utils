import type { Geometry, Position } from 'geojson';
import { pointInGeometry } from '@edgewarn/web-utils/geo';

export type AlertBoundingBox = [west: number, south: number, east: number, north: number];

export function validatePoint(point: { lat: number; lon: number }): void {
    if (
        !Number.isFinite(point.lat) ||
        Math.abs(point.lat) > 90 ||
        !Number.isFinite(point.lon) ||
        Math.abs(point.lon) > 180
    )
        throw new Error('Invalid alert point');
}

export function validateBox(box: AlertBoundingBox): void {
    if (
        !Array.isArray(box) ||
        box.length !== 4 ||
        box.some((v) => !Number.isFinite(v)) ||
        box[0] < -180 ||
        box[2] > 180 ||
        box[1] < -90 ||
        box[3] > 90 ||
        box[0] > box[2] ||
        box[1] > box[3]
    )
        throw new Error('Invalid alert bounding box');
}

/** Inclusive segment clipping avoids treating an overlapping extent as an intersection. */
function segmentHitsBox(a: Position, b: Position, box: AlertBoundingBox): boolean {
    if (![...a.slice(0, 2), ...b.slice(0, 2)].every(Number.isFinite) || a.length < 2 || b.length < 2)
        return false;
    let start = 0,
        end = 1;
    for (let axis = 0; axis < 2; axis++) {
        const delta = b[axis] - a[axis];
        const low = box[axis],
            high = box[axis + 2];
        if (delta === 0) {
            if (a[axis] < low || a[axis] > high) return false;
        } else {
            const t1 = (low - a[axis]) / delta,
                t2 = (high - a[axis]) / delta;
            start = Math.max(start, Math.min(t1, t2));
            end = Math.min(end, Math.max(t1, t2));
            if (start > end) return false;
        }
    }
    return true;
}

export function geometryIntersectsBox(geometry: Geometry | null, box: AlertBoundingBox): boolean {
    if (!geometry) return false;
    const inside = (p: Position) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3];
    const lineHits = (line: Position[]) =>
        line.some(inside) || line.some((p, i) => i > 0 && segmentHitsBox(line[i - 1], p, box));
    switch (geometry.type) {
        case 'MultiPolygon':
            return geometry.coordinates.some((coordinates) =>
                geometryIntersectsBox({ type: 'Polygon', coordinates }, box),
            );
        case 'Polygon':
            return (
                geometry.coordinates.some(lineHits) ||
                [
                    [box[0], box[1]],
                    [box[0], box[3]],
                    [box[2], box[1]],
                    [box[2], box[3]],
                ].some(([lon, lat]) => pointInGeometry(lat, lon, geometry))
            );
        default:
            return false;
    }
}
