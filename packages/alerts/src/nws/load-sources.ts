import type { EdgeWARNAPI, NWSAlertFeature, NWSAPI, WWAAPI } from '@edgewarn/web-utils/net';
import { normalizeOfficialAlertId } from '../alert-id.ts';
import { mergeLocationAlerts } from '../merge-location-alerts.ts';
import { sortDashboardAlerts } from '../dashboard-priority.ts';
import { createEdgeWARNAlertSource, createNWSAlertSource, createWWAAlertSource } from './alert-source.ts';
import type { AlertSource, AlertSourceId } from './alert-source.ts';

export interface AlertLoaderOptions {
    edgewarn?: EdgeWARNAPI;
    /** NWS client for the `nws` source (and WWA hydration). Defaults to a fresh client. */
    nws?: NWSAPI;
    /** WWA client for the `wwa` source. Defaults to a fresh client. */
    wwa?: WWAAPI;
    source?: AlertSourceId | AlertSourceId[];
    signal?: AbortSignal;
}

export function selectedSources(options: AlertLoaderOptions): AlertSource[] {
    const ids =
        options.source === undefined
            ? ['edgewarn', 'nws']
            : Array.isArray(options.source)
              ? options.source
              : [options.source];
    if (!ids.length || ids.some((id) => !['edgewarn', 'nws', 'wwa'].includes(id)))
        throw new Error('Invalid alert source selection');
    if (ids.includes('edgewarn') && !options.edgewarn)
        throw new Error('EdgeWARN source requires an API instance');
    return (['edgewarn', 'nws', 'wwa'] as const)
        .filter((id) => ids.includes(id))
        .map((id) => {
            if (id === 'edgewarn') return createEdgeWARNAlertSource(options.edgewarn!);
            return id === 'nws'
                ? createNWSAlertSource(options.nws)
                : createWWAAlertSource(options.wwa, options.nws);
        });
}

export async function loadSources(
    sources: AlertSource[],
    run: (source: AlertSource) => Promise<NWSAlertFeature[]>,
    signal?: AbortSignal,
): Promise<NWSAlertFeature[]> {
    if (!sources.length) throw new Error('No selected source supports this region type');
    signal?.throwIfAborted();
    const results = await Promise.allSettled(sources.map(run));
    signal?.throwIfAborted();
    if (results.every((r) => r.status === 'rejected'))
        throw new AggregateError(
            results.map((r) => (r.status === 'rejected' ? r.reason : undefined)),
            'No alert source is available',
        );
    // Filter duplicates before the historical last-wins helper so higher-priority
    // sources retain both their fields and their insertion order when sorting ties.
    const seen = new Set<string>();
    let merged: NWSAlertFeature[] = [];
    for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const unique = result.value.filter((feature) => {
            const id = normalizeOfficialAlertId(feature.id || feature.properties?.id || '');
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
        merged = mergeLocationAlerts(merged, unique);
    }
    return sortDashboardAlerts(merged);
}
