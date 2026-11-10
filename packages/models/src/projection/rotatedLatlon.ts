import type { LatLonModelGrid } from '@edgewarn/web-utils/grib2';
import { sampledRectBounds } from './bounds.ts';
import type { GridProjection } from './types.ts';

const D2R = Math.PI / 180;
const wrap = (v: number) => v - 360 * Math.floor((v + 180) / 360);

/** Rotated spherical axes (zero rotation angle), without resampling the source grid. */
export function rotatedLatLonGridProjection(grid: LatLonModelGrid): GridProjection {
    if (!grid.rotation || !grid.radiusM) throw new Error('Rotated grid needs its pole and earth radius');
    const { nx, ny, lat1, lon1, dlat, dlon } = grid;
    const pole = -grid.rotation.southPoleLat * D2R;
    const meridian = grid.rotation.southPoleLon * D2R;
    const s = Math.sin(pole),
        c = Math.cos(pole);
    const sign = grid.scanMode === 0 ? -1 : 1;
    const centre = ((nx - 1) * dlon) / 2;
    const forward: GridProjection['forward'] = (lat, lon) => {
        const p = lat * D2R,
            l = lon * D2R - meridian;
        const x = Math.cos(p) * Math.cos(l),
            y = Math.cos(p) * Math.sin(l),
            z = Math.sin(p);
        const rlat = Math.atan2(-c * x + s * z, Math.hypot(s * x + c * z, y)) / D2R;
        const rlon = Math.atan2(y, s * x + c * z) / D2R;
        return [(wrap(rlon - lon1 - centre) + centre) / dlon, ((rlat - lat1) / dlat) * sign];
    };
    const inverse: GridProjection['inverse'] = (i, j) => {
        const p = (lat1 + sign * j * dlat) * D2R,
            l = (lon1 + i * dlon) * D2R;
        const x = Math.cos(p) * Math.cos(l),
            y = Math.cos(p) * Math.sin(l),
            z = Math.sin(p);
        return [
            Math.atan2(c * x + s * z, Math.hypot(s * x - c * z, y)) / D2R,
            wrap((meridian + Math.atan2(y, s * x - c * z)) / D2R),
        ];
    };
    return {
        kind: 'latlon',
        nx,
        ny,
        key: `rotated:${nx}x${ny}:${lat1}:${lon1}:${dlat}:${dlon}:${sign}:${pole}:${meridian}`,
        forward,
        inverse,
        rotation: (lat, lon) => {
            const p = lat * D2R,
                l = lon * D2R - meridian;
            return Math.atan2(c * Math.sin(l), s * Math.cos(p) + c * Math.sin(p) * Math.cos(l));
        },
        // Nominal spacing at the rotated equator, where the regional domain is centred.
        cellMetres: () => dlon * D2R * grid.radiusM!,
        rectBounds: (i0, j0, i1, j1) => sampledRectBounds(inverse, forward, i0, j0, i1, j1),
        uniforms: () => ({ kind: 4, a: [lat1, lon1, dlat, dlon], b: [s, c, meridian, sign] }),
    };
}

/** Same axis rotation and longitude wrapping as the CPU projection. */
export const ROTATED_LATLON_GLSL = /* glsl */ `
vec2 rllForward(vec2 lngLatDeg) {
    float p = radians(lngLatDeg.y);
    float l = radians(lngLatDeg.x) - u_projB.z;
    float x = cos(p) * cos(l), y = cos(p) * sin(l), z = sin(p);
    float rx = u_projB.x * x + u_projB.y * z;
    float rz = -u_projB.y * x + u_projB.x * z;
    float rlat = degrees(atan(rz, length(vec2(rx, y))));
    float rlon = degrees(atan(y, rx));
    float centre = (u_gridSize.x - 1.0) * u_projA.w / 2.0;
    float t = rlon - u_projA.y - centre;
    float d = t - 360.0 * floor((t + 180.0) / 360.0) + centre;
    return vec2(d / u_projA.w, (rlat - u_projA.x) / u_projA.z * u_projB.w);
}
`;
