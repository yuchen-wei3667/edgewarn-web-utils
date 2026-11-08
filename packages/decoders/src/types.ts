import type { MrmsModeOptions, ModelHalfOptions, ModelLevelsOptions, MrmsDecodeResult, ModelHalfResult, ModelLevelsResult } from './grib2/types.ts';
import type { DecoderOptions, Radial } from './nexrad/decoder/decoder.ts';
import type { decodeLevel3Radial } from './nexrad/level3/digitalRadial.ts';
import type { TvsProduct } from './nexrad/level3/tvs.ts';
import type { AbiReadOptions, AbiDependencies, AbiGrid } from './goes/abi.ts';
export type DecoderBudget = Readonly<{ memoryLimitBytes: number }>;
export type Grib2MrmsOptions = MrmsModeOptions & { format: 'grib2' };
export type Grib2HalfOptions = ModelHalfOptions & { format: 'grib2' };
export type Grib2LevelsOptions = ModelLevelsOptions & { format: 'grib2' };
export type NexradLevel2Options = DecoderOptions & {
    format: 'nexrad'; level: 2; onRadial: (radial: Radial) => void; signal?: AbortSignal;
};
export type NexradRadialOptions = { format: 'nexrad'; level: 3; product: 'radial'; moment: string; signal?: AbortSignal };
export type NexradTvsOptions = { format: 'nexrad'; level: 3; product: 'tvs'; signal?: AbortSignal };
export type GoesOptions = AbiReadOptions & { format: 'goes'; dependencies?: AbiDependencies };
export type DecodeOptions = Grib2MrmsOptions | Grib2HalfOptions | Grib2LevelsOptions | NexradLevel2Options | NexradRadialOptions | NexradTvsOptions | GoesOptions;
export type DecodeResult = MrmsDecodeResult | ModelHalfResult | ModelLevelsResult | ReturnType<typeof decodeLevel3Radial> | TvsProduct | null | AbiGrid | void;
