import { listS3Pages, parseS3Listing } from '@edgewarn/web-utils/net';

/** Public MRMS bucket on AWS Open Data. */
export const MRMS_BUCKET_URL = 'https://noaa-mrms-pds.s3.amazonaws.com';
/** Domain directory of every product key. */
export const MRMS_DOMAIN_PREFIX = 'CONUS';

export interface ListingOptions {
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    /** Bucket URL; defaults to {@link MRMS_BUCKET_URL}. */
    baseUrl?: string;
}

interface ListingPage {
    keys: string[];
    prefixes: string[];
    nextToken: string | null;
}

const KEY_RE = /^CONUS\/([^/]+)\/(\d{8})\/MRMS_(.+)_(\d{8}-\d{6})\.grib2\.gz$/;
const TIMESTAMP_RE = /^(\d{8})-(\d{2})(\d{2})(\d{2})$/;

/** One ListObjectsV2 page as keys, prefixes and the continuation token. */
export function parseListing(xml: string): ListingPage {
    const { objects, prefixes, nextToken } = parseS3Listing(xml);
    return { keys: objects.map((o) => o.key), prefixes, nextToken };
}

/** `YYYYMMDD-HHMMSS` for a key of the exact MRMS form, else null (malformed keys are skipped). */
export function timestampFromKey(key: string, product?: string): string | null {
    const m = KEY_RE.exec(key);
    if (!m) return null;
    const [, dir, day, name, ts] = m;
    if (product !== undefined && dir !== product) return null;
    if (name !== dir || ts.slice(0, 8) !== day) return null;
    return isValidTimestamp(ts) ? ts : null;
}

function isValidTimestamp(ts: string): boolean {
    const m = TIMESTAMP_RE.exec(ts);
    if (!m) return false;
    return Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4]) < 60;
}

export const mrmsKey = (product: string, timestamp: string): string =>
    `${MRMS_DOMAIN_PREFIX}/${product}/${timestamp.slice(0, 8)}/MRMS_${product}_${timestamp}.grib2.gz`;

export const mrmsUrl = (product: string, timestamp: string, baseUrl = MRMS_BUCKET_URL): string =>
    `${baseUrl}/${mrmsKey(product, timestamp)}`;

/** `YYYYMMDD` (UTC) of a Date. */
export function utcDay(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Every UTC day touched by [from, to], oldest first. */
export function utcDaysBetween(from: Date, to: Date): string[] {
    const days: string[] = [];
    const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
    for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t <= end; t += 86_400_000) {
        days.push(utcDay(new Date(t)));
    }
    return days;
}

export function timestampToDate(ts: string): Date {
    const m = TIMESTAMP_RE.exec(ts);
    if (!m) throw new Error(`Bad MRMS timestamp: ${ts}`);
    const d = m[1];
    return new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +m[2], +m[3], +m[4]));
}

async function listPages(
    params: Record<string, string>,
    opts: ListingOptions,
    onPage: (page: ListingPage) => void,
): Promise<void> {
    await listS3Pages(
        opts.baseUrl ?? MRMS_BUCKET_URL,
        params,
        { fetcher: opts.fetcher, signal: opts.signal, label: 'MRMS' },
        (page) => onPage({ keys: page.objects.map((o) => o.key), prefixes: page.prefixes, nextToken: page.nextToken }),
    );
}

/** Timestamps for one product on one UTC day, optionally only those after `afterTimestamp`. */
export async function listDay(
    product: string,
    day: string,
    opts: ListingOptions = {},
    afterTimestamp?: string,
): Promise<string[]> {
    const out: string[] = [];
    const params: Record<string, string> = { prefix: `${MRMS_DOMAIN_PREFIX}/${product}/${day}/` };
    if (afterTimestamp && afterTimestamp.slice(0, 8) === day) params['start-after'] = mrmsKey(product, afterTimestamp);
    await listPages(params, opts, (page) => {
        for (const key of page.keys) {
            const ts = timestampFromKey(key, product);
            if (ts && ts.slice(0, 8) === day) out.push(ts);
        }
    });
    return out;
}

/** Narrow a listing to one UTC hour instead of downloading the product's entire day. */
export async function listHour(product: string, hour: Date, opts: ListingOptions = {}): Promise<string[]> {
    const day = utcDay(hour);
    const hh = String(hour.getUTCHours()).padStart(2, '0');
    const prefix = `${MRMS_DOMAIN_PREFIX}/${product}/${day}/MRMS_${product}_${day}-${hh}`;
    const out: string[] = [];
    await listPages({ prefix }, opts, (page) => {
        for (const key of page.keys) {
            const stamp = timestampFromKey(key, product);
            if (stamp) out.push(stamp);
        }
    });
    return out.sort();
}

/** Sorted timestamps for every UTC day in [from, to]. Day listings run in parallel. */
export async function listTimestamps(
    product: string,
    from: Date,
    to: Date,
    opts: ListingOptions = {},
): Promise<string[]> {
    const days = await Promise.all(utcDaysBetween(from, to).map((day) => listDay(product, day, opts)));
    return days.flat().sort();
}

/**
 * Timestamps newer than `lastTimestamp`: one start-after request for its day, plus the full
 * listing of any later UTC day up to `now`. This is the 30 s auto-refresh path.
 */
export async function listNew(
    product: string,
    lastTimestamp: string | null,
    now: Date,
    opts: ListingOptions = {},
): Promise<string[]> {
    if (!lastTimestamp) return listTimestamps(product, new Date(now.getTime() - 86_400_000), now, opts);
    const lastDay = lastTimestamp.slice(0, 8);
    const days = utcDaysBetween(timestampToDate(lastTimestamp), now);
    const lists = await Promise.all(
        days.map((day) => listDay(product, day, opts, day === lastDay ? lastTimestamp : undefined)),
    );
    return lists.flat().filter((ts) => ts > lastTimestamp).sort();
}

/** Product directory names under CONUS/. */
export async function listProducts(opts: ListingOptions = {}): Promise<string[]> {
    const names: string[] = [];
    await listPages({ prefix: `${MRMS_DOMAIN_PREFIX}/`, delimiter: '/' }, opts, (page) => {
        for (const prefix of page.prefixes) {
            const name = prefix.slice(MRMS_DOMAIN_PREFIX.length + 1, -1);
            if (name && !name.includes('/')) names.push(name);
        }
    });
    return names.sort();
}
