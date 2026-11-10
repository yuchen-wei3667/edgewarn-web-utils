import type { LambertModelGrid } from '@edgewarn/web-utils/grib2';
import {
    gridRectLngLatBounds,
    gridRotation,
    lambertForward,
    lambertInverse,
    lambertProjection,
} from '../lambert.ts';
import type { GridProjection } from './types.ts';

/** Lambert conformal behind the `GridProjection` interface; the maths stays in `../lambert.ts`. */
export function lambertGridProjection(grid: LambertModelGrid): GridProjection {
    const p = lambertProjection(grid);
    return {
        kind: 'lambert',
        nx: p.nx,
        ny: p.ny,
        key: `lambert:${p.nx}x${p.ny}:${p.n}:${p.lov}:${p.x0}:${p.y0}:${p.dx}:${p.dy}`,
        forward: (lat, lon) => lambertForward(p, lat, lon),
        inverse: (i, j) => lambertInverse(p, i, j),
        rotation: (_lat, lon) => gridRotation(p, lon),
        cellMetres: () => p.dx,
        rectBounds: (i0, j0, i1, j1) => [gridRectLngLatBounds(p, i0, j0, i1, j1)],
        uniforms: () => ({
            kind: 0,
            a: [p.n, p.rF, (p.lov * Math.PI) / 180, 0],
            b: [p.x0, p.y0, p.dx, p.dy],
        }),
    };
}
