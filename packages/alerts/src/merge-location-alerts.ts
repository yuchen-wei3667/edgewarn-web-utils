import type { NWSAlertFeature } from '@edgewarn/web-utils/net';
import { normalizeOfficialAlertId } from './alert-id.ts';

export function mergeLocationAlerts(snapshot: NWSAlertFeature[], point: NWSAlertFeature[]): NWSAlertFeature[] {
  const byId = new Map<string, NWSAlertFeature>();
  for (const feature of [...snapshot, ...point]) {
    const id = normalizeOfficialAlertId(feature.id || feature.properties?.id || '');
    if (id) byId.set(id, feature);
  }
  return [...byId.values()];
}
