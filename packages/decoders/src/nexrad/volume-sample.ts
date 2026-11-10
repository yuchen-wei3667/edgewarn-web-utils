import { AZIMUTH_MISSING } from './decoder/cutAssembler.ts';
import type { CutField } from './decoder/cutAssembler.ts';
import { codeToValue } from './catalog.ts';
import { EFFECTIVE_RADIUS_M, beamHeightMeters, groundRangeAndBearing, slantRangeOf } from './geometry.ts';
import type { SiteLocation } from './geometry.ts';

/** Most elevations a volume tool keeps (a VCP has at most about 20 cuts, SAILS repeats are dropped). */
const MAX_POLAR_SWEEPS = 24;
/** Half of the 1 degree beam, as an angle. */
export const BEAM_HALF_WIDTH_RAD = (0.5 * Math.PI) / 180;
/** Sweeps closer than this in elevation are the same elevation scanned again; the newer one is kept. */
const SAME_ELEVATION_DEG = 0.1;

/** One elevation of one moment, as the decoder produced it. Never regridded: lookups go straight to the gates. */
export interface Sweep {
    elevationId: number;
    field: CutField;
}

/** Elevations in rising order, a repeated elevation (SAILS) replaced by its newest scan, empty cuts dropped. */
export function buildSweeps(items: ReadonlyArray<Sweep>): Sweep[] {
    // An elevation cropped to nothing stays: its beam still brackets the heights around it.
    const sorted = items.filter((s) => s.field.rows > 0).sort((a, b) => a.field.elevation - b.field.elevation);
    const kept: Sweep[] = [];
    for (const sweep of sorted) {
        const last = kept[kept.length - 1];
        if (last && sweep.field.elevation - last.field.elevation < SAME_ELEVATION_DEG) {
            if (sweep.field.cut > last.field.cut) kept[kept.length - 1] = sweep;
        } else kept.push(sweep);
    }
    return kept.slice(0, MAX_POLAR_SWEEPS);
}

/** Value at a gate, or NaN where there is no echo, the gate is range folded or the position is not in the data. */
function gateValue(field: CutField, row: number, gate: number): number {
    const code = field.data[row * field.gates + gate];
    const value = codeToValue(code, field.scale, field.offset);
    return value === null ? NaN : value;
}

/** What every elevation sees above one place: beam centre height (km above sea level) and the value in the beam. */
export interface PolarColumn {
    count: number;
    heightsKm: Float64Array;
    values: Float32Array;
    /** Half the beam's thickness (km) at that range, how far past its centre an elevation still speaks for. */
    halfBeamKm: Float64Array;
}

function polarColumnFrom(sweeps: ReadonlyArray<Sweep>, site: SiteLocation, groundMeters: number, bearing: number): PolarColumn {
    const count = sweeps.length;
    const heightsKm = new Float64Array(count), values = new Float32Array(count).fill(NaN), halfBeamKm = new Float64Array(count);
    const siteElevation = site.elevationMeters ?? 0;
    for (let i = 0; i < count; i++) {
        const field = sweeps[i].field;
        const slant = slantRangeOf(groundMeters, field.elevation);
        heightsKm[i] = beamHeightMeters(slant, field.elevation, siteElevation) / 1000;
        halfBeamKm[i] = (slant * BEAM_HALF_WIDTH_RAD) / 1000;
        const gate = Math.floor((slant - field.firstGateMeters) / field.gateSpacingMeters + 0.5);
        if (!(gate >= 0 && gate < field.gates)) continue;
        const row = field.azimuthLut[Math.floor(bearing * 10 + 0.5) % field.azimuthLut.length];
        if (row === AZIMUTH_MISSING) continue;
        values[i] = gateValue(field, row, gate);
    }
    return { count, heightsKm, values, halfBeamKm };
}

/** The column above a point on the map. */
export function polarColumn(sweeps: ReadonlyArray<Sweep>, site: SiteLocation, lat: number, lng: number): PolarColumn {
    const { groundMeters, bearing } = groundRangeAndBearing(site, lat, lng);
    return polarColumnFrom(sweeps, site, groundMeters, bearing);
}

/**
 * Value at height `zKm` in a column: linear between the elevations just below and above. Where only one of the pair
 * has an echo the nearer one speaks for it, and past the lowest or highest beam a value holds for half a beam width.
 */
export function polarValueAt(column: PolarColumn, zKm: number): number {
    const { count, heightsKm: h, values: v, halfBeamKm: half } = column;
    if (count === 0) return NaN;
    let lo = -1;
    while (lo + 1 < count && h[lo + 1] <= zKm) lo++;
    if (lo < 0) return zKm >= h[0] - half[0] ? v[0] : NaN;
    if (lo === count - 1) return zKm <= h[lo] + half[lo] ? v[lo] : NaN;
    const hi = lo + 1;
    const t = (zKm - h[lo]) / (h[hi] - h[lo]);
    const a = v[lo], b = v[hi];
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a + (b - a) * t;
    if (!Number.isNaN(a) && t < 0.5) return a;
    if (!Number.isNaN(b) && t >= 0.5) return b;
    return NaN;
}

interface PlainPoint { lat: number; lng: number }
interface PlainBounds { west: number; south: number; east: number; north: number }

export interface ShapeRange {
    nearM: number;
    farM: number;
}

const LINE_SAMPLES = 64;

/** Nearest and farthest ground distance from the station to a line (sampled along it). */
export function lineRangeFrom(site: SiteLocation, a: PlainPoint, b: PlainPoint): ShapeRange {
    let nearM = Infinity, farM = 0;
    for (let i = 0; i <= LINE_SAMPLES; i++) {
        const t = i / LINE_SAMPLES;
        const { groundMeters } = groundRangeAndBearing(site, a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t);
        nearM = Math.min(nearM, groundMeters);
        farM = Math.max(farM, groundMeters);
    }
    return { nearM, farM };
}

/** Nearest and farthest ground distance from the station to a box: its closest point, and its farthest corner. */
export function boxRangeFrom(site: SiteLocation, box: PlainBounds): ShapeRange {
    const lat = Math.min(Math.max(site.lat, box.south), box.north);
    const lng = Math.min(Math.max(site.lon, box.west), box.east);
    const nearM = groundRangeAndBearing(site, lat, lng).groundMeters;
    let farM = 0;
    for (const corner of [[box.south, box.west], [box.south, box.east], [box.north, box.west], [box.north, box.east]]) {
        farM = Math.max(farM, groundRangeAndBearing(site, corner[0], corner[1]).groundMeters);
    }
    return { nearM, farM };
}

type RangeVerdict = 'inside' | 'partial' | 'outside';

export function rangeVerdict(range: ShapeRange, limitM: number): RangeVerdict {
    if (range.nearM > limitM) return 'outside';
    return range.farM > limitM ? 'partial' : 'inside';
}

/** The columns above `n` evenly spaced points along a line, read straight from the sweeps. */
export function polarProfile(sweeps: ReadonlyArray<Sweep>, site: SiteLocation, a: PlainPoint, b: PlainPoint, n: number): PolarColumn[] {
    const columns: PolarColumn[] = [];
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        columns.push(polarColumn(sweeps, site, a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t));
    }
    return columns;
}

/** Ground distances (m) from the station that a download must cover. */
export interface RangeBand {
    nearM: number;
    farM: number;
}

/** The union of shape ranges, grown so a slightly moved or redrawn shape still fits inside it. */
export function padBand(spans: ReadonlyArray<ShapeRange>, limitM: number, pad: number): RangeBand {
    const near = Math.min(...spans.map((s) => s.nearM)), far = Math.min(limitM, Math.max(...spans.map((s) => s.farM)));
    const grow = Math.max(0, far - near) * pad;
    return { nearM: Math.max(0, near - grow), farM: Math.min(limitM, far + grow) };
}

export const bandCovers = (outer: RangeBand, inner: RangeBand): boolean => outer.nearM <= inner.nearM && outer.farM >= inner.farM;

/** Slant range at which a beam of this elevation reaches `heightAboveSiteM`. */
function slantAtHeight(elevationDeg: number, heightAboveSiteM: number): number {
    const sinE = Math.sin((elevationDeg * Math.PI) / 180), r = EFFECTIVE_RADIUS_M;
    return -r * sinE + Math.sqrt(r * r * sinE * sinE + heightAboveSiteM * heightAboveSiteM + 2 * r * heightAboveSiteM);
}

/**
 * Keeps only the gates a band can use: slant ranges between the band's edges, and below `topKm`. A copy of the
 * wanted columns; the original (a whole cut, 1.3 MB or more) can then be dropped. Values are untouched.
 */
export function cropField(field: CutField, band: RangeBand, siteElevationMeters: number, topKm: number, marginM: number): CutField {
    const elevation = field.elevation;
    const near = slantRangeOf(Math.max(0, band.nearM - marginM), elevation) - marginM;
    let far = slantRangeOf(band.farM + marginM, elevation) + marginM;
    far = Math.min(far, slantAtHeight(elevation, Math.max(0, topKm * 1000 - siteElevationMeters)) + marginM);
    const lo = Math.max(0, Math.floor((near - field.firstGateMeters) / field.gateSpacingMeters));
    const hi = Math.min(field.gates, Math.ceil((far - field.firstGateMeters) / field.gateSpacingMeters) + 1);
    const gates = Math.max(0, hi - lo);
    if (lo === 0 && gates === field.gates) return field;
    const data = field.wordSize === 16 ? new Uint16Array(field.rows * gates) : new Uint8Array(field.rows * gates);
    if (gates > 0) {
        for (let row = 0; row < field.rows; row++) data.set(field.data.subarray(row * field.gates + lo, row * field.gates + lo + gates), row * gates);
    }
    return { ...field, gates, data, firstGateMeters: field.firstGateMeters + lo * field.gateSpacingMeters };
}
