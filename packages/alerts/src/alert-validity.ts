import type { NWSAlertFeature } from '@edgewarn/web-utils/net';
import { compareAlertPriority } from './alert-priority.ts';

function alertValidity(alert: NWSAlertFeature, now: number): { start: number; end: number } | null {
    const p = alert.properties;
    if (
        p.status !== 'Actual' ||
        !['Alert', 'Update'].includes(p.messageType) ||
        /test message/i.test(p.event)
    )
        return null;
    const sent = Date.parse(p.sent),
        expires = Date.parse(p.expires);
    if (!Number.isFinite(sent) || sent > now || !Number.isFinite(expires) || expires <= now) return null;
    const onset = Date.parse(p.onset),
        effective = Date.parse(p.effective),
        ends = Date.parse(p.ends);
    const start = Number.isFinite(onset) ? onset : effective;
    const end = Number.isFinite(ends) ? Math.min(ends, expires) : expires;
    return Number.isFinite(start) && end > start && end > now ? { start, end } : null;
}

export function alertsForPeriod(
    alerts: NWSAlertFeature[] | undefined,
    start: number,
    end: number,
    now: number,
): NWSAlertFeature[] {
    return (alerts ?? [])
        .filter((alert) => {
            const validity = alertValidity(alert, now);
            return validity && validity.start < end && validity.end > Math.max(start, now);
        })
        .sort(compareAlertPriority);
}
