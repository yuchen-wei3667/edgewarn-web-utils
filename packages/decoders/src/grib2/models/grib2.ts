import { Memory } from '../../internal/memory.ts';
import { LevelAccumulator, type LevelGrid } from './levelGrid.ts';
export type { LevelGrid } from './levelGrid.ts';
import { parseSection5, s32, u16, u32 } from '../sections.ts';
import type { GridRotation, LevelReducer, ValueTransform } from './types.ts';
import { isAuditedPacking } from '../../internal/audited.ts';
import { HALF_NAN, toHalf } from './half.ts';

interface ModelGridBase {
    nx: number;
    ny: number;
    lat1: number;
    lon1: number;
    /**
     * GRIB scanning mode flags. Supported: 0x40 (rows run south to north) and 0x50 (the same, but
     * adjacent rows scan in opposite directions, so the second, fourth... row is stored east to west);
     * for a lat/lon grid also 0x00 (rows run north to south).
     */
    scanMode: number;
    /**
     * Radius of the spherical earth the message declares, metres. Absent only on grids built outside
     * this decoder (the RTMA reader keeps its own copy and passes the radius explicitly).
     */
    radiusM?: number;
    /**
     * Resolution and component flags (octet 55) bit 5: the message says its vector components follow the
     * grid's axes. Only a default for a `vector` field with no `frame` of its own: HRRR, RRFS and REFS
     * carry the "east and north" flag on winds that are in fact grid-relative.
     */
    componentsRelativeToGrid?: boolean;
}

/** Lambert conformal (3.30) grid as stored in the message. Angles in degrees, distances in metres. */
export interface LambertModelGrid extends ModelGridBase {
    projection: 'lambert';
    lov: number;
    latin1: number;
    latin2: number;
    dx: number;
    dy: number;
}

/** Regular latitude/longitude (3.0) grid. Angles and increments in degrees; `lon1` in [0, 360). */
export interface LatLonModelGrid extends ModelGridBase {
    rotation?: GridRotation;
    projection: 'latlon';
    dlat: number;
    dlon: number;
}

/** Polar stereographic (3.20), north pole only. `lov` is the meridian parallel to the grid's y axis; `latD` is where `dx` and `dy` are true. */
export interface PolarStereoModelGrid extends ModelGridBase {
    projection: 'polarStereo';
    lov: number;
    latD: number;
    dx: number;
    dy: number;
}

/** Mercator (3.10) with the grid's axes along the equator and the meridians. `latD` is where `dx` and `dy` are true. */
export interface MercatorModelGrid extends ModelGridBase {
    projection: 'mercator';
    latD: number;
    dx: number;
    dy: number;
}

export type ModelGrid = LambertModelGrid | LatLonModelGrid | PolarStereoModelGrid | MercatorModelGrid;

/** GRIB2 flag table 3.3 bit 5 (octet 55): u and v components are relative to the x and y of the grid. */
const COMPONENTS_RELATIVE_TO_GRID = 0x08;

/** GRIB2 flag table 3.4 bit 4: adjacent rows scan in opposite directions. */
const SCAN_ALTERNATING_ROWS = 0x10;
/** Rows run south to north, west to east, i fastest. The only layout this decoder handles, with or without alternating rows. */
const SCAN_SOUTH_TO_NORTH = 0x40;

/** Code table 3.2 shapes of the earth this decoder reads: 0 sphere 6 367 470 m, 1 sphere with its radius in the message, 6 sphere 6 371 229 m. */
function earthRadiusM(s: Uint8Array): number {
    const shape = s[14];
    if (shape === 0) return 6367470;
    if (shape === 6) return 6371229;
    if (shape === 1) {
        const radius = u32(s, 16) / 10 ** s[15];
        if (radius > 0) return radius;
    }
    throw new Error(`Shape of earth ${shape} not supported`);
}

export type { ValueTransform };

/** Read n (0..32) bits MSB-first starting at bit position pos. */
function bits(b: Uint8Array, pos: number, n: number): number {
    if (n === 0) return 0;
    if (n > 25) return bits(b, pos, n - 16) * 65536 + bits(b, pos + n - 16, 16);
    const i = pos >>> 3;
    // Out-of-range reads yield undefined, which coerces to 0 in bitwise ops.
    const word = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    return ((word << (pos & 7)) >>> 0) >>> (32 - n);
}

/** n-octet sign-magnitude integer (Section 7 spatial differencing descriptors). */
function signedOctets(b: Uint8Array, pos: number, n: number): number {
    const v = bits(b, pos, n * 8);
    const top = 2 ** (n * 8 - 1);
    return v >= top ? -(v - top) : v;
}

/** Micro-degrees, the unit of a grid's angles while the basic angle and its subdivisions are unset. */
const MICRODEGREE = 1e-6;
/** How far a lat/lon grid's stated last point may sit from first point + increments, degrees. */
const LATLON_EXTENT_TOLERANCE_DEG = 1e-3;
/** Rows run north to south, columns west to east (lat/lon grids only). */
const SCAN_NORTH_TO_SOUTH = 0x00;

/** Regular latitude/longitude (3.0): the octet numbers are those of the GRIB2 template table. */
function parseLatLonGrid(s: Uint8Array): LatLonModelGrid {
    const scanMode = s[71];
    if (scanMode !== SCAN_NORTH_TO_SOUTH && scanMode !== SCAN_SOUTH_TO_NORTH) {
        throw new Error(`Scan mode 0x${scanMode.toString(16)} not supported (lat/lon grids: 0x00 or 0x40)`);
    }
    if (u32(s, 38) !== 0) throw new Error('Lat/lon grid with a non-zero basic angle not supported');
    const nx = u32(s, 30);
    const ny = u32(s, 34);
    const lat1 = s32(s, 46) * MICRODEGREE;
    const lon1 = u32(s, 50) * MICRODEGREE;
    const lat2 = s32(s, 55) * MICRODEGREE;
    const lon2 = u32(s, 59) * MICRODEGREE;
    const dlon = u32(s, 63) * MICRODEGREE;
    const dlat = u32(s, 67) * MICRODEGREE;
    // The increments and the last point must agree, or a cell would be placed on the wrong coordinate.
    const wantLat2 = lat1 + (scanMode === SCAN_NORTH_TO_SOUTH ? -1 : 1) * (ny - 1) * dlat;
    const lonSpan = (((lon2 - lon1) % 360) + 360) % 360;
    // Increments are rounded to whole micro-degrees (HAFS stores 0.02 as 19999), so the error grows with the cell count.
    const latTolerance = Math.max(LATLON_EXTENT_TOLERANCE_DEG, ny * MICRODEGREE);
    const lonTolerance = Math.max(LATLON_EXTENT_TOLERANCE_DEG, nx * MICRODEGREE);
    if (Math.abs(lat2 - wantLat2) > latTolerance || Math.abs(lonSpan - (nx - 1) * dlon) > lonTolerance) {
        throw new Error('Lat/lon grid extent does not match its increments');
    }
    return {
        projection: 'latlon', nx, ny, lat1, lon1, dlat, dlon, scanMode, radiusM: earthRadiusM(s),
        componentsRelativeToGrid: (s[54] & COMPONENTS_RELATIVE_TO_GRID) !== 0,
    };
}

/**
 * Rotated latitude/longitude (3.1): the layout of 3.0 on rotated axes, then the southern pole of the rotation (octets 73 to 80)
 * and an angle of rotation (octets 81 to 84, an IEEE float) that must be zero: the projection layer applies the pole only.
 */
function parseRotatedLatLonGrid(s: Uint8Array): ModelGrid {
    const angle = new DataView(s.buffer, s.byteOffset + 80, 4).getFloat32(0);
    if (angle !== 0) throw new Error('Rotated lat/lon grid with a non-zero angle of rotation not supported');
    return { ...parseLatLonGrid(s), rotation: { southPoleLat: s32(s, 72) * MICRODEGREE, southPoleLon: u32(s, 76) * MICRODEGREE } };
}

/** Rows run south to north, with or without alternating directions: the layouts the projected grids use. */
function projectedScanMode(scanMode: number): number {
    if (scanMode !== SCAN_SOUTH_TO_NORTH && scanMode !== (SCAN_SOUTH_TO_NORTH | SCAN_ALTERNATING_ROWS)) {
        throw new Error(`Scan mode 0x${scanMode.toString(16)} not supported`);
    }
    return scanMode;
}

/** Polar stereographic (3.20): octet numbers are those of the GRIB2 template table, minus one. */
function parsePolarStereoGrid(s: Uint8Array): ModelGrid {
    if ((s[63] & 0x80) !== 0) throw new Error('Polar stereographic grid centred on the south pole not supported');
    return {
        projection: 'polarStereo',
        nx: u32(s, 30),
        ny: u32(s, 34),
        lat1: s32(s, 38) * MICRODEGREE,
        lon1: u32(s, 42) * MICRODEGREE,
        latD: s32(s, 47) * MICRODEGREE,
        lov: u32(s, 51) * MICRODEGREE,
        dx: u32(s, 55) * 1e-3,
        dy: u32(s, 59) * 1e-3,
        scanMode: projectedScanMode(s[64]),
        radiusM: earthRadiusM(s),
        componentsRelativeToGrid: (s[46] & COMPONENTS_RELATIVE_TO_GRID) !== 0,
    };
}

/** Mercator (3.10). NBM's files put the grid's central meridian in the orientation octets; it does not change the mapping, so it is ignored. */
function parseMercatorGrid(s: Uint8Array): ModelGrid {
    return {
        projection: 'mercator',
        nx: u32(s, 30),
        ny: u32(s, 34),
        lat1: s32(s, 38) * MICRODEGREE,
        lon1: u32(s, 42) * MICRODEGREE,
        latD: s32(s, 47) * MICRODEGREE,
        dx: u32(s, 64) * 1e-3,
        dy: u32(s, 68) * 1e-3,
        scanMode: projectedScanMode(s[59]),
        radiusM: earthRadiusM(s),
        componentsRelativeToGrid: (s[46] & COMPONENTS_RELATIVE_TO_GRID) !== 0,
    };
}

function parseGrid(s: Uint8Array): ModelGrid {
    const tmpl = u16(s, 12);
    if (tmpl === 0) return parseLatLonGrid(s);
    if (tmpl === 1) return parseRotatedLatLonGrid(s);
    if (tmpl === 20) return parsePolarStereoGrid(s);
    if (tmpl === 10) return parseMercatorGrid(s);
    if (tmpl !== 30) throw new Error(`Grid template 3.${tmpl} not supported (Lambert conformal 3.30, polar stereographic 3.20, Mercator 3.10, regular lat/lon 3.0 and rotated lat/lon 3.1)`);
    const scanMode = projectedScanMode(s[64]);
    return {
        projection: 'lambert',
        nx: u32(s, 30),
        ny: u32(s, 34),
        lat1: s32(s, 38) * 1e-6,
        lon1: u32(s, 42) * 1e-6,
        lov: u32(s, 51) * 1e-6,
        dx: u32(s, 55) * 1e-3,
        dy: u32(s, 59) * 1e-3,
        scanMode,
        latin1: s32(s, 65) * 1e-6,
        latin2: s32(s, 69) * 1e-6,
        radiusM: earthRadiusM(s),
        componentsRelativeToGrid: (s[54] & COMPONENTS_RELATIVE_TO_GRID) !== 0,
    };
}

/**
 * Receives unpacked values in scan order, skipping points the bitmap marks absent, and writes them
 * to the requested levels. Kept as a closure-free class so V8 keeps the hot path monomorphic.
 */
class LevelWriter {
    private gi = 0;
    private i = 0;
    private j = 0;
    private readonly total: number;
    private readonly nx: number;
    private readonly ny: number;
    private readonly bitmap: Uint8Array | null;
    private readonly l0: Uint16Array | null;
    private readonly accs: LevelAccumulator[];
    /** Adjacent rows scan in opposite directions: odd rows (the second, fourth...) arrive east to west. */
    private readonly alternating: boolean;
    /** Values above this are a "none" code in the field (an unlimited ceiling), not data: they are written as missing. */
    private readonly validMax: number;
    constructor(
        nx: number, ny: number, bitmap: Uint8Array | null, l0: Uint16Array | null, accs: LevelAccumulator[], alternating: boolean,
        validMax: number,
    ) {
        this.nx = nx;
        this.ny = ny;
        this.bitmap = bitmap;
        this.l0 = l0;
        this.accs = accs;
        this.alternating = alternating;
        this.validMax = validMax;
        this.total = nx * ny;
    }
    /** Column of the point being written. The bitmap is indexed in scan order, so only the cell's position is mapped. */
    private column(): number {
        return this.alternating && (this.j & 1) === 1 ? this.nx - 1 - this.i : this.i;
    }
    private step(): void {
        if (++this.i === this.nx) {
            for (const a of this.accs) {
                const f = a.out.factor;
                if ((this.j + 1) % f === 0 || this.j === this.ny - 1) a.flush((this.j / f) | 0);
            }
            this.i = 0;
            this.j++;
        }
        this.gi++;
    }
    private skipAbsent(): void {
        const bm = this.bitmap;
        if (!bm) return;
        while (this.gi < this.total && !(bm[this.gi >>> 3] & (0x80 >>> (this.gi & 7)))) this.missingHere();
    }
    private missingHere(): void {
        if (this.l0) this.l0[this.j * this.nx + this.column()] = HALF_NAN;
        this.step();
    }
    value(v: number): void {
        this.skipAbsent();
        if (this.gi >= this.total) return;
        if (v > this.validMax) { this.missingHere(); return; }
        const col = this.column();
        if (this.l0) this.l0[this.j * this.nx + col] = toHalf(v);
        for (const a of this.accs) a.add(col, v);
        this.step();
    }
    missing(): void {
        this.skipAbsent();
        if (this.gi < this.total) this.missingHere();
    }
    finish(): void {
        while (this.gi < this.total) this.missingHere();
    }
}

/** Where an unpacked value goes: the level writers, or whatever a packing addon is tested against. */
export interface ValueSink {
    value(v: number): void;
    missing(): void;
}

/** Section 5 and 7 of one message, with the unpack constants of the field (`value = base + packed * step`). */
export interface PackedField {
    s5: Uint8Array;
    /** Section 7 without its five-octet header. */
    s7: Uint8Array;
    nValues: number;
    nbits: number;
    base: number;
    step: number;
}

/** Reads the packed values of one message and hands each to the sink, in scan order. */
type PackingDecoder =(field: PackedField, sink: ValueSink) => void;

const PACKINGS = new Map<number, PackingDecoder>();

/**
 * Teach the decoder a data representation template beyond 5.0, 5.2 and 5.3. An addon calls this when it loads
 * (`addons/ecmwf` registers CCSDS, 5.42), so a worker pays for a packing only when a model that needs it is used.
 */
export function registerPacking(template: number, decoder: PackingDecoder): void {
    PACKINGS.set(template, decoder);
}

/** The data representation templates the decoder reads without an addon. */
export const BUILT_IN_PACKINGS: readonly number[] = [0, 2, 3];

export interface DecodeLevelsOptions {
    transform?: ValueTransform;
    /** Levels to produce, as indices into `factors`. */
    levels: readonly number[];
    /** Source cells per texel for each level index: the dataset's `factors`. */
    factors: readonly number[];
    reducer?: LevelReducer;
    /** Values above this (after the transform) are treated as missing: the field's "none" code. */
    validMax?: number;
}

interface ParsedMessage {
    grid: ModelGrid;
    s5: Uint8Array;
    s7: Uint8Array;
    bitmap: Uint8Array | null;
}

function parseMessage(msg: Uint8Array): ParsedMessage {
    if (u32(msg, 0) !== 0x47524942 || msg[7] !== 2) throw new Error('Not a GRIB2 message');
    let grid: ModelGrid | null = null;
    let s5: Uint8Array | null = null;
    let s7: Uint8Array | null = null;
    let bitmap: Uint8Array | null = null;
    for (let p = 16; p + 4 <= msg.length && u32(msg, p) !== 0x37373737;) {
        const len = u32(msg, p);
        if (len < 5 || len > msg.length - p) throw new Error('Invalid GRIB2 section length');
        const s = msg.subarray(p, p + len);
        switch (s[4]) {
            case 3: grid = parseGrid(s); break;
            case 5: s5 = s; break;
            case 6:
                if (s[5] === 0) bitmap = s.subarray(6);
                else if (s[5] !== 255) throw new Error(`Bitmap indicator ${s[5]} not supported`);
                break;
            case 7: s7 = s.subarray(5); break;
        }
        p += len;
    }
    if (!grid || !s5 || !s7) throw new Error('GRIB2 message is missing section 3, 5 or 7');
    return { grid, s5, s7, bitmap };
}

/** Read only the grid definition of a message (cheap: no unpacking). */
export function readGrib2Grid(msg: Uint8Array): ModelGrid {
    return parseMessage(msg).grid;
}

/**
 * Decode one GRIB2 message (one field) into float16 grids at one or more levels of detail.
 * Supports DRT 5.0 (simple), 5.2 (complex) and 5.3 (complex + spatial differencing), with or
 * without a bitmap, and any template an addon has registered with `registerPacking`. Values go packed -> transform -> level writers; the full-resolution grid is
 * only allocated when level 0 is requested. NaNs are excluded from the reducers, and a texel with
 * no valid source cell is NaN.
 */

export function decodeGrib2ToLevels(msg: Uint8Array, opts: DecodeLevelsOptions): {
    grid: ModelGrid;
    levels: LevelGrid[];
};
/** @internal */

export function decodeGrib2ToLevels(msg: Uint8Array, opts: DecodeLevelsOptions, memory?: Memory): {
    grid: ModelGrid;
    levels: LevelGrid[];
};
export function decodeGrib2ToLevels(msg: Uint8Array, opts: DecodeLevelsOptions, memory = new Memory()): { grid: ModelGrid; levels: LevelGrid[] } {
    const { grid, s5, s7, bitmap } = parseMessage(msg);
    const factors = opts.factors;
    const reducer = opts.reducer ?? 'mean';
    const wanted = [...new Set(opts.levels)].sort((a, b) => a - b);
    let l0: Uint16Array | null = null;
    const accs: LevelAccumulator[] = [];
    for (const level of wanted) {
        const f = factors[level];
        if (!f) throw new Error(`No factor for level ${level}`);
        if (f === 1) l0 = memory.array(Uint16Array, grid.nx * grid.ny);
        else accs.push(new LevelAccumulator(level, f, grid.nx, grid.ny, reducer, memory));
    }

    const { template, R, E, D, nbits } = parseSection5(s5);
    const nValues = u32(s5, 5);
    const transform = opts.transform ?? {};
    const a = transform.scale ?? 1;
    const dscale = 10 ** -D * a;
    const base = R * dscale + (transform.offset ?? 0);
    const step = 2 ** E * dscale;

    const w = new LevelWriter(grid.nx, grid.ny, bitmap, l0, accs, (grid.scanMode & SCAN_ALTERNATING_ROWS) !== 0, opts.validMax ?? Infinity);
    if (template === 0) {
        for (let i = 0, pos = 0; i < nValues; i++, pos += nbits) w.value(base + bits(s7, pos, nbits) * step);
    } else if (template === 2 || template === 3) {
        decodeComplex(s5, s7, template === 3, nbits, nValues, base, step, w, memory);
    } else {
        const packing = PACKINGS.get(template);
        if (!packing) throw new Error(`Data representation template 5.${template} not supported`);
        if (memory.limitBytes !== Infinity && !isAuditedPacking(packing)) throw new Error('Custom packing is not supported by the budgeted decoder');
        (packing as (field: PackedField, sink: ValueSink, memory: Memory) => void)({ s5, s7, nValues, nbits, base, step }, w, memory);
    }
    w.finish();

    const levels: LevelGrid[] = wanted.map((level) => {
        if (factors[level] === 1) return { level, factor: 1, nx: grid.nx, ny: grid.ny, data: l0! };
        return accs.find((acc) => acc.out.level === level)!.out;
    });
    return { grid, levels };
}

/** Decode one message at full resolution into float16 bits (level 0 of `decodeGrib2ToLevels`). */

export function decodeGrib2ToHalf(msg: Uint8Array, transform?: ValueTransform): {
    grid: ModelGrid;
    data: Uint16Array;
};
/** @internal */

export function decodeGrib2ToHalf(msg: Uint8Array, transform?: ValueTransform, memory?: Memory): {
    grid: ModelGrid;
    data: Uint16Array;
};
export function decodeGrib2ToHalf(msg: Uint8Array, transform: ValueTransform = {}, memory = new Memory()): { grid: ModelGrid; data: Uint16Array } {
    const { grid, levels } = decodeGrib2ToLevels(msg, { transform, levels: [0], factors: [1] }, memory);
    return { grid, data: levels[0].data };
}

function decodeComplex(
    s5: Uint8Array, d: Uint8Array, spatial: boolean, refBits: number, nValues: number,
    base: number, step: number, w: LevelWriter, memory: Memory,
): void {
    const missMgmt = s5[22];
    const ng = u32(s5, 31);
    const widthRef = s5[35];
    const widthBits = s5[36];
    const lenRef = u32(s5, 37);
    const lenInc = s5[41];
    const lastLen = u32(s5, 42);
    const lenBits = s5[46];
    const order = spatial ? s5[47] : 0;
    const extraOctets = spatial ? s5[48] : 0;

    let pos = 0;
    let ival1 = 0, ival2 = 0, minsd = 0;
    if (spatial) {
        if (order !== 1 && order !== 2) throw new Error(`Spatial differencing order ${order} not supported`);
        ival1 = signedOctets(d, pos, extraOctets); pos += extraOctets * 8;
        if (order === 2) { ival2 = signedOctets(d, pos, extraOctets); pos += extraOctets * 8; }
        minsd = signedOctets(d, pos, extraOctets); pos += extraOctets * 8;
    }

    // Per-group descriptors; each block is padded to a whole octet.
    const refs = memory.array(Float64Array, ng);
    for (let k = 0; k < ng; k++, pos += refBits) refs[k] = bits(d, pos, refBits);
    pos = (pos + 7) & ~7;
    const widths = memory.array(Uint8Array, ng);
    for (let k = 0; k < ng; k++, pos += widthBits) widths[k] = widthRef + bits(d, pos, widthBits);
    pos = (pos + 7) & ~7;
    const lens = memory.array(Uint32Array, ng);
    for (let k = 0; k < ng; k++, pos += lenBits) lens[k] = lenRef + bits(d, pos, lenBits) * lenInc;
    lens[ng - 1] = lastLen;
    pos = (pos + 7) & ~7;

    const refMiss1 = 2 ** refBits - 1;
    const refMiss2 = refMiss1 - 1;
    let n = 0;          // non-missing values seen (spatial differencing skips missing points)
    let prev = 0, prev2 = 0;
    let emitted = 0;

    for (let k = 0; k < ng && emitted < nValues; k++) {
        const ref = refs[k];
        const width = widths[k];
        const len = Math.min(lens[k], nValues - emitted);
        const miss1 = 2 ** width - 1;
        const miss2 = miss1 - 1;
        for (let j = 0; j < len; j++, emitted++) {
            let x: number;
            if (width === 0) {
                if (missMgmt !== 0 && (ref === refMiss1 || (missMgmt === 2 && ref === refMiss2))) { w.missing(); continue; }
                x = ref;
            } else {
                const raw = bits(d, pos, width);
                pos += width;
                if (missMgmt !== 0 && (raw === miss1 || (missMgmt === 2 && raw === miss2))) { w.missing(); continue; }
                x = ref + raw;
            }
            let v: number;
            if (order === 0) v = x;
            else if (n === 0) v = ival1;
            else if (order === 1) v = x + minsd + prev;
            else if (n === 1) v = ival2;
            else v = x + minsd + 2 * prev - prev2;
            prev2 = prev;
            prev = v;
            n++;
            w.value(base + v * step);
        }
    }
}
