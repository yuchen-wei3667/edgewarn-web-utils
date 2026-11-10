import {
    DERIVATIVE_BASELINE_M,
    DERIVATIVE_EARTH_RADIUS_M,
    DERIVATIVE_METRIC_CACHE,
    DERIVATIVE_MIN_SPAN_M,
} from './limits.ts';
import type { GridProjection } from './projection/types.ts';

/**
 * Horizontal derivatives on a model grid, for the diagnostic fields (advection, frontogenesis; phase 5.9, ADR-P5-8).
 * Centred differences over `span` cells each side, with the true spacing of each cell (great-circle distance, so a
 * Lambert grid's map scale and a lat/lon grid's convergence are both in it), and gradients turned from the grid's axes
 * to east and north with the projection's rotation, so a derivative is always `d/dEast` and `d/dNorth`.
 * Cells within `span` of the edge are NaN, as are the cells at the pole of a lat/lon grid; a grid whose columns close
 * around the globe wraps. The seam for Phase 6's `ddx`/`ddy`.
 */

export interface GridMetrics {
    nx: number;
    ny: number;
    /** Cells each side of the centre the difference spans. */
    span: number;
    /** Columns close around the globe, so the difference wraps rather than ending at the edge. */
    periodic: boolean;
    /**
     * 1 / metres across the `2 * span` cells of the difference along +i and +j at each cell, negative where +i points
     * west or +j points south; NaN where undefined.
     */
    invDx: Float32Array;
    invDy: Float32Array;
    /** Rotation of the grid axes from east: gradients and winds turn by it. */
    cos: Float32Array;
    sin: Float32Array;
    /** Latitude of each cell, degrees (for the Coriolis parameter). */
    lat: Float32Array;
}

const D2R = Math.PI / 180;

function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const h =
        Math.sin(((lat2 - lat1) * D2R) / 2) ** 2 +
        Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(((lon2 - lon1) * D2R) / 2) ** 2;
    return 2 * DERIVATIVE_EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const wrap180 = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Cells each side of the difference for a grid: the baseline over the cell spacing in the middle of the grid. */
export function derivativeSpan(proj: GridProjection): number {
    const i = Math.floor(proj.nx / 2);
    const j = Math.floor(proj.ny / 2);
    const [la, lo] = proj.inverse(i, j);
    const [lb, lb2] = proj.inverse(i + 1, j);
    const cell = distanceM(la, lo, lb, lb2);
    return Math.max(1, Math.round(DERIVATIVE_BASELINE_M / (2 * cell)));
}

/** Whether the first and last columns are neighbours (a lat/lon grid that covers 360 degrees). */
function closesAround(proj: GridProjection): boolean {
    if (proj.kind !== 'latlon') return false;
    const first = proj.inverse(0, 0)[1];
    const next = proj.inverse(proj.nx, 0)[1];
    return Math.abs(wrap180(next - first)) < 1e-6;
}

/** The last grids' tables: they are pure functions of the grid, and a frame's recipes all use the same one. */
const cache = new Map<string, GridMetrics>();

export function gridMetrics(proj: GridProjection): GridMetrics {
    const key = proj.key;
    const hit = cache.get(key);
    if (hit) {
        cache.delete(key);
        cache.set(key, hit);
        return hit;
    }
    const { nx, ny } = proj;
    const span = derivativeSpan(proj);
    const periodic = closesAround(proj);
    const invDx = new Float32Array(nx * ny);
    const invDy = new Float32Array(nx * ny);
    const cos = new Float32Array(nx * ny);
    const sin = new Float32Array(nx * ny);
    const latitude = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            const [lat, lon] = proj.inverse(i, j);
            const a = proj.rotation(lat, lon);
            cos[k] = Math.cos(a);
            sin[k] = Math.sin(a);
            latitude[k] = lat;
            const [wLat, wLon] = proj.inverse(i - span, j);
            const [eLat, eLon] = proj.inverse(i + span, j);
            const [sLat, sLon] = proj.inverse(i, j - span);
            const [nLat, nLon] = proj.inverse(i, j + span);
            // Signed by where +i and +j point: a lat/lon grid scanned from the north has +j pointing south.
            const dx = distanceM(wLat, wLon, eLat, eLon) * (wrap180(eLon - wLon) < 0 ? -1 : 1);
            const dy = distanceM(sLat, sLon, nLat, nLon) * (nLat - sLat < 0 ? -1 : 1);
            invDx[k] = Math.abs(dx) < DERIVATIVE_MIN_SPAN_M ? Number.NaN : 1 / dx;
            invDy[k] = Math.abs(dy) < DERIVATIVE_MIN_SPAN_M ? Number.NaN : 1 / dy;
        }
    }
    const metrics: GridMetrics = { nx, ny, span, periodic, invDx, invDy, cos, sin, lat: latitude };
    cache.set(key, metrics);
    while (cache.size > DERIVATIVE_METRIC_CACHE) cache.delete(cache.keys().next().value as string);
    return metrics;
}

/** East and north components of a vector given along the grid's axes (the same turn as a grid-relative wind). */
function toEarthAxes(gx: number, gy: number, cos: number, sin: number): [number, number] {
    return [gx * cos + gy * sin, -gx * sin + gy * cos];
}

/**
 * The horizontal gradient of a scalar, per metre, east and north. NaN in any cell the difference needs makes NaN;
 * the cells near the edge are NaN.
 */
export function gradient(field: Float32Array, m: GridMetrics): { east: Float32Array; north: Float32Array } {
    const { nx, ny, span } = m;
    const east = new Float32Array(nx * ny).fill(Number.NaN);
    const north = new Float32Array(nx * ny).fill(Number.NaN);
    for (let j = span; j < ny - span; j++) {
        for (let i = 0; i < nx; i++) {
            let iw = i - span;
            let ie = i + span;
            if (m.periodic) {
                iw = (iw + nx) % nx;
                ie %= nx;
            } else if (iw < 0 || ie >= nx) continue;
            const k = j * nx + i;
            const gx = (field[j * nx + ie] - field[j * nx + iw]) * m.invDx[k];
            const gy = (field[(j + span) * nx + i] - field[(j - span) * nx + i]) * m.invDy[k];
            [east[k], north[k]] = toEarthAxes(gx, gy, m.cos[k], m.sin[k]);
        }
    }
    return { east, north };
}
