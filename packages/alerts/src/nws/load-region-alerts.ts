import { loadSources, selectedSources } from './load-sources.ts';
import type { AlertLoaderOptions } from './load-sources.ts';
import { regionKind } from './alert-source.ts';
import type { AlertRegion } from './alert-source.ts';

export async function loadRegionAlerts(region: AlertRegion, options: AlertLoaderOptions = {}) {
  const kind = regionKind(region);
  const sources = selectedSources(options).filter(source => source.supportsRegion(kind));
  return loadSources(sources, source => source.forRegion(region, options.signal), options.signal);
}
