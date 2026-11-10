import { nearestFrameWindow } from '@edgewarn/web-utils/time';
import { listS3Pages, parseS3Listing } from '@edgewarn/web-utils/net';
import { channelOf, mcmipShift, topLevel } from '@edgewarn/web-utils/goes';
import type { GoesBand, GoesSector } from '@edgewarn/web-utils/goes';
import { GOES_BUCKET_URL, GOES_SATELLITE, GOES_SCAN_MODE, GOES_TIMELINE_FRAMES } from './config.ts';

export interface GoesListingOptions {
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    /** Bucket URL; defaults to {@link GOES_BUCKET_URL}. */
    baseUrl?: string;
    /** Satellite tag in file names; defaults to {@link GOES_SATELLITE}. */
    satellite?: string;
    /** Scan mode digit in file names; defaults to {@link GOES_SCAN_MODE}. */
    scanMode?: string;
    /**
     * Called when an empty listing led to reading a different live scan mode from the bucket. The
     * retry already uses it; pass it back as `scanMode` on later calls to skip the detection.
     */
    onScanModeChange?: (mode: string) => void;
    /** Frames kept per timeline window; defaults to {@link GOES_TIMELINE_FRAMES} for the sector. */
    frames?: number;
}

export interface GoesObject { key: string; size: number }

/** One scan of one band in one sector: the band's own file, plus MCMIP when zoom-out needs it. */
export interface GoesFrame {
    timestamp: string;
    band: GoesObject;
    mcmip: GoesObject | null;
}

interface ParsedGoesKey {
    product: string;
    /** `CMIPC`, `CMIPM1`, `MCMIPC`, ... */
    stem: string;
    mode: string;
    /** Channel as in the file name (`C13`), or null for all-band (MCMIP) files. */
    channel: string | null;
    satellite: string;
    /** Scan start as `YYYYMMDD-HHMMSS`. */
    timestamp: string;
}

const KEY_RE = /^(ABI-L2-[A-Z0-9]+)\/(\d{4})\/(\d{3})\/(\d{2})\/OR_ABI-L2-([A-Z0-9]+)-M(\d)(?:C(\d{2}))?_G(\d{2})_s(\d{13})\d_e\d{14}_c\d{14}\.nc$/;

/** One ListObjectsV2 page of GOES objects. */
export function parseGoesListing(xml: string): { objects: GoesObject[]; nextToken: string | null } {
    const { objects, nextToken } = parseS3Listing(xml);
    return { objects, nextToken };
}

/** `sYYYYDDDHHMMSS` (day of year) to `YYYYMMDD-HHMMSS`, or null when out of range. */
export function scanTimestamp(start: string): string | null {
    const year = +start.slice(0, 4), doy = +start.slice(4, 7), hh = +start.slice(7, 9), mm = +start.slice(9, 11), ss = +start.slice(11, 13);
    const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
    if (doy < 1 || doy > daysInYear || hh > 23 || mm > 59 || ss > 60) return null;
    const d = new Date(Date.UTC(year, 0, doy, hh, mm, Math.min(ss, 59)));
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/** Parse a key of the exact ABI L2 form; anything else is null and skipped. */
export function parseGoesKey(key: string): ParsedGoesKey | null {
    const m = KEY_RE.exec(key);
    if (!m) return null;
    const [, product, year, doy, hour, stem, mode, channel, sat, start] = m;
    if (start.slice(0, 4) !== year || start.slice(4, 7) !== doy || start.slice(7, 9) !== hour) return null;
    const timestamp = scanTimestamp(start);
    if (!timestamp) return null;
    return { product, stem, mode, channel: channel ? `C${channel}` : null, satellite: `G${sat}`, timestamp };
}

export function timestampToDate(ts: string): Date {
    return new Date(Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(9, 11), +ts.slice(11, 13), +ts.slice(13, 15)));
}

/** `<product>/YYYY/DDD/HH/` for the UTC hour containing `date`. */
export function hourPrefix(product: string, date: Date): string {
    const doy = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
    return `${product}/${date.getUTCFullYear()}/${String(doy).padStart(3, '0')}/${String(date.getUTCHours()).padStart(2, '0')}/`;
}

/** File-name stem for a band file (`OR_ABI-L2-CMIPC-M6C13_G19_`) or an all-band file (`…MCMIPC-M6_G19_`). */
export function fileStem(stem: string, channel: string | null, mode = GOES_SCAN_MODE, satellite = GOES_SATELLITE): string {
    return `OR_ABI-L2-${stem}-M${mode}${channel ?? ''}_${satellite}_`;
}

export const goesUrl = (key: string, baseUrl = GOES_BUCKET_URL): string => `${baseUrl}/${key}`;

async function listPrefix(prefix: string, opts: GoesListingOptions, extra: Record<string, string> = {}): Promise<GoesObject[]> {
    const out: GoesObject[] = [];
    await listS3Pages(opts.baseUrl ?? GOES_BUCKET_URL, { prefix, ...extra }, {
        fetcher: opts.fetcher, signal: opts.signal, label: 'GOES', allPages: !extra['max-keys'],
    }, (page) => { out.push(...page.objects); });
    return out;
}

interface Listed extends GoesObject { timestamp: string }

/** Files of one stem in one UTC hour, keyed by scan start. Malformed or foreign keys are skipped. */
async function listStemHour(
    product: string, stem: string, channel: string | null, hour: Date, opts: GoesListingOptions, startAfter?: string,
): Promise<Listed[]> {
    const dir = hourPrefix(product, hour);
    const extra: Record<string, string> = {};
    if (startAfter && startAfter.startsWith(dir)) extra['start-after'] = startAfter;
    const satellite = opts.satellite ?? GOES_SATELLITE;
    const objects = await listPrefix(`${dir}${fileStem(stem, channel, opts.scanMode ?? GOES_SCAN_MODE, satellite)}`, opts, extra);
    const out: Listed[] = [];
    for (const o of objects) {
        const k = parseGoesKey(o.key);
        if (!k || k.product !== product || k.stem !== stem || k.channel !== channel || k.satellite !== satellite) continue;
        out.push({ ...o, timestamp: k.timestamp });
    }
    return out;
}

/** True when frames of this band in this sector need MCMIP at some zoom level. */
function needsMcmip(band: GoesBand, sector: GoesSector): boolean {
    return mcmipShift(band, sector, topLevel(band)) > 0;
}

/**
 * Scans of one band in the given UTC hours, joined with MCMIP on scan start when zoom-out needs it.
 * A 0.5 or 1 km frame whose MCMIP file has not landed yet is left out, so zooming out never shows nothing.
 */
async function listFrames(sector: GoesSector, band: GoesBand, hours: Date[], opts: GoesListingOptions, startAfter?: string): Promise<GoesFrame[]> {
    const channel = channelOf(band);
    const withMcmip = needsMcmip(band, sector);
    const [bandLists, mcmipLists] = await Promise.all([
        Promise.all(hours.map((h) => listStemHour(sector.product, sector.fileStem, channel, h, opts, startAfter))),
        withMcmip && sector.mcmip
            ? Promise.all(hours.map((h) => listStemHour(sector.mcmip!.product, sector.mcmip!.fileStem, null, h, opts)))
            : Promise.resolve([] as Listed[][]),
    ]);
    const mcmip = new Map(mcmipLists.flat().map((o) => [o.timestamp, o]));
    const frames: GoesFrame[] = [];
    for (const o of bandLists.flat()) {
        const m = mcmip.get(o.timestamp);
        if (withMcmip && !m) continue;
        frames.push({ timestamp: o.timestamp, band: { key: o.key, size: o.size }, mcmip: m ? { key: m.key, size: m.size } : null });
    }
    return frames.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}

/** Read the scan mode from whatever the hour holds (one small page). Returns null if the hour is empty. */
async function detectScanMode(sector: GoesSector, hour: Date, opts: GoesListingOptions = {}): Promise<string | null> {
    const objects = await listPrefix(hourPrefix(sector.product, hour), opts, { 'max-keys': '20' });
    for (const o of objects) {
        const k = parseGoesKey(o.key);
        if (k && k.satellite === (opts.satellite ?? GOES_SATELLITE)) return k.mode;
    }
    return null;
}

/** Every UTC hour from `from` to `to`, oldest first. */
export function hoursBetween(from: Date, to: Date): Date[] {
    const out: Date[] = [];
    const start = Math.floor(from.getTime() / 3_600_000), end = Math.floor(to.getTime() / 3_600_000);
    for (let h = start; h <= end; h++) out.push(new Date(h * 3_600_000));
    return out;
}

/** Frames whose scan started in [from, to], oldest first. */
export async function listScans(sector: GoesSector, band: GoesBand, from: Date, to: Date, opts: GoesListingOptions = {}): Promise<GoesFrame[]> {
    const fromTs = scanTimestampOf(from), toTs = scanTimestampOf(to);
    return (await listFrames(sector, band, hoursBetween(from, to), opts)).filter((f) => f.timestamp >= fromTs && f.timestamp <= toTs);
}

const scanTimestampOf = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/**
 * The newest `count` (default `GOES_TIMELINE_FRAMES` for the sector) frames: the current and previous UTC hour. If both are
 * empty the scan mode may have changed, so it is read from the bucket once and the listing retried.
 */
export async function fetchGoesTimeline(sector: GoesSector, band: GoesBand, now = new Date(), opts: GoesListingOptions = {}): Promise<GoesFrame[]> {
    const count = opts.frames ?? GOES_TIMELINE_FRAMES[sector.id];
    const hours = [new Date(now.getTime() - 3_600_000), now];
    let frames = await listFrames(sector, band, hours, opts);
    if (frames.length === 0) {
        const retry = await retryWithDetectedMode(sector, band, hours, now, opts);
        if (retry) frames = retry;
    }
    return frames.slice(-count);
}

/** After an empty listing: read the live scan mode from the bucket and, if it differs, list again with it. */
async function retryWithDetectedMode(sector: GoesSector, band: GoesBand, hours: Date[], at: Date, opts: GoesListingOptions): Promise<GoesFrame[] | null> {
    const mode = (await detectScanMode(sector, at, opts)) ?? (await detectScanMode(sector, hours[0], opts));
    if (!mode || mode === (opts.scanMode ?? GOES_SCAN_MODE)) return null;
    opts.onScanModeChange?.(mode);
    return listFrames(sector, band, hours, { ...opts, scanMode: mode });
}

/** A bounded four-scan window around a historical or live UTC timeline cursor. */
export async function fetchGoesTimelineNear(sector: GoesSector, band: GoesBand, cursor: Date, opts: GoesListingOptions = {}, count: number = opts.frames ?? GOES_TIMELINE_FRAMES[sector.id]): Promise<GoesFrame[]> {
    const hours = [-1, 0, 1].map((offset) => new Date(cursor.getTime() + offset * 3_600_000));
    let frames = await listFrames(sector, band, hours, opts);
    if (!frames.length) {
        const retry = await retryWithDetectedMode(sector, band, hours, cursor, opts);
        if (retry) frames = retry;
    }
    opts.signal?.throwIfAborted();
    return nearestFrameWindow(frames, cursor, count, (frame) => frame.timestamp);
}

/** Frames newer than `last`: a start-after listing of its hour, plus every later hour up to `now`. */
export async function listNewFrames(sector: GoesSector, band: GoesBand, last: GoesFrame | null, now = new Date(), opts: GoesListingOptions = {}): Promise<GoesFrame[]> {
    if (!last) return fetchGoesTimeline(sector, band, now, opts);
    const hours = hoursBetween(timestampToDate(last.timestamp), now);
    const frames = await listFrames(sector, band, hours, opts, last.band.key);
    return frames.filter((f) => f.timestamp > last.timestamp);
}

/** Merge new frames into a timeline, keeping the newest `count` (default `GOES_TIMELINE_FRAMES` for the sector). */
export function mergeFrames(sector: GoesSector, existing: readonly GoesFrame[], fresh: readonly GoesFrame[], count: number = GOES_TIMELINE_FRAMES[sector.id]): GoesFrame[] {
    const byTime = new Map(existing.map((f) => [f.timestamp, f]));
    for (const f of fresh) byTime.set(f.timestamp, f);
    return [...byTime.values()].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1)).slice(-count);
}
