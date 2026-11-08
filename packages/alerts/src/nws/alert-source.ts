import { NWSAPI, WWAAPI } from '@edgewarn/web-utils/net';
import type { EdgeWARNAPI, NWSAlertFeature, NWSAlertRegion, WWAFeature } from '@edgewarn/web-utils/net';
import { findAlertsAtPoint } from '../location-alert-matching.ts';
import { normalizeOfficialAlertId } from '../alert-id.ts';
import { normalizeAlertGeometry } from '../alert-geometry.ts';
import { geometryIntersectsBox, validateBox, validatePoint } from './region-geometry.ts';
import type { AlertBoundingBox } from './region-geometry.ts';

export type AlertSourceId = 'edgewarn' | 'nws' | 'wwa';
export type AlertRegion = NWSAlertRegion | { wfo: string[] } | { bbox: AlertBoundingBox };
export type AlertRegionKind = 'area' | 'region' | 'zone' | 'wfo' | 'bbox';
export interface AlertSource {
  readonly id: AlertSourceId;
  supportsRegion(kind: AlertRegionKind): boolean;
  forPoint(point: { lat: number; lon: number }, signal?: AbortSignal): Promise<NWSAlertFeature[]>;
  forRegion(region: AlertRegion, signal?: AbortSignal): Promise<NWSAlertFeature[]>;
}

export function regionKind(region: AlertRegion): AlertRegionKind {
  const keys = Object.keys(region);
  if (keys.length !== 1 || !['area', 'region', 'zone', 'wfo', 'bbox'].includes(keys[0])) throw new Error('unsupported region type');
  const kind = keys[0] as AlertRegionKind;
  if ('bbox' in region) validateBox(region.bbox);
  else {
    const values = Object.values(region)[0] as string[];
    if (!Array.isArray(values) || !values.length || values.some(v => typeof v !== 'string' || !v.trim())) throw new Error('Region requires non-empty codes');
    if ('wfo' in region && values.some(v => !/^[A-Z]{4}$/.test(v))) throw new Error('Invalid WFO code');
  }
  return kind;
}

async function batches<T, R>(items: T[], convert: (item: T) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += 8) {
    signal?.throwIfAborted();
    results.push(...await Promise.all(items.slice(i, i + 8).map(convert)));
  }
  signal?.throwIfAborted();
  return results;
}

export function createEdgeWARNAlertSource(api: EdgeWARNAPI): AlertSource {
  async function snapshot(signal?: AbortSignal): Promise<NWSAlertFeature[]> {
    signal?.throwIfAborted();
    const timestamps = await api.fetchNWSTimestamps({ signal });
    const latest = [...timestamps].sort().at(-1);
    if (!latest) throw new Error('No alert snapshot is available');
    return api.fetchNWSAlertList(latest, { signal });
  }
  return {
    id: 'edgewarn',
    supportsRegion: kind => kind === 'bbox',
    async forPoint(point, signal) {
      validatePoint(point);
      const list = await snapshot(signal);
      const candidates = findAlertsAtPoint(point.lat, point.lon, list).map(item => item.feature);
      return batches(candidates, async feature => {
        const id = normalizeOfficialAlertId(feature.id || feature.properties?.id || '');
        if (!id) return feature;
        return (await api.downloadNWSAlert(id, { signal })) ?? feature;
      }, signal);
    },
    async forRegion(region, signal) {
      regionKind(region);
      if (!('bbox' in region)) throw new Error('unsupported region type');
      return (await snapshot(signal)).filter(f => geometryIntersectsBox(normalizeAlertGeometry(f), region.bbox));
    },
  };
}

export function createNWSAlertSource(): AlertSource {
  return {
    id: 'nws',
    supportsRegion: kind => ['area', 'region', 'zone'].includes(kind),
    async forPoint(point, signal) {
      validatePoint(point);
      return (await NWSAPI.getAlerts<{ features: NWSAlertFeature[] }>(point.lat, point.lon, signal)).features ?? [];
    },
    async forRegion(region, signal) {
      regionKind(region);
      if (!('area' in region || 'region' in region || 'zone' in region)) throw new Error('unsupported region type');
      return (await NWSAPI.getRegionAlerts<{ features: NWSAlertFeature[] }>(region, signal)).features ?? [];
    },
  };
}

export function createWWAAlertSource(): AlertSource {
  async function hydrate(candidates: WWAFeature[], signal?: AbortSignal): Promise<NWSAlertFeature[]> {
    const results = await batches(candidates, async candidate => {
      try {
        const feature = await NWSAPI.getAlertById(candidate.properties.cap_id, signal);
        if (feature?.type !== 'Feature' || typeof feature.id !== 'string' || !feature.id || !feature.properties
          || typeof feature.properties.event !== 'string'
          || !['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'].includes(feature.properties.severity)) {
          throw new Error('Invalid hydrated NWS alert');
        }
        return feature.geometry ? feature : { ...feature, geometry: candidate.geometry };
      } catch {
        signal?.throwIfAborted();
        return null;
      }
    }, signal);
    const features = results.filter((f): f is NWSAlertFeature => f !== null);
    if (candidates.length && !features.length) throw new Error('All WWA alert hydration failed');
    return features;
  }
  return {
    id: 'wwa',
    supportsRegion: kind => kind === 'wfo' || kind === 'bbox',
    async forPoint(point, signal) {
      return hydrate((await WWAAPI.getAlerts(point.lat, point.lon, signal)).features, signal);
    },
    async forRegion(region, signal) {
      regionKind(region);
      if (!('wfo' in region || 'bbox' in region)) throw new Error('unsupported region type');
      return hydrate((await WWAAPI.getRegionAlerts(region, signal)).features, signal);
    },
  };
}
