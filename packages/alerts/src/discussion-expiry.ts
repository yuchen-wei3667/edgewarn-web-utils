/**
 * When an SPC mesoscale discussion (MCD) or a WPC mesoscale precipitation discussion (MPD) stops being valid.
 * The feeds keep a discussion listed for a while after it expires, and the map only refetches every few minutes,
 * so expired ones are filtered out when the feeds are read (`activeDiscussionFeatures`), and a long-lived view
 * sets one timer for the next end time (`createExpiryWatch`) instead of polling.
 */

const MINUTE_MS = 60_000;
/** `DDHHMM` (UTC) to a timestamp, taking the day from the month, the one before or the one after that lies closest to `now`. */
function parseDayHourMinute(day: number, hour: number, minute: number, now: number): number | null {
    if (day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    const current = new Date(now);
    let best: number | null = null;
    for (const monthOffset of [-1, 0, 1]) {
        const month = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + monthOffset, 1));
        const stamp = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day, hour, minute);
        if (new Date(stamp).getUTCMonth() !== month.getUTCMonth()) continue;
        if (best === null || Math.abs(stamp - now) < Math.abs(best - now)) best = stamp;
    }
    return best;
}

/** `HHMM` (UTC) with no day: the occurrence of that clock time nearest to `now`, since a discussion lasts hours, not days. */
function parseHourMinute(hour: number, minute: number, now: number): number | null {
    if (hour > 23 || minute > 59) return null;
    const midnight = now - (now % (24 * 60 * MINUTE_MS));
    let best: number | null = null;
    for (const dayOffset of [-1, 0, 1]) {
        const stamp = midnight + dayOffset * 24 * 60 * MINUTE_MS + (hour * 60 + minute) * MINUTE_MS;
        if (best === null || Math.abs(stamp - now) < Math.abs(best - now)) best = stamp;
    }
    return best;
}

/** The WPC `ValidEndTi` field, `DDHHMM`. */
export function wpcExpiryMs(validEnd: string | null | undefined, now: number): number | null {
    const match = validEnd?.match(/(?:^|\D)(\d{2})(\d{2})(\d{2})(?:\D|$)/);
    return match ? parseDayHourMinute(Number(match[1]), Number(match[2]), Number(match[3]), now) : null;
}

/**
 * The SPC end time from a discussion's text: the end of "Valid 062115Z - 070015Z" (it carries the day), else
 * "Active Till 0015Z" (clock time only). Null when neither is there, which keeps the discussion on the map.
 */
export function spcExpiryMs(text: string | null | undefined, now: number): number | null {
    if (!text) return null;
    const valid = text.match(/Valid\s+\d{6}Z?\s*-\s*(\d{2})(\d{2})(\d{2})Z?/i);
    if (valid) return parseDayHourMinute(Number(valid[1]), Number(valid[2]), Number(valid[3]), now);
    const till = text.match(/Active\s+Till\s+(?:\d{2}\/)?(\d{2}):?(\d{2})\s*Z?/i);
    return till ? parseHourMinute(Number(till[1]), Number(till[2]), now) : null;
}

export function isExpired(expiresAt: number | null, now: number): boolean {
    return expiresAt !== null && expiresAt <= now;
}

/** A feature's end time: WPC features carry `validEnd`, SPC ones the end in their description text. */
export function discussionFeatureExpiryMs(feature: GeoJSON.Feature, now: number): number | null {
    const properties = feature.properties ?? {};
    if ('validEnd' in properties)
        return wpcExpiryMs(typeof properties.validEnd === 'string' ? properties.validEnd : null, now);
    return spcExpiryMs(String(properties.folderpath ?? properties.EXPIRE ?? ''), now);
}

/** The collection without discussions whose end time has passed. */
export function activeDiscussionFeatures(
    collection: GeoJSON.FeatureCollection,
    now = Date.now(),
): GeoJSON.FeatureCollection {
    const features = (collection.features ?? []).filter(
        (feature) => !isExpired(discussionFeatureExpiryMs(feature, now), now),
    );
    return features.length === collection.features?.length ? collection : { ...collection, features };
}

/** setTimeout stores its delay in 32 bits. */
const MAX_TIMER_MS = 2 ** 31 - 1;
/** Fires just after the end time, so `isExpired` is true by then. */
const EXPIRY_SLACK_MS = 1000;

/** Timer and clock functions `createExpiryWatch` uses. Pass fakes to drive it without real time. */
export interface ExpiryWatchClock {
    setTimeout: (callback: () => void, delayMs: number) => unknown;
    clearTimeout: (handle: unknown) => void;
    now: () => number;
}

/**
 * One timer for the earliest of a set of end times. `arm` replaces any earlier timer, so call it after each
 * draw with the end times now shown; `onExpire` should redraw (and arm again). Nothing runs while no end time is ahead.
 * `clock` defaults to the global timers and `Date.now`.
 */
export function createExpiryWatch(onExpire: () => void, clock: Partial<ExpiryWatchClock> = {}) {
    const schedule = clock.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    const cancel = clock.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const currentTime = clock.now ?? Date.now;
    let timer: unknown = null;
    const clear = () => {
        if (timer !== null) cancel(timer);
        timer = null;
    };
    const arm = (endTimes: Iterable<number | null | undefined>, now = currentTime()) => {
        clear();
        let next = Infinity;
        for (const end of endTimes) if (typeof end === 'number' && end > now && end < next) next = end;
        if (next === Infinity) return;
        timer = schedule(
            () => {
                timer = null;
                onExpire();
            },
            Math.min(next - now + EXPIRY_SLACK_MS, MAX_TIMER_MS),
        );
    };
    return { arm, clear };
}
