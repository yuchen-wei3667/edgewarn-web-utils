import type { Geometry } from 'geojson';
import { fetchWithTimeout } from '../fetch-with-timeout.ts';
import { nwsHeaders } from '../nws/api.ts';

export type AlertBoundingBox = [west: number, south: number, east: number, north: number];
export interface WWAFeature {
  type: 'Feature';
  geometry: Geometry | null;
  properties: { cap_id: string; phenom?: string; sig?: string; wfo?: string };
}
export interface WWAResponse { type: 'FeatureCollection'; features: WWAFeature[]; exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean } }
export function validateAlertPoint(point: { lat: number; lon: number }): void {
  if (!Number.isFinite(point.lat) || Math.abs(point.lat) > 90 || !Number.isFinite(point.lon) || Math.abs(point.lon) > 180) throw new Error('Invalid alert point');
}
export function validateAlertBoundingBox(box: AlertBoundingBox): void {
  if (!Array.isArray(box) || box.length !== 4 || box.some(v => !Number.isFinite(v)) || box[0] < -180 || box[2] > 180 || box[1] < -90 || box[3] > 90 || box[0] > box[2] || box[1] > box[3]) throw new Error('Invalid alert bounding box');
}

/** Fixed NOAA polygon service. Hydration belongs to the alerts domain. */
export class WWAAPI {
  private static async query(parameters: Record<string, string>, signal?: AbortSignal): Promise<WWAResponse> {
    const query = new URLSearchParams({ f: 'geojson', outFields: 'phenom,sig,wfo,cap_id', returnGeometry: 'true', inSR: '4326', ...parameters });
    const response = await fetchWithTimeout(`https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query?${query}`, { headers: nwsHeaders(), signal });
    if (!response.ok) throw new Error(`WWA request failed (${response.status})`);
    const result = await response.json() as WWAResponse;
    if (result.exceededTransferLimit || result.properties?.exceededTransferLimit) throw new Error('WWA response exceeded transfer limit');
    if (!Array.isArray(result.features)) throw new Error('Invalid WWA response');
    return result;
  }
  static async getAlerts(lat: number, lon: number, signal?: AbortSignal): Promise<WWAResponse> {
    validateAlertPoint({ lat, lon });
    return this.query({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', spatialRel: 'esriSpatialRelIntersects' }, signal);
  }
  static async getRegionAlerts(region: { wfo: string[] } | { bbox: AlertBoundingBox }, signal?: AbortSignal): Promise<WWAResponse> {
    if (Object.keys(region).length !== 1) throw new Error('unsupported region type');
    if ('bbox' in region) {
      validateAlertBoundingBox(region.bbox);
      return this.query({ geometry: region.bbox.join(','), geometryType: 'esriGeometryEnvelope', spatialRel: 'esriSpatialRelIntersects' }, signal);
    }
    if (!('wfo' in region)) throw new Error('unsupported region type');
    if (!Array.isArray(region.wfo) || !region.wfo.length || region.wfo.some(v => typeof v !== 'string' || !/^[A-Z]{4}$/.test(v))) throw new Error('Invalid WFO code');
    return this.query({ where: `wfo IN (${region.wfo.map(v => `'${v}'`).join(',')})` }, signal);
  }
}
