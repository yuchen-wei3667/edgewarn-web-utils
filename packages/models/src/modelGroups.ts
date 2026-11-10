import { getDataset, type ModelId } from './datasets.ts';
import type { ModelCategory } from './configs/types.ts';

type ModelGroupId = ModelCategory;

interface ModelGroup {
    id: ModelGroupId;
    label: string;
    ids: ModelId[];
}

const GROUPS: readonly { id: ModelGroupId; label: string }[] = [
    { id: 'convection-allowing', label: 'Convection-allowing' },
    { id: 'regional', label: 'Regional' },
    { id: 'global', label: 'Global' },
    { id: 'ensemble', label: 'Ensemble' },
    { id: 'ai', label: 'AI' },
    { id: 'hurricane', label: 'Hurricane' },
    { id: 'climate', label: 'Climate' },
];

/** The declared category, except that an AI model stays AI and any other ensemble counts as an ensemble. */
function groupOf(id: ModelId): ModelGroupId {
    const dataset = getDataset(id);
    const { category } = dataset.about;
    if (category === 'ai' || category === 'hurricane') return category;
    return dataset.ensemble ? 'ensemble' : category;
}

/** The ids split into the groups that have any, in the picker's order; each keeps the order it was given. */
export function groupModels(ids: readonly ModelId[]): ModelGroup[] {
    return GROUPS.map((group) => ({ ...group, ids: ids.filter((id) => groupOf(id) === group.id) })).filter(
        (group) => group.ids.length > 0,
    );
}

/** What a search matches against: the name, the producer and how long and how often it runs. */
const haystack = (id: ModelId): string => {
    const { label, shortLabel, about, docs } = getDataset(id);
    return [label, shortLabel, about.provider, docs.runs, docs.length].join(' ').toLowerCase();
};

/** Every word of the query must appear, in any order, so "ecmwf ens" finds IFS ENS and AIFS ENS. */
export function modelMatches(id: ModelId, query: string): boolean {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const text = haystack(id);
    return words.every((word) => text.includes(word));
}
