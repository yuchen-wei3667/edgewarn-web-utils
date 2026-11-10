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
    assert.deepEqual(Object.keys(grib).sort(),['BUILT_IN_PACKINGS','CCSDS_TEMPLATE','HALF_NAN','JPEG2000_TEMPLATE','decodeCcsds','decodeCcsdsField','decodeGrib2','decodeGrib2ToHalf','decodeGrib2ToLevels','decodeJpeg2000Field','fromHalf','levelFromValues','packedOf','parseEcmwfIndex','parseIdx','physicalOf','readGrib2Grid','registerPacking','toHalf'].sort());
    const nexrad=await import('../dist/nexrad/index.js');
    assert.deepEqual(Object.keys(nexrad).sort(),[
        'AZIMUTH_MISSING',
        'BEAM_HALF_WIDTH_RAD',
        'Bzip2Decoder',
        'ChunkSequence',
        'CutAssembler',
        'EARTH_RADIUS_M',
        'EFFECTIVE_RADIUS_M',
        'ElevationAssembler',
        'LEVEL3_PRODUCT_LETTER',
        'MERCATOR_RADIUS_M',
        'MessageDecoder',
        'NEXRAD_FOLD_COLOR',
        'NEXRAD_MOMENT_OF',
        'NEXRAD_SITES',
        'NEXRAD_SITE_BY_ID',
        'NexradDecoder',
        'bandCovers',
        'beamHeightMeters',
        'boxRangeFrom',
        'buildAzimuthLut',
        'buildElevations',
        'buildSweeps',
        'codeToValue',
        'cropField',
        'decodeLevel3Radial',
        'destinationPoint',
        'elevationMoments',
        'formatAngle',
        'groundRangeAndBearing',
        'groupTilts',
        'hasLevel3Moment',
        'lineRangeFrom',
        'locateGate',
        'materialize',
        'maxRangeMeters',
        'mercatorUnit',
        'mercatorY',
        'momentReadiness',
        'momentsOfKind',
        'ownersOf',
        'padBand',
        'parseLevel3Header',
        'parseTvsProduct',
        'parseVcp',
        'pickElevation',
        'polarColumn',
        'polarProfile',
        'polarValueAt',
        'radarQuad',
        'rangeVerdict',
        'readVcpFromPrefix',
        'sample',
        'shaderGeometryFloat32',
        'slantRangeOf',
    ].sort());
    assert.deepEqual(Object.keys(await import('../dist/goes/index.js')).sort(),[
        'AbiFile',
        'BytesSource',
        'COMPOSITE_TOP_LEVEL',
        'DEFAULT_GOES_SECTOR',
        'GOES_BANDS',
        'GOES_BRIGHTNESS_TEMP_PRODUCTS',
        'GOES_COMPOSITES',
        'GOES_COMPOSITE_HELPERS',
        'GOES_PRODUCTS',
        'GOES_PRODUCT_DESCRIPTIONS',
        'GOES_PRODUCT_LABELS',
        'GOES_PRODUCT_SHORT_LABELS',
        'GOES_REFLECTANCE_PRODUCTS',
        'GOES_RGB_PRODUCTS',
        'GOES_SECTORS',
        'Hdf5File',
        'Hdf5FormatError',
        'InflateError',
        'bandLevelOffset',
        'channelOf',
        'compositeBands',
        'getGoesBand',
        'getGoesComposite',
        'getGoesSector',
        'goesFrameKey',
        'inflate',
        'isGoesBandId',
        'isGoesCompositeId',
        'isGoesSectorId',
        'lonLatToPixel',
        'lonLatToScan',
        'mcmipShift',
        'pixelToLonLat',
        'pyramidFromWire',
        'scanToLonLat',
        'subsolarPoint',
        'topLevel',
        'zenithDeg',
    ].sort());
});
