import type { NWSAlertFeature } from '@edgewarn/web-utils/net';

/** Retains popup order: select unplayed alerts through the first critical alert. */
/** @experimental Presentation policy; behavior may change in any release. */
export function selectAlertsToSound<
    T extends { alertId: string; isCritical: boolean; feature: NWSAlertFeature },
>(alerts: readonly T[], played: Pick<Set<string>, 'has'>): T[] {
    const selected: T[] = [];
    const seen = new Set<string>();
    for (const alert of alerts) {
        if (played.has(alert.alertId) || seen.has(alert.alertId)) continue;
        seen.add(alert.alertId);
        selected.push(alert);
        if (alert.isCritical) break;
    }
    return selected;
}
