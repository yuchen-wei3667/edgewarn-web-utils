import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {webpack}=require(resolve(process.argv[2]));
const dir=mkdtempSync('/tmp/edgewarn-decoder-bundle-');
const repo=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const grib=JSON.stringify(repo+'/dist/grib2/index.js');
const entries={
 base:`export {decodeGrib2,BUILT_IN_PACKINGS} from ${grib};`,
 codecs:`export {decodeGrib2,registerPacking,JPEG2000_TEMPLATE,decodeJpeg2000Field,CCSDS_TEMPLATE,decodeCcsdsField} from ${grib};`,
 all:`export {EdgeWARNDecoder} from ${JSON.stringify(repo+'/dist/index.js')};export * from ${grib};`,
 root:`export {EdgeWARNDecoder} from ${JSON.stringify(repo+'/dist/index.js')};`,
};
const results=[];
for(const [name,source] of Object.entries(entries)){
 const entry=dir+'/'+name+'.mjs';writeFileSync(entry,source);const out=dir+'/'+name;mkdirSync(out,{recursive:true});
 const stats=await new Promise((ok,fail)=>{webpack({mode:'production',target:'webworker',entry,output:{path:out,filename:'index.mjs',library:{type:'module'},chunkFormat:'module',chunkLoading:'import'},experiments:{outputModule:true},optimization:{minimize:false}},(err,stats)=>err?fail(err):stats.hasErrors()?fail(Error(stats.toString({all:false,errors:true}))):ok(stats));});
 const json=stats.toJson({all:false,modules:true,assets:true,chunkModules:true});
 const moduleNames=JSON.stringify(json.modules?.filter(m=>m.chunks?.length));
 if(name==='base'){assert.ok(!moduleNames.includes('jpeg2000/codestream'));assert.ok(!moduleNames.includes('ccsds/decode'));assert.ok(!readFileSync(out+'/index.mjs','utf8').includes('JPEG 2000 code stream'));}
 const api=await import(pathToFileURL(out+'/index.mjs'));
 const message=new Uint8Array(readFileSync(repo+'/test/fixtures/models/jpeg2000/rap-tmp2m-f06.grib2'));
 if(name==='codecs'||name==='all'){
  assert.throws(()=>api.decodeGrib2(message,{mode:'model',output:'half'}),/5.40 not supported/);
  api.registerPacking(api.JPEG2000_TEMPLATE,api.decodeJpeg2000Field);
  assert.equal(api.decodeGrib2(message,{mode:'model',output:'half'}).grid.nx,451);
  api.registerPacking(api.CCSDS_TEMPLATE,api.decodeCcsdsField);
  const ccsds=new Uint8Array(readFileSync(repo+'/test/fixtures/models/ecmwf-ifs/t00z-f012-2t.grib2'));
  assert.ok(api.decodeGrib2(ccsds,{mode:'model',output:'half'}).data.length>0);
  // MRMS keeps its stream dispatch after bundling.
  const {buildSimpleGrib,chunkedStream}=await import(pathToFileURL(repo+'/test/fixtures/mrms/grib2-builder.mjs'));
  const result=await api.decodeGrib2(chunkedStream(buildSimpleGrib({ni:2,nj:2,nbits:8,values:[1,2,3,4]})).stream,{mode:'mrms',sink:{begin(){},row(){}}});assert.equal(result.rowsRead,2);
 }
 if(name==='all'){ const d=new api.EdgeWARNDecoder({memoryLimitBytes:32*1024*1024});assert.equal((await d.decode(message,{format:'grib2',mode:'model',output:'half'})).grid.nx,451); }
 if(name==='root'){
  const d=new api.EdgeWARNDecoder({memoryLimitBytes:32*1024*1024});
  const image=await d.decode(new Uint8Array(readFileSync(repo+'/test/fixtures/goes/abi-mini.nc')),{format:'goes'});assert.equal(image.width,90);
 }
 results.push({entry:name,assets:json.assets.map(({name,size})=>({name,size})),checks:'passed'});
}
writeFileSync(repo+'/bench/bundles.json',JSON.stringify({bundler:'Next.js installed compiled webpack; production webworker target, module chunks, minimization disabled (installed Next terser plugin absent); not a Website production build',results},null,2)+'\n');rmSync(dir,{recursive:true,force:true});console.log(JSON.stringify(results));
