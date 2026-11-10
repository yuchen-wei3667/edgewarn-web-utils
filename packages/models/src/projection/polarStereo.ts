import type { PolarStereoModelGrid } from '@edgewarn/web-utils/grib2';
import { sampledRectBounds } from './bounds.ts';
import type { GridProjection } from './types.ts';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const wrap180 = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;
/** Radius used when a grid built outside the decoder states none. */
const DEFAULT_RADIUS_M = 6371229;

/**
 * Polar stereographic about the north pole, true at `latD`. The pole is the origin; x runs along the grid's
 * rows and +y points toward the pole along the meridian `lov`. rho = R (1 + sin latD) tan(pi/4 - lat/2).
 */
export function polarStereoGridProjection(
    grid: PolarStereoModelGrid,
    radius = grid.radiusM ?? DEFAULT_RADIUS_M,
): GridProjection {
    const k = radius * (1 + Math.sin(grid.latD * D2R));
    const lov = wrap180(grid.lov);
    const toXY = (lat: number, lon: number): [number, number] => {
        const rho = k * Math.tan(Math.PI / 4 - (lat * D2R) / 2);
        const theta = wrap180(lon - lov) * D2R;
        return [rho * Math.sin(theta), -rho * Math.cos(theta)];
    };
    const [x0, y0] = toXY(grid.lat1, grid.lon1);
    const { nx, ny, dx, dy } = grid;
    const forward: GridProjection['forward'] = (lat, lon) => {
        const [x, y] = toXY(lat, lon);
        return [(x - x0) / dx, (y - y0) / dy];
    };
    const inverse: GridProjection['inverse'] = (i, j) => {
        const x = x0 + i * dx;
        const y = y0 + j * dy;
        const lat = (Math.PI / 2 - 2 * Math.atan(Math.hypot(x, y) / k)) * R2D;
        return [lat, wrap180(lov + Math.atan2(x, -y) * R2D)];
    };
    return {
        kind: 'polarStereo',
        nx,
        ny,
        key: `polarStereo:${nx}x${ny}:${grid.latD}:${lov}:${x0}:${y0}:${dx}:${dy}`,
        forward,
        inverse,
        rotation: (_lat, lon) => wrap180(lon - lov) * D2R,
        cellMetres: () => dx,
        rectBounds: (i0, j0, i1, j1) => sampledRectBounds(inverse, forward, i0, j0, i1, j1),
        uniforms: () => ({ kind: 2, a: [k, lov * D2R, 0, 0], b: [x0, y0, dx, dy] }),
    };
}

/**
 * GLSL (ES 3.00) forward projection for a polar stereographic grid; the same arithmetic as `forward` above. Expects
 * `u_projA` = (k, lovRad, unused, unused) and `u_projB` = (x0, y0, dx, dy) and returns grid (i, j). rho is 1e6 to
 * 1e7 m, so a float32 ulp is under a metre, far below a cell of 3 km.
 */
export const POLAR_STEREO_GLSL = /* glsl */ `
vec2 psForward(vec2 lngLatDeg) {
    float lat = radians(lngLatDeg.y);
    float dlon = radians(lngLatDeg.x) - u_projA.y;
    dlon = dlon - 2.0 * 3.14159265358979 * floor((dlon + 3.14159265358979) / (2.0 * 3.14159265358979));
    float rho = u_projA.x * tan(3.14159265358979 / 4.0 - lat / 2.0);
    vec2 xy = vec2(rho * sin(dlon), -rho * cos(dlon));
    return (xy - u_projB.xy) / u_projB.zw;
}
`;
