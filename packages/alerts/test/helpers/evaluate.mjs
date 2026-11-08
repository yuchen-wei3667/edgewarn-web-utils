// Evaluate every P0 root export on fixed inputs.
export function evaluate(a, fixtures) {
  const { alerts, ids, now } = fixtures;
  const names = ['alertPriorityRank', 'hasEASActivation', 'isSevereThunderstormWarning',
    'isFlashFloodWarning', 'isDashboardSignificantAlert', 'isDashboardTopBannerAlert',
    'isSevereTabAlert', 'extractSevereHazards', 'extractSpcWatchNumber', 'tornadoAlertText',
    'isTornadoWarning', 'isTornadoEmergency', 'isPdsTornado', 'isConfirmedTornado',
    'normalizeAlertGeometry', 'getFeatureAlertCacheKey', 'formatNwsAlertText'];
  const keys = list => list.map(f => f.id);
  return {
    ids: ids.map(id => [a.normalizeAlertId(id), a.normalizeOfficialAlertId(id),
      a.getFeatureAlertCacheKey({ id, properties: { id: 'fallback' } })]),
    features: alerts.map(f => Object.fromEntries(names.map(name => [name, a[name](f)]))),
    events: alerts.map(f => [a.isCriticalAlertEvent(f.properties.event),
      a.getSPCWatchTypeFromEvent(f.properties.event), a.hasEASActivationRequest(f.properties.description)]),
    critical: [...a.CRITICAL_EVENTS],
    comparisons: alerts.map(x => alerts.map(y => a.compareAlertPriority(x, y))),
    priority: keys([...alerts].sort(a.compareAlertPriority)),
    dashboard: keys(a.sortDashboardAlerts(alerts)),
    periods: [-2, 0, 1, 3, 6].map(h => {
      const t = now + h * 3600000;
      return [keys(a.alertsForPeriod(alerts, t, t + 3600000, now)), a.mostUrgentAlertForHour(alerts, t)?.id ?? null];
    }),
    locations: [[31,-99],[35,-95],[33,-97],[30,-100],[0,0]].map(([lat,lon]) =>
      ['Unknown','Minor','Moderate','Severe','Extreme'].map(min =>
        a.findAlertsAtPoint(lat,lon,alerts,min).map(x => [x.feature.id,x.isCritical]))),
    filters: ['All','Severe','Unknown'].map(severity => ['All','Tornado Warning','missing'].map(event => keys(a.filterNwsAlerts(alerts,severity,event)))),
    merge: a.mergeLocationAlerts(ids.map(id => ({id,properties:{id},marker:'snapshot'})),
      [{id:'abc',properties:{id:'abc'},marker:'point'}]),
    format: alerts.map(f => a.formatAlertTimeUntil(f.properties.expires,now)),
    invalidTime: a.formatAlertTime('invalid'),
  };
}
