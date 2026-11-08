import { decodeGrib2 as decodeMrms } from './mrms/decode.ts';
import { decodeGrib2ToHalf, decodeGrib2ToLevels } from './models/grib2.ts';
import type { Grib2Options, MrmsModeOptions, MrmsDecodeResult, ModelHalfOptions, ModelHalfResult, ModelLevelsOptions, ModelLevelsResult } from './types.ts';
export type * from './types.ts';
export type { GridInfo, PackedRow, RowSink, SinkSignal } from './mrms/types.ts';
export { readGrib2Grid, decodeGrib2ToHalf, decodeGrib2ToLevels, registerPacking, BUILT_IN_PACKINGS } from './models/grib2.ts';
export type { ModelGrid, LambertModelGrid, LatLonModelGrid, PolarStereoModelGrid, MercatorModelGrid, DecodeLevelsOptions, PackedField, ValueSink, LevelGrid } from './models/grib2.ts';
export type { GridRotation, LevelReducer, ValueTransform } from './models/types.ts';
export { parseIdx } from './models/idx.ts';
export type { IdxEntry } from './models/idx.ts';
export { parseEcmwfIndex } from './models/addons/ecmwf/inventory.ts';
export { JPEG2000_TEMPLATE, decodeJpeg2000Field } from './models/addons/jpeg2000/index.ts';
export { CCSDS_TEMPLATE, decodeCcsds, decodeCcsdsField } from './models/addons/ccsds/index.ts';

export function decodeGrib2(input: ReadableStream<Uint8Array>, options: MrmsModeOptions): Promise<MrmsDecodeResult>;
export function decodeGrib2(input: Uint8Array, options: ModelHalfOptions): ModelHalfResult;
export function decodeGrib2(input: Uint8Array, options: ModelLevelsOptions): ModelLevelsResult;
export function decodeGrib2(input: Uint8Array | ReadableStream<Uint8Array>, options: Grib2Options): ModelHalfResult | ModelLevelsResult | Promise<MrmsDecodeResult> {
    if (options?.mode === 'mrms') {
        if (!(input instanceof ReadableStream) || !options.sink || typeof options.sink.begin !== 'function' || typeof options.sink.row !== 'function') throw new TypeError('MRMS requires a byte stream and row sink');
        return decodeMrms(input, options.sink, options);
    }
    if (options?.mode !== 'model' || !(input instanceof Uint8Array)) throw new TypeError('Model GRIB2 requires mode model and Uint8Array input');
    if (options.output === 'half') return decodeGrib2ToHalf(input, options.transform);
    if (options.output === 'levels') return decodeGrib2ToLevels(input, options);
    throw new TypeError('Model GRIB2 requires output half or levels');
}
