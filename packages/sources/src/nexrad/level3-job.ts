/**
 * Jobs on a finished volume's Level III products. A volume is a file per moment and tilt (`TLX_N1G_2026_10_20_00_09_35`),
 * so a job first reads the 256-byte headers of the candidates to learn the tilt angles, then downloads the one file
 * it wants. The tilts are named N0 to N3 by position, not by angle, which is why the angles have to be read.
 */
import { LEVEL3_PRODUCT_LETTER, decodeLevel3Radial, groupTilts, parseLevel3Header } from '@edgewarn/web-utils/nexrad';
import type { CutField, ElevationSummary, Level3Header, Level3Tilt } from '@edgewarn/web-utils/nexrad';
import type { ExpiryCache } from '@edgewarn/web-utils/net';
import { NEXRAD_LEVEL3_URL, NEXRAD_LIMITS } from './config.ts';
import type { NexradLimits } from './config.ts';
import { level3Key, level3ObjectUrl } from './listing.ts';

/** The job fields a Level III read uses. */
export interface Level3Job {
    jobId: number;
    site: string;
    /** Volume start, `YYYYMMDD-HHMMSS`. */
    volumeId: string;
    /** Moment codes wanted (REF, VEL, ZDR, RHO); the first one is read. */
    moments: string[];
    /** Target by nominal angle (resolved against this volume's tilts) or by unified elevation id. */
    elevation: { angle: number } | { id: number };
}

/** What a Level III read reports. Structurally a subset of a decode worker's messages. */
export type Level3Message =
    | { type: 'vcp'; jobId: number; volumeId: string; vcp: number; elevations: ElevationSummary[]; selected: number | null }
    | {
          type: 'revision';
          jobId: number;
          volumeId: string;
          elevationId: number;
          moment: string;
          component: 'B';
          revision: 1;
          provisional: false;
          field: CutField;
      };

export interface Level3JobDeps {
    fetcher?: typeof fetch;
    signal: AbortSignal;
    /** Receives each message; the second argument lists buffers that can move without a copy. */
    post: (message: Level3Message, transfer?: ArrayBuffer[]) => void;
    level3Url?: string;
    /**
     * Headers by object key. A published product never changes, so a cache may hold them for good; a
     * missing product is never stored, it may appear later. Omit to read every header again each job.
     */
    headerCache?: ExpiryCache<Level3Header>;
    /** Overrides for {@link NEXRAD_LIMITS} (tilts per moment, probe size). */
    limits?: Partial<NexradLimits>;
}

const MOMENT_ORDER = Object.keys(LEVEL3_PRODUCT_LETTER);

async function readHeader(site: string, product: string, volumeId: string, deps: Level3JobDeps): Promise<Level3Header | null> {
    const key = level3Key(site, product, volumeId);
    const held = deps.headerCache?.get(key);
    if (held) return held;
    const probeBytes = deps.limits?.level3ProbeBytes ?? NEXRAD_LIMITS.level3ProbeBytes;
    const fetcher = deps.fetcher ?? globalThis.fetch;
    const response = await fetcher(level3ObjectUrl(key, deps.level3Url ?? NEXRAD_LEVEL3_URL), {
        signal: deps.signal,
        headers: { Range: `bytes=0-${probeBytes - 1}` },
    });
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const header = parseLevel3Header(new Uint8Array(await response.arrayBuffer()).subarray(0, probeBytes));
    if (!header) return null;
    deps.headerCache?.set(key, header);
    return header;
}

/** Every product Level III has for the volume, with its header. */
async function probeTilts(site: string, volumeId: string, deps: Level3JobDeps): Promise<Level3Tilt[]> {
    const tilts = deps.limits?.level3Tilts ?? NEXRAD_LIMITS.level3Tilts;
    const candidates = MOMENT_ORDER.flatMap((moment) =>
        Array.from({ length: tilts }, (_, tilt) => ({ moment, product: `N${tilt}${LEVEL3_PRODUCT_LETTER[moment]}` })),
    );
    const found = await Promise.all(
        candidates.map(async ({ moment, product }) => {
            const header = await readHeader(site, product, volumeId, deps);
            return header ? { moment, product, header } : null;
        }),
    );
    return found.filter((t): t is Level3Tilt => t !== null);
}

const summaryOf = ({ id, nominalAngle, moments, paired, cuts }: ReturnType<typeof groupTilts>[number]): ElevationSummary => ({
    id,
    nominalAngle,
    moments,
    paired,
    cuts,
});

/** Post the volume's elevations (the card's list). */
export async function readLevel3Vcp(job: Level3Job, deps: Level3JobDeps): Promise<void> {
    const tilts = await probeTilts(job.site, job.volumeId, deps);
    if (!tilts.length) throw new Error('Level III has no products for this volume');
    deps.post({
        type: 'vcp',
        jobId: job.jobId,
        volumeId: job.volumeId,
        vcp: tilts[0].header.vcp,
        elevations: groupTilts(tilts).map(summaryOf),
        selected: null,
    });
}

/** Download and decode the tilt of `job.moments[0]` nearest `job.elevation.angle`. */
export async function runLevel3Job(job: Level3Job, deps: Level3JobDeps, state: { bytesRead: number }): Promise<void> {
    const moment = job.moments[0];
    if (!(moment in LEVEL3_PRODUCT_LETTER)) throw new Error(`Level III has no ${moment}`);
    const tilts = await probeTilts(job.site, job.volumeId, deps);
    const groups = groupTilts(tilts);
    const target = 'angle' in job.elevation ? job.elevation.angle : 0;
    let chosen: { group: (typeof groups)[number]; tilt: Level3Tilt } | null = null;
    for (const group of groups) {
        const tilt = group.members.find((t) => t.moment === moment);
        if (tilt && (!chosen || Math.abs(group.nominalAngle - target) < Math.abs(chosen.group.nominalAngle - target) - 1e-9))
            chosen = { group, tilt };
    }
    if (!chosen) throw new Error(`Level III has no ${moment}`);
    deps.post({
        type: 'vcp',
        jobId: job.jobId,
        volumeId: job.volumeId,
        vcp: chosen.tilt.header.vcp,
        elevations: groups.map(summaryOf),
        selected: chosen.group.id,
    });

    const fetcher = deps.fetcher ?? globalThis.fetch;
    const response = await fetcher(
        level3ObjectUrl(level3Key(job.site, chosen.tilt.product, job.volumeId), deps.level3Url ?? NEXRAD_LEVEL3_URL),
        { signal: deps.signal },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    state.bytesRead += bytes.length;
    const { field } = decodeLevel3Radial(bytes, moment);
    deps.post(
        {
            type: 'revision',
            jobId: job.jobId,
            volumeId: job.volumeId,
            elevationId: chosen.group.id,
            moment,
            component: 'B',
            revision: 1,
            provisional: false,
            field,
        },
        [field.data.buffer, field.azimuths.buffer, field.azimuthLut.buffer] as ArrayBuffer[],
    );
}
