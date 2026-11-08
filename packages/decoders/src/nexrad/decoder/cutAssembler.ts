import { Memory } from '../../internal/memory.ts';
import type { Radial } from './decoder.ts';

/** Old sites can send up to 800 radials per cut. */
const MAX_ROWS = 800;
const AZIMUTH_BINS = 3600;
export const AZIMUTH_MISSING = 0xffff;
const END_OF_CUT = new Set([2, 4]);

/** One moment of one cut: the rows received, as raw codes. */
export interface CutField {
    moment: string;
    cut: number;
    rows: number;
    gates: number;
    wordSize: 8 | 16;
    scale: number;
    offset: number;
    firstGateMeters: number;
    gateSpacingMeters: number;
    /** rows * gates codes: Uint8Array for 8-bit moments, Uint16Array (host order) for 16-bit. */
    data: Uint8Array | Uint16Array;
    azimuths: Float32Array;
    /** Nearest row for each 0.1 degree of azimuth, or AZIMUTH_MISSING. */
    azimuthLut: Uint16Array;
    /** Mean elevation angle of the received radials. */
    elevation: number;
    scanTimeMs: number;
    complete: boolean;
    /** Azimuth of the newest radial: where the sweep is while the cut is arriving. */
    sweepAzimuth: number;
}

export function buildAzimuthLut(azimuths: ArrayLike<number>, rows: number): Uint16Array;
/** @internal */
export function buildAzimuthLut(azimuths: ArrayLike<number>, rows: number, memory?: Memory): Uint16Array;
export function buildAzimuthLut(azimuths: ArrayLike<number>, rows: number, memory = new Memory()): Uint16Array {
    const lut = memory.array(Uint16Array, AZIMUTH_BINS).fill(AZIMUTH_MISSING);
    if (!rows) return lut;
    const order = Array.from({ length: rows }, (_, i) => i).sort((a, b) => azimuths[a] - azimuths[b]);
    const sorted = order.map((r) => azimuths[r]);
    const gaps: number[] = [];
    for (let i = 0; i < rows; i++) {
        const next = i + 1 < rows ? sorted[i + 1] : sorted[0] + 360;
        gaps.push(next - sorted[i]);
    }
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 1;
    // A bin farther than this from every radial was not swept (partial cut).
    const limit = Math.max(1, median * 1.5);
    let j = 0;
    for (let bin = 0; bin < AZIMUTH_BINS; bin++) {
        const az = bin / 10;
        while (j + 1 < rows && sorted[j + 1] <= az) j++;
        // candidates: sorted[j] (<= az) and the next one, wrapping.
        const lo = sorted[j] <= az ? j : (j - 1 + rows) % rows;
        const hi = (lo + 1) % rows;
        const dLo = Math.abs(((az - sorted[lo] + 540) % 360) - 180);
        const dHi = Math.abs(((az - sorted[hi] + 540) % 360) - 180);
        const best = dLo <= dHi ? lo : hi;
        if (Math.min(dLo, dHi) <= limit) lut[bin] = order[best];
    }
    return lut;
}

/** Collects one moment of one cut, row by row. Copies the borrowed radial buffers. */
export class CutAssembler {
    readonly moment: string;
    readonly cut: number;
    done = false;
    private rows = 0;
    private capacity = 0;
    private gates = 0;
    private wordSize: 8 | 16 = 8;
    private scale = 1;
    private offset = 0;
    private firstGateMeters = 0;
    private gateSpacingMeters = 0;
    private bytes: Uint8Array = new Uint8Array(0);
    private azimuths = new Float32Array(0);
    private elevationSum = 0;
    private scanTimeMs = 0;
    private firstAzimuth = 0;
    private travelled = 0;
    private lastAzimuth = 0;

    constructor(moment: string, cut: number) {
        this.moment = moment;
        this.cut = cut;
    }

    /** Azimuth swept so far over 360, clamped to 1. */
    get fraction(): number {
        return this.done ? 1 : Math.min(1, this.travelled / 360);
    }
    get rowCount(): number {
        return this.rows;
    }

    /** Returns true when this radial ended the cut. */
    accept(radial: Radial): boolean {
        if (this.done || radial.elevationNumber !== this.cut) return false;
        const moment = radial.moments.find((m) => m.name === this.moment);
        if (moment && this.rows < MAX_ROWS) this.addRow(radial, moment);
        if (END_OF_CUT.has(radial.status)) {
            this.done = true;
            return true;
        }
        return false;
    }

    /** Close a cut that ended without an end-of-cut radial (the next cut began). */
    close() {
        this.done = true;
    }

    private addRow(radial: Radial, moment: Radial['moments'][number]) {
        if (!this.rows) {
            this.gates = moment.gates;
            this.wordSize = moment.wordSize;
            this.scale = moment.scale;
            this.offset = moment.offset;
            this.firstGateMeters = moment.firstGateMeters;
            this.gateSpacingMeters = moment.gateSpacingMeters;
            this.scanTimeMs = radial.timeMs;
            this.firstAzimuth = this.lastAzimuth = radial.azimuth;
            this.capacity = 360;
            this.allocate(this.capacity);
        } else {
            let delta = radial.azimuth - this.lastAzimuth;
            if (delta < -180) delta += 360;
            if (delta > 0) this.travelled += delta;
            this.lastAzimuth = radial.azimuth;
        }
        if (this.rows === this.capacity) {
            this.capacity = Math.min(MAX_ROWS, this.capacity * 2);
            this.allocate(this.capacity);
        }
        const rowBytes = this.gates * (this.wordSize / 8);
        const source = moment.raw.subarray(0, Math.min(moment.raw.length, rowBytes));
        this.bytes.set(source, this.rows * rowBytes);
        this.azimuths[this.rows] = radial.azimuth;
        this.elevationSum += radial.elevation;
        this.rows++;
    }

    private allocate(capacity: number) {
        const rowBytes = this.gates * (this.wordSize / 8);
        const bytes = new Uint8Array(capacity * rowBytes);
        bytes.set(this.bytes);
        this.bytes = bytes;
        const azimuths = new Float32Array(capacity);
        azimuths.set(this.azimuths);
        this.azimuths = azimuths;
    }

    /** Snapshot of what has been received. Copies, so the assembler can keep filling. */
    snapshot(): CutField {
        const rows = this.rows;
        const rowBytes = this.gates * (this.wordSize / 8);
        const raw = this.bytes.slice(0, rows * rowBytes);
        let data: Uint8Array | Uint16Array = raw;
        if (this.wordSize === 16) {
            const wide = new Uint16Array(rows * this.gates);
            for (let i = 0; i < wide.length; i++) wide[i] = raw[i * 2] * 256 + raw[i * 2 + 1];
            data = wide;
        }
        const azimuths = this.azimuths.slice(0, rows);
        return {
            moment: this.moment,
            cut: this.cut,
            rows,
            gates: this.gates,
            wordSize: this.wordSize,
            scale: this.scale,
            offset: this.offset,
            firstGateMeters: this.firstGateMeters,
            gateSpacingMeters: this.gateSpacingMeters,
            data,
            azimuths,
            azimuthLut: buildAzimuthLut(azimuths, rows),
            elevation: rows ? this.elevationSum / rows : 0,
            scanTimeMs: this.scanTimeMs,
            complete: this.done,
            sweepAzimuth: this.lastAzimuth,
        };
    }
}
