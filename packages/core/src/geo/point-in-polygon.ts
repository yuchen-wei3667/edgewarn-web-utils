import type * as GeoJSON from 'geojson';
/**
 * Point-in-polygon helpers for GeoJSON Polygon and MultiPolygon geometry.
 * Coordinates are expected in GeoJSON order: [lon, lat].
 */

/**
 * Ray-casting point-in-polygon test for a Polygon coordinate set.
 * `coords` is an array of rings where each ring is [lon, lat] pairs.
 */
function pointInPolygonCoords(lat: number, lon: number, coords: number[][][]): boolean {
    if (!coords || coords.length === 0) return false;

    const EPSILON = 1e-9;

    const pointOnSegment = (ringStart: number[], ringEnd: number[]) => {
        if (ringStart.length < 2 || ringEnd.length < 2) return false;

        const x1 = ringStart[1];
        const y1 = ringStart[0];
        const x2 = ringEnd[1];
        const y2 = ringEnd[0];

        const cross = (lat - x1) * (y2 - y1) - (lon - y1) * (x2 - x1);
        if (Math.abs(cross) > EPSILON) {
            return false;
        }

        const minX = Math.min(x1, x2) - EPSILON;
        const maxX = Math.max(x1, x2) + EPSILON;
        const minY = Math.min(y1, y2) - EPSILON;
        const maxY = Math.max(y1, y2) + EPSILON;

        return lat >= minX && lat <= maxX && lon >= minY && lon <= maxY;
    };

    const pointOnRing = (ring: number[][]) => {
        if (!ring || ring.length < 2) return false;

        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            if (pointOnSegment(ring[j], ring[i])) {
                return true;
            }
        }

        return false;
    };

    const pointInRing = (ring: number[][]) => {
        if (!ring || ring.length < 3) return false;
        let inside = false;

        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][1];
            const yi = ring[i][0];
            const xj = ring[j][1];
            const yj = ring[j][0];

            const intersect =
                yi > lon !== yj > lon &&
                lat < ((xj - xi) * (lon - yi)) / (yj - yi) + xi;

            if (intersect) inside = !inside;
        }

        return inside;
    };

    if (pointOnRing(coords[0])) return true;
    if (!pointInRing(coords[0])) return false;

    for (let h = 1; h < coords.length; h++) {
        if (pointOnRing(coords[h])) return false;
        if (pointInRing(coords[h])) return false;
    }

    return true;
}

/** Check if a point is inside a GeoJSON Polygon or MultiPolygon. */
export function pointInGeometry(lat: number, lon: number, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
    if (geometry.type === 'Polygon') {
        return pointInPolygonCoords(lat, lon, geometry.coordinates);
    }

    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some(polyCoords => pointInPolygonCoords(lat, lon, polyCoords));
    }

    return false;
}
