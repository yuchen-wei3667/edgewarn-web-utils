import { parseEcmwfIndex, parseIdx } from '@edgewarn/web-utils/grib2';

/** The inventory parser of each source dialect, as the adapters use them. */
const PARSERS = { wgrib2: parseIdx, ecmwf: parseEcmwfIndex };

/** Parse a saved inventory the way the dataset's source dialect reads it (`.idx` text or an ECMWF `.index`). */
export function parseInventory(dataset, text) {
    return PARSERS[dataset.source.dialect](text);
}
