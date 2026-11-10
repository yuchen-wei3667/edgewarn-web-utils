import { COMPARE_PERCENT_HALF_RANGE } from '../limits.ts';
import { getModelField, type ModelFieldDef } from '../catalog.ts';
import { getDataset, type ModelId } from '../datasets.ts';
import type { ValueTransform } from '@edgewarn/web-utils/grib2';
import { describeSpec } from './describe.ts';
import { registerDerivedField } from './derived.ts';
import { checkExpr } from './expr/check.ts';
import { chooseReference, refuseMovingGrid } from './gridRelation.ts';
import { comparisonHash } from './identity.ts';
import { operandUnits } from './operandUnits.ts';
import type { ComparisonSpec, ValueKind } from './types.ts';

interface RegisteredComparison {
    def: ModelFieldDef;
    reference: ModelId;
    valueKind: ValueKind;
    units: string;
    refs: string[];
}

const full = (t: ValueTransform | undefined) => ({ scale: t?.scale ?? 1, offset: t?.offset ?? 0 });
/** A result stored in physical units still reads colormaps written for the field's raw units: compose the two transforms. */
function physical(def: ModelFieldDef): { toStored: ValueTransform; range?: [number, number]; scale: number } {
    const to = full(def.colormap.toStored),
        show = full(def.display);
    const map = (v: number) => v * show.scale + show.offset;
    const range = def.colormap.range
        ? ([map(def.colormap.range[0]), map(def.colormap.range[1])].sort((x, y) => x - y) as [number, number])
        : undefined;
    return {
        toStored: { scale: to.scale * show.scale, offset: to.offset * show.scale + show.offset },
        range,
        scale: Math.abs(to.scale * show.scale),
    };
}

/**
 * The field id of a comparison. The run and time policy are not part of it (they change which frames are read, not what is
 * drawn); the reference policy and difference range are, because they change the grid and the colour scale.
 */
function compareFieldId(spec: ComparisonSpec, half?: number): string {
    return `cmp~${comparisonHash({
        expr: spec.expr,
        reference: spec.reference,
        half,
        operands: spec.operands.map(({ id, model, product, fieldId, member, threshold }) => ({
            id,
            model,
            product,
            fieldId,
            member,
            threshold,
        })),
    }).slice(0, 12)}`;
}

/** Everything about a spec that can be known without drawing it. Throws an `ExprError`, or an `Error` naming the operand. */
export function checkComparison(spec: ComparisonSpec) {
    for (const o of spec.operands) refuseMovingGrid(o.model, `Operand ${o.id.toUpperCase()}`);
    const defs = spec.operands.map((o) => {
        const def = getModelField(o.fieldId);
        if (!def || def.kind === 'categorical')
            throw new Error(`Operand ${o.id.toUpperCase()}: ${o.fieldId} cannot be compared`);
        return def;
    });
    const checked = checkExpr(
        spec.expr,
        spec.operands.map((o, i) => ({ id: o.id, ...operandUnits(defs[i], o.product) })),
    );
    const referenceOperand = chooseReference(
        spec.reference,
        spec.operands.map((o) => ({ id: o.id, grid: getDataset(o.model).grid })),
    );
    return { defs, checked, reference: spec.operands.find((o) => o.id === referenceOperand)!.model };
}

/** Checks a comparison and registers the field definition the map layer, legend and tooltip read it through. */
export function registerComparison(spec: ComparisonSpec, half?: number): RegisteredComparison {
    const { defs, checked, reference } = checkComparison(spec);
    const first = defs[0],
        id = compareFieldId(spec, half);
    const diverging = checked.valueKind === 'delta' || checked.valueKind === 'percent';
    const source = physical(first);
    const kindQuantity =
        checked.valueKind === 'absolute' || checked.valueKind === 'delta' ? first.quantity : 'other';
    const title = describeSpec(spec).chip;
    const def: ModelFieldDef = {
        ...first,
        id,
        models: [reference],
        product: undefined,
        overrides: undefined,
        legacyIds: [],
        overlay: true,
        searchTerms: [],
        label: `${first.label} ${title}`,
        shortLabel: title,
        kind: 'scalar',
        recipe: 'single',
        recipeParams: undefined,
        units: checked.units,
        quantity: kindQuantity,
        ratioScale: undefined,
        display: undefined,
        colormap: diverging
            ? { name: 'Model_Difference' }
            : {
                  name: first.colormap.name,
                  toStored: source.toStored,
                  ...(source.range ? { range: source.range } : {}),
              },
        derived: {
            valueKind: checked.valueKind,
            source: first.colormap,
            sourceScale: source.scale,
            quantity: kindQuantity,
            ...(source.range ? { span: source.range[1] - source.range[0] } : {}),
            ...(half !== undefined
                ? { half }
                : checked.valueKind === 'percent'
                  ? { half: COMPARE_PERCENT_HALF_RANGE }
                  : {}),
        },
    };
    return {
        def: registerDerivedField(def),
        reference,
        valueKind: checked.valueKind,
        units: checked.units,
        refs: checked.refs,
    };
}
