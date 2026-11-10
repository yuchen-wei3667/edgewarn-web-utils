import type { ModelFieldDef } from '../catalog.ts';
import type { EnsembleProduct } from '../datasets.ts';
/** Ensemble statistics have different units and affine semantics from their parent field. */
export function operandUnits(def: ModelFieldDef, product: EnsembleProduct) {
    if (product === 'nsprd')
        return { units: '', scale: 1, offset: 0, ratioScale: true, valueKind: 'ratio' as const };
    if (product === 'exceed')
        return { units: '%', scale: 1, offset: 0, ratioScale: true, valueKind: 'percent' as const };
    if (product === 'sprd')
        return {
            units: def.units,
            scale: Math.abs(def.display?.scale ?? 1),
            offset: 0,
            ratioScale: true,
            valueKind: 'delta' as const,
        };
    return {
        units: def.units,
        scale: def.display?.scale ?? 1,
        offset: def.display?.offset ?? 0,
        ratioScale: def.ratioScale,
        valueKind: 'absolute' as const,
    };
}
