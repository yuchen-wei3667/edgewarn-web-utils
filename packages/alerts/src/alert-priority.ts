import type { NWSAlertFeature } from '@edgewarn/web-utils/net';
import { isFlashFloodEmergency } from './warning-copy.ts';
import { hasEASActivationRequest } from './eas-phrase.ts';
import {
  isConfirmedTornado,
  isPdsTornado,
  isTornadoEmergency,
  isTornadoWarning,
  tornadoAlertText,
} from './tornado-severity.ts';

export function isSevereThunderstormWarning(alert: NWSAlertFeature): boolean {
  return /^severe thunderstorm warning$/i.test((alert.properties.event || '').trim());
}

export function isFlashFloodWarning(alert: NWSAlertFeature): boolean {
  return /^flash flood warning$/i.test((alert.properties.event || '').trim());
}

/** Synchronous EAS check against the alert text shipped with the feature. */
export function hasEASActivation(alert: NWSAlertFeature): boolean {
  return hasEASActivationRequest(alert.properties.description || '');
}

// EAS-activated alerts sort ahead of everything else while keeping their
// relative tornado → severe thunderstorm → flash flood order.
const EAS_PRIORITY_BOOST = 100;

const SEVERITY_ORDER = ['extreme', 'severe', 'moderate', 'minor'];

/**
 * Lower rank wins. Order: tornado (emergency → PDS → confirmed → indicated),
 * severe thunderstorm (destructive → standard), flash flood (emergency →
 * warning), other destructive alerts, then everything else. Alerts carrying
 * an EAS activation request outrank non-EAS alerts in the same order.
 */
export function alertPriorityRank(alert: NWSAlertFeature): number {
  let rank: number;
  if (isTornadoWarning(alert)) {
    if (isTornadoEmergency(alert)) rank = 0;
    else if (isPdsTornado(alert)) rank = 1;
    else if (isConfirmedTornado(alert)) rank = 2;
    else rank = 3;
  } else if (isSevereThunderstormWarning(alert)) {
    rank = /destructive/i.test(tornadoAlertText(alert)) ? 4 : 5;
  } else if (isFlashFloodWarning(alert)) {
    rank = isFlashFloodEmergency(alert) ? 6 : 7;
  } else if (/destructive/i.test(tornadoAlertText(alert))) {
    rank = 8;
  } else {
    rank = 9;
  }
  return hasEASActivation(alert) ? rank - EAS_PRIORITY_BOOST : rank;
}

/**
 * Full ordering: event rank first, then severity (Extreme first), then
 * warnings before watches. The last two only break ties — e.g. a Severe
 * Flood Warning outranks a Severe Flood Watch, but event rank still
 * decides across tiers.
 */
export function compareAlertPriority(a: NWSAlertFeature, b: NWSAlertFeature): number {
  return (
    alertPriorityRank(a) - alertPriorityRank(b) ||
    severityRank(a) - severityRank(b) ||
    warningWatchRank(a) - warningWatchRank(b)
  );
}

/** Lower wins: Extreme → Severe → Moderate → Minor → Unknown. */
function severityRank(alert: NWSAlertFeature): number {
  const index = SEVERITY_ORDER.indexOf((alert.properties.severity || '').trim().toLowerCase());
  return index === -1 ? SEVERITY_ORDER.length : index;
}

/**
 * Lower wins: warnings before watches before everything else
 * (advisories, statements, etc.). Only reached when event rank and
 * severity already tie.
 */
function warningWatchRank(alert: NWSAlertFeature): number {
  const event = (alert.properties.event || '').toLowerCase();
  if (/\bwarning\b/.test(event)) return 0;
  if (/\bwatch\b/.test(event)) return 1;
  return 2;
}

const HOUR_MS = 3_600_000;

/**
 * Most urgent alert overlapping the hour starting at `hourMs`, if any.
 * An alert covers the hour when its [effective, expires) window intersects
 * [hourMs, hourMs + 1h). Alerts with an unknown start count while unexpired.
 */
export function mostUrgentAlertForHour(alerts: NWSAlertFeature[] | undefined, hourMs: number): NWSAlertFeature | null {
  if (!alerts) return null;
  let top: NWSAlertFeature | null = null;
  for (const alert of alerts) {
    const start = Date.parse(alert.properties.effective || alert.properties.sent);
    const end = Date.parse(alert.properties.expires);
    if (!Number.isFinite(end) || end <= hourMs) continue;
    if (Number.isFinite(start) && start >= hourMs + HOUR_MS) continue;
    if (!top || compareAlertPriority(alert, top) < 0) top = alert;
  }
  return top;
}
