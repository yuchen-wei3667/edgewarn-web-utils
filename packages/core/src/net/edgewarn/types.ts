export interface Cell {
    id: number | string;
    /** UTC observation time supplied by the per-cell history resource. */
    timestamp?: string | number;
    bbox: number[][];
    properties: Record<string, unknown>;
    modules?: Record<string, unknown>;
    /**
     * NWS alert references attached to this cell snapshot entry
     * (`alerts` key of cell and storm snapshot
     * entries). Entries may be alert ID strings or alert objects.
     */
    alerts?: unknown;
}

export interface StormCellList {
    type: string;
    features: Cell[];
    content?: { features: Cell[] };
}
