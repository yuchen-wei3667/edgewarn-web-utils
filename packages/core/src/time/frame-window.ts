import { parseTimestampUTC } from './timestamp.ts';

/** Keep a bounded window around the cursor, breaking equal-distance ties toward the older scan. */
export function nearestFrameWindow<T>(
    frames: readonly T[],
    cursor: Date,
    count: number,
    timestamp: (frame: T) => string,
): T[] {
    const target = cursor.getTime();
    return [...frames]
        .filter((frame) => Number.isFinite(parseTimestampUTC(timestamp(frame))?.getTime()))
        .sort((a, b) => {
            const left = parseTimestampUTC(timestamp(a))!.getTime();
            const right = parseTimestampUTC(timestamp(b))!.getTime();
            return Math.abs(left - target) - Math.abs(right - target) || left - right;
        })
        .slice(0, count)
        .sort((a, b) => timestamp(a).localeCompare(timestamp(b)));
}

/**
 * The scan each timeline frame would show: the nearest one to each frame time, oldest first and
 * without repeats. Frames with no scan within `maxGapMs` get none.
 */
export function framesForTimeline<T>(
    frames: readonly T[],
    times: readonly Date[],
    timestamp: (frame: T) => string,
    maxGapMs: number,
): T[] {
    const timed = frames
        .map((frame) => ({ frame, time: parseTimestampUTC(timestamp(frame))?.getTime() }))
        .filter((entry): entry is { frame: T; time: number } => Number.isFinite(entry.time));
    const picked = new Set<T>();
    for (const cursor of times) {
        const target = cursor.getTime();
        let best: { frame: T; time: number } | null = null;
        for (const entry of timed) {
            const diff = Math.abs(entry.time - target);
            if (diff <= maxGapMs && (!best || diff < Math.abs(best.time - target))) best = entry;
        }
        if (best) picked.add(best.frame);
    }
    return [...picked].sort((a, b) => timestamp(a).localeCompare(timestamp(b)));
}
