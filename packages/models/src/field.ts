import type { ModelDataSource, ValueTransform } from './configs/types.ts';
import type { EnsembleProduct, ModelId } from './datasets.ts';
import type { ExceedThreshold } from './ensemble.ts';
import type { ModelGrid } from '@edgewarn/web-utils/grib2';

/**
 * What a decoded frame is, the same for every source format: the generic atmospheric field of the
 * model-viewer plan. The tiles stay float16 arrays; this describes them and travels with them.
 */

/** Where in the vertical the field's inputs sit, read from the level text of its first selector. */
export interface ModelFieldVertical {
    kind: 'surface' | 'height-agl' | 'pressure' | 'layer' | 'column' | 'other';
    value?: number;
    units?: 'm' | 'hPa';
}

/** One byte range read to make the frame. */
export interface ModelFieldRead {
    url: string;
    start: number;
    end: number | null;
}

export interface ModelFieldFrame {
    compare?: import('./compare/types.ts').ComparisonFrameInfo;
    model: ModelId;
    product: EnsembleProduct;
    fieldId: string;
    /** Run (init) time and valid time, ms since the epoch. */
    initMs: number;
    validMs: number;
    /** The declared grid the tiles are on; the decoded one was checked against it. A moving-grid dataset's frame carries the decoded grid instead, corner and all. */
    grid: ModelGrid;
    projectionKey: string;
    vertical: ModelFieldVertical;
    /** Units of the stored values, and how stored values become display values (MSLP is stored as hPa - 1000). */
    units: string;
    display?: ValueTransform;
    /** Missing values are float16 NaN in every source format. */
    missing: 'nan';
    /** Set on ensemble products; `membersUsed < membersExpected` means the result is incomplete. */
    ensemble?: {
        product: EnsembleProduct;
        member?: number;
        membersUsed: number;
        membersExpected: number;
        threshold?: ExceedThreshold;
    };
    /** Reference period used by climatologically normalized ensemble products. */
    normalization?: { method: 'trailing-30-run-mean'; runsUsed: number; runsExpected: number };
    provenance: {
        source: ModelDataSource['kind'];
        /** The objects and byte ranges read, so a frame can be reproduced. */
        reads: readonly ModelFieldRead[];
        /** Set when the bytes are a third party's post-processed copy of the producer's output. */
        derivedFrom?: string;
    };
}

/** Classify a selector's level text (`500 mb`, `2 m above ground`, `0-3000 m above ground`, `surface`...). */
export function verticalOf(level: string): ModelFieldVertical {
    if (level === 'surface') return { kind: 'surface' };
    if (level.startsWith('entire atmosphere')) return { kind: 'column' };
    const pressure = /^(\d+(?:\.\d+)?) mb$/.exec(level);
    if (pressure) return { kind: 'pressure', value: Number(pressure[1]), units: 'hPa' };
    const height = /^(\d+(?:\.\d+)?) m above ground$/.exec(level);
    if (height) return { kind: 'height-agl', value: Number(height[1]), units: 'm' };
    if (/^\d+-\d+ (m above ground|mb above ground)$/.test(level)) return { kind: 'layer' };
    return { kind: 'other' };
}
