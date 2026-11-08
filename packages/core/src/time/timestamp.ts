/**
 * Timestamp utilities for parsing and formatting EdgeWARN timestamps
 * Supported formats:
 * - YYYYMMDD-HHMMSS
 * - YYYY.MM.DD.HH.MM.SS
 */

interface TimestampStr {
    date: string;
    time: string;
}

/**
 * Parse a timestamp string into a Date object
 * @param ts - Timestamp string in a supported format
 * @returns Date object or null if invalid
 */
function parseTimestamp(ts: string): Date | null {
    const trimmed = ts.trim();
    const match = trimmed.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
        ?? trimmed.match(/^(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})$/);
    if (!match) return null;
    return new Date(
        parseInt(match[1]),
        parseInt(match[2]) - 1,
        parseInt(match[3]),
        parseInt(match[4]),
        parseInt(match[5]),
        parseInt(match[6])
    );
}

/** Parse an EdgeWARN timestamp as UTC. */
export function parseTimestampUTC(ts: string): Date | null {
    const trimmed = ts.trim();
    const match = trimmed.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
        ?? trimmed.match(/^(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})$/);
    if (!match) return null;
    return new Date(Date.UTC(
        parseInt(match[1]),
        parseInt(match[2]) - 1,
        parseInt(match[3]),
        parseInt(match[4]),
        parseInt(match[5]),
        parseInt(match[6]),
    ));
}

/**
 * Format a timestamp string into human-readable date and time
 * @param ts - Timestamp string in a supported format
 * @returns Object with formatted date (YYYY-MM-DD) and time (HH:MM)
 */
export function formatTimeLabel(ts: string): TimestampStr {
    const match = ts.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/)
        ?? ts.match(/(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})/);
    if (!match) return { date: ts, time: '' };
    return {
        date: `${match[1]}-${match[2]}-${match[3]}`,
        time: `${match[4]}:${match[5]}`
    };
}

/**
 * Find the closest timestamp in a list to a target timestamp
 * @param targetTs - Target timestamp in YYYYMMDD-HHMMSS format
 * @param candidates - Array of candidate timestamps
 * @param toleranceMs - Maximum difference in milliseconds (default: 10 minutes)
 * @returns Closest timestamp or null if none within tolerance
 */
export function findClosestTimestamp(
    targetTs: string,
    candidates: string[],
    toleranceMs: number = 600000
): string | null {
    if (!candidates || candidates.length === 0) return null;

    const targetDate = parseTimestamp(targetTs);
    if (!targetDate) return null;
    targetDate.setSeconds(0, 0);

    let closest: string | null = null;
    let minDiff = Infinity;

    for (const cand of candidates) {
        const candDate = parseTimestamp(cand);
        if (!candDate) continue;
        candDate.setSeconds(0, 0);

        const diff = Math.abs(candDate.getTime() - targetDate.getTime());
        if (diff < minDiff) {
            minDiff = diff;
            closest = cand;
        }
    }

    if (minDiff > toleranceMs) return null;
    return closest;
}

/**
 * Format a relative expiry countdown, e.g. "Expires in 45 min" or
 * "Expires in 2 hr 15 min". Returns "Expiration unavailable" when the value
 * can't be parsed and "Expired" once the time has passed.
 */
export function formatExpiresIn(
    value: string | number | Date | null | undefined,
    nowMs: number = Date.now(),
): string {
    if (value === null || value === undefined || value === '') return 'Expiration unavailable';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Expiration unavailable';
    const diffMs = date.getTime() - nowMs;
    if (diffMs <= 0) return 'Expired';
    const totalMinutes = Math.floor(diffMs / 60_000);
    if (totalMinutes < 60) return `Expires in ${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours < 48) return minutes ? `Expires in ${hours} hr ${minutes} min` : `Expires in ${hours} hr`;
    const days = Math.floor(hours / 24);
    return `Expires in ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Format a date value as a short UTC string, e.g. "Jun 19, 14:30 UTC".
 * Returns the original string (or "Unknown") when the value can't be parsed.
 * @param value Date-parseable string, Date, or number.
 * @param withYear Include the year (used by SPC outlooks).
 */
export function formatDateUTC(
    value: string | number | Date | null | undefined,
    withYear = false
): string {
    if (value === null || value === undefined || value === '') return 'Unknown';

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return typeof value === 'string' ? value : 'Unknown';
    }

    return `${date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(withYear ? { year: 'numeric' as const } : {}),
        hour: 'numeric',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
    })} UTC`;
}

/**
 * The `YYYYMMDD-HHMMSS` timestamp rounded to the nearest whole hour. Layers that change at most
 * hourly use it so stepping through 2-minute frames does not reload them.
 */
export function roundTimestampToHour(ts: string | null): string | null {
    if (!ts) return null;
    const date = parseTimestampUTC(ts);
    if (!date) return ts;
    const hour = 3_600_000;
    const rounded = new Date(Math.round(date.getTime() / hour) * hour);
    return rounded.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/** Strict `YYYYMMDD-HHMMSS` (UTC) <-> epoch ms, shared by the bucket stacks. Imports nothing. */

const TIMESTAMP_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** Epoch ms of a `YYYYMMDD-HHMMSS` UTC timestamp, or null when it is not one. */
export function timestampToMs(ts: string): number | null {
    const m = TIMESTAMP_RE.exec(ts);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** `YYYYMMDD-HHMMSS` (UTC) of an epoch ms. */
export function msToTimestamp(ms: number): string {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
