import type { NWSAlertFeature } from '@edgewarn/web-utils/net';

/** Short local date and time for an alert timestamp, e.g. "Oct 16, 3:05 PM CDT". */
export function formatAlertTime(iso: string): string {
    try {
        return new Date(iso).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
        });
    } catch {
        return iso;
    }
}

/** Time left until `iso` as "1d 2h 5m", "Expired", or the formatted time when unreadable. */
export function formatAlertTimeUntil(iso: string, now: number): string {
    const expiresAt = new Date(iso).getTime();
    if (!Number.isFinite(expiresAt)) {
        return formatAlertTime(iso);
    }

    const diffMs = expiresAt - now;
    if (diffMs <= 0) {
        return 'Expired';
    }

    const totalMinutes = Math.ceil(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];

    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

    return parts.join(' ');
}

/** Plain-text rendering of an alert, used for the "NWS text" view. */
export function formatNwsAlertText(feature: NWSAlertFeature): string {
    const props = feature.properties;
    return [
        `Event: ${props.event}`,
        `Severity: ${props.severity}`,
        `Effective: ${props.effective}`,
        `Expires: ${props.expires}`,
        props.areaDesc ? `Area: ${props.areaDesc}` : '',
        props.headline ? `\n${props.headline}` : '',
        props.description ? `\n${props.description}` : '',
        props.instruction ? `\nInstructions:\n${props.instruction}` : '',
    ].filter(Boolean).join('\n');
}
