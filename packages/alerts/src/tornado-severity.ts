import type { NWSAlertFeature } from '@edgewarn/web-utils/net';
import { extractSevereHazards } from './severe-hazards.ts';

export function tornadoAlertText(alert: NWSAlertFeature): string {
  return `${alert.properties.headline || ''}\n${alert.properties.description || ''}\n${alert.properties.instruction || ''}`;
}

export function isTornadoWarning(alert: NWSAlertFeature): boolean {
  return /^tornado warning$/i.test((alert.properties.event || '').trim());
}

export function isTornadoEmergency(alert: NWSAlertFeature): boolean {
  return /tornado emergency/i.test(tornadoAlertText(alert));
}

export function isPdsTornado(alert: NWSAlertFeature): boolean {
  return /particularly dangerous situation/i.test(tornadoAlertText(alert));
}

export function isConfirmedTornado(alert: NWSAlertFeature): boolean {
  return extractSevereHazards(alert).tornadoConfirmation === 'confirmed';
}
