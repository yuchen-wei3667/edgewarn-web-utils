import type { NWSAlertFeature } from '@edgewarn/web-utils/net';
import type { SPCWatchType } from './spc-watch-types.ts';

const WATCH_EVENT_TYPE_MAP: Record<string, SPCWatchType> = {
    'Severe Thunderstorm Watch': 'Severe Thunderstorm',
    'Tornado Watch': 'Tornado',
};

const WATCH_NUMBER_REGEX = /(SEVERE THUNDERSTORM|TORNADO)\s+WATCH(?:\s+NUMBER)?\s+(\d{1,4})/gi;

function normalizeAlertText(value?: string | null): string {
    return value?.replace(/\s+/g, ' ').trim().toUpperCase() ?? '';
}

export function getSPCWatchTypeFromEvent(event?: string | null): SPCWatchType {
    if (!event) {
        return 'Unknown';
    }

    return WATCH_EVENT_TYPE_MAP[event] ?? 'Unknown';
}

export function extractSpcWatchNumber(feature: NWSAlertFeature): number | null {
    const expectedType = getSPCWatchTypeFromEvent(feature.properties.event);
    if (expectedType === 'Unknown') {
        return null;
    }

    const searchText = [
        feature.properties.description,
        feature.properties.headline,
        feature.properties.instruction,
    ]
        .map(normalizeAlertText)
        .filter(Boolean)
        .join(' ');

    for (const match of searchText.matchAll(WATCH_NUMBER_REGEX)) {
        const matchedType = match[1] === 'SEVERE THUNDERSTORM' ? 'Severe Thunderstorm' : 'Tornado';
        if (matchedType !== expectedType) {
            continue;
        }

        const watchNumber = Number.parseInt(match[2], 10);
        if (!Number.isNaN(watchNumber) && watchNumber >= 1 && watchNumber <= 9999) {
            return watchNumber;
        }
    }

    return null;
}
