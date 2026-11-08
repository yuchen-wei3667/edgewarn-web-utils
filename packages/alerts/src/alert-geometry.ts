import type * as GeoJSON from 'geojson';
import type { NWSAlertFeature } from '@edgewarn/web-utils/net';
function mergeAlertGeometries(
    geometries: Array<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
): GeoJSON.MultiPolygon | null {
    const allPolygons: number[][][][] = [];

    for (const geometry of geometries) {
        if (geometry.type === 'Polygon') {
            allPolygons.push(geometry.coordinates);
        } else if (geometry.type === 'MultiPolygon') {
            allPolygons.push(...geometry.coordinates);
        }
    }

    if (allPolygons.length === 0) {
        return null;
    }

    return {
        type: 'MultiPolygon',
        coordinates: allPolygons,
    };
}

function parseCustomPolygon(customPolygon: unknown): GeoJSON.Polygon[] {
    if (!Array.isArray(customPolygon) || customPolygon.length === 0) {
        return [];
    }

    const firstEntry = customPolygon[0];
    const isMultiRing = Array.isArray(firstEntry) && Array.isArray(firstEntry[0]);
    const rings = (isMultiRing ? customPolygon : [customPolygon]) as unknown[];
    const polygons: GeoJSON.Polygon[] = [];

    for (const ring of rings) {
        if (!Array.isArray(ring)) {
            continue;
        }

        const normalizedRing = ring
            .map((point): [number, number] | null => {
                if (!Array.isArray(point) || point.length < 2) {
                    return null;
                }

                const value1 = Number(point[0]);
                const value2 = Number(point[1]);
                if (Number.isNaN(value1) || Number.isNaN(value2)) {
                    return null;
                }

                if (value1 > 0 && value2 < 0) {
                    return [value2, value1];
                }

                return [value1, value2];
            })
            .filter((point): point is [number, number] => point !== null);

        if (normalizedRing.length < 3) {
            continue;
        }

        const firstPoint = normalizedRing[0];
        const lastPoint = normalizedRing[normalizedRing.length - 1];
        if (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]) {
            normalizedRing.push([firstPoint[0], firstPoint[1]]);
        }

        if (normalizedRing.length < 4) {
            continue;
        }

        polygons.push({
            type: 'Polygon',
            coordinates: [normalizedRing],
        });
    }

    return polygons;
}

/** Normalize standard GeoJSON or the legacy `Polygon` field into one shape. */
export function normalizeAlertGeometry(feature: NWSAlertFeature): GeoJSON.MultiPolygon | null {
    const geometries: Array<GeoJSON.Polygon | GeoJSON.MultiPolygon> = [];
    let geometryHandled = false;

    if (
        feature.geometry &&
        (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')
    ) {
        geometries.push(feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon);
        geometryHandled = true;
    }

    const customPolygon = (feature as NWSAlertFeature & { Polygon?: unknown }).Polygon;
    if (!geometryHandled && customPolygon) {
        const parsedPolygons = parseCustomPolygon(customPolygon);
        if (parsedPolygons.length > 0) {
            geometries.push(...parsedPolygons);
            geometryHandled = true;
        }
    }

    return mergeAlertGeometries(geometries);
}
