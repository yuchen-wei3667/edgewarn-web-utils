import { AZIMUTH_MISSING } from './decoder/cutAssembler.ts';
import type { CutField } from './decoder/cutAssembler.ts';

export const EARTH_RADIUS_M = 6371008.8;
/** Effective Earth radius for beam refraction (4/3). */
export const EFFECTIVE_RADIUS_M = EARTH_RADIUS_M * (4 / 3);
/** Web Mercator sphere (what MapLibre draws on). */
export const MERCATOR_RADIUS_M = 6378137;
const RAD = Math.PI / 180;

export interface SiteLocation { lat: number; lon: number; elevationMeters?: number }

interface GateLocation {
    row: number;
    gate: number;
    /** Slant range to the gate centre. */
    slantMeters: number;
    groundMeters: number;
    bearing: number;
}

/**
 * Great-circle ground distance and initial bearing, float64. This overlaps `/geo` `distanceMeters` and
 * `calculateBearing` (same 6371008.8 m radius); decoders cannot import `/geo`, so the copy stays.
 */
export function groundRangeAndBearing(site: SiteLocation, lat: number, lon: number): { groundMeters: number; bearing: number } {
    const lat1 = site.lat * RAD;
    const lat2 = lat * RAD;
    const dLat = lat2 - lat1;
    const dLon = (lon - site.lon) * RAD;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const groundMeters = 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return { groundMeters, bearing: ((Math.atan2(y, x) / RAD) + 360) % 360 };
}

/** Ground distance to slant range (Py-ART antenna convention, effective Earth radius 4/3). */
export function slantRangeOf(groundMeters: number, elevationDeg: number): number {
    const phi = groundMeters / EFFECTIVE_RADIUS_M;
    return EFFECTIVE_RADIUS_M * Math.sin(phi) / Math.cos(elevationDeg * RAD + phi);
}

/** Slant range to height above the radar (existing 4/3 formula). */
export function beamHeightMeters(slantMeters: number, elevationDeg: number, siteElevationMeters = 0): number {
    const e = elevationDeg * RAD;
    return Math.sqrt(slantMeters * slantMeters + 2 * EFFECTIVE_RADIUS_M * slantMeters * Math.sin(e) + EFFECTIVE_RADIUS_M * EFFECTIVE_RADIUS_M)
        - EFFECTIVE_RADIUS_M + siteElevationMeters;
}

type GeometryField = Pick<CutField, 'gates' | 'firstGateMeters' | 'gateSpacingMeters' | 'elevation'> & { azimuthLut: Uint16Array };

/** Which (row, gate) of `field` covers a point, or null outside the data. Float64 reference of the shader. */
export function locateGate(field: GeometryField, site: SiteLocation, lat: number, lon: number): GateLocation | null {
    const { groundMeters, bearing } = groundRangeAndBearing(site, lat, lon);
    const slantMeters = slantRangeOf(groundMeters, field.elevation);
    // The file's first-gate range is the centre of gate 0.
    const gate = Math.floor((slantMeters - field.firstGateMeters) / field.gateSpacingMeters + 0.5);
    if (!(gate >= 0 && gate < field.gates)) return null;
    const row = field.azimuthLut[Math.floor(bearing * 10 + 0.5) % field.azimuthLut.length];
    if (row === AZIMUTH_MISSING) return null;
    return { row, gate, slantMeters, groundMeters, bearing };
}

/** Furthest gate edge, slant metres. */
export const maxRangeMeters = (field: Pick<CutField, 'gates' | 'firstGateMeters' | 'gateSpacingMeters'>) =>
    field.firstGateMeters + field.gates * field.gateSpacingMeters;

/** Mercator y (metres, Web Mercator sphere) of a latitude. */
export const mercatorY = (lat: number) => MERCATOR_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
/** Mercator unit coordinates (0..1) of a lon/lat, as MapLibre's projection matrix expects. */
export function mercatorUnit(lon: number, lat: number): [number, number] {
    return [(lon + 180) / 360, 0.5 - mercatorY(lat) / (2 * Math.PI * MERCATOR_RADIUS_M)];
}

interface RadarQuad {
    /** x, y in mercator units then local x, y in mercator metres east/north of the site: 4 floats per vertex, 4 vertices. */
    vertices: Float32Array;
    indices: Uint16Array;
}

/** A square around the site covering `rangeMeters`, with a margin for the mercator stretch and the great-circle edge. */
export function radarQuad(site: SiteLocation, rangeMeters: number): RadarQuad {
    const stretch = 1 / Math.cos(Math.min(85, Math.abs(site.lat) + (rangeMeters / EARTH_RADIUS_M) / RAD) * RAD);
    const half = rangeMeters * stretch * 1.05;
    const [cx, cy] = mercatorUnit(site.lon, site.lat);
    const unit = 2 * Math.PI * MERCATOR_RADIUS_M;
    const corners: Array<[number, number]> = [[-half, half], [half, half], [half, -half], [-half, -half]];
    const vertices = new Float32Array(16);
    corners.forEach(([lx, ly], i) => {
        vertices[i * 4] = cx + lx / unit;
        vertices[i * 4 + 1] = cy - ly / unit;
        vertices[i * 4 + 2] = lx;
        vertices[i * 4 + 3] = ly;
    });
    return { vertices, indices: new Uint16Array([0, 1, 2, 0, 2, 3]) };
}

/**
 * The fragment shader's arithmetic with each operation rounded to float32. Lets a test hold the GLSL formula to the
 * float64 reference without a GPU.
 */
export function shaderGeometryFloat32(
    site: SiteLocation, localX: number, localY: number, elevationDeg: number,
): { groundMeters: number; bearing: number; slantMeters: number } {
    const f = Math.fround;
    const lat1 = f(f(site.lat) * f(RAD));
    const lon1 = f(f(site.lon) * f(RAD));
    const yAbs = f(f(mercatorY(site.lat)) + f(localY));
    const lat2 = f(f(2 * Math.atan(f(Math.exp(f(yAbs / f(MERCATOR_RADIUS_M)))))) - f(Math.PI / 2));
    const dLon = f(f(localX) / f(MERCATOR_RADIUS_M));
    void lon1;
    const dLat = f(lat2 - lat1);
    const sLat = f(Math.sin(f(dLat / 2)));
    const sLon = f(Math.sin(f(dLon / 2)));
    const a = f(f(sLat * sLat) + f(f(f(Math.cos(lat1)) * f(Math.cos(lat2))) * f(sLon * sLon)));
    const groundMeters = f(f(2 * EARTH_RADIUS_M) * f(Math.asin(f(Math.min(1, f(Math.sqrt(a)))))));
    const y = f(f(Math.sin(dLon)) * f(Math.cos(lat2)));
    const x = f(f(f(Math.cos(lat1)) * f(Math.sin(lat2))) - f(f(f(Math.sin(lat1)) * f(Math.cos(lat2))) * f(Math.cos(dLon))));
    const bearing = f((f(f(Math.atan2(y, x)) / f(RAD)) + 360) % 360);
    const phi = f(groundMeters / f(EFFECTIVE_RADIUS_M));
    const slantMeters = f(f(f(EFFECTIVE_RADIUS_M) * f(Math.sin(phi))) / f(Math.cos(f(f(elevationDeg * RAD) + phi))));
    return { groundMeters, bearing, slantMeters };
}
