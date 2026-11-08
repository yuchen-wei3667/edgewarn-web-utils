import type { Cell } from './types.ts';

function toCellArray(value: unknown): Cell[] {
    if (Array.isArray(value)) {
        return value as Cell[];
    }

    if (value && typeof value === 'object') {
        return Object.values(value) as Cell[];
    }

    return [];
}

/**
 * Normalize different EdgeWARN stormcell response shapes into a flat array.
 */
export function normalizeStormcellFeatures(payload: unknown): Cell[] {
    if (Array.isArray(payload)) {
        return payload as Cell[];
    }

    if (!payload || typeof payload !== 'object') {
        return [];
    }

    const data = payload as {
        content?: { features?: unknown };
        features?: unknown;
        cells?: unknown;
    };

    // Storm snapshots nest the collection one level deeper:
    // `{ cells: { ..., features: [...] } }`.
    if (data.cells !== undefined) {
        if (Array.isArray(data.cells)) {
            return data.cells as Cell[];
        }
        if (data.cells && typeof data.cells === 'object') {
            const inner = data.cells as { features?: unknown };
            if (inner.features !== undefined) {
                return toCellArray(inner.features);
            }
            return toCellArray(data.cells);
        }
    }

    if (data.content?.features !== undefined) {
        return toCellArray(data.content.features);
    }

    if (data.features !== undefined) {
        return toCellArray(data.features);
    }

    return [];
}
