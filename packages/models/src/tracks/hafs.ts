import { HAFS_BUCKET } from '../configs/shared.ts';
import type { HafsModel, StormRef, StormTrack, TrackPoint } from './types.ts';

/** Per cycle, one `stats.short` text file per storm in NOAA's HAFS bucket holds its track and intensity every 3 hours. */
const HAFS_MODELS: readonly HafsModel[] = ['hfsa', 'hfsb'];

const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60_000;
/** A missing value in the stats file. */
const FILL = -999;

const LINE =
    /^HOUR:\s*(-?\d+(?:\.\d+)?)\s+LONG:\s*(-?\d+(?:\.\d+)?)\s+LAT:\s*(-?\d+(?:\.\d+)?)\s+MIN PRESS \(hPa\):\s*(-?\d+(?:\.\d+)?)\s+MAX SURF WIND \(KNOTS\):\s*(-?\d+(?:\.\d+)?)\s*$/;

const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;
const valid = (v: number): number | null => (Number.isFinite(v) && v > FILL ? v : null);

/** Parse `stats.short` text. A line that is not a track point is skipped and counted, never fatal. */
export function parseHafsStats(text: string, initMs: number): { points: TrackPoint[]; skipped: number } {
    const points: TrackPoint[] = [];
    let skipped = 0;
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const m = LINE.exec(line);
        if (!m) {
            skipped++;
            continue;
        }
        const [hour, lon, lat, press, wind] = m.slice(1).map(Number);
        if (!Number.isFinite(hour) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) {
            skipped++;
            continue;
        }
        const leadMinutes = Math.round(hour * MINUTES_PER_HOUR);
        points.push({
            leadMinutes,
            validMs: initMs + leadMinutes * MS_PER_MINUTE,
            lat,
            lon: wrapLon(lon),
            minPressureHpa: valid(press),
            maxWindKt: valid(wind),
        });
    }
    points.sort((a, b) => a.leadMinutes - b.leadMinutes);
    return { points, skipped };
}

/** `hfsa/20261026/12/22e.2026102612.hfsa.grib.stats.short` -> the storm, or null for any other key. */
export function stormFromKey(key: string): StormRef | null {
    const m = /(?:^|\/)(\d{2})([a-z])\.(\d{4})(\d{2})(\d{2})(\d{2})\.(hfsa|hfsb)\.grib\.stats\.short$/.exec(
        key,
    );
    if (!m) return null;
    const initMs = Date.UTC(+m[3], +m[4] - 1, +m[5], +m[6]);
    return { number: m[1], basin: m[2], id: `${m[1]}${m[2]}`, model: m[7] as HafsModel, initMs };
}

export const statsUrl = (s: StormRef): string => {
    const d = new Date(s.initMs);
    const p = (n: number) => String(n).padStart(2, '0');
    const day = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
    return `${HAFS_BUCKET}/${s.model}/${day}/${p(d.getUTCHours())}/${s.id}.${day}${p(d.getUTCHours())}.${s.model}.grib.stats.short`;
};

/** Storms named in one cycle's bucket listing (S3 ListObjectsV2 XML). */
export function parseStormListing(xml: string): StormRef[] {
    const out: StormRef[] = [];
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
        const storm = stormFromKey(m[1]);
        if (storm) out.push(storm);
    }
    return out;
}

/** The cycles to look at, newest first: the last `count` 6-hourly cycles at or before `nowMs`. */
export function recentCycles(nowMs: number, count: number): number[] {
    const cycle = 6 * 3_600_000;
    const newest = Math.floor(nowMs / cycle) * cycle;
    return Array.from({ length: count }, (_, i) => newest - i * cycle);
}

/** The listing URL of one model's cycle; storm files sort before `parent.*`, so the first page names every storm. */
export function listingUrl(model: HafsModel, cycleMs: number): string {
    const d = new Date(cycleMs);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${HAFS_BUCKET}/?list-type=2&prefix=${model}/${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}/${p(d.getUTCHours())}/&max-keys=1000`;
}

/**
 * Active storms: for each model, the newest of the last `cycles` cycles that names a storm, keeping the latest run of
 * each storm id. A failed listing counts as empty; it is reported in `failed` so the caller can say the list may be partial.
 */
export async function listHafsStorms(
    fetchFn: typeof fetch,
    nowMs: number,
    cycles = 4,
): Promise<{ storms: StormRef[]; failed: number }> {
    const jobs = HAFS_MODELS.flatMap((model) => recentCycles(nowMs, cycles).map((c) => listingUrl(model, c)));
    let failed = 0;
    const pages = await Promise.all(
        jobs.map(async (url) => {
            try {
                const res = await fetchFn(url);
                if (!res.ok) {
                    failed++;
                    return [];
                }
                return parseStormListing(await res.text());
            } catch {
                failed++;
                return [];
            }
        }),
    );
    const latest = new Map<string, StormRef>();
    for (const s of pages.flat()) {
        const key = `${s.model}:${s.id}`;
        const have = latest.get(key);
        if (!have || s.initMs > have.initMs) latest.set(key, s);
    }
    return {
        storms: [...latest.values()].sort((a, b) => b.initMs - a.initMs || a.id.localeCompare(b.id)),
        failed,
    };
}

export async function fetchStormTrack(fetchFn: typeof fetch, storm: StormRef): Promise<StormTrack> {
    const url = statsUrl(storm);
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const { points, skipped } = parseHafsStats(await res.text(), storm.initMs);
    return { storm, points, skipped, source: { url } };
}

/** Saffir-Simpson category from 1-minute sustained wind in knots: `td`, `ts`, `1`..`5`. */
export function intensityCategory(windKt: number | null): 'td' | 'ts' | '1' | '2' | '3' | '4' | '5' | null {
    if (windKt === null) return null;
    if (windKt < 34) return 'td';
    if (windKt < 64) return 'ts';
    if (windKt < 83) return '1';
    if (windKt < 96) return '2';
    if (windKt < 113) return '3';
    if (windKt < 137) return '4';
    return '5';
}

/** The position at a valid time, interpolated linearly between the two points that bracket it; null outside the track. */
export function positionAt(
    points: readonly TrackPoint[],
    validMs: number,
): { lat: number; lon: number } | null {
    if (!points.length || validMs < points[0].validMs || validMs > points[points.length - 1].validMs)
        return null;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        if (validMs > b.validMs) continue;
        const t = b.validMs === a.validMs ? 0 : (validMs - a.validMs) / (b.validMs - a.validMs);
        // Along the short way around the antimeridian.
        let dLon = b.lon - a.lon;
        if (dLon > 180) dLon -= 360;
        else if (dLon < -180) dLon += 360;
        return { lat: a.lat + (b.lat - a.lat) * t, lon: wrapLon(a.lon + dLon * t) };
    }
    return { lat: points[0].lat, lon: points[0].lon };
}
