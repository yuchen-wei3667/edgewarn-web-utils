import { MRMS_VOLUME_LIMITS } from './limits.ts';
import {
    CONUS_VOLUME_GRID, gridCol, gridRow, distanceBetween, rectCols, rectRows,
    type GridRect, type LatLng, type VolumeGrid,
} from './geometry.ts';

/** Level data over one region, the shape the sampler needs. */
interface SampleSource {
    rect: GridRect;
    /** Per level: values over the rect (row-major, NaN = no data), or null while not loaded. */
    data: ReadonlyArray<Float32Array | null>;
}

interface ProfileSamples {
    /** Columns along the line. */
    n: number;
    nLevels: number;
    /** `values[column * nLevels + level]`; NaN = no echo or not loaded. */
    values: Float32Array;
    /** Distance of each column from A (m). */
    distM: Float32Array;
    lat: Float64Array;
    lng: Float64Array;
    lengthM: number;
}

/** Bilinear value at a fractional grid position of a level; falls back to the nearest cell next to no-data. */
export function sampleLevel(level: Float32Array, rect: GridRect, row: number, col: number): number {
    const rows = rectRows(rect), cols = rectCols(rect);
    const r = row - rect.r0, c = col - rect.c0;
    if (r < -0.5 || c < -0.5 || r > rows - 0.5 || c > cols - 0.5) return NaN;
    const r0 = Math.min(Math.max(Math.floor(r), 0), rows - 1), c0 = Math.min(Math.max(Math.floor(c), 0), cols - 1);
    const r1 = Math.min(r0 + 1, rows - 1), c1 = Math.min(c0 + 1, cols - 1);
    const fr = Math.min(Math.max(r - r0, 0), 1), fc = Math.min(Math.max(c - c0, 0), 1);
    const v00 = level[r0 * cols + c0], v01 = level[r0 * cols + c1], v10 = level[r1 * cols + c0], v11 = level[r1 * cols + c1];
    if (Number.isNaN(v00) || Number.isNaN(v01) || Number.isNaN(v10) || Number.isNaN(v11)) {
        return level[Math.min(Math.round(r), rows - 1) * cols + Math.min(Math.round(c), cols - 1)];
    }
    return (v00 * (1 - fc) + v01 * fc) * (1 - fr) + (v10 * (1 - fc) + v11 * fc) * fr;
}

export function profileColumns(
    lengthM: number,
    cellM: number,
    min: number = MRMS_VOLUME_LIMITS.minProfileColumns,
    max: number = MRMS_VOLUME_LIMITS.maxProfileColumns,
): number {
    return Math.min(max, Math.max(min, Math.round((2 * lengthM) / cellM)));
}

/** Samples every loaded level along the straight lat/lon line A to B (within about 0.1% of a great circle at 96 mi). */
export function sampleProfile(source: SampleSource, a: LatLng, b: LatLng, grid: VolumeGrid = CONUS_VOLUME_GRID): ProfileSamples {
    const lengthM = distanceBetween(a, b);
    const cellM = distanceBetween({ lat: a.lat, lng: 0 }, { lat: a.lat + grid.dj, lng: 0 });
    const n = profileColumns(lengthM, cellM);
    const nLevels = source.data.length;
    const values = new Float32Array(n * nLevels).fill(NaN);
    const distM = new Float32Array(n);
    const lat = new Float64Array(n), lng = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        lat[i] = a.lat + (b.lat - a.lat) * t;
        lng[i] = a.lng + (b.lng - a.lng) * t;
        distM[i] = lengthM * t;
        const row = gridRow(lat[i], grid), col = gridCol(lng[i], grid);
        for (let k = 0; k < nLevels; k++) {
            const level = source.data[k];
            if (level) values[i * nLevels + k] = sampleLevel(level, source.rect, row, col);
        }
    }
    return { n, nLevels, values, distM, lat, lng, lengthM };
}

/**
 * Value of one column at height `z` (km): linear between the nearest usable levels below and above.
 * A level counts as usable when it is loaded. Where only one of the pair has an echo, the nearer
 * level supplies the value if `z` is within half a gap of it, so echo tops do not turn into blocks.
 */
export function verticalValue(column: ArrayLike<number>, usable: ReadonlyArray<boolean>, heights: ReadonlyArray<number>, z: number): number {
    let lo = -1, hi = -1;
    for (let k = 0; k < heights.length; k++) {
        if (!usable[k]) continue;
        if (heights[k] <= z) lo = k;
        else { hi = k; break; }
    }
    if (lo < 0 && hi < 0) return NaN;
    if (lo < 0) return z >= heights[hi] - 0.125 ? column[hi] : NaN;
    if (hi < 0) return z <= heights[lo] + 0.5 ? column[lo] : NaN;
    const v0 = column[lo], v1 = column[hi];
    const t = (z - heights[lo]) / (heights[hi] - heights[lo]);
    if (!Number.isNaN(v0) && !Number.isNaN(v1)) return v0 + (v1 - v0) * t;
    if (!Number.isNaN(v0) && t < 0.5) return v0;
    if (!Number.isNaN(v1) && t >= 0.5) return v1;
    return NaN;
}

/** Every level's value at one point (exact bilinear read of the region, for the hover readout). */
export function sampleColumn(source: SampleSource, lat: number, lng: number, grid: VolumeGrid = CONUS_VOLUME_GRID): Float32Array {
    const out = new Float32Array(source.data.length).fill(NaN);
    const row = gridRow(lat, grid), col = gridCol(lng, grid);
    for (let k = 0; k < source.data.length; k++) {
        const level = source.data[k];
        if (level) out[k] = sampleLevel(level, source.rect, row, col);
    }
    return out;
}
