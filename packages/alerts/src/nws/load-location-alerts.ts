import { loadSources, selectedSources } from './load-sources.ts';
import type { AlertLoaderOptions } from './load-sources.ts';
import { validatePoint } from './region-geometry.ts';

export async function loadLocationAlerts(
    location: { lat: number; lon: number },
    options: AlertLoaderOptions = {},
) {
    validatePoint(location);
    return loadSources(
        selectedSources(options),
        (source) => source.forPoint(location, options.signal),
        options.signal,
    );
}
