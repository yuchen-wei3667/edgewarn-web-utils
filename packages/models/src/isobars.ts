import {
    ISOBAR_INTERVAL_HPA,
    ISOBAR_MAJOR_EVERY,
    ISOBAR_SMOOTH_PASSES,
    MODEL_TILE_HALO,
    PRESSURE_CENTER_EDGE_TEXELS,
    PRESSURE_CENTER_PROMINENCE_HPA,
    PRESSURE_CENTER_RADIUS_TEXELS,
    PRESSURE_CENTER_STRIDE,
} from './limits.ts';
import { fromHalf } from '@edgewarn/web-utils/grib2';
import type { GridProjection } from './projection/types.ts';

import { levelLayout, tileTexels, type ModelTileKey } from './tiles.ts';

/** One level of a field as a plain grid; NaN marks texels no tile covered. */
export interface IsobarLevelGrid {
    nx: number;
    ny: number;
    /** Grid cells merged per texel. */
    factor: number;
    values: Float32Array;
}

export interface IsobarTile {
    key: ModelTileKey;
    width: number;
    height: number;
    /** float16 bits, one channel, with the tile's halo. */
    data: ArrayBuffer;
}

export interface IsobarLine {
    hpa: number;
    major: boolean;
    coordinates: [number, number][];
}
export interface PressureCenter {
    kind: 'H' | 'L';
    hpa: number;
    lng: number;
    lat: number;
}
export interface IsobarSet {
    lines: IsobarLine[];
    centers: PressureCenter[];
}

/**
 * Stitch the interiors of a level's tiles into one grid. `offset` restores display values
 * (MSLP is stored as hPa - 1000; heights are already in dam).
 */
export function assembleLevelGrid(
    tiles: readonly IsobarTile[],
    level: number,
    gridNx: number,
    gridNy: number,
    offset: number,
    factors: readonly number[],
): IsobarLevelGrid {
    const layout = levelLayout(level, gridNx, gridNy, factors);
    const values = new Float32Array(layout.nx * layout.ny).fill(Number.NaN);
    for (const tile of tiles) {
        if (tile.key.level !== level) continue;
        const { c0, r0, c1, r1 } = tileTexels(layout, tile.key.tx, tile.key.ty);
        const data = new Uint16Array(tile.data);
        for (let r = r0; r < r1; r++) {
            const src = (r - r0 + MODEL_TILE_HALO) * tile.width + MODEL_TILE_HALO;
            for (let c = c0; c < c1; c++) values[r * layout.nx + c] = fromHalf(data[src + c - c0]) + offset;
        }
    }
    return { nx: layout.nx, ny: layout.ny, factor: layout.factor, values };
}

/** Separable [1 2 1] smoothing that ignores NaN neighbours; NaN texels stay NaN. */
export function smoothGrid(values: Float32Array, nx: number, ny: number, passes: number): Float32Array {
    let a: Float32Array = values;
    let b: Float32Array = new Float32Array(values.length);
    for (let p = 0; p < passes * 2; p++) {
        const horizontal = p % 2 === 0;
        for (let r = 0; r < ny; r++) {
            for (let c = 0; c < nx; c++) {
                const k = r * nx + c;
                const centre = a[k];
                if (Number.isNaN(centre)) {
                    b[k] = centre;
                    continue;
                }
                const lo = horizontal ? (c > 0 ? a[k - 1] : Number.NaN) : r > 0 ? a[k - nx] : Number.NaN;
                const hi = horizontal
                    ? c < nx - 1
                        ? a[k + 1]
                        : Number.NaN
                    : r < ny - 1
                      ? a[k + nx]
                      : Number.NaN;
                let sum = 2 * centre;
                let weight = 2;
                if (!Number.isNaN(lo)) {
                    sum += lo;
                    weight += 1;
                }
                if (!Number.isNaN(hi)) {
                    sum += hi;
                    weight += 1;
                }
                b[k] = sum / weight;
            }
        }
        [a, b] = [b, a];
    }
    return a === values ? values.slice() : a;
}

/**
 * Marching squares at every `interval` units, stitched into polylines in texel coordinates. An edge
 * between two texels has one id, shared by the two squares it borders, which is how segments join.
 */
export function contourTexels(
    grid: IsobarLevelGrid,
    interval: number,
): { level: number; points: [number, number][] }[] {
    const { nx, ny, values } = grid;
    // Horizontal edge (c, r)-(c+1, r) has id 2 * (r * nx + c); vertical edge (c, r)-(c, r+1) has 2 * (r * nx + c) + 1.
    const hEdge = (c: number, r: number) => 2 * (r * nx + c);
    const vEdge = (c: number, r: number) => 2 * (r * nx + c) + 1;
    const segments = new Map<number, number[]>();
    for (let r = 0; r < ny - 1; r++) {
        for (let c = 0; c < nx - 1; c++) {
            const v00 = values[r * nx + c],
                v10 = values[r * nx + c + 1];
            const v01 = values[(r + 1) * nx + c],
                v11 = values[(r + 1) * nx + c + 1];
            const lo = Math.min(v00, v10, v01, v11);
            const hi = Math.max(v00, v10, v01, v11);
            if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
            const kMin = Math.ceil(lo / interval),
                kMax = Math.floor(hi / interval);
            for (let k = kMin; k <= kMax; k++) {
                const level = k * interval;
                // Corners at or above the level are "in"; this keeps a value that sits exactly on a level consistent.
                const i00 = v00 >= level,
                    i10 = v10 >= level,
                    i01 = v01 >= level,
                    i11 = v11 >= level;
                const code = (i00 ? 1 : 0) | (i10 ? 2 : 0) | (i11 ? 4 : 0) | (i01 ? 8 : 0);
                if (code === 0 || code === 15) continue;
                const top = hEdge(c, r),
                    bottom = hEdge(c, r + 1),
                    left = vEdge(c, r),
                    right = vEdge(c + 1, r);
                const out = segments.get(level) ?? [];
                segments.set(level, out);
                const add = (a: number, b: number) => {
                    out.push(a, b);
                };
                switch (code) {
                    case 1:
                    case 14:
                        add(top, left);
                        break;
                    case 2:
                    case 13:
                        add(top, right);
                        break;
                    case 3:
                    case 12:
                        add(left, right);
                        break;
                    case 4:
                    case 11:
                        add(right, bottom);
                        break;
                    case 6:
                    case 9:
                        add(top, bottom);
                        break;
                    case 7:
                    case 8:
                        add(left, bottom);
                        break;
                    default: {
                        // Saddle (5 or 10): the square's mean says whether the high corners join.
                        const joined = (v00 + v10 + v01 + v11) / 4 >= level;
                        if (code === 5) {
                            if (joined) {
                                add(top, right);
                                add(left, bottom);
                            } else {
                                add(top, left);
                                add(right, bottom);
                            }
                        } else if (joined) {
                            add(top, left);
                            add(right, bottom);
                        } else {
                            add(top, right);
                            add(left, bottom);
                        }
                    }
                }
            }
        }
    }

    const position = (id: number, level: number): [number, number] => {
        const cell = id >> 1;
        const c = cell % nx,
            r = (cell - c) / nx;
        if ((id & 1) === 0) {
            const a = values[cell],
                b = values[cell + 1];
            return [c + (b === a ? 0.5 : (level - a) / (b - a)), r];
        }
        const a = values[cell],
            b = values[cell + nx];
        return [c, r + (b === a ? 0.5 : (level - a) / (b - a))];
    };

    const out: { level: number; points: [number, number][] }[] = [];
    for (const [level, flat] of segments) {
        const count = flat.length / 2;
        const touching = new Map<number, number[]>();
        for (let s = 0; s < count; s++) {
            for (const end of [flat[2 * s], flat[2 * s + 1]]) {
                const list = touching.get(end);
                if (list) list.push(s);
                else touching.set(end, [s]);
            }
        }
        const used = new Uint8Array(count);
        /** Walk from `edge` through unused segments, adding each far end to the chain's tail or head. */
        const follow = (edge: number, chain: number[], atEnd: boolean) => {
            let at = edge;
            for (;;) {
                const next = (touching.get(at) ?? []).find((s) => !used[s]);
                if (next === undefined) return;
                used[next] = 1;
                at = flat[2 * next] === at ? flat[2 * next + 1] : flat[2 * next];
                if (atEnd) chain.push(at);
                else chain.unshift(at);
            }
        };
        for (let s = 0; s < count; s++) {
            if (used[s]) continue;
            used[s] = 1;
            const chain = [flat[2 * s], flat[2 * s + 1]];
            follow(chain[1], chain, true);
            follow(chain[0], chain, false);
            if (chain.length < 3) continue;
            out.push({ level, points: chain.map((id) => position(id, level)) });
        }
    }
    return out;
}

/** High and Low centres: extremes of a window that also stand out from its rim. */
export function findPressureCenters(
    grid: IsobarLevelGrid,
    radius: number,
    prominence: number,
    edge: number,
): { c: number; r: number; kind: 'H' | 'L' }[] {
    const { nx, ny, values } = grid;
    const windowExtreme = (pickMax: boolean): Float32Array => {
        const worst = pickMax ? -Infinity : Infinity;
        const rows = new Float32Array(values.length);
        for (let r = 0; r < ny; r++) {
            for (let c = 0; c < nx; c++) {
                let best = worst;
                for (let x = Math.max(0, c - radius); x <= Math.min(nx - 1, c + radius); x++) {
                    const v = values[r * nx + x];
                    if (!Number.isNaN(v) && (pickMax ? v > best : v < best)) best = v;
                }
                rows[r * nx + c] = best;
            }
        }
        const out = new Float32Array(values.length);
        for (let r = 0; r < ny; r++) {
            for (let c = 0; c < nx; c++) {
                let best = worst;
                for (let y = Math.max(0, r - radius); y <= Math.min(ny - 1, r + radius); y++) {
                    const v = rows[y * nx + c];
                    if (pickMax ? v > best : v < best) best = v;
                }
                out[r * nx + c] = best;
            }
        }
        return out;
    };
    const rimMean = (c: number, r: number): number => {
        let sum = 0,
            n = 0;
        for (let a = 0; a < 16; a++) {
            const x = Math.round(c + radius * Math.cos((a * Math.PI) / 8));
            const y = Math.round(r + radius * Math.sin((a * Math.PI) / 8));
            if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
            const v = values[y * nx + x];
            if (!Number.isNaN(v)) {
                sum += v;
                n++;
            }
        }
        return n ? sum / n : Number.NaN;
    };
    const found: { c: number; r: number; kind: 'H' | 'L'; strength: number }[] = [];
    for (const kind of ['H', 'L'] as const) {
        const extreme = windowExtreme(kind === 'H');
        for (let r = edge; r < ny - edge; r++) {
            for (let c = edge; c < nx - edge; c++) {
                const v = values[r * nx + c];
                if (Number.isNaN(v) || v !== extreme[r * nx + c]) continue;
                const rim = rimMean(c, r);
                const depth = kind === 'H' ? v - rim : rim - v;
                if (!(depth >= prominence)) continue;
                // A flat top ties across several texels: keep the first one found.
                if (
                    found.some(
                        (f) => f.kind === kind && Math.abs(f.c - c) <= radius && Math.abs(f.r - r) <= radius,
                    )
                )
                    continue;
                found.push({ c, r, kind, strength: depth });
            }
        }
    }
    return found;
}

/** Every `stride`th texel in both directions. */
function thinGrid(grid: IsobarLevelGrid, stride: number): IsobarLevelGrid {
    const nx = Math.ceil(grid.nx / stride),
        ny = Math.ceil(grid.ny / stride);
    const values = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++)
        for (let c = 0; c < nx; c++) values[r * nx + c] = grid.values[r * stride * grid.nx + c * stride];
    return { nx, ny, factor: grid.factor * stride, values };
}

/**
 * Cut a polyline wherever it jumps across the antimeridian (longitude changes by more than 180 degrees
 * between neighbours), so a line on a global grid is never drawn the long way round the map.
 */
function splitAtAntimeridian(coordinates: [number, number][]): [number, number][][] {
    const parts: [number, number][][] = [[coordinates[0]]];
    for (let k = 1; k < coordinates.length; k++) {
        if (Math.abs(coordinates[k][0] - coordinates[k - 1][0]) > 180) parts.push([]);
        parts[parts.length - 1].push(coordinates[k]);
    }
    return parts.filter((part) => part.length >= 2);
}

/** Project a display-unit grid's contours to GeoJSON longitude/latitude, splitting at the dateline. */
export function buildContourLines(
    grid: IsobarLevelGrid,
    proj: GridProjection,
    interval: number,
): { value: number; major: boolean; coordinates: [number, number][] }[] {
    if (!Number.isFinite(interval) || interval <= 0) throw new Error('Contour interval must be positive');
    const smooth = { ...grid, values: smoothGrid(grid.values, grid.nx, grid.ny, ISOBAR_SMOOTH_PASSES) };
    return projectContourLines(smooth, proj, interval);
}

function projectContourLines(
    grid: IsobarLevelGrid,
    proj: GridProjection,
    interval: number,
): { value: number; major: boolean; coordinates: [number, number][] }[] {
    const shift = (grid.factor - 1) / 2;
    return contourTexels(grid, interval).flatMap(({ level, points }) =>
        splitAtAntimeridian(
            points.map(([x, y]) => {
                const [lat, lng] = proj.inverse(x * grid.factor + shift, y * grid.factor + shift);
                return [lng, lat] as [number, number];
            }),
        ).map((coordinates) => ({
            value: level,
            major: level % (interval * ISOBAR_MAJOR_EVERY) === 0,
            coordinates,
        })),
    );
}

/** Isobars and Highs/Lows for a pressure grid already in hPa. */
export function buildIsobarSet(grid: IsobarLevelGrid, proj: GridProjection): IsobarSet {
    const smooth = { ...grid, values: smoothGrid(grid.values, grid.nx, grid.ny, ISOBAR_SMOOTH_PASSES) };
    const toLngLat = (x: number, y: number): [number, number] => {
        const shift = (smooth.factor - 1) / 2;
        const [lat, lng] = proj.inverse(x * smooth.factor + shift, y * smooth.factor + shift);
        return [lng, lat];
    };
    const lines: IsobarLine[] = projectContourLines(smooth, proj, ISOBAR_INTERVAL_HPA).map(
        ({ value, ...line }) => ({ ...line, hpa: value }),
    );
    // Systems are hundreds of km across, so they are searched on a thinned copy of the grid.
    const stride = PRESSURE_CENTER_STRIDE;
    const thin = thinGrid(smooth, stride);
    const centers: PressureCenter[] = findPressureCenters(
        thin,
        PRESSURE_CENTER_RADIUS_TEXELS,
        PRESSURE_CENTER_PROMINENCE_HPA,
        PRESSURE_CENTER_EDGE_TEXELS,
    ).map(({ c, r, kind }) => {
        const [lng, lat] = toLngLat(c * stride, r * stride);
        return { kind, hpa: Math.round(thin.values[r * thin.nx + c]), lng, lat };
    });
    return { lines, centers };
}
