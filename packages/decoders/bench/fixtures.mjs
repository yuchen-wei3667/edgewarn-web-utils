// Run each case in its own process. Source mode requires the frozen Website snapshot.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildPngGrib, chunkedStream } from '../test/fixtures/mrms/grib2-builder.mjs';
const [mode, kind, sourceRoot] = process.argv.slice(2);
const root = new URL('../', import.meta.url);
const load = (source, target) => import(mode === 'source'
    ? pathToFileURL(resolve(sourceRoot, 'src/utils', source)).href
    : new URL(`dist/${target}`, root).href);
const fixture = name => new Uint8Array(readFileSync(new URL(`test/fixtures/${name}`, root)));
let input, run;
if (kind === 'mrms') {
    input = buildPngGrib({ ni:500, nj:500, values:Array.from({length:250000}, (_,i)=>i%65536) });
    const { decodeGrib2 } = await load('mrms/grib2/decode.ts','grib2/mrms/decode.js');
    run = () => decodeGrib2(chunkedStream(input,65536).stream,{begin(){},row(){}});
} else if (['model','jpeg2000','ccsds'].includes(kind)) {
    const model = await load('models/grib2.ts','grib2/models/grib2.js');
    input = fixture(kind === 'model' ? 'models/t12z-f00-tmp2m.grib2' : kind === 'jpeg2000' ? 'models/jpeg2000/rap-tmp2m-f06.grib2' : 'models/ecmwf-ifs/t00z-f012-2t.grib2');
    if(kind === 'jpeg2000') {
        const codec = await load('models/addons/jpeg2000/decode.ts','grib2/models/addons/jpeg2000/decode.js');
        model.registerPacking(40,codec.decodeJpeg2000Field);
    }
    if(kind === 'ccsds') {
        const codec = await load('models/addons/ecmwf/ccsds.ts','grib2/models/addons/ccsds/decode.js');
        model.registerPacking(42,codec.decodeCcsdsField);
    }
    run = () => model.decodeGrib2ToHalf(input);
} else if (kind === 'nexrad') {
    input = fixture('nexrad/synthetic.ar2v');
    const { NexradDecoder } = await load('nexrad/decoder/decoder.ts','nexrad/decoder/decoder.js');
    run = () => { const d = new NexradDecoder(()=>{}); d.push(input); d.finish(); };
} else if(kind === 'goes') {
    input = fixture('goes/abi-mini.nc');
    const { AbiFile } = await load('goes/abi.ts','goes/abi.js');
    const { BytesSource } = await load('goes/source.ts','goes/source.js');
    run = async () => (await AbiFile.open(new BytesSource(input))).read();
} else throw Error('Unknown fixture benchmark');
if(mode === 'facade') {
    const { EdgeWARNDecoder } = await import(new URL('dist/index.js',root));
    const d = new EdgeWARNDecoder({memoryLimitBytes:128*1024*1024});
    const options = kind === 'mrms' ? {format:'grib2',mode:'mrms',sink:{begin(){},row(){}}}
        : ['model','jpeg2000','ccsds'].includes(kind) ? {format:'grib2',mode:'model',output:'half'}
        : kind === 'nexrad' ? {format:'nexrad',level:2,onRadial(){}} : {format:'goes'};
    run = () => d.decode(kind === 'mrms' ? chunkedStream(input,65536).stream : input,options);
}
for(let i=0;i<5;i++) await run();
const samples=[];
for(let i=0;i<25;i++){ const start=performance.now(); await run(); samples.push(performance.now()-start); }
const sorted=[...samples].sort((a,b)=>a-b);
console.log(JSON.stringify({mode,kind,runtime:process.version,inputSha256:createHash('sha256').update(input).digest('hex'),warmup:5,repetitions:25,samplesMs:samples,p50Ms:sorted[12],p90Ms:sorted[22],processMaxRssKiB:process.resourceUsage().maxRSS}));
