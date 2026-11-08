import type { NWSAlertFeature } from '@edgewarn/web-utils/net';

export function alertMatchesFilter(alert: NWSAlertFeature, severity: string, eventType: string): boolean {
    return (
        (severity === 'All' || (alert.properties.severity || 'Unknown') === severity) &&
        (eventType === 'All' || alert.properties.event === eventType)
    );
}

/** Shared predicate for active-alert lists and map rendering. */
export function filterNwsAlerts(
    alerts: NWSAlertFeature[],
    severity: string,
    eventType: string,
): NWSAlertFeature[] {
    return alerts.filter((alert) => alertMatchesFilter(alert, severity, eventType));
}
