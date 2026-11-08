import type { NWSAlertFeature } from '@edgewarn/web-utils/net';

const EVENT_PRIORITY: Record<string, number> = {
  'Tornado Warning': 100,
  'Extreme Wind Warning': 95,
  'Flash Flood Warning': 90,
  'Severe Thunderstorm Warning': 85,
  'Snow Squall Warning': 80,
};

const SEVERITY_PRIORITY: Record<string, number> = {
  Extreme: 40,
  Severe: 30,
  Moderate: 20,
  Minor: 10,
  Unknown: 0,
};

function alertPriority(feature: NWSAlertFeature): number {
  const event = feature.properties.event || '';
  const eventType = /warning/i.test(event) ? 30 : /watch/i.test(event) ? 20 : /advisory/i.test(event) ? 10 : 0;
  return (EVENT_PRIORITY[event] ?? eventType) + (SEVERITY_PRIORITY[feature.properties.severity] ?? 0);
}

export function sortDashboardAlerts(features: NWSAlertFeature[]): NWSAlertFeature[] {
  return [...features].sort((a, b) => {
    const priority = alertPriority(b) - alertPriority(a);
    if (priority) return priority;
    return Date.parse(a.properties.expires || '') - Date.parse(b.properties.expires || '');
  });
}
