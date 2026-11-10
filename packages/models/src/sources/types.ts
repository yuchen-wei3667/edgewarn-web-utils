import type { LevelReducer } from '../configs/types.ts';
import type { ModelFieldDef, ModelSelector } from '../catalog.ts';
import type { EnsembleProduct, ModelDataset, ModelId } from '../datasets.ts';
import type { ModelFieldRead } from '../field.ts';
import type { LevelGrid, ModelGrid } from '@edgewarn/web-utils/grib2';
import type { ModelFetcher } from './fetcher.ts';

/** One field at one valid time of one run: what an adapter is asked to read. */
export interface SourceReadRequest {
    dataset: ModelDataset;
    model: ModelId;
    product: EnsembleProduct;
    /** Ensemble member to read (0 = control); unset for deterministic models and published statistics. */
    member?: number;
    def: ModelFieldDef;
    /** The field's inputs for this model, in recipe order. */
    selectors: readonly ModelSelector[];
    initMs: number;
    /** Minutes since the cycle. */
    minutes: number;
    /** The file index (forecast hour, or sub-hourly file number) holding that valid time. */
    step: number;
    /** Which level of detail to decode each input at (0 when the recipe needs full resolution first). */
    level: number;
    reducer: LevelReducer;
}

export interface SourceContext {
    fetcher: ModelFetcher;
    /** Throws when the job was cancelled. */
    check: () => void;
    onLoading?: (message: string) => void;
}

export interface SourceInputs {
    /** The grid the inputs were decoded on, to check against the declared one. */
    grid: ModelGrid;
    /** One level grid per input (more than one per selector for `sum-window`), float16, in scan order. */
    levels: LevelGrid[];
    reads: ModelFieldRead[];
    /** Bytes that came over the network (cache hits are not counted). */
    fetched: number;
}

/**
 * The format-specific half of a decode job: locate a field's data in the source, read it through the
 * shared fetcher and decode it to level grids. Throws `ModelMissing` when a component is absent. The recipe,
 * decimation and tiling that follow are the same for every source.
 */
export interface SourceAdapter {
    readInputs(req: SourceReadRequest, ctx: SourceContext): Promise<SourceInputs>;
}
