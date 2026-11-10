import type { Vec2 } from './types.ts';

/** Wind arithmetic shared by the plot geometry, the CSV export and the RAOB reader: components and meteorological direction. Pure. */

const D2R = Math.PI / 180;
const FULL_CIRCLE_DEG = 360;

/** Speed in m/s and the direction the wind blows FROM, degrees clockwise from north in [0, 360); a calm wind has direction 0. */
export function windFromComponents(u: number, v: number): { speedMs: number; dirDeg: number } {
    const speedMs = Math.hypot(u, v);
    if (speedMs === 0) return { speedMs, dirDeg: 0 };
    return { speedMs, dirDeg: ((Math.atan2(-u, -v) / D2R) % FULL_CIRCLE_DEG + FULL_CIRCLE_DEG) % FULL_CIRCLE_DEG };
}

/** The components (m/s) of a wind blowing FROM `dirDeg`. */
export function componentsFromWind(dirDeg: number, speedMs: number): Vec2 {
    return { u: -speedMs * Math.sin(dirDeg * D2R), v: -speedMs * Math.cos(dirDeg * D2R) };
}
