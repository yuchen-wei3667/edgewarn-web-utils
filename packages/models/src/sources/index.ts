import {
    CCSDS_TEMPLATE,
    JPEG2000_TEMPLATE,
    decodeCcsdsField,
    decodeJpeg2000Field,
    parseEcmwfIndex,
    registerPacking,
} from '@edgewarn/web-utils/grib2';
import type { ModelDataSource } from '../configs/types.ts';
import { grib2IndexAdapter, makeGrib2IndexAdapter } from './grib2Index.ts';
import type { SourceAdapter } from './types.ts';

export interface LoadSourceOptions {
    /**
     * Loader of the adapter for an `om` source. The Open-Meteo reader is GPL-2.0, so it never ships in this
     * package: the host passes its own. Without it an `om` source throws.
     */
    om?: () => Promise<SourceAdapter>;
}

/** The ECMWF adapter: the JSON `.index` dialect, and the CCSDS packing (5.42) its open-data objects use. */
let ecmwfAdapter: SourceAdapter | undefined;

/**
 * The adapter for a dataset's source. A source loads on demand, so a host pays for a reader (the NetCDF one, the
 * CCSDS decoder) only when a model that needs it is used. Packing addons register with the decoder here, as a
 * dataset needs them. An unknown kind or dialect is a bug in the config, not a request for wgrib2: it throws.
 */
export async function loadSourceAdapter(
    source: ModelDataSource,
    options: LoadSourceOptions = {},
): Promise<SourceAdapter> {
    switch (source.kind) {
        case 'om':
            if (!options.om) throw new Error('An om source needs the host to pass an `om` adapter loader');
            return options.om();
        case 'netcdf':
            return (await import('../netcdf/gridReader.ts')).netcdfGridAdapter;
        case 'grib2-index':
            if (source.jpeg2000) registerPacking(JPEG2000_TEMPLATE, decodeJpeg2000Field);
            switch (source.dialect) {
                case 'wgrib2':
                    return grib2IndexAdapter;
                case 'ecmwf':
                    registerPacking(CCSDS_TEMPLATE, decodeCcsdsField);
                    return (ecmwfAdapter ??= makeGrib2IndexAdapter(parseEcmwfIndex));
                default:
                    throw new Error(`No inventory dialect "${source.dialect as string}"`);
            }
        default:
            throw new Error(`No source adapter for source kind "${(source as { kind: string }).kind}"`);
    }
}
