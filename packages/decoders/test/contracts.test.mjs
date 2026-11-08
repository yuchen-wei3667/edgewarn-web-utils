import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseIdx, parseEcmwfIndex, decodeGrib2 } from '../dist/grib2/index.js';
import { AbiFile, BytesSource } from '../dist/goes/index.js';
import { ExpiringMap, CACHE_RETENTION_MS } from './helpers/expiringMap.mjs';
const fixture=new Uint8Array(readFileSync(new URL('./fixtures/goes/abi-mini.nc',import.meta.url)));

test('wgrib2 shared offsets, extra qualifiers and final inclusive ranges preserve source behavior',()=>{
    const rows=parseIdx('1:0:d=2026010100:TMP:surface:anl:\n2.1:100:d=2026010100:UGRD:10 m above ground:1 hour fcst:prob >1:prob fcst 0/1:\n2.2:100:d=2026010100:VGRD:10 m above ground:1 hour fcst:\n3:200:d=2026010100:APCP:surface:0-1 hour acc fcst:\n');
    assert.deepEqual(rows.map(r=>[r.start,r.end]),[[0,99],[100,199],[100,199],[200,null]]);
    assert.deepEqual(rows[1].extra,['prob >1','prob fcst 0/1']);assert.deepEqual(rows[0].extra,[]);
    assert.deepEqual(parseIdx('bad\n'),[]);
});

test('ECMWF ensemble metadata and statistics survive pure inventory parsing',()=>{
    const text=[{param:'t',levtype:'pl',levelist:850,step:12,type:'cf',_offset:40,_length:20},{param:'2t',levtype:'sfc',step:0,type:'pf',number:'3',_offset:60,_length:10},{param:'tp',levtype:'sfc',step:6,type:'em',_offset:70,_length:30}].map(JSON.stringify).join('\n');
    const rows=parseEcmwfIndex(text);
    assert.equal(rows[0].level,'850 mb');assert.equal(rows[0].member,0);assert.equal(rows[1].member,3);assert.equal(rows[1].forecast,'anl');assert.equal(rows[2].forecast,'0-6 hour acc fcst');
    assert.deepEqual(rows.map(r=>[r.start,r.end]),[[40,59],[60,69],[70,99]]);
});

test('ABI metadata promise sharing, expiry injection and rejection eviction',async()=>{
    let now=0,cache;const file=await AbiFile.open(new BytesSource(fixture),undefined,{createMetadataCache:()=>cache=new ExpiringMap({now:()=>now})});
    try {
        let loads=0;const load=file.loadMeta.bind(file);file.loadMeta=async(...args)=>{loads++;return load(...args);};
        const [a,b]=await Promise.all([file.attributes('Rad'),file.attributes('Rad')]);assert.equal(a,b);assert.equal(loads,1);
        now=CACHE_RETENTION_MS-1;await file.attributes('Rad');assert.equal(loads,1);
        now=CACHE_RETENTION_MS;await file.attributes('Rad');assert.equal(loads,2);
        await assert.rejects(file.attributes('absent'));assert.equal(cache.has('absent'),false);
        await assert.rejects(file.attributes('absent'));assert.equal(loads,4);
    } finally {cache.clear();}
    const standalone=await AbiFile.open(new BytesSource(fixture));assert.equal(standalone.vars.constructor,Map);
});

test('malformed zero/short/oversized GRIB2 lengths terminate in a bounded subprocess',()=>{
    const module=new URL('../dist/grib2/index.js',import.meta.url).href;
    const code=`import {readGrib2Grid} from ${JSON.stringify(module)};for(const length of [0,1,4,1000]){const b=new Uint8Array(24);b.set([71,82,73,66]);b[7]=2;new DataView(b.buffer).setUint32(16,length);try{readGrib2Grid(b);process.exit(1);}catch(e){if(!/section length/.test(String(e)))throw e;}}`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',code],{timeout:3000});assert.equal(result.status,0,result.stderr?.toString());
});

test('fresh format imports neither register optional packings nor request bytes or create timers',()=>{
    const module=new URL('../dist/grib2/index.js',import.meta.url).href;
    const root=new URL('../dist/index.js',import.meta.url).href;
    const nexrad=new URL('../dist/nexrad/index.js',import.meta.url).href;
    const goes=new URL('../dist/goes/index.js',import.meta.url).href;
    const fixture=new URL('./fixtures/models/jpeg2000/rap-tmp2m-f06.grib2',import.meta.url).href;
    const code=`import {readFileSync} from 'node:fs';globalThis.fetch=()=>{throw Error('fetch on import')};globalThis.setTimeout=()=>{throw Error('timer on import')};await import(${JSON.stringify(root)});await import(${JSON.stringify(nexrad)});await import(${JSON.stringify(goes)});const m=await import(${JSON.stringify(module)});try{m.decodeGrib2ToHalf(new Uint8Array(readFileSync(new URL(${JSON.stringify(fixture)}))));process.exit(1);}catch(e){if(!/5.40 not supported/.test(String(e)))throw e;}`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',code],{timeout:3000});assert.equal(result.status,0,result.stderr?.toString());
});

test('truncated JPEG tile headers and cyclic HDF5 metadata terminate with format errors',()=>{
    const jpeg=new URL('../dist/grib2/models/addons/jpeg2000/codestream.js',import.meta.url).href;
    const hdf=new URL('../dist/goes/hdf5.js',import.meta.url).href;
    const code=`import assert from 'node:assert/strict';import {decodeCodestream} from ${JSON.stringify(jpeg)};import {Hdf5File} from ${JSON.stringify(hdf)};
    const data=new Uint8Array(16);data.set([255,79,255,144,0,10]);assert.throws(()=>decodeCodestream(data),/no SOD/);
    const pre=new Uint8Array(24);pre.set([79,72,68,82,2,0,20]);
    const block=new Uint8Array(20);block.set([16,16,0,0]);new DataView(block.buffer).setBigUint64(12,20n,true);
    const f=new Hdf5File({read:async()=>block},8,8,0,0);await assert.rejects(f.messagesV2(0,pre),/Cyclic HDF5 continuation/);
    const node=new Uint8Array(1000);node.set([84,82,69,69,1,1,1,0]);const tree=new Hdf5File({read:async()=>node},8,8,0,0);await assert.rejects(tree.chunkIndex(0,2),/Cyclic HDF5 chunk/);
    const truncated=new Hdf5File({read:async()=>new Uint8Array([3,10,0,0])},8,8,0,0);await assert.rejects(truncated.messagesV2(0,pre),/Truncated HDF5/);`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',code],{timeout:3000});assert.equal(result.status,0,result.stderr?.toString());
});

test('in-memory ByteSource rejects unsafe and negative ranges before slicing',async()=>{
    const source=new BytesSource(new Uint8Array(8));
    for(const [offset,length] of [[-1,1],[0,-1],[0,NaN],[1.5,1],[2**53,1],[7,2]])await assert.rejects(source.read(offset,length),RangeError);
    assert.equal(source.requests,0);
    assert.equal((await source.read(8,0)).length,0);
});
