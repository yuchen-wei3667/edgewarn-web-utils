import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
const root=new URL('../',import.meta.url);

test('source, runtime and declaration graphs preserve format ownership and portable imports',()=>{
    for(const tree of ['src','dist']){
        for(const file of readdirSync(new URL(tree+'/',root),{recursive:true}).filter(f=>/\.(ts|js)$/.test(f))){
            const text=readFileSync(new URL(`${tree}/${file}`,root),'utf8');
            assert.doesNotMatch(text,/\b(fetch|setInterval|setTimeout|localStorage|window|document)\s*\(|@openmeteo|@\/|config\/models/ ,file);
            for(const [,specifier]of text.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)){
                assert.ok(specifier.startsWith('.'),`${file}: external ${specifier}`);
                const target=posix.normalize(posix.join(posix.dirname(file),specifier));
                if(file.startsWith('internal/'))assert.ok(target.startsWith('internal/'),`${file} -> ${target}`);
                for(const format of ['grib2','nexrad','goes'])if(file.startsWith(format+'/'))assert.ok(target.startsWith(format+'/')||target.startsWith('internal/'),`${file} -> ${target}`);
                for(const mode of ['models','mrms'])if(file.startsWith(`grib2/${mode}/`))assert.ok(!target.startsWith(`grib2/${mode==='models'?'mrms':'models'}/`),`${file} -> ${target}`);
            }
        }
    }
});

test('public runtime surface matches the decoding-only contract',async()=>{
    const api=await import('../dist/index.js');assert.deepEqual(Object.keys(api).sort(),['DecodeBudgetExceededError','EdgeWARNDecoder']);
    const grib=await import('../dist/grib2/index.js');
    assert.deepEqual(Object.keys(grib).sort(),['BUILT_IN_PACKINGS','CCSDS_TEMPLATE','JPEG2000_TEMPLATE','decodeCcsds','decodeCcsdsField','decodeGrib2','decodeGrib2ToHalf','decodeGrib2ToLevels','decodeJpeg2000Field','parseEcmwfIndex','parseIdx','readGrib2Grid','registerPacking'].sort());
    const nexrad=await import('../dist/nexrad/index.js');
    assert.deepEqual(Object.keys(nexrad).sort(),['AZIMUTH_MISSING','Bzip2Decoder','CutAssembler','MessageDecoder','NexradDecoder','buildAzimuthLut','decodeLevel3Radial','destinationPoint','materialize','momentsOfKind','parseLevel3Header','parseTvsProduct','parseVcp','readVcpFromPrefix','sample'].sort());
    assert.deepEqual(Object.keys(await import('../dist/goes/index.js')).sort(),['AbiFile','BytesSource','Hdf5FormatError','InflateError']);
});
