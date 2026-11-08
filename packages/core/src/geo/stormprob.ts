import { getConvexHull, getPolygonCentroid } from './polygon.ts';

/** Projects a polygon to a target location and scales it. */
export function projectAndScalePolygon(
    polygon: [number, number][],
    targetLat: number,
    targetLon: number,
    scale: number
): [number, number][] {
    const [cLat, cLon] = getPolygonCentroid(polygon);
    return polygon.map(([lat, lon]) => [
        targetLat + (lat - cLat) * scale,
        targetLon + (lon - cLon) * scale,
    ]);
}

/**
 * Generates convex hulls connecting adjacent polygons to create a swath.
 */
export function generatePolygonSegmentHulls(polygons: [number, number][][]): [number, number][][] {
    if (polygons.length < 2) return [];

    const hulls: [number, number][][] = [];

    for (let i = 0; i < polygons.length - 1; i++) {
        const combinedPoints = [...polygons[i], ...polygons[i + 1]];
        const hull = getConvexHull(combinedPoints);
        if (hull.length > 2) {
            hulls.push(hull);
        }
    }

    return hulls;
}
