import type { MetarEntry } from './types.ts';

/** One report from aviationweather.gov's `/api/data/metar?format=json`. */
export interface AwcMetarRow {
    icaoId?: string;
    obsTime?: number;
    reportTime?: string;
    temp?: number | null;
    dewp?: number | null;
    wdir?: number | string | null;
    wspd?: number | null;
    wgst?: number | null;
    lat?: number;
    lon?: number;
}

const HOUR_MS = 3_600_000;
const CONUS_BOUNDS = { south: 24, north: 50, west: -125, east: -66 };

/** Hourly stamps (`YYYYMMDD-HHMMSS`, UTC) for the last `count` whole hours, oldest first. */
export function metarHourTimestamps(nowMs: number, count: number): string[] {
    const top = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
    return Array.from({ length: count }, (_, i) => {
        const iso = new Date(top - (count - 1 - i) * HOUR_MS).toISOString();
        return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}0000`;
    });
}

/** ISO instant of an hourly `YYYYMMDD-HHMMSS` stamp. */
export function metarStampToIso(stamp: string): string | null {
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})0000$/.exec(stamp);
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:00:00Z` : null;
}

/** US station ids inside CONUS from AWC's `metars.cache.csv` (header row first). */
export function conusStationIds(csv: string): string[] {
    const ids = new Set<string>();
    for (const line of csv.split('\n').slice(1)) {
        const m = /",(K[A-Z0-9]{3}),[^,]*,(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/.exec(line);
        if (!m) continue;
        const lat = Number(m[2]);
        const lon = Number(m[3]);
        if (lat >= CONUS_BOUNDS.south && lat <= CONUS_BOUNDS.north && lon >= CONUS_BOUNDS.west && lon <= CONUS_BOUNDS.east) ids.add(m[1]);
    }
    return [...ids];
}

function numberText(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** Newest report per station at or before `untilMs`, as the map's `MetarEntry` shape. */
export function latestMetarEntries(rows: AwcMetarRow[], untilMs: number): MetarEntry[] {
    const newest = new Map<string, AwcMetarRow>();
    for (const row of rows) {
        if (!row.icaoId || typeof row.obsTime !== 'number' || typeof row.lat !== 'number' || typeof row.lon !== 'number') continue;
        const at = row.obsTime * 1000;
        if (at > untilMs) continue;
        const seen = newest.get(row.icaoId);
        if (!seen || (seen.obsTime ?? 0) < row.obsTime) newest.set(row.icaoId, row);
    }
    return [...newest.values()].map((row) => ({
        observation_time: new Date((row.obsTime as number) * 1000).toISOString(),
        station: row.icaoId as string,
        coordinates: [row.lat as number, row.lon as number],
        wind: {
            direction: row.wdir === null || row.wdir === undefined ? 'VRB' : String(row.wdir),
            speed: numberText(row.wspd) || '0',
            gust: typeof row.wgst === 'number' ? String(row.wgst) : null,
        },
        temperature: numberText(row.temp),
        dewpoint: numberText(row.dewp),
    }));
}
