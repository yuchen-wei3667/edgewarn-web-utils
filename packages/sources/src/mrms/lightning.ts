import { CONUS_VOLUME_GRID, distanceBetween, pointAlong } from './volume/geometry.ts';

/** The grid fields lightning sampling reads from a decoded window. */
export interface LightningGrid { lat1: number; lon1: number; di: number; dj: number; refTime: string }
/** A decoded rectangle of one lightning product, as a decode worker returns it. */
export interface LightningWindow {
    grid: LightningGrid;
    rows: [number, number];
    cols: [number, number];
    /** Float32 physical values (NaN = no data), row-major over the rectangle. */
    data: ArrayBuffer;
}

export const LIGHTNING_PRODUCTS = [
    { id: 'LightningProbabilityNext60minGrid_scale_1', stage: 'probability60', maxAgeMs: 6 * 60_000 },
    { id: 'LightningProbabilityNext30minGrid_scale_1', stage: 'probability30', maxAgeMs: 6 * 60_000 },
    { id: 'NLDN_CG_015min_AvgDensity_00.00', stage: 'activity15', maxAgeMs: 5 * 60_000 },
    { id: 'NLDN_CG_005min_AvgDensity_00.00', stage: 'activity5', maxAgeMs: 5 * 60_000 },
] as const;

export type LightningStage = typeof LIGHTNING_PRODUCTS[number]['stage'];
export interface LightningLocation { lat: number; lon: number }
export interface LightningReading {
    stage: LightningStage;
    issuedAtMs: number;
    /** Containing grid cell only; never a neighbourhood maximum. */
    probability: number | null;
    /** Distance to the centre of the nearest active grid cell, not an individual strike. */
    distanceMiles: number | null;
}
export interface LightningCandidate {
    stage: LightningStage;
    threatLevel: 6 | 8;
    distanceMiles: number | null;
    title: string;
    detail: string;
    confidence: string;
}

export const LIGHTNING_SOURCES = 'NOAA MRMS · NLDN';
const MILE_M = 1609.344;
const SEARCH_MILES = 25;
// NLDN additionally uses -1 for missing. Never apply rendering hideBelow/interpolation to analysis.
export const LIGHTNING_SENTINELS = [-1, -3, -99, -999, -9999, -99900, -99903];
const STAGE_ORDER: Record<LightningStage, number> = { probability60: 0, probability30: 1, activity15: 2, activity5: 3 };

/** These four products use the map's CONUS 0.01-degree grid, checked by WindowSink on decode. */
export function lightningWindow(location: LightningLocation): { rows: [number, number]; cols: [number, number] } | null {
    const g = CONUS_VOLUME_GRID;
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return null;
    const row = Math.round((g.lat1 - location.lat) / g.dj);
    const col = Math.round((location.lon - g.lon1) / g.di);
    if (row < 0 || row >= g.nj || col < 0 || col >= g.ni) return null;
    const origin = { lat: location.lat, lng: location.lon };
    // Pad for grid cells whose centre falls just beyond the bounding circle.
    const radius = SEARCH_MILES * MILE_M + 2000;
    const north = pointAlong(origin, radius, 0).lat;
    const south = pointAlong(origin, radius, 180).lat;
    const west = pointAlong(origin, radius, 270).lng;
    const east = pointAlong(origin, radius, 90).lng;
    return {
        rows: [Math.max(0, Math.floor((g.lat1 - north) / g.dj)), Math.min(g.nj - 1, Math.ceil((g.lat1 - south) / g.dj))],
        cols: [Math.max(0, Math.floor((west - g.lon1) / g.di)), Math.min(g.ni - 1, Math.ceil((east - g.lon1) / g.di))],
    };
}

function normalizedLongitude(g: LightningGrid): number { return g.lon1 > 180 ? g.lon1 - 360 : g.lon1; }

export function sampleLightning(stage: LightningStage, location: LightningLocation, message: LightningWindow): LightningReading {
    const { grid, rows, cols } = message;
    const values = new Float32Array(message.data);
    const width = cols[1] - cols[0] + 1;
    if (values.length !== width * (rows[1] - rows[0] + 1)) throw new Error('Incomplete lightning window');
    const issuedAtMs = Date.parse(grid.refTime);
    if (!Number.isFinite(issuedAtMs)) throw new Error('Missing lightning reference time');
    let probability: number | null = null;
    let distanceMiles: number | null = null;
    const lon1 = normalizedLongitude(grid);
    if (stage === 'probability30' || stage === 'probability60') {
        const row = Math.round((grid.lat1 - location.lat) / grid.dj);
        const col = Math.round((location.lon - lon1) / grid.di);
        if (row >= rows[0] && row <= rows[1] && col >= cols[0] && col <= cols[1]) {
            const value = values[(row - rows[0]) * width + col - cols[0]];
            // Zero can also encode unavailable coverage. Do not turn it into an all-clear.
            if (Number.isFinite(value) && value > 0 && value <= 100) probability = value;
        }
    } else {
        for (let row = rows[0]; row <= rows[1]; row++) {
            for (let col = cols[0]; col <= cols[1]; col++) {
                const value = values[(row - rows[0]) * width + col - cols[0]];
                if (!Number.isFinite(value) || value <= 0) continue;
                const distance = distanceBetween(
                    { lat: location.lat, lng: location.lon },
                    { lat: grid.lat1 - row * grid.dj, lng: lon1 + col * grid.di },
                ) / MILE_M;
                if (distance <= SEARCH_MILES && (distanceMiles == null || distance < distanceMiles)) distanceMiles = distance;
            }
        }
    }
    return { stage, issuedAtMs, probability, distanceMiles };
}

export function lightningIsFresh(reading: LightningReading, nowMs: number): boolean {
    const product = LIGHTNING_PRODUCTS.find(product => product.stage === reading.stage)!;
    const ageMs = nowMs - reading.issuedAtMs;
    return Number.isFinite(ageMs) && ageMs >= -60_000 && ageMs <= product.maxAgeMs;
}

/** Severity first; on equal severity prefer the later stage, then nearer activity/higher probability. */
export function selectLightningCandidate(readings: readonly LightningReading[], nowMs: number): LightningCandidate | null {
    const candidates: { reading: LightningReading; candidate: LightningCandidate }[] = [];
    for (const reading of readings) {
        if (!lightningIsFresh(reading, nowMs)) continue;
        const { stage, probability, distanceMiles } = reading;
        if (stage === 'probability60' || stage === 'probability30') {
            if (probability == null || !Number.isFinite(probability) || probability < 20 || probability > 100) continue;
            const minutes = stage === 'probability60' ? 60 : 30;
            const remaining = Math.max(1, Math.ceil((reading.issuedAtMs + minutes * 60_000 - nowMs) / 60_000));
            candidates.push({ reading, candidate: {
                stage,
                threatLevel: stage === 'probability60' && probability < 50 ? 8 : 6,
                distanceMiles: null,
                title: probability >= 50 ? 'Elevated lightning potential' : 'Lightning possible',
                detail: `${Math.round(probability)}% chance of lightning within ${remaining} minutes.`,
                confidence: 'Lightning forecast',
            } });
        } else {
            if (distanceMiles == null || !Number.isFinite(distanceMiles) || distanceMiles < 0 || distanceMiles > SEARCH_MILES) continue;
            const minutes = stage === 'activity15' ? 15 : 5;
            candidates.push({ reading, candidate: {
                stage,
                threatLevel: stage === 'activity15' && distanceMiles > 10 ? 8 : 6,
                distanceMiles,
                title: `Lightning detected within ${Math.max(1, Math.ceil(distanceMiles))} ${distanceMiles <= 1 ? 'mile' : 'miles'}`,
                detail: '',
                confidence: `Observed lightning · past ${minutes} min`,
            } });
        }
    }
    candidates.sort((a, b) => a.candidate.threatLevel - b.candidate.threatLevel
        || STAGE_ORDER[b.reading.stage] - STAGE_ORDER[a.reading.stage]
        || (a.reading.distanceMiles ?? Infinity) - (b.reading.distanceMiles ?? Infinity)
        || (b.reading.probability ?? 0) - (a.reading.probability ?? 0)
        || b.reading.issuedAtMs - a.reading.issuedAtMs);
    return candidates[0]?.candidate ?? null;
}
