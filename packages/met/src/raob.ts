/**
 * Observed radiosondes. The Iowa State Mesonet (IEM) serves the RAOB archive as JSON with CORS open, so a
 * browser reads one station and launch time directly. This file lists the stations, picks the nearest, snaps a
 * launch time, and turns one reply into a `Column`. The only network calls are in `fetchRaobStations` and
 * `fetchRaobColumn`, through `fetchWithTimeout`. The site links (`raobSoundingHref`) stay with the website.
 */

import { distanceMeters } from '@edgewarn/web-utils/geo';
import { fetchWithTimeout } from '@edgewarn/web-utils/net';
import { componentsFromWind } from './wind.ts';
import type { Column } from './types.ts';

/** IEM station list of the RAOB network. */
export const RAOB_STATIONS_URL = 'https://mesonet.agron.iastate.edu/geojson/network/RAOB.geojson';
/** IEM profile service; `?ts=YYYYMMDDHH00&station=ID`. */
export const RAOB_PROFILE_URL = 'https://mesonet.agron.iastate.edu/json/raob.py';

const KNOT_MS = 0.514444;
const HOUR_MS = 3_600_000;
/** Launches happen at 00 and 12 UTC everywhere; 06 and 18 UTC only at a few sites, so those are offered but not assumed. */
const MAIN_HOURS_UTC = [0, 12] as const;
const EXTRA_HOURS_UTC = [6, 18] as const;
const DAY_MS = 24 * HOUR_MS;

export interface RaobStation {
    /** The id the IEM profile service takes, e.g. `KOKX` or `_ABR` (an area). */
    id: string;
    name: string;
    lat: number;
    lon: number;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The online stations of the IEM RAOB network. Features without a point or an id are skipped. */
export function parseRaobStations(geojson: unknown): RaobStation[] {
    const features = (geojson as { features?: unknown } | null)?.features;
    if (!Array.isArray(features)) return [];
    const stations: RaobStation[] = [];
    for (const feature of features as { id?: unknown; properties?: { sname?: unknown; online?: unknown }; geometry?: { coordinates?: unknown } }[]) {
        const coordinates = feature?.geometry?.coordinates;
        if (typeof feature?.id !== 'string' || !Array.isArray(coordinates) || feature.properties?.online === false) continue;
        const [lon, lat] = coordinates as unknown[];
        if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) continue;
        const name = typeof feature.properties?.sname === 'string' ? feature.properties.sname : feature.id;
        stations.push({ id: feature.id, name: name.replace(/\s+--.*$/, '').replace(/\s+/g, ' ').trim(), lat, lon });
    }
    return stations;
}

/** Great-circle distance in km (`/geo` `distanceMeters`, so on the 6371.0088 km mean sphere). */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
    return distanceMeters(aLat, aLon, bLat, bLon) / 1000;
}

/** The `count` stations nearest a point, nearest first, each with its distance. */
export function nearestRaobStations(stations: readonly RaobStation[], lat: number, lon: number, count: number): { station: RaobStation; km: number }[] {
    return stations
        .map((station) => ({ station, km: distanceKm(lat, lon, station.lat, station.lon) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, count);
}

/**
 * Launch times (ms) around a valid time, nearest first. The first is the 00 or 12 UTC launch nearest the valid time (the
 * default); the 06 and 18 UTC ones follow, since only some stations fly them.
 */
export function raobLaunchChoices(validMs: number): { ms: number; main: boolean }[] {
    const day = Math.floor(validMs / DAY_MS) * DAY_MS;
    const all: { ms: number; main: boolean }[] = [];
    for (const offset of [-DAY_MS, 0, DAY_MS]) {
        for (const hour of MAIN_HOURS_UTC) all.push({ ms: day + offset + hour * HOUR_MS, main: true });
        for (const hour of EXTRA_HOURS_UTC) all.push({ ms: day + offset + hour * HOUR_MS, main: false });
    }
    const near = (item: { ms: number }) => Math.abs(item.ms - validMs);
    const byDistance = all.sort((a, b) => near(a) - near(b));
    const firstMain = byDistance.find((item) => item.main);
    const rest = byDistance.filter((item) => item !== firstMain).slice(0, 3);
    return firstMain ? [firstMain, ...rest] : rest;
}

/** `YYYYMMDDHH00` in UTC, the form the IEM `ts` parameter takes. */
export function raobTimestamp(ms: number): string {
    return new Date(ms).toISOString().slice(0, 13).replace(/\D/g, '') + '00';
}

export const raobProfileUrl = (stationId: string, ms: number, baseUrl: string = RAOB_PROFILE_URL): string =>
    `${baseUrl}?ts=${raobTimestamp(ms)}&station=${encodeURIComponent(stationId)}`;

interface RaobRow { pres?: unknown; hght?: unknown; tmpc?: unknown; dwpc?: unknown; drct?: unknown; sknt?: unknown }

/**
 * One IEM reply as a `Column`, or null when the station sent nothing usable. A row needs a pressure, a height and a
 * temperature (the underground mandatory levels arrive without one); a missing dewpoint becomes NaN and a missing wind
 * NaN components. Rows are put in falling pressure with repeated pressures dropped, and a dewpoint above the temperature
 * is lowered to it.
 */
export function parseRaobColumn(json: unknown, validMs: number): Column | null {
    const profile = (json as { profiles?: { profile?: unknown }[] } | null)?.profiles?.[0]?.profile;
    if (!Array.isArray(profile)) return null;
    const rows = (profile as RaobRow[])
        .filter((row) => isFiniteNumber(row.pres) && isFiniteNumber(row.hght) && isFiniteNumber(row.tmpc) && row.pres > 0)
        .sort((a, b) => (b.pres as number) - (a.pres as number));
    const kept = rows.filter((row, k) => k === 0 || row.pres !== rows[k - 1].pres);
    if (kept.length < 2) return null;
    const p = new Float32Array(kept.length);
    const z = new Float32Array(kept.length);
    const t = new Float32Array(kept.length);
    const td = new Float32Array(kept.length);
    const u = new Float32Array(kept.length);
    const v = new Float32Array(kept.length);
    kept.forEach((row, k) => {
        p[k] = row.pres as number;
        z[k] = row.hght as number;
        t[k] = row.tmpc as number;
        td[k] = isFiniteNumber(row.dwpc) ? Math.min(row.dwpc, t[k]) : NaN;
        if (isFiniteNumber(row.drct) && isFiniteNumber(row.sknt)) {
            const wind = componentsFromWind(row.drct, row.sknt * KNOT_MS);
            u[k] = wind.u;
            v[k] = wind.v;
        } else {
            u[k] = NaN;
            v[k] = NaN;
        }
    });
    return { validMs, p, z, t, td, u, v, surface: { p: p[0], z: z[0], t: t[0], td: td[0], u: u[0], v: v[0] } };
}

/** The levels of a column that carry a wind, as a column of its own, for the hodograph (which cannot draw a gap). Null with fewer than two. */
export function windOnlyColumn(col: Column): Column | null {
    const keep = Array.from(col.p, (_, k) => k).filter((k) => Number.isFinite(col.u[k]) && Number.isFinite(col.v[k]));
    if (keep.length < 2) return null;
    const pick = (field: Float32Array) => Float32Array.from(keep, (k) => field[k]);
    const first = keep[0];
    return {
        ...col, p: pick(col.p), z: pick(col.z), t: pick(col.t), td: pick(col.td), u: pick(col.u), v: pick(col.v),
        surface: { p: col.p[first], z: col.z[first], t: col.t[first], td: col.td[first], u: col.u[first], v: col.v[first] },
    };
}

/** What the page says when a launch is not there. */
export class RaobError extends Error {
    readonly kind: 'network' | 'empty';
    constructor(kind: 'network' | 'empty', message: string) {
        super(message);
        this.kind = kind;
    }
}

export async function fetchRaobStations(signal?: AbortSignal, url: string = RAOB_STATIONS_URL): Promise<RaobStation[]> {
    const response = await fetchWithTimeout(url, { signal });
    if (!response.ok) throw new RaobError('network', `The station list could not be read (${response.status}).`);
    const stations = parseRaobStations(await response.json());
    if (stations.length === 0) throw new RaobError('network', 'The station list came back empty.');
    return stations;
}

/** One station's launch at `ms`. Throws a `RaobError`: `empty` when the station has no sounding then, `network` otherwise. */
export async function fetchRaobColumn(
    stationId: string, ms: number, signal?: AbortSignal, baseUrl: string = RAOB_PROFILE_URL,
): Promise<Column> {
    const response = await fetchWithTimeout(raobProfileUrl(stationId, ms, baseUrl), { signal });
    if (!response.ok) throw new RaobError('network', `The observed sounding could not be read (${response.status}).`);
    const column = parseRaobColumn(await response.json(), ms);
    if (!column) throw new RaobError('empty', 'No sounding was launched there at that time, or it has not been posted yet.');
    return column;
}

/** US sites: the lower 48 and Puerto Rico (`K…`, `TJSJ`), Alaska (`PA…`), Hawaii (`PH…`) and Pacific islands (`PG…`). Area ids (`_ABR`) and foreign sites are left out. */
const US_STATION_ID = /^(K[A-Z]{3}|P[AGH][A-Z]{2}|TJSJ)$/;

export const isUsRaobStation = (station: Pick<RaobStation, 'id'>): boolean => US_STATION_ID.test(station.id);

/** A station's name split into the place and, when the IEM gives one, the state (`Norman OK/US` is `Norman` in `OK`). */
export function raobPlace(station: Pick<RaobStation, 'name'>): { place: string; region: string | null } {
    const match = /^(.*?)\s+([A-Z]{2})\/US$/.exec(station.name);
    const place = (match ? match[1] : station.name).toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
    return { place, region: match ? match[2] : null };
}

/** Soundings post about this long after the launch (the profile service answers empty before). */
const POST_DELAY_MS = 90 * 60_000;

/** 00 and 12 UTC launches over the last `days` days, newest first, leaving out any that are not posted yet. */
export function recentRaobLaunches(nowMs: number, days = 7): { ms: number; posted: boolean }[] {
    const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
    const launches: { ms: number; posted: boolean }[] = [];
    for (let back = 0; back < days; back++) {
        for (const hour of [12, 0]) {
            const ms = today - back * DAY_MS + hour * HOUR_MS;
            if (ms <= nowMs) launches.push({ ms, posted: ms + POST_DELAY_MS <= nowMs });
        }
    }
    return launches;
}
