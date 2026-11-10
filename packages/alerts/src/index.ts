export type { NWSAlertProperties, NWSAlertFeature, NWSData } from './types.ts';
export type {
    SPCWatchType,
    SPCWatchProbabilities,
    SPCWatchAttributes,
    SPCWatchSourceUrls,
    SPCWatchDetails,
} from './spc-watch-types.ts';
export type {
    LocationAlert,
    LocationAlertFeatureInput,
    LocationAlertMinimumSeverity,
} from './location-alert-matching.ts';
export type { ParsedSevereHazards } from './severe-hazards.ts';
export { normalizeAlertId, normalizeOfficialAlertId, getFeatureAlertCacheKey } from './alert-id.ts';
export { normalizeAlertGeometry } from './alert-geometry.ts';
export { filterNwsAlerts } from './alert-filter.ts';
export { formatAlertTime, formatAlertTimeUntil, formatNwsAlertText } from './alert-format.ts';
export {
    alertPriorityRank,
    compareAlertPriority,
    mostUrgentAlertForHour,
    hasEASActivation,
    isSevereThunderstormWarning,
    isFlashFloodWarning,
} from './alert-priority.ts';
export { alertsForPeriod } from './alert-validity.ts';
export { CRITICAL_EVENTS, isCriticalAlertEvent } from './critical-events.ts';
export { isDashboardSignificantAlert, isDashboardTopBannerAlert } from './dashboard-significance.ts';
export { sortDashboardAlerts } from './dashboard-priority.ts';
export { hasEASActivationRequest } from './eas-phrase.ts';
export { findAlertsAtPoint } from './location-alert-matching.ts';
export { mergeLocationAlerts } from './merge-location-alerts.ts';
export { extractSevereHazards } from './severe-hazards.ts';
export { isSevereTabAlert } from './severe-scope.ts';
export { getSPCWatchTypeFromEvent, extractSpcWatchNumber } from './spc-watch.ts';
export {
    tornadoAlertText,
    isTornadoWarning,
    isTornadoEmergency,
    isPdsTornado,
    isConfirmedTornado,
} from './tornado-severity.ts';
export { alertMatchesFilter } from './alert-filter.ts';
export { alertEASKey, isEASVerificationCandidate } from './eas-eligibility.ts';
export { getDismissedAlerts, saveDismissedAlert } from './dismissals.ts';
export type { DismissalStorage, DismissedAlert } from './dismissals.ts';
export { selectAlertsToSound } from './sound-selection.ts';
export {
    isFlashFloodEmergency,
    hazardParts,
    hazardLine,
    warningCopy,
    heroTitleForAlert,
} from './warning-copy.ts';
export type { WarningCopy } from './warning-copy.ts';
export { hazardTypeForAlert } from './hazard-type.ts';
export type { HazardType } from './hazard-type.ts';
export { getEventColors } from './event-colors.ts';
export {
    wpcExpiryMs,
    spcExpiryMs,
    isExpired,
    discussionFeatureExpiryMs,
    activeDiscussionFeatures,
    createExpiryWatch,
} from './discussion-expiry.ts';
export type { ExpiryWatchClock } from './discussion-expiry.ts';
