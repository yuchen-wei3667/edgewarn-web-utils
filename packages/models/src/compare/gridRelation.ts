import { getDataset, type ModelId } from '../datasets.ts';
import type { ModelGrid } from '@edgewarn/web-utils/grib2';
import { gridMismatch } from '../gridMatch.ts';
import { projectionFor } from '../projection/index.ts';
import type { OperandId, ComparisonSpec } from './types.ts';
/**
 * A moving-grid model (a storm-following nest) has a different grid every frame, so there is no grid to align to or
 * resample onto, and a comparison plans its reference grid before anything is decoded. Throws a message for the person.
 */
export function refuseMovingGrid(model: ModelId, who: string): void {
    const dataset = getDataset(model);
    if (dataset.movingGrid)
        throw new Error(
            `${who}: ${dataset.label} follows its storm, so its grid changes every hour and it cannot be compared.`,
        );
}
export function relate(ref: ModelGrid, src: ModelGrid): 'identical' | 'shift' | 'resample' {
    if (!gridMismatch(ref, src)) return 'identical';
    if (
        ref.projection === 'latlon' &&
        !ref.rotation &&
        src.projection === 'latlon' &&
        !src.rotation &&
        !gridMismatch({ ...ref, lon1: src.lon1 }, src) &&
        Math.abs(ref.nx * ref.dlon - 360) < 1e-6 &&
        Math.abs((ref.lon1 - src.lon1) / src.dlon - Math.round((ref.lon1 - src.lon1) / src.dlon)) < 1e-6
    )
        return 'shift';
    return 'resample';
}
export function chooseReference(
    policy: ComparisonSpec['reference'],
    operands: Array<{ id: OperandId; grid: ModelGrid }>,
): OperandId {
    if (!operands.length) throw new Error('No reference operands');
    if (policy !== 'finest' && policy !== 'coarsest') {
        if (!operands.some((x) => x.id === policy)) throw new Error('Unknown reference operand');
        return policy;
    }
    return operands.reduce((a, b) => {
        const size = (x: typeof a) => projectionFor(x.grid).cellMetres(40);
        return (policy === 'finest' ? size(b) < size(a) : size(b) > size(a)) ? b : a;
    }).id;
}
