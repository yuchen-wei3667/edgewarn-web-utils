/**
 * Shared list of event types that should be treated as critical alerts.
 */
export const CRITICAL_EVENTS = new Set([
    'Tornado Warning',
    'Severe Thunderstorm Warning',
    'Flash Flood Warning',
]);

export function isCriticalAlertEvent(eventType: string): boolean {
    return CRITICAL_EVENTS.has(eventType);
}
