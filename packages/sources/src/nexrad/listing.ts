import { listS3Pages } from '@edgewarn/web-utils/net';
import type { S3Object } from '@edgewarn/web-utils/net';
import { msToTimestamp, timestampToMs as parseUtcTimestamp } from '@edgewarn/web-utils/time';
import { NEXRAD_ARCHIVE_URL, NEXRAD_CHUNKS_URL, NEXRAD_LEVEL3_URL, NEXRAD_LIMITS } from './config.ts';
import type { NexradLimits } from './config.ts';

export interface NexradListingOptions {
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    archiveUrl?: string;
    chunksUrl?: string;
    level3Url?: string;
    /** Overrides for {@link NEXRAD_LIMITS}. */
    limits?: Partial<NexradLimits>;
}

type ListedObject = S3Object;

export interface ArchiveObject extends ListedObject {
    site: string;
    /** Volume start as `YYYYMMDD-HHMMSS`. */
    timestamp: string;
}

export type Level3Object = ArchiveObject;

export interface ChunkObject extends ListedObject {
    site: string;
    id: number;
    /** Volume start as `YYYYMMDD-HHMMSS`: the same for every chunk of the volume. */
    timestamp: string;
    sequence: number;
    marker: 'S' | 'I' | 'E';
}

const ARCHIVE_KEY = /^(\d{4})\/(\d{2})\/(\d{2})\/([A-Z0-9]{4})\/\4(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_V0\d$/;

/** `YYYY/MM/DD/SITE/SITEYYYYMMDD_HHMMSS_V06`. The `_MDM` metadata objects and anything else are null. */
export function parseArchiveKey(key: string): { site: string; timestamp: string } | null {
    const m = ARCHIVE_KEY.exec(key);
    if (!m) return null;
    const [, y, mo, d, site, y2, mo2, d2, hh, mm, ss] = m;
    if (y !== y2 || mo !== mo2 || d !== d2) return null;
    return { site, timestamp: `${y}${mo}${d}-${hh}${mm}${ss}` };
}

const CHUNK_KEY = /^([A-Z0-9]{4})\/(\d{1,3})\/(\d{8}-\d{6})-(\d{3})-([SIE])$/;

export function parseChunkKey(key: string): Omit<ChunkObject, 'size' | 'key'> | null {
    const m = CHUNK_KEY.exec(key);
    if (!m) return null;
    return { site: m[1], id: Number(m[2]), timestamp: m[3], sequence: Number(m[4]), marker: m[5] as 'S' | 'I' | 'E' };
}

export const archiveObjectUrl = (key: string, base = NEXRAD_ARCHIVE_URL) => `${base}/${key}`;
export const chunkObjectUrl = (key: string, base = NEXRAD_CHUNKS_URL) => `${base}/${key}`;
export const level3ObjectUrl = (key: string, base = NEXRAD_LEVEL3_URL) => `${base}/${key}`;

/** Level III names stations without the region letter: `KTLX` is `TLX`, `PHKI` is `HKI`. */
const level3SiteId = (site: string) => site.slice(1);

const LEVEL3_KEY = /^([A-Z0-9]{3})_(N[0-3][A-Z])_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})$/;

/** `SITE_PRODUCT_YYYY_MM_DD_HH_MM_SS`: the product and the volume start it belongs to. Anything else is null. */
export function parseLevel3Key(key: string): { site: string; product: string; timestamp: string } | null {
    const m = LEVEL3_KEY.exec(key);
    if (!m) return null;
    return { site: m[1], product: m[2], timestamp: `${m[3]}${m[4]}${m[5]}-${m[6]}${m[7]}${m[8]}` };
}

/** Object key of one Level III product of a volume: `product` is `N0B`, `N1G`... and `volumeId` is `YYYYMMDD-HHMMSS`. */
export function level3Key(site: string, product: string, volumeId: string): string {
    const [date, time] = volumeId.split('-');
    return `${level3SiteId(site)}_${product}_${date.slice(0, 4)}_${date.slice(4, 6)}_${date.slice(6, 8)}_${time.slice(0, 2)}_${time.slice(2, 4)}_${time.slice(4, 6)}`;
}

/** `YYYY/MM/DD/` for a UTC date. */
export function archiveDayPrefix(date: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}/${p(date.getUTCMonth() + 1)}/${p(date.getUTCDate())}/`;
}

/** Epoch ms of a `YYYYMMDD-HHMMSS` timestamp; NaN when it is not one. */
export function timestampToMs(ts: string): number {
    return parseUtcTimestamp(ts) ?? NaN;
}

export { msToTimestamp };

async function listAll(base: string, params: Record<string, string>, opts: NexradListingOptions, pages = true) {
    const objects: ListedObject[] = [];
    const prefixes: string[] = [];
    await listS3Pages(base, params, { fetcher: opts.fetcher, signal: opts.signal, label: 'NEXRAD', allPages: pages }, (page) => {
        objects.push(...page.objects);
        prefixes.push(...page.prefixes);
    });
    return { objects, prefixes };
}

/** Volumes of one site on one UTC day, oldest first. */
export async function listArchiveDay(site: string, day: Date, opts: NexradListingOptions = {}): Promise<ArchiveObject[]> {
    const { objects } = await listAll(opts.archiveUrl ?? NEXRAD_ARCHIVE_URL, { prefix: `${archiveDayPrefix(day)}${site}/` }, opts);
    const out: ArchiveObject[] = [];
    for (const o of objects) {
        const parsed = parseArchiveKey(o.key);
        if (parsed && parsed.site === site) out.push({ ...o, ...parsed });
    }
    return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Volumes of one site on one UTC day that Level III has published, oldest first. Listed by the index product's
 * key, which carries the volume start (the extra 0.5 degree scans of SAILS have keys of their own in the N0 products).
 */
export async function listLevel3Day(site: string, day: Date, opts: NexradListingOptions = {}): Promise<Level3Object[]> {
    const p = (n: number) => String(n).padStart(2, '0');
    const indexProduct = opts.limits?.level3IndexProduct ?? NEXRAD_LIMITS.level3IndexProduct;
    const prefix = `${level3SiteId(site)}_${indexProduct}_${day.getUTCFullYear()}_${p(day.getUTCMonth() + 1)}_${p(day.getUTCDate())}_`;
    const { objects } = await listAll(opts.level3Url ?? NEXRAD_LEVEL3_URL, { prefix }, opts);
    const out: Level3Object[] = [];
    for (const o of objects) {
        const parsed = parseLevel3Key(o.key);
        if (parsed && parsed.product === indexProduct && parsed.site === level3SiteId(site)) out.push({ ...o, site, timestamp: parsed.timestamp });
    }
    return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Volume ids present in the chunk bucket for a site (one delimiter listing). */
export async function listRingIds(site: string, opts: NexradListingOptions = {}): Promise<number[]> {
    const { prefixes } = await listAll(opts.chunksUrl ?? NEXRAD_CHUNKS_URL, { prefix: `${site}/`, delimiter: '/' }, opts);
    const ids: number[] = [];
    for (const p of prefixes) {
        const m = new RegExp(`^${site}/(\\d{1,3})/$`).exec(p);
        if (m && +m[1] >= 1 && +m[1] <= (opts.limits?.ringSize ?? NEXRAD_LIMITS.ringSize)) ids.push(+m[1]);
    }
    return ids.sort((a, b) => a - b);
}

export const nextRingId = (id: number, ringSize: number = NEXRAD_LIMITS.ringSize) => (id % ringSize) + 1;
export const previousRingId = (id: number, ringSize: number = NEXRAD_LIMITS.ringSize) => ((id + ringSize - 2) % ringSize) + 1;

/**
 * The newest id is the end of the cyclic run: the id whose successor is absent. A full ring (no such id) or a
 * ring with several runs is settled by comparing volume start times via `probeTimestamp`.
 */
export async function findNewestRingId(
    ids: readonly number[], probeTimestamp: (id: number) => Promise<string | null>, ringSize: number = NEXRAD_LIMITS.ringSize,
): Promise<number | null> {
    if (!ids.length) return null;
    const present = new Set(ids);
    const ends = ids.filter((id) => !present.has(nextRingId(id, ringSize)));
    if (ends.length === 1) return ends[0];
    const candidates = ends.length ? ends : [...ids];
    if (ends.length) {
        let best: { id: number; ts: string } | null = null;
        for (const id of candidates) {
            const ts = await probeTimestamp(id);
            if (ts && (!best || ts > best.ts)) best = { id, ts };
        }
        return best?.id ?? null;
    }
    // Full ring: start times rise along the ring from the oldest id to the newest, so the ring is a rotated sorted
    // list. Binary search the rotation point.
    const sorted = [...ids].sort((a, b) => a - b);
    const first = await probeTimestamp(sorted[0]);
    if (!first) return null;
    let lo = 0;
    let hi = sorted.length - 1;
    const last = await probeTimestamp(sorted[hi]);
    if (last && last > first) return sorted[hi]; // not rotated: the highest id is the newest
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const ts = await probeTimestamp(sorted[mid]);
        if (!ts) return null;
        if (ts >= first) lo = mid + 1;
        else hi = mid;
    }
    return sorted[(lo - 1 + sorted.length) % sorted.length];
}

/** Chunks of one volume id in order. `startAfter` lists only keys after it (live polling). */
export async function listChunks(site: string, id: number, opts: NexradListingOptions = {}, startAfter?: string): Promise<ChunkObject[]> {
    const params: Record<string, string> = { prefix: `${site}/${id}/` };
    if (startAfter) params['start-after'] = startAfter;
    const { objects } = await listAll(opts.chunksUrl ?? NEXRAD_CHUNKS_URL, params, opts);
    const out: ChunkObject[] = [];
    for (const o of objects) {
        const parsed = parseChunkKey(o.key);
        if (parsed && parsed.id === id) out.push({ ...o, ...parsed });
    }
    return out.sort((a, b) => a.sequence - b.sequence);
}

/** Start time of a ring id: the first chunk's key, read with a one-key listing. */
export async function probeRingTimestamp(site: string, id: number, opts: NexradListingOptions = {}): Promise<string | null> {
    const { objects } = await listAll(opts.chunksUrl ?? NEXRAD_CHUNKS_URL, { prefix: `${site}/${id}/`, 'max-keys': '1' }, opts, false);
    const parsed = objects[0] ? parseChunkKey(objects[0].key) : null;
    return parsed?.timestamp ?? null;
}
