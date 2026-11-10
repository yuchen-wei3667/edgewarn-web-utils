import { calculateBearing, calculateDestination, distanceMeters } from '@edgewarn/web-utils/geo';
import { MRMS_VOLUME_LIMITS } from './limits.ts';

export interface LatLng { lat: number; lng: number }

/** The CONUS MRMS 3D grid: row 0 is the northernmost row, pixel centres at the stated lat/lon. */
export interface VolumeGrid { ni: number; nj: number; lat1: number; lon1: number; di: number; dj: number }

export const CONUS_VOLUME_GRID: VolumeGrid = { ni: 7000, nj: 3500, lat1: 54.995, lon1: -129.995, di: 0.01, dj: 0.01 };

/** Inclusive row and column range of a grid. */
export interface GridRect { r0: number; r1: number; c0: number; c1: number }

export interface LatLngBounds { west: number; south: number; east: number; north: number }

export interface VolumeLine { a: LatLng; b: LatLng; lengthM: number; clamped: boolean }
export interface VolumeBox extends LatLngBounds { widthM: number; heightM: number; clamped: boolean }

/** Metres per degree of latitude on the sphere used by `distanceMeters`. */
export const METERS_PER_DEGREE_LAT = distanceMeters(0, 0, 1, 0);
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Adapter for `/geo` `distanceMeters` on `{lat, lng}` points. Internal: not part of the public surface. */
export function distanceBetween(a: LatLng, b: LatLng): number {
    return distanceMeters(a.lat, a.lng, b.lat, b.lng);
}

/**
 * Adapter for `/geo` `calculateDestination`: point `distanceM` metres from `from` along `bearing`
 * degrees, longitude wrapped to [-180, 180). Internal: not part of the public surface.
 */
export function pointAlong(from: LatLng, distanceM: number, bearing: number): LatLng {
    const [lat, lng] = calculateDestination(from.lat, from.lng, distanceM, bearing);
    return { lat, lng: ((lng + 540) % 360) - 180 };
}

/** Line from `a` to `b`; B moves back along the same bearing when the line is longer than the limit. */
export function clampLine(a: LatLng, b: LatLng, maxM: number = MRMS_VOLUME_LIMITS.maxLineMeters): VolumeLine {
    const length = distanceBetween(a, b);
    if (length <= maxM) return { a, b, lengthM: length, clamped: false };
    return { a, b: pointAlong(a, maxM, calculateBearing(a.lat, a.lng, b.lat, b.lng)), lengthM: maxM, clamped: true };
}

/**
 * Box from a fixed corner to the pointer. Each side stops at the limit: north-south by degrees of
 * latitude, east-west measured at the box's centre latitude.
 */
export function clampBox(anchor: LatLng, corner: LatLng, maxM: number = MRMS_VOLUME_LIMITS.maxBoxMeters): VolumeBox {
    const maxLat = maxM / METERS_PER_DEGREE_LAT;
    const dLat = corner.lat - anchor.lat;
    const sLat = Math.sign(dLat) || 1;
    const clampedLat = Math.abs(dLat) > maxLat;
    const lat = anchor.lat + sLat * Math.min(Math.abs(dLat), maxLat);
    const midLat = (anchor.lat + lat) / 2;
    const maxLng = maxM / (METERS_PER_DEGREE_LAT * Math.cos(rad(midLat)));
    const dLng = corner.lng - anchor.lng;
    const sLng = Math.sign(dLng) || 1;
    const clampedLng = Math.abs(dLng) > maxLng;
    const lng = anchor.lng + sLng * Math.min(Math.abs(dLng), maxLng);
    const box = {
        west: Math.min(anchor.lng, lng), east: Math.max(anchor.lng, lng),
        south: Math.min(anchor.lat, lat), north: Math.max(anchor.lat, lat),
    };
    return { ...box, ...boxSize(box), clamped: clampedLat || clampedLng };
}

export function boxSize(b: LatLngBounds): { widthM: number; heightM: number } {
    const midLat = (b.north + b.south) / 2;
    return {
        widthM: distanceBetween({ lat: midLat, lng: b.west }, { lat: midLat, lng: b.east }),
        heightM: distanceBetween({ lat: b.south, lng: b.west }, { lat: b.north, lng: b.west }),
    };
}

export const lineBounds = (line: { a: LatLng; b: LatLng }): LatLngBounds => ({
    west: Math.min(line.a.lng, line.b.lng), east: Math.max(line.a.lng, line.b.lng),
    south: Math.min(line.a.lat, line.b.lat), north: Math.max(line.a.lat, line.b.lat),
});

const clip = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export const gridRow = (lat: number, g: VolumeGrid = CONUS_VOLUME_GRID): number => (g.lat1 - lat) / g.dj;
export const gridCol = (lng: number, g: VolumeGrid = CONUS_VOLUME_GRID): number => (lng - g.lon1) / g.di;

/** Rows and columns covering the bounds plus a halo, clipped to the grid. Null when fully outside. */
export function neededRect(b: LatLngBounds, g: VolumeGrid = CONUS_VOLUME_GRID, halo = MRMS_VOLUME_LIMITS.haloCells): GridRect | null {
    const r0 = Math.floor(gridRow(b.north, g)) - halo;
    const r1 = Math.ceil(gridRow(b.south, g)) + halo;
    const c0 = Math.floor(gridCol(b.west, g)) - halo;
    const c1 = Math.ceil(gridCol(b.east, g)) + halo;
    if (r1 < 0 || r0 > g.nj - 1 || c1 < 0 || c0 > g.ni - 1) return null;
    return { r0: clip(r0, 0, g.nj - 1), r1: clip(r1, 0, g.nj - 1), c0: clip(c0, 0, g.ni - 1), c1: clip(c1, 0, g.ni - 1) };
}

/** The needed rect grown by a fraction of its own size on every side. */
export function paddedRect(needed: GridRect, g: VolumeGrid = CONUS_VOLUME_GRID, fraction = MRMS_VOLUME_LIMITS.padFraction): GridRect {
    const padR = Math.ceil((needed.r1 - needed.r0 + 1) * fraction);
    const padC = Math.ceil((needed.c1 - needed.c0 + 1) * fraction);
    return {
        r0: clip(needed.r0 - padR, 0, g.nj - 1), r1: clip(needed.r1 + padR, 0, g.nj - 1),
        c0: clip(needed.c0 - padC, 0, g.ni - 1), c1: clip(needed.c1 + padC, 0, g.ni - 1),
    };
}

export const contains = (region: GridRect, needed: GridRect): boolean =>
    region.r0 <= needed.r0 && region.r1 >= needed.r1 && region.c0 <= needed.c0 && region.c1 >= needed.c1;

export const rectRows = (r: GridRect): number => r.r1 - r.r0 + 1;
export const rectCols = (r: GridRect): number => r.c1 - r.c0 + 1;
export const sameRect = (a: GridRect, b: GridRect): boolean => a.r0 === b.r0 && a.r1 === b.r1 && a.c0 === b.c0 && a.c1 === b.c1;

export const milesOf = (meters: number): number => meters / 1609.344;
