# @edgewarn/web-utils: decoders

Portable ESM weather byte decoders, copied from consumer-app and adapted for
Node, browsers and workers. No runtime code dependencies, decoder network clients, caches,
workers, scheduling or rendering. Node 22.18+ and native Web Streams,
`DecompressionStream`, `AbortSignal`, `DOMException` and typed arrays are required.

```ts
import { EdgeWARNDecoder } from '@edgewarn/web-utils';

const decoder = new EdgeWARNDecoder({ memoryLimitBytes: 64 * 1024 * 1024 });
const field = await decoder.decode(messageBytes, {
  format: 'grib2', mode: 'model', output: 'half',
});
```

The root exports only `EdgeWARNDecoder`, `DecodeBudgetExceededError` and types.
`decode` always returns a promise; calls on the same instance cannot overlap.
Separate instances have independent, additive limits. Input is bytes, a byte
stream (MRMS or NEXRAD II), or a GOES `ByteSource`; URLs are never accepted.

## GRIB2

All GRIB2 APIs, inventory parsers and codecs use `@edgewarn/web-utils/grib2`.

```ts
import {
  decodeGrib2, parseIdx, parseEcmwfIndex,
  registerPacking, JPEG2000_TEMPLATE, decodeJpeg2000Field,
  CCSDS_TEMPLATE, decodeCcsdsField,
} from '@edgewarn/web-utils/grib2';

// Optional codecs require explicit registration, once per JS realm.
registerPacking(JPEG2000_TEMPLATE, decodeJpeg2000Field);
registerPacking(CCSDS_TEMPLATE, decodeCcsdsField);

const half = decodeGrib2(messageBytes, { mode: 'model', output: 'half' });
const coarse = decodeGrib2(messageBytes, {
  mode: 'model', output: 'levels', levels: [1, 2], factors: [1, 2, 3],
  reducer: 'mean', transform: { offset: -273.15 },
});
await decodeGrib2(body, { mode: 'mrms', sink, signal });
```

Model decoding is synchronous, with half-float bits in `Uint16Array`, NaNs,
bitmaps, scan direction, alternating rows, affine transforms and mean/max/mode
reduction. Only requested levels are allocated. Supported grids are Lambert,
regular/rotated lat/lon, polar stereographic and Mercator within the original
Website subsets. Built-in packings are 0, 2 and 3. Optional 40 supports the
existing single-tile, single-component reversible JPEG 2000 profile; optional 42
supports the existing unsigned, unrestricted CCSDS profile. Other profiles throw.
`readGrib2Grid`, `decodeGrib2ToHalf` and `decodeGrib2ToLevels` retain their original
contracts. Registration overwrites a previous decoder for that template.

MRMS accepts a `ReadableStream<Uint8Array>`, plain or gzip, supporting simple and
PNG packing (0/41). `sink.begin(grid)` and `sink.row(y, packedRow)` can be async;
return `'stop'` for early cancellation. The row is reused: copy it during the
callback if retaining it. Sink backpressure, aborts and errors stop consumption.
The result reports `grid`, `rowsRead`, `bytesRead`, and `stopped`. Packed integer
rows need the grid's scale metadata to obtain physical values.

`parseIdx(text)` and `parseEcmwfIndex(text)` return ordered `IdxEntry` rows with
variable, level, forecast, extra qualifiers, optional member and byte ranges.
`end` is **inclusive**; the final wgrib2 end is `null`. Shared wgrib2 offsets use
the next distinct offset. ECMWF lengths determine end directly. Parsing is
permissive: callers must validate safe ranges before making network reads.
Inventory strings/objects are outside the decoder instance's buffer allowance.

The single GRIB2 entry point has no registration side effects and permits unused
codec elimination, but does not preserve the Website's former separate addon
chunks. The root dynamically loads only the selected format.

## NEXRAD

`@edgewarn/web-utils/nexrad` exports incremental `NexradDecoder`, `MessageDecoder`,
`Bzip2Decoder`, `sample`, `materialize`, VCP readers, `CutAssembler`, azimuth lookup
and Level III radial/TVS readers.

```ts
await decoder.decode(archiveBody, {
  format: 'nexrad', level: 2,
  onRadial(radial) { /* consume borrowed moments synchronously */ },
  maxCompressedRecordBytes: 8 * 1024 * 1024,
  maxDecodedRecordBytes: 16 * 1024 * 1024,
  signal,
});
const radial = await decoder.decode(productBytes, {
  format: 'nexrad', level: 3, product: 'radial', moment: 'REF',
});
const tvs = await decoder.decode(productBytes, {
  format: 'nexrad', level: 3, product: 'tvs',
});
```

Level II supports modern `AR2V0006` Archive-II with BZip2 records, CRC validation,
Message 31, Message 5 VCP metadata and existing cut assembly. Push ordered bytes,
then call `finish()` to validate completion. Radials/moments borrow buffers until
the callback returns; copy `raw` or call `materialize` to retain samples. Missing
samples are NaN and range-folded samples are negative infinity. Historical
encodings, randomized BZip2 and segmented Message 31 remain unsupported. Record
limits and `workspaceBytes` retain their meanings; a record bound is not a total
heap bound. The root streams radials without aggregating a volume.

Level III supports the original digital-radial product codes and NTV/TVS subset,
including compression, scaling, station/scan metadata and azimuth lookup. Invalid
radial products throw; invalid TVS products return `null`, whereas a valid TVS
product with no detections returns an empty detections array. Listing, volume
selection and elevation sequencing are outside the package.

## GOES ABI

`@edgewarn/web-utils/goes` exports `AbiFile`, `BytesSource`, byte-source and ABI
contracts, `Hdf5FormatError`, and `InflateError`.

```ts
import { AbiFile, BytesSource } from '@edgewarn/web-utils/goes';
const file = await AbiFile.open(new BytesSource(fileBytes), signal);
const image = await file.read({ rows: [0, 500], cols: [0, 500], stride: 2, signal });
```

The original NetCDF-4/HDF5 subset includes v2/v3 superblocks, compact/dense links
and attributes, contiguous/compact/chunked data and shuffle/deflate. Checksums
are not verified. Unsupported filters/layouts throw. Output is north-first raw
unsigned codes plus scale, offset, fill, axes and projection metadata. Read
windows are half-open; stride, reusable output, JS/native inflate, request batch
limits and concurrency retain their existing contracts. `readRows` streams
borrowed rows in order from caller-supplied range iterators. `bandRange`,
`gridInfo`, `prepare`, metadata readers and `release` remain available.

Metadata uses a native Map per file, lasting as long as that `AbiFile`. For the
Website's existing expiry policy, inject its Map subclass:

```ts
await AbiFile.open(source, signal, {
  createMetadataCache: <V>() => new ExpiringMap<string, V>(),
});
```

Promise sharing and eviction on rejection are preserved. HTTP range sources,
read-ahead caches, fetch binding and `streamAbi` stay in the application. A
`ByteSource` owns its returned buffers/caches and must honor cancellation signals.

## Memory and failure contracts

The constructor snapshots a positive safe integer `memoryLimitBytes`. The
instance reserves decoder-managed backing stores **before allocation**, including
output, row buffers, level accumulators and codec workspace. Shared buffers are
counted once, reused buffers remain reserved, and temporary storage is released
when no longer needed. Output transfers to the caller when decoding completes;
retained results from earlier calls do not count against later operations.

Caller input, caller-supplied output, ByteSource buffers/caches, JavaScript
objects/strings, module constants, VM overhead, and opaque native decompressor
allocations are outside this allowance. The shared GOES inflater table workspace
is charged once per operation. This is not a browser/process heap cap. Device,
worker, GPU, download and application cache budgets stay with the caller.

Exceeding the allowance throws `DecodeBudgetExceededError` with `limitBytes`,
`usedBytes` and `requestedBytes`. No resolution changes or truncation happen to
fit a budget. Readers are cancelled, operation reservations are cleared, and the
instance can be reused after failure. Already delivered rows/radials are partial
results: discard them after failure. Low-level format APIs retain their unlimited
compatibility behavior and decoder-local bounds. Custom registered packings work
through those APIs; the budgeted instance refuses unaudited implementations.

See the repository's decoder extraction notes for source provenance, validation
and pending Website/browser release gates. No Website adoption or publication is included.
