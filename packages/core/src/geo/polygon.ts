import { toRad } from './math.ts';

/** Calculates the centroid of a polygon. */
export function getPolygonCentroid(polygon: [number, number][]): [number, number] {
    if (polygon.length === 0) return [0, 0];
    if (polygon.length === 1) return polygon[0];

    let sumLat = 0;
    let sumLon = 0;
    let totalArea = 0;

    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        const crossProduct = polygon[i][1] * polygon[j][0] - polygon[j][1] * polygon[i][0];
        totalArea += crossProduct;
        sumLat += (polygon[i][0] + polygon[j][0]) * crossProduct;
        sumLon += (polygon[i][1] + polygon[j][1]) * crossProduct;
    }

    if (Math.abs(totalArea) < 1e-10) {
        const avgLat = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
        const avgLon = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
        return [avgLat, avgLon];
    }

    const centroidLat = sumLat / (3 * totalArea);
    const centroidLon = sumLon / (3 * totalArea);
    return [centroidLat, centroidLon];
}

/** Calculates the convex hull of a set of points using the Monotone Chain algorithm. */
export function getConvexHull(points: [number, number][]): [number, number][] {
    if (points.length < 3) return points;

    const sortedPoints = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));

    const cross = (o: [number, number], a: [number, number], b: [number, number]) => {
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    };

    const lower: [number, number][] = [];
    for (const p of sortedPoints) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }

    const upper: [number, number][] = [];
    for (let i = sortedPoints.length - 1; i >= 0; i--) {
        const p = sortedPoints[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

/** Calculates the approximate radius of a polygon (Equivalent Circular Radius). */
export function getPolygonApproxRadius(polygon: [number, number][]): number {
    if (polygon.length < 3) return 0;

    const [cLat, cLon] = getPolygonCentroid(polygon);
    const latScale = 111132;
    const lonScale = 111132 * Math.cos(toRad(cLat));

    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        const x1 = (polygon[i][1] - cLon) * lonScale;
        const y1 = (polygon[i][0] - cLat) * latScale;
        const x2 = (polygon[j][1] - cLon) * lonScale;
        const y2 = (polygon[j][0] - cLat) * latScale;

        area += x1 * y2 - x2 * y1;
    }

    area = Math.abs(area) / 2;
    return Math.sqrt(area / Math.PI);
}
