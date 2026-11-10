import type { ModelColormapRef } from '../configs/types.ts';
import type { ModelFieldDef } from '../catalog.ts';
import type { ValueKind } from './types.ts';

/** What a registered comparison field needs besides a normal field definition. */
export interface DerivedFieldInfo {
    valueKind: ValueKind;
    /** The first operand's colormap, used for results that are not differences. */
    source: ModelColormapRef;
    /** |colormap value -> stored value| scale of that colormap, to size the difference range. */
    sourceScale: number;
    /** That colormap's span in stored units when the field stretches it onto a fixed range. */
    span?: number;
    quantity: ModelFieldDef['quantity'];
    /** Half range of the difference colormap in stored units; absent means a share of the source span. */
    half?: number;
}

const registry = new Map<string, ModelFieldDef>();

/** Comparison fields exist only at runtime: the catalog consults this after the bundled registry. */
export function registerDerivedField(def: ModelFieldDef): ModelFieldDef {
    const known = registry.get(def.id);
    if (known) return known;
    registry.set(def.id, def);
    return def;
}
export const derivedField = (id: string): ModelFieldDef | null => registry.get(id) ?? null;
