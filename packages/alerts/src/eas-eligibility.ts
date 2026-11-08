import type { NWSAlertFeature } from '@edgewarn/web-utils/net';
import { normalizeOfficialAlertId } from './alert-id.ts';
import { isDashboardTopBannerAlert } from './dashboard-significance.ts';

export function alertEASKey(alert: NWSAlertFeature): string {
    return `${normalizeOfficialAlertId(alert.id || alert.properties.id)}:${alert.properties.sent}`;
}

export function isEASVerificationCandidate(alert: NWSAlertFeature): boolean {
    // Special Weather Statements can share generic text with an EAS product,
    // and are not EAS activation alerts. Keep them in the dashboard hero but
    // out of product matching, playback, and EAS status.
    return (
        !/^special weather statement$/i.test(alert.properties.event.trim()) &&
        isDashboardTopBannerAlert(alert)
    );
}
