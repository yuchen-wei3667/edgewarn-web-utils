import type { GridProjection } from './projection/types.ts';

/**
 * Rotate grid-relative wind components to earth-relative in place.
 * Cells with NaN components stay NaN.
 */
export function rotateToEarth(
    u: Float32Array,
    v: Float32Array,
    cosA: Float32Array,
    sinA: Float32Array,
): void {
    for (let k = 0; k < u.length; k++) {
        const gu = u[k];
        const gv = v[k];
        u[k] = gu * cosA[k] + gv * sinA[k];
        v[k] = -gu * sinA[k] + gv * cosA[k];
    }
}

/**
 * cos/sin of the grid rotation for every texel of a level whose texels each merge `factor` cells.
 * The rotation varies smoothly across the grid, so it is evaluated at texel centres.
 */
export function rotationTables(
    p: GridProjection,
    nx: number,
    ny: number,
    factor: number,
): { cos: Float32Array; sin: Float32Array } {
    const cos = new Float32Array(nx * ny);
    const sin = new Float32Array(nx * ny);
    const off = (factor - 1) / 2;
    for (let r = 0; r < ny; r++) {
        for (let c = 0; c < nx; c++) {
            const [lat, lon] = p.inverse(c * factor + off, r * factor + off);
            const a = p.rotation(lat, lon);
            cos[r * nx + c] = Math.cos(a);
            sin[r * nx + c] = Math.sin(a);
        }
    }
    return { cos, sin };
}

/** Speed and meteorological direction (degrees the wind blows from, 0 = north) of an earth-relative wind. */
export function speedAndDirection(u: number, v: number): { speed: number; direction: number } {
    const speed = Math.hypot(u, v);
    const direction = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
    return { speed, direction };
}
