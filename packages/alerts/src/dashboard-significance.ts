import type { NWSAlertFeature } from '@edgewarn/web-utils/net';

export function isDashboardSignificantAlert(alert: NWSAlertFeature) {
  const event = alert.properties.event.trim();
  if (event.toLowerCase() === 'strong thunderstorm') return false;
  if (/^flash flood warning$/i.test(event)) return true;
  if (/\b(tornado|severe thunderstorm|thunderstorm|tropical|hurricane|typhoon|cyclone)\b.*\b(watch|warning)\b/i.test(event)) return true;
  if (/\b(watch|warning)\b.*\b(tornado|severe thunderstorm|thunderstorm|tropical|hurricane|typhoon|cyclone)\b/i.test(event)) return true;
  if (/^special weather statement$/i.test(event)) return true;
  return /^marine weather statement$|^special marine warning$/i.test(event);
}

export function isDashboardTopBannerAlert(alert: NWSAlertFeature) {
  const event = alert.properties.event.trim();
  if (/^special weather statement$/i.test(event)
    && /\bthunderstorms?\b/i.test([
      alert.properties.headline,
      alert.properties.description,
      alert.properties.instruction,
    ].filter(Boolean).join(' '))) return true;
  return /^flash flood warning$/i.test(alert.properties.event.trim())
    || /\b(tornado|thunderstorm|tropical storm|hurricane|typhoon|tropical cyclone)\b.*\bwarning\b/i.test(alert.properties.event)
    || /\bwarning\b.*\b(tornado|thunderstorm|tropical storm|hurricane|typhoon|tropical cyclone)\b/i.test(alert.properties.event);
}
