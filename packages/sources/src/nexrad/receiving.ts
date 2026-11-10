import { formatAngle } from '@edgewarn/web-utils/nexrad';
import { NEXRAD_LIMITS } from './config.ts';
import type { NexradLimits } from './config.ts';
import { cadenceMs } from './volumes.ts';
import type { NexradVolume } from './volumes.ts';
import { timestampToMs } from './listing.ts';

export type ReceivingKind = 'receiving' | 'idle' | 'overdue' | 'error' | 'offline';

export interface ReceivingState {
    kind: ReceivingKind;
    /** Card text. */
    text: string;
    /** 0..1 swept in the cut being received; only while receiving. */
    fraction: number | null;
    /** Elevation angle being received, degrees. */
    angle: number | null;
}

export interface ReceivingInput {
    now: number;
    volumes: readonly NexradVolume[];
    /** The follower's latest report, when it is on the newest volume. */
    receiving: { volumeId: string; angle: number; fraction: number } | null;
    /** The volume list failed to load, or a frame could not be fetched. */
    unreachable: boolean;
}

/** The state the Receiving card shows (§6.4). */
export function receivingState(
    { now, volumes, receiving, unreachable }: ReceivingInput,
    limits: Partial<NexradLimits> = {},
): ReceivingState {
    const { offlineMs, overdueFactor } = { ...NEXRAD_LIMITS, ...limits };
    const none = { fraction: null, angle: null };
    if (unreachable) return { kind: 'error', text: "Can't reach NOAA", ...none };
    const real = volumes.filter((v) => v.source !== 'missing');
    const newest = real[real.length - 1];
    if (!newest) return { kind: 'idle', text: 'Up to date', ...none };

    if (newest.source === 'chunks' && !newest.complete) {
        const mine = receiving && receiving.volumeId === newest.id ? receiving : null;
        return mine
            ? { kind: 'receiving', text: `Receiving ${formatAngle(mine.angle)}`, fraction: mine.fraction, angle: mine.angle }
            : { kind: 'receiving', text: 'Receiving', ...none };
    }
    const age = now - timestampToMs(newest.id);
    if (age > offlineMs) return { kind: 'offline', text: 'Station offline', ...none };
    const cadence = cadenceMs(real);
    if (cadence && age > cadence * overdueFactor) return { kind: 'overdue', text: 'Waiting for next scan', ...none };
    return { kind: 'idle', text: 'Up to date', ...none };
}
