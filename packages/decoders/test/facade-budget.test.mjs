import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EdgeWARNDecoder, DecodeBudgetExceededError } from '../dist/index.js';
import { Memory } from '../dist/internal/memory.js';
import { decodeGrib2, decodeGrib2ToHalf, decodeGrib2ToLevels, registerPacking, JPEG2000_TEMPLATE, decodeJpeg2000Field, CCSDS_TEMPLATE, decodeCcsdsField } from '../dist/grib2/index.js';
import { decodeGrib2 as mrms } from '../dist/grib2/mrms/decode.js';
import { NexradDecoder } from '../dist/nexrad/decoder/decoder.js';
import { decodeLevel3Radial } from '../dist/nexrad/level3/digitalRadial.js';
import { AbiFile, BytesSource } from '../dist/goes/index.js';
import { buildLambertGrib, buildPolarStereoGrib, buildMercatorGrib } from './fixtures/models/lcc-grib-builder.mjs';
import { buildSimpleGrib, buildPngGrib, chunkedStream } from './fixtures/mrms/grib2-builder.mjs';
import { fixtures } from './fixtures/nexrad/core-fixtures.mjs';
const bytes = name => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const model = buildLambertGrib([1,2,3,4,5,6], 3, 2);
const half = {format:'grib2', mode:'model', output:'half'};
const instance = limit => new EdgeWARNDecoder({memoryLimitBytes:limit});
const sink = { begin(){}, row(){} };

test('budget snapshot, safe sizes, backing-store identity, exact reservation and release', async () => {
    for(const value of [0,-1,1.5,NaN,Infinity,2**53,undefined]) assert.throws(()=>instance(value), RangeError);
    const budget={memoryLimitBytes:12}; const decoder=new EdgeWARNDecoder(budget); budget.memoryLimitBytes=1;
    assert.deepEqual((await decoder.decode(model,half)).data,decodeGrib2ToHalf(model).data);
    await assert.rejects(instance(11).decode(model,half), e=>e instanceof DecodeBudgetExceededError && e.usedBytes===0 && e.requestedBytes===12 && e.limitBytes===11);
    let reads=0;const snapshot=new EdgeWARNDecoder({get memoryLimitBytes(){reads++;return reads===1?12:1;}});
    await snapshot.decode(model,half);assert.equal(reads,1);
    const m=new Memory(16); const array=m.array(Uint16Array,8);
    assert.equal(m.usedBytes,16);m.release(array.subarray(1));m.release(array);assert.equal(m.usedBytes,0);
    assert.throws(()=>m.array(Uint32Array,Number.MAX_SAFE_INTEGER),RangeError);
    assert.throws(()=>m.array(Uint16Array,0.5),RangeError);
    await instance(Number.MAX_SAFE_INTEGER).decode(model,half);
});

test('mode facade preserves synchronous model and asynchronous MRMS contracts; invalid inputs are untouched', async () => {
    assert.equal(decodeGrib2(model,{mode:'model',output:'half'}) instanceof Promise,false);
    let pulls=0;const input=new ReadableStream({pull(){pulls++;}}, {highWaterMark:0});
    assert.throws(()=>decodeGrib2(input,{mode:'model',output:'half'}),TypeError);
    assert.throws(()=>decodeGrib2(model,{mode:'model',output:'unknown'}),TypeError);
    await assert.rejects(instance(1024).decode(input,{format:'unknown'}),TypeError);assert.equal(pulls,0);assert.equal(input.locked,false);
    await input.cancel();
});

for(const [name,message,options] of [
    ['simple',model,half],
    ['coarse mean',model,{...half,output:'levels',levels:[1,1],factors:[1,2]}],
    ['coarse max',model,{...half,output:'levels',levels:[0,1],factors:[1,2],reducer:'max'}],
    ['coarse mode',model,{...half,output:'levels',levels:[1],factors:[1,2],reducer:'mode'}],
    ['complex',bytes('models/t12z-f00-tmp2m.grib2'),half],
]) {
    test(`${name}: exact managed peak succeeds, one byte less fails, outputs match`,async()=>{
        const m=new Memory(128*1024*1024);
        const expected=options.output==='half'?decodeGrib2ToHalf(message,options.transform,m):decodeGrib2ToLevels(message,options,m);
        assert.deepEqual(await instance(m.peakBytes).decode(message,options),expected);
        await assert.rejects(instance(m.peakBytes-1).decode(message,options),DecodeBudgetExceededError);
    });
}

for(const [name,template,codec] of [['jpeg2000',JPEG2000_TEMPLATE,decodeJpeg2000Field],['ecmwf-ifs',CCSDS_TEMPLATE,decodeCcsdsField]]) {
    test(`${name}: explicit audited registration and all fixture budgets`,async()=>{
        registerPacking(template,codec);
        const { readdirSync }=await import('node:fs');
        for(const file of readdirSync(new URL(`./fixtures/models/${name}/`,import.meta.url)).filter(f=>f.endsWith('.grib2'))) {
            const message=bytes(`models/${name}/${file}`);const m=new Memory(256*1024*1024);
            const expected=decodeGrib2ToHalf(message,{},m);
            assert.deepEqual(await instance(m.peakBytes).decode(message,half),expected,file);
            await assert.rejects(instance(m.peakBytes-1).decode(message,half),DecodeBudgetExceededError);
        }
    });
}

test('unaccounted registered codecs are refused before invocation',async()=>{
    let calls=0;registerPacking(40,()=>calls++);
    await assert.rejects(instance(64*1024*1024).decode(bytes('models/jpeg2000/rap-tmp2m-f06.grib2'),half),/Custom packing/);
    assert.equal(calls,0);registerPacking(40,decodeJpeg2000Field);
});

for(const png of [false,true]) test(`MRMS ${png?'PNG':'simple'} reuses bounded rows and releases after stop/error`,async()=>{
    const build=png?buildPngGrib:buildSimpleGrib;
    const message=build({ni:12,nj:50,values:Array.from({length:600},(_,i)=>i),nbits:16});
    const options={format:'grib2',mode:'mrms',sink};const m=new Memory(1024*1024);
    await mrms(chunkedStream(message,7).stream,sink,{},m);
    const decoder=instance(m.peakBytes);
    const result=await decoder.decode(chunkedStream(message,7).stream,options);assert.equal(result.rowsRead,50);
    await assert.rejects(instance(m.peakBytes-1).decode(chunkedStream(message,7).stream,options),DecodeBudgetExceededError);
    await assert.rejects(decoder.decode(chunkedStream(message).stream,{...options,sink:{begin(){throw Error('sink failed');},row(){}}}),/sink failed/);
    assert.equal((await decoder.decode(chunkedStream(message,7).stream,options)).rowsRead,50);
});

test('overlap rejects immediately; cancellation during sniff releases source and permits reuse',async()=>{
    let cancelled=false;let entered;const ready=new Promise(resolve=>entered=resolve);
    const stream=new ReadableStream({pull(){entered();},cancel(){cancelled=true;}},{highWaterMark:0});
    const controller=new AbortController();const decoder=instance(10000);
    const pending=decoder.decode(stream,{format:'grib2',mode:'mrms',sink,signal:controller.signal});
    await ready;await assert.rejects(decoder.decode(model,half),/active/);controller.abort();
    await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,true);assert.equal(stream.locked,false);
    await decoder.decode(model,half);
});

test('NEXRAD L2 streams borrowed radials with bounded workspace and recovers after failure',async()=>{
    const archive=Buffer.from(fixtures.archive,'base64');const m=new Memory(32*1024*1024);
    const low=new NexradDecoder(()=>{}, {},m);low.push(archive);low.finish();
    let count=0;const options={format:'nexrad',level:2,onRadial:r=>{count++;assert.equal(r.station,'KTLX');}};
    const decoder=instance(m.peakBytes);await decoder.decode(archive,options);assert.equal(count,1);
    await assert.rejects(instance(m.peakBytes-1).decode(archive,options),DecodeBudgetExceededError);
    await assert.rejects(decoder.decode(new Uint8Array([1,2,3]),options),/Truncated/);
    await decoder.decode(chunkedStream(archive,1).stream,options);assert.equal(count,2);
    const s=chunkedStream(archive,1).stream;
    await assert.rejects(instance(1).decode(s,options),DecodeBudgetExceededError);assert.equal(s.locked,false);
});

test('GOES Map default, caller-owned output, full/windowed/native reads have exact peak bounds',async()=>{
    const message=bytes('goes/abi-mini.nc');
    for(const options of [{format:'goes'},{format:'goes',rows:[3,21],cols:[5,70],stride:2},{format:'goes',output:new Uint16Array(60*90),inflate:'native'}]) {
        const m=new Memory(1024*1024);const file=await AbiFile.open(new BytesSource(message),undefined,{},m);const expected=await file.read(options);
        const decoder=instance(m.peakBytes);const got=await decoder.decode(message,options);assert.deepEqual(got,expected);
        if(options.output)assert.equal(got.data,options.output);
        await assert.rejects(instance(m.peakBytes-1).decode(message,options),DecodeBudgetExceededError);
        await decoder.decode(new BytesSource(message),options);
    }
});

test('projected grid decoding remains independent of renderer projections',()=>{
    for(const build of [buildPolarStereoGrib,buildMercatorGrib])assert.deepEqual(decodeGrib2(build([1,2,3,4],2,2,{scanMode:0x40}),{mode:'model',output:'half'}).data,new Uint16Array([15360,16384,16896,17408]));
});

for (const name of ['VEL','ZDR']) test(`NEXRAD L3 ${name}: decoded result and every workspace reservation are bounded`,async()=>{
    const products=await import('./fixtures/nexrad/level3-products.mjs');const message=products[name];const m=new Memory(32*1024*1024);
    const expected=decodeLevel3Radial(message,name,m);const options={format:'nexrad',level:3,product:'radial',moment:name};
    const decoder=instance(m.peakBytes);assert.deepEqual(await decoder.decode(message,options),expected);
    await assert.rejects(instance(m.peakBytes-1).decode(message,options),DecodeBudgetExceededError);
    await assert.rejects(decoder.decode(message.subarray(0,25),options));await decoder.decode(message,options);
});

test('NEXRAD TVS distinguishes empty and invalid products through the instance',async()=>{
    const d=instance(1);const options={format:'nexrad',level:3,product:'tvs'};
    assert.equal((await d.decode(bytes('nexrad/tvs-kemx.bin'),options)).detections.length,1);
    assert.deepEqual((await d.decode(bytes('nexrad/tvs-none-ktlx.bin'),options)).detections,[]);
    assert.equal(await d.decode(new Uint8Array(),options),null);
});

test('GOES budget failure aborts and settles sibling streams before instance reuse',async()=>{
    const message=bytes('goes/abi-mini.nc');const m=new Memory(1024*1024);
    const file=await AbiFile.open(new BytesSource(message),undefined,{},m);const plan=await file.prepare();
    const limit=m.usedBytes+plan.chunkBytes+plan.maxStored+plan.chunkBytes-1;
    let active=0,closed=0;const base=new BytesSource(message);
    const source={read:(...args)=>base.read(...args),get requests(){return base.requests;},get bytesFetched(){return base.bytesFetched;},
        async *stream(offset,length,signal){
            active++;
            try {
                await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});
                signal.throwIfAborted();
                yield await base.read(offset,length);
            } finally { active--;closed++; }
        },
    };
    const decoder=instance(limit);
    await assert.rejects(decoder.decode(source,{format:'goes',maxBatchBytes:1,fetchConcurrency:2}),DecodeBudgetExceededError);
    assert.equal(active,0);assert.equal(closed,1);
    await decoder.decode(model,half);
});
