import { hasLevel3Moment } from '@edgewarn/web-utils/nexrad';
import { NEXRAD_LIMITS } from './config.ts';
import type { NexradLimits } from './config.ts';
import {
    findNewestRingId, listArchiveDay, listChunks, listLevel3Day, listRingIds, msToTimestamp, nextRingId, previousRingId, probeRingTimestamp, timestampToMs,
} from './listing.ts';
import type { ArchiveObject, ChunkObject, Level3Object, NexradListingOptions } from './listing.ts';

/**
 * Where a volume's frames come from. 'level3': a finished volume, from the radar processor's products (velocity
 * dealiased). 'chunks': a volume still being received, or one Level III has not published yet. 'archive': a finished
 * volume Level III lacks, from the Level II archive.
 */
export type VolumeSource = 'archive' | 'chunks' | 'level3' | 'missing';

export interface NexradVolume {
    /** Volume start as `YYYYMMDD-HHMMSS`. Identity of the volume in every bucket. */
    id: string;
    source: VolumeSource;
    /** Level II archive object key: the volume itself (source 'archive'), or the same volume's Level II file next to its Level III products. */
    archiveKey?: string;
    size?: number;
    /** Chunk bucket ring id and the chunks known so far (source 'chunks', or a recent 'level3' volume). */
    chunkId?: number;
    chunks?: ChunkObject[];
    /** False for a chunk volume whose `E` chunk has not arrived. */
    complete: boolean;
}

export const volumeFromArchive = (o: ArchiveObject): NexradVolume => ({
    id: o.timestamp, source: 'archive', archiveKey: o.key, size: o.size, complete: true,
});

export const volumeFromLevel3 = (o: Level3Object): NexradVolume => ({ id: o.timestamp, source: 'level3', complete: true });

/** Whether the frame of `moment` for this volume is read from Level III (spectrum width and differential phase are not published there). */
export const usesLevel3 = (volume: Pick<NexradVolume, 'source'>, moment: string): boolean => volume.source === 'level3' && hasLevel3Moment(moment);

export function volumeFromChunks(chunks: readonly ChunkObject[]): NexradVolume | null {
    if (!chunks.length) return null;
    const sorted = [...chunks].sort((a, b) => a.sequence - b.sequence);
    return {
        id: sorted[0].timestamp, source: 'chunks', chunkId: sorted[0].id, chunks: sorted,
        complete: sorted[sorted.length - 1].marker === 'E',
    };
}

/**
 * One entry per start time, oldest first. A volume still being received stays on its chunks. A finished one is read
 * from Level III when it is there (keeping the archive key and chunks that are known, which the 3D tools need), else
 * from the archive, else from its chunks.
 */
export function mergeVolumes(archive: readonly NexradVolume[], live: readonly NexradVolume[], level3: readonly NexradVolume[] = []): NexradVolume[] {
    const liveById = new Map(live.map((v) => [v.id, v]));
    const archiveById = new Map(archive.map((v) => [v.id, v]));
    const level3ById = new Map(level3.map((v) => [v.id, v]));
    const ids = new Set([...liveById.keys(), ...archiveById.keys(), ...level3ById.keys()]);
    const out: NexradVolume[] = [];
    for (const id of ids) {
        const chunks = liveById.get(id);
        const file = archiveById.get(id);
        const products = level3ById.get(id);
        if (chunks && !chunks.complete) out.push(chunks);
        else if (products) {
            out.push({
                ...products,
                ...(file ? { archiveKey: file.archiveKey, size: file.size } : {}),
                ...(chunks ? { chunkId: chunks.chunkId, chunks: chunks.chunks } : {}),
            });
        } else out.push((file ?? chunks)!);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * Insert `missing` volumes where the delta between two volumes is a gap. A gap is a delta over
 * min(1.75 x the median of the last six deltas, 12 min), so the rule follows the cadence of the mode
 * (about 4.5 min in storm VCPs, 10 min in clear air).
 */
export function fillGaps(volumes: readonly NexradVolume[], limits: Partial<NexradLimits> = {}): NexradVolume[] {
    const { gapWindow, gapFactor, gapMaxMs, maxMissingPerGap } = { ...NEXRAD_LIMITS, ...limits };
    const out: NexradVolume[] = [];
    const deltas: number[] = [];
    for (let i = 0; i < volumes.length; i++) {
        const v = volumes[i];
        if (i > 0) {
            const prev = volumes[i - 1];
            const delta = timestampToMs(v.id) - timestampToMs(prev.id);
            const recent = deltas.slice(-gapWindow);
            const typical = recent.length ? median(recent) : delta;
            const limit = Math.min(gapFactor * typical, gapMaxMs);
            if (recent.length && delta > limit) {
                const count = Math.min(maxMissingPerGap, Math.max(1, Math.round(delta / typical) - 1));
                for (let k = 1; k <= count; k++) {
                    out.push({ id: msToTimestamp(timestampToMs(prev.id) + (delta * k) / (count + 1)), source: 'missing', complete: false });
                }
            } else deltas.push(delta);
        }
        out.push(v);
    }
    return out;
}

/** Typical gap between real volumes, from the newest ones. Null with fewer than two. */
export function cadenceMs(volumes: readonly NexradVolume[], windowSize: number = NEXRAD_LIMITS.gapWindow): number | null {
    const real = volumes.filter((v) => v.source !== 'missing');
    const deltas: number[] = [];
    for (let i = Math.max(1, real.length - windowSize); i < real.length; i++) deltas.push(timestampToMs(real[i].id) - timestampToMs(real[i - 1].id));
    return deltas.length ? median(deltas) : null;
}

/** Archive volumes covering the newest `count` volumes: whole UTC days, newest first, until enough are found. */
async function listArchiveVolumes(site: string, now: Date, count: number, opts: NexradListingOptions = {}): Promise<NexradVolume[]> {
    let found: ArchiveObject[] = [];
    for (let back = 0; back < (opts.limits?.maxArchiveDays ?? NEXRAD_LIMITS.maxArchiveDays) && found.length < count; back++) {
        const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
        found = [...(await listArchiveDay(site, day, opts)), ...found];
    }
    return found.slice(-count).map(volumeFromArchive);
}

/** Level III volumes covering the newest `count` volumes, listed the same way. */
async function listLevel3Volumes(site: string, now: Date, count: number, opts: NexradListingOptions = {}): Promise<NexradVolume[]> {
    let found: Level3Object[] = [];
    for (let back = 0; back < (opts.limits?.maxArchiveDays ?? NEXRAD_LIMITS.maxArchiveDays) && found.length < count; back++) {
        const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
        found = [...(await listLevel3Day(site, day, opts)), ...found];
    }
    return found.slice(-count).map(volumeFromLevel3);
}

interface LiveDiscovery {
    newestId: number | null;
    volumes: NexradVolume[];
}

/**
 * Chunk volumes of the last few scans, oldest first. Finds the newest ring id (§3.8), then walks back until it
 * reaches a finished volume that `finishedIds` (the archive's and Level III's) already hold; that one is kept, as the
 * archive may not have its file yet.
 */
export async function discoverLiveVolumes(
    site: string, finishedIds: ReadonlySet<string>, opts: NexradListingOptions = {}, ids?: number[],
): Promise<LiveDiscovery> {
    const ring = ids ?? await listRingIds(site, opts);
    const newestId = await findNewestRingId(ring, (id) => probeRingTimestamp(site, id, opts), opts.limits?.ringSize);
    if (newestId == null) return { newestId: null, volumes: [] };
    const volumes: NexradVolume[] = [];
    let id = newestId;
    for (let i = 0; i < (opts.limits?.maxLiveVolumes ?? NEXRAD_LIMITS.maxLiveVolumes); i++) {
        if (!ring.includes(id)) break;
        const volume = volumeFromChunks(await listChunks(site, id, opts));
        if (!volume) break;
        volumes.unshift(volume);
        if (volume.complete && finishedIds.has(volume.id)) break;
        id = previousRingId(id, opts.limits?.ringSize);
    }
    return { newestId, volumes };
}

/**
 * Full timeline, gap-filled, newest `count` entries: Level III for finished volumes, the chunks for the one being
 * received, the Level II archive for any volume Level III lacks. One of the two finished listings may fail.
 */
export async function listNexradVolumes(site: string, now: Date, count: number, opts: NexradListingOptions = {}): Promise<{ volumes: NexradVolume[]; newestChunkId: number | null }> {
    const [archiveResult, level3Result] = await Promise.allSettled([listArchiveVolumes(site, now, count, opts), listLevel3Volumes(site, now, count, opts)]);
    if (archiveResult.status === 'rejected' && level3Result.status === 'rejected') throw archiveResult.reason;
    const archive = archiveResult.status === 'fulfilled' ? archiveResult.value : [];
    const level3 = level3Result.status === 'fulfilled' ? level3Result.value : [];
    const finishedIds = new Set([...archive, ...level3].map((v) => v.id));
    const live = await discoverLiveVolumes(site, finishedIds, opts).catch(() => ({ newestId: null, volumes: [] as NexradVolume[] }));
    const merged = mergeVolumes(archive, live.volumes, level3);
    return { volumes: fillGaps(merged, opts.limits).slice(-count), newestChunkId: live.newestId };
}

/** The real (non-missing) volume whose start is nearest `cursor` (`YYYYMMDD-HHMMSS`); the newest when there is no cursor. */
export function nearestVolume(volumes: readonly NexradVolume[], cursor: string | null): NexradVolume | null {
    const real = volumes.filter((v) => v.source !== 'missing');
    if (!real.length) return null;
    if (!cursor) return real[real.length - 1];
    const target = timestampToMs(cursor);
    let best = real[0];
    let bestGap = Infinity;
    for (const v of real) {
        const gap = Math.abs(timestampToMs(v.id) - target);
        if (gap < bestGap) { best = v; bestGap = gap; }
    }
    return best;
}

interface LivePoll {
    volumes: NexradVolume[];
    newestChunkId: number | null;
    /** Chunks or a new volume arrived. */
    changed: boolean;
}

/**
 * One live poll (§3.9). While the newest chunk volume has no `E` chunk, list the chunks after the last known one.
 * Once it is complete, look for the next ring id: its first chunk is the start of the next volume.
 */
export async function pollLiveVolumes(
    site: string, volumes: readonly NexradVolume[], newestChunkId: number | null, count: number, opts: NexradListingOptions = {},
): Promise<LivePoll> {
    const real = volumes.filter((v) => v.source !== 'missing');
    const last = real[real.length - 1];
    if (!last) return { volumes: [...volumes], newestChunkId, changed: false };

    if (last.source === 'chunks' && !last.complete && last.chunkId != null) {
        const known = last.chunks ?? [];
        const after = known.length ? known[known.length - 1].key : undefined;
        const fresh = await listChunks(site, last.chunkId, opts, after);
        if (!fresh.length) return { volumes: [...volumes], newestChunkId, changed: false };
        const updated = volumeFromChunks([...known, ...fresh.filter((c) => !known.some((k) => k.sequence === c.sequence))]);
        if (!updated) return { volumes: [...volumes], newestChunkId, changed: false };
        const next = volumes.map((v) => (v.id === last.id ? updated : v));
        return { volumes: next, newestChunkId: last.chunkId, changed: true };
    }

    if (newestChunkId == null) return { volumes: [...volumes], newestChunkId, changed: false };
    const nextId = nextRingId(newestChunkId, opts.limits?.ringSize);
    const next = volumeFromChunks(await listChunks(site, nextId, opts));
    if (!next || next.id <= last.id) return { volumes: [...volumes], newestChunkId, changed: false };
    const merged = fillGaps([...real, next], opts.limits).slice(-count);
    return { volumes: merged, newestChunkId: nextId, changed: true };
}
