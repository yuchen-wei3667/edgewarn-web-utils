import type { ModelDataset } from '../datasets.ts';

/** The ECMWF open-data inventory sits beside its object with the extension swapped (`….grib2` -> `….index`). */
const ECMWF_OBJECT = /\.grib2$/;

/**
 * The URL to range-probe to learn whether an object of a run is published, and where its inventory is read from.
 * A GRIB2 source publishes the inventory last, so its presence means the object is complete; an OM or NetCDF object has no
 * companion file, so the object itself is probed. Kept apart from the adapters because the main thread lists
 * runs and must not load a reader to do it.
 */
export function probeUrlFor(dataset: ModelDataset, objectUrl: string): string {
    const { source } = dataset;
    if (source.kind === 'om' || source.kind === 'netcdf') return objectUrl;
    return source.dialect === 'ecmwf' ? objectUrl.replace(ECMWF_OBJECT, '.index') : `${objectUrl}.idx`;
}
