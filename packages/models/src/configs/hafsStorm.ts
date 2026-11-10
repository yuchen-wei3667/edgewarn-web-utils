/**
 * HAFS publishes one object per storm, so its file names carry a storm id that no other model has. The viewer
 * sets the storm it is showing here, and the HAFS datasets read it when they build an object path. Not a model:
 * it sits outside `datasets/` like `shared.ts`.
 */

let activeStorm: string | null = null;

/** The track model (the bucket prefix) of each HAFS dataset. Code outside the config reaches the dataset ids only through here. */
const TRACK_OF_DATASET = { 'hafs-a': 'hfsa', 'hafs-b': 'hfsb' } as const;
type HafsDatasetId = keyof typeof TRACK_OF_DATASET;
type HafsTrackModel = (typeof TRACK_OF_DATASET)[HafsDatasetId];

/** The track model a dataset id draws (`hfsa` for the first HAFS dataset); null for any other dataset. */
export function hafsTrackModel(datasetId: string): HafsTrackModel | null {
    return datasetId in TRACK_OF_DATASET ? TRACK_OF_DATASET[datasetId as HafsDatasetId] : null;
}

/** The dataset that draws a track model. */
export function hafsDatasetId(track: HafsTrackModel): HafsDatasetId {
    return (Object.keys(TRACK_OF_DATASET) as HafsDatasetId[]).find(
        (id) => TRACK_OF_DATASET[id] === track,
    ) as HafsDatasetId;
}

/** Storm ids as the track listing writes them: lower case, number then basin letter (`22e`). */
const STORM_ID = /^\d{2}[a-z]$/;
/** Shaped like an id but never issued (storm numbers start at 01), so a path built with no storm 404s instead of throwing. */
const NO_STORM = '00x';

/** Set the storm the HAFS datasets read, or `null` for none. Rejects ids that would not be a path segment. */
export function setHafsStorm(id: string | null): void {
    if (id !== null && !STORM_ID.test(id)) throw new Error(`Not a HAFS storm id: ${id}`);
    activeStorm = id;
}

/** The storm id for an object path. */
export function stormPathId(): string {
    return activeStorm ?? NO_STORM;
}
