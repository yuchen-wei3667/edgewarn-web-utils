import { fieldsForModel, getModelField, MODEL_PANES } from './catalog.ts';
import { getDataset, type EnsembleProduct, type ModelId } from './datasets.ts';
import { offeredProducts } from './ensemble.ts';
import { WAVE_MODELS } from './configs/families.ts';

export function modelFamily(model: ModelId): ModelId {
    for (const [parent, wave] of Object.entries(WAVE_MODELS)) {
        if (model === wave) return parent as ModelId;
    }
    return model;
}

export function familyModelIds(model: ModelId): readonly ModelId[] {
    const parent = modelFamily(model);
    const wave = WAVE_MODELS[parent as keyof typeof WAVE_MODELS];
    return wave ? [parent, wave] : [parent];
}

export function familyPickerIds(ids: readonly ModelId[]): ModelId[] {
    return ids.filter((id) => modelFamily(id) === id || !ids.includes(modelFamily(id)));
}

/** Preserve supported products across tabs; normalized spread is atmospheric only. */
export function familyProduct(model: ModelId, product: EnsembleProduct): EnsembleProduct {
    const dataset = getDataset(model);
    if (dataset.ensembles.includes(product) || offeredProducts(dataset).includes(product)) return product;
    if (product === 'nsprd' && dataset.ensembles.includes('sprd')) return 'sprd';
    return dataset.ensembles[0];
}

export function familyFields(model: ModelId, product: EnsembleProduct) {
    return familyModelIds(model).flatMap((id) => fieldsForModel(id, familyProduct(id, product)));
}

export function familyPanes(model: ModelId, product: EnsembleProduct) {
    const offered = new Set(familyFields(model, product).map((field) => field.pane));
    return MODEL_PANES.filter((pane) => offered.has(pane.id)).map((pane) =>
        pane.id === 'waves' ? { ...pane, label: 'Wave' } : pane,
    );
}

export function familyFieldModel(model: ModelId, field: string): ModelId {
    return familyModelIds(model).find((id) => getModelField(field)?.models.includes(id)) ?? model;
}
