import { Memory } from '../../internal/memory.ts';
import type { LevelReducer, ValueTransform } from './types.ts';
import { HALF_NAN, toHalf } from './half.ts';

export interface LevelGrid {
    level: number;
    /** Source cells merged per texel along each axis. */
    factor: number;
    nx: number;
    ny: number;
    /** IEEE float16 bits in file scan order (row 0 is the southernmost); HALF_NAN marks missing. */
    data: Uint16Array;
}

/** Categories tracked by the 'mode' reducer: integer values 0..MODE_CATEGORIES-1. Others count as missing. */
const MODE_CATEGORIES = 16;

/**
 * Accumulates one decimated level row by row. Peak memory is the level's own output plus one row
 * of accumulators, never the full-resolution grid.
 */
export class LevelAccumulator {
    readonly out: LevelGrid;
    private readonly sums: Float32Array;
    private readonly counts: Uint8Array;
    private readonly hist: Uint8Array | null;
    private readonly reducer: LevelReducer;
    constructor(level: number, factor: number, srcNx: number, srcNy: number, reducer: LevelReducer);
    /** @internal */
    constructor(level: number, factor: number, srcNx: number, srcNy: number, reducer: LevelReducer, memory?: Memory);
    constructor(level: number, factor: number, srcNx: number, srcNy: number, reducer: LevelReducer, memory = new Memory()) {
        this.reducer = reducer;
        const nx = Math.ceil(srcNx / factor);
        const ny = Math.ceil(srcNy / factor);
        this.out = { level, factor, nx, ny, data: memory.array(Uint16Array, nx * ny) };
        this.sums = memory.array(Float32Array, nx);
        this.counts = memory.array(Uint8Array, nx);
        this.hist = reducer === 'mode' ? memory.array(Uint8Array, nx * MODE_CATEGORIES) : null;
        if (reducer === 'max') this.sums.fill(-Infinity);
    }
    add(i: number, v: number): void {
        const c = (i / this.out.factor) | 0;
        if (this.reducer === 'mean') this.sums[c] += v;
        else if (this.reducer === 'max') { if (v > this.sums[c]) this.sums[c] = v; }
        else {
            const k = Math.round(v);
            if (k < 0 || k >= MODE_CATEGORIES) return;
            this.hist![c * MODE_CATEGORIES + k]++;
        }
        this.counts[c]++;
    }
    /** Write output row r from the accumulators and reset them. */
    flush(r: number): void {
        const { nx, data } = this.out;
        const base = r * nx;
        for (let c = 0; c < nx; c++) {
            const n = this.counts[c];
            if (n === 0) data[base + c] = HALF_NAN;
            else if (this.reducer === 'mean') data[base + c] = toHalf(this.sums[c] / n);
            else if (this.reducer === 'max') data[base + c] = toHalf(this.sums[c]);
            else {
                const h = this.hist!;
                let best = 0, bestN = -1;
                for (let k = 0; k < MODE_CATEGORIES; k++) {
                    const m = h[c * MODE_CATEGORIES + k];
                    // Ties go to the higher category, so a rarer hazard code is not hidden by a tie.
                    if (m >= bestN && m > 0) { best = k; bestN = m; }
                }
                data[base + c] = toHalf(best);
            }
        }
        this.counts.fill(0);
        if (this.reducer === 'max') this.sums.fill(-Infinity); else this.sums.fill(0);
        this.hist?.fill(0);
    }
}

/** Convert and reduce decoded row-major floats using the same reducers as the GRIB reader. */
export function levelFromValues(values: Float32Array, nx: number, ny: number, level: number, factor: number,
    reducer: LevelReducer, transform: ValueTransform = {}, validMax = Infinity): LevelGrid {
    if (values.length !== nx * ny) throw new Error('Decoded array dimensions do not match the grid');
    const accumulator = new LevelAccumulator(level, factor, nx, ny, reducer);
    const scale = transform.scale ?? 1, offset = transform.offset ?? 0;
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const value = values[j * nx + i] * scale + offset;
            if (Number.isFinite(value) && value <= validMax) accumulator.add(i, value);
        }
        if ((j + 1) % factor === 0 || j === ny - 1) accumulator.flush(Math.floor(j / factor));
    }
    return accumulator.out;
}
