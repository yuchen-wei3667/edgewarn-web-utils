import type { MercatorModelGrid } from '@edgewarn/web-utils/grib2';
import { sampledRectBounds } from './bounds.ts';
import type { GridProjection } from './types.ts';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const wrap180 = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;
/** Radius used when a grid built outside the decoder states none. */
const DEFAULT_RADIUS_M = 6371229;

/**
 * Mercator with its axes along the equator and the meridians, true at `latD`: x = R cos(latD) (lon - lon1) and
 * y = R cos(latD) ln tan(pi/4 + lat/2), measured from the first grid point. A regional grid is read around its
 * own middle, so a point west of `lon1` is a small negative `i` rather than a wrapped one.
 */
export function mercatorGridProjection(
    grid: MercatorModelGrid,
    radius = grid.radiusM ?? DEFAULT_RADIUS_M,
): GridProjection {
    const rc = radius * Math.cos(grid.latD * D2R);
    const { nx, ny, dx, dy } = grid;
    const lonCentre = grid.lon1 + ((((nx - 1) / 2) * dx) / rc) * R2D;
    const mercY = (lat: number): number => rc * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
    const y0 = mercY(grid.lat1);
    const forward: GridProjection['forward'] = (lat, lon) => {
        const dlon = wrap180(lon - lonCentre) + (lonCentre - grid.lon1);
        return [(dlon * D2R * rc) / dx, (mercY(lat) - y0) / dy];
    };
    const inverse: GridProjection['inverse'] = (i, j) => [
        (2 * Math.atan(Math.exp((y0 + j * dy) / rc)) - Math.PI / 2) * R2D,
        wrap180(grid.lon1 + ((i * dx) / rc) * R2D),
    ];
    return {
        kind: 'mercator',
        nx,
        ny,
        key: `mercator:${nx}x${ny}:${grid.latD}:${grid.lon1}:${y0}:${dx}:${dy}`,
        forward,
        inverse,
        rotation: () => 0,
        cellMetres: (lat) => (dx * Math.cos(lat * D2R)) / Math.cos(grid.latD * D2R),
        rectBounds: (i0, j0, i1, j1) => sampledRectBounds(inverse, forward, i0, j0, i1, j1),
        uniforms: () => ({ kind: 3, a: [rc, grid.lon1, lonCentre, 0], b: [0, y0, dx, dy] }),
    };
}

/**
 * GLSL (ES 3.00) forward projection for a Mercator grid; the same arithmetic as `forward` above. Expects
 * `u_projA` = (R cos latD, lon1, lonCentre, unused) with the longitudes in degrees and `u_projB` = (unused, y0, dx, dy),
 * and returns grid (i, j).
 */
export const MERCATOR_GLSL = /* glsl */ `
vec2 mcForward(vec2 lngLatDeg) {
    float t = lngLatDeg.x - u_projA.z + 180.0;
    float d = t - 360.0 * floor(t / 360.0) - 180.0 + (u_projA.z - u_projA.y);
    float y = u_projA.x * log(tan(3.14159265358979 / 4.0 + radians(lngLatDeg.y) / 2.0));
    return vec2(radians(d) * u_projA.x / u_projB.z, (y - u_projB.y) / u_projB.w);
}
`;
