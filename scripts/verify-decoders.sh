#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
consumer_dir="$(mktemp -d /tmp/edgewarn-decoders-consumer.XXXXXX)"
trap 'rm -rf "$consumer_dir"' EXIT
cd "$repo_dir"
npm pack --workspace @edgewarn/decoders --pack-destination "$consumer_dir" --silent
cp packages/decoders/test/fixtures/goes/abi-mini.nc "$consumer_dir/"
cp packages/decoders/test/fixtures/models/jpeg2000/rap-tmp2m-f06.grib2 "$consumer_dir/"
cp packages/decoders/test/fixtures/models/t12z-f00-tmp2m.grib2 "$consumer_dir/"
cp packages/decoders/test/fixtures/nexrad/{synthetic.ar2v,tvs-kemx.bin,level3-products.mjs} "$consumer_dir/"
cd "$consumer_dir"
printf '%s\n' '{"private":true,"type":"module"}' > package.json
npm install --ignore-scripts --offline --no-audit --no-fund ./*.tgz
cat > smoke.mjs <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.fetch = () => { throw Error('import-time request'); };
const { EdgeWARNDecoder, DecodeBudgetExceededError } = await import('@edgewarn/decoders');
const grib = await import('@edgewarn/decoders/grib2');
const nexrad = await import('@edgewarn/decoders/nexrad');
const goes = await import('@edgewarn/decoders/goes');
const decoder = new EdgeWARNDecoder({ memoryLimitBytes:64*1024*1024 });
const bytes = name => new Uint8Array(readFileSync(name));
const options = { format:'grib2', mode:'model', output:'half' };
const field = await decoder.decode(bytes('t12z-f00-tmp2m.grib2'),options);
assert.equal(field.data.length, field.grid.nx * field.grid.ny);
assert.throws(() => grib.decodeGrib2ToHalf(bytes('rap-tmp2m-f06.grib2')),/5.40 not supported/);
grib.registerPacking(grib.JPEG2000_TEMPLATE,grib.decodeJpeg2000Field);
assert.equal((await decoder.decode(bytes('rap-tmp2m-f06.grib2'), options)).grid.nx,451);
const image = await decoder.decode(bytes('abi-mini.nc'),{format:'goes'});
assert.equal(image.width,90);
assert.equal(image.height,60);
let count=0;
await decoder.decode(bytes('synthetic.ar2v'),{format:'nexrad',level:2,onRadial(){count++;}});
assert.ok(count>0);
const { VEL }=await import('./level3-products.mjs');
assert.equal((await decoder.decode(VEL,{format:'nexrad',level:3,product:'radial',moment:'VEL'})).field.rows,4);
assert.equal((await decoder.decode(bytes('tvs-kemx.bin'),{format:'nexrad',level:3,product:'tvs'})).detections.length,1);
assert.deepEqual(grib.BUILT_IN_PACKINGS,[0,2,3]);
for(const name of ['@edgewarn/decoders/grib2/models/grib2','@edgewarn/decoders/internal/memory','@edgewarn/decoders/nexrad/decoder/decoder','@edgewarn/decoders/mrms','@edgewarn/decoders/goes/hdf5']) await assert.rejects(import(name),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
JS
cat > consumer.ts <<'TS'
import { EdgeWARNDecoder, DecodeBudgetExceededError } from '@edgewarn/decoders';
import type * as Root from '@edgewarn/decoders';
import * as Grib from '@edgewarn/decoders/grib2';
import * as Nexrad from '@edgewarn/decoders/nexrad';
import * as Goes from '@edgewarn/decoders/goes';
const decoder = new EdgeWARNDecoder({memoryLimitBytes:1024});
declare const bytes: Uint8Array;
declare const stream: ReadableStream<Uint8Array>;
declare const sink: Grib.RowSink;
declare const source: Goes.ByteSource;
const half: Promise<Grib.ModelHalfResult> = decoder.decode(bytes,{format:'grib2',mode:'model',output:'half'});
const rows: Promise<Grib.MrmsDecodeResult> = decoder.decode(stream,{format:'grib2',mode:'mrms',sink});
const sync: Grib.ModelLevelsResult = Grib.decodeGrib2(bytes,{mode:'model',output:'levels',levels:[1],factors:[1,2]});
Grib.registerPacking(Grib.CCSDS_TEMPLATE,Grib.decodeCcsdsField);
Grib.registerPacking(Grib.JPEG2000_TEMPLATE,Grib.decodeJpeg2000Field);
const l2: Promise<void> = decoder.decode(stream,{format:'nexrad',level:2,onRadial(radial){Nexrad.materialize(radial.moments[0]);}});
const l3 = decoder.decode(bytes,{format:'nexrad',level:3,product:'radial',moment:'REF'});
const tvs: Promise<Nexrad.TvsProduct|null> = decoder.decode(bytes,{format:'nexrad',level:3,product:'tvs'});
const image: Promise<Goes.AbiGrid> = decoder.decode(source,{format:'goes',dependencies:{createMetadataCache:<V>()=>new Map<string,V>()}});
Goes.AbiFile.open(new Goes.BytesSource(bytes));
// @ts-expect-error model does not accept a stream
Grib.decodeGrib2(stream,{mode:'model',output:'half'});
// @ts-expect-error model output is required
Grib.decodeGrib2(bytes,{mode:'model'});
// @ts-expect-error allocator context is private
Grib.decodeGrib2ToHalf(bytes,{},{});
// @ts-expect-error no unexported paths
import { Memory } from '@edgewarn/decoders/internal/memory';
TS
node smoke.mjs
printf '%s\n' '{"compilerOptions":{"noEmit":true,"strict":true,"module":"NodeNext","target":"ES2022","types":[],"skipLibCheck":false},"files":["consumer.ts"]}' > tsconfig.json
node "$repo_dir/node_modules/typescript/bin/tsc" -p tsconfig.json
printf '%s\n' 'Decoders external tarball fixtures and strict declarations passed.'
