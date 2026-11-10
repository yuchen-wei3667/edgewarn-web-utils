import type { LatLonModelGrid } from '@edgewarn/web-utils/grib2';
import { rotatedLatLonGridProjection } from './rotatedLatlon.ts';
import type { GridProjection } from './types.ts';

const D2R = Math.PI / 180;
const wrap180 = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * Regular latitude/longitude grid. Columns run west to east from `lon1`; rows run from `lat1` north to
 * south (scan 0x00) or south to north (0x40). A grid whose columns close around the globe (GFS) is
 * continuous across its seam; a regional one reads the same, centred on its own middle, so a point west
 * of `lon1` is a small negative `i` rather than a wrapped one.
 */
export function latLonGridProjection(grid: LatLonModelGrid): GridProjection {
    if (grid.rotation) return rotatedLatLonGridProjection(grid);
    const { nx, ny, lat1, lon1, dlat, dlon } = grid;
    if (grid.radiusM === undefined)
        throw new Error('latLonGridProjection needs the earth radius: the grid has none');
    const radius = grid.radiusM;
    /** +1 when j grows northward (0x40), -1 when it grows southward (0x00). */
    const scanSign = grid.scanMode === 0x00 ? -1 : 1;
    /**
     * Offset from `lon1` of the middle of the columns' longitude interval. `i` is taken from the
     * longitude difference wrapped to within 180 degrees of it, which for a global grid puts the seam
     * between the last column and the first (half a cell either side).
     */
    const centre = ((nx - 1) * dlon) / 2;
    return {
        kind: 'latlon',
        nx,
        ny,
        key: `latlon:${nx}x${ny}:${lat1}:${lon1}:${dlat}:${dlon}:${grid.scanMode}`,
        forward: (lat, lon) => {
            const t = lon - lon1 - centre + 180;
            const d = t - 360 * Math.floor(t / 360) - 180 + centre;
            return [d / dlon, ((lat - lat1) / dlat) * scanSign];
        },
        inverse: (i, j) => [lat1 + scanSign * j * dlat, wrap180(lon1 + i * dlon)],
        rotation: () => 0,
        cellMetres: (lat) => dlon * D2R * radius * Math.cos(lat * D2R),
        rectBounds: (i0, j0, i1, j1) => {
            const latA = lat1 + scanSign * j0 * dlat;
            const latB = lat1 + scanSign * j1 * dlat;
            const south = Math.max(-90, Math.min(latA, latB));
            const north = Math.min(90, Math.max(latA, latB));
            const west = wrap180(lon1 + i0 * dlon);
            const east = west + (i1 - i0) * dlon;
            if (east - west >= 360) return [[-180, south, 180, north]];
            if (east <= 180) return [[west, south, east, north]];
            return [
                [west, south, 180, north],
                [-180, south, east - 360, north],
            ];
        },
        uniforms: () => ({ kind: 1, a: [lat1, lon1, dlat, dlon], b: [scanSign, centre, 0, 0] }),
    };
}

/**
 * GLSL (ES 3.00) forward projection for a lat/lon grid; the same arithmetic as `forward` above. Expects
 * `u_projA` = (lat1, lon1, dlat, dlon) and `u_projB` = (scanSign, centreOffset, unused, unused) and returns
 * grid (i, j). float32 holds a longitude within 3e-5 degrees, a small fraction of a 0.25 degree cell.
 */
export const LATLON_GLSL = /* glsl */ `
vec2 llForward(vec2 lngLatDeg) {
    float t = lngLatDeg.x - u_projA.y - u_projB.y + 180.0;
    float d = t - 360.0 * floor(t / 360.0) - 180.0 + u_projB.y;
    return vec2(d / u_projA.w, (lngLatDeg.y - u_projA.x) / u_projA.z * u_projB.x);
}
`;
