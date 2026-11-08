import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import * as met from '@edgewarn/web-utils/met';

test('met is isolated from transport, storage, platform globals and other packages', () => {
    for (const name of readdirSync(new URL('../src/', import.meta.url))) {
        const ast = ts.createSourceFile(name, readFileSync(new URL('../src/' + name, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
        function visit(node) {
            if (ts.isIdentifier(node)) assert.ok(!['fetch', 'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'process', 'require'].includes(node.text), `${name}: ${node.text}`);
            if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
            if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
                if (node.moduleSpecifier) assert.match(node.moduleSpecifier.text, /^\.\/[^/]+\.ts$/);
            }
            ts.forEachChild(node, visit);
        }
        visit(ast);
    }
});

test('public surface is exactly 60 functions and four D-M2 constants', async () => {
    assert.deepEqual(Object.keys(met).sort(), [
    "saturationVapourPressure",
    "dewpointFromRelativeHumidity",
    "mixingRatioHpa",
    "lclTemperatureK",
    "equivalentPotentialTemperature",
    "thetaK",
    "thetaC",
    "temperatureFromThetaC",
    "lclTempC",
    "lclPressureHpa",
    "dryLift",
    "virtualTemperatureC",
    "wobf",
    "satLiftC",
    "wetLiftC",
    "wetBulbC",
    "tempAtMixratioC",
    "dryLiftToC",
    "interpolateLogP",
    "heightAt",
    "pressureAt",
    "fieldAt",
    "heightsAgl",
    "heightAglAt",
    "pressureAtAgl",
    "levelOfTemperature",
    "layerMean",
    "exactLayerMean",
    "isLayerValid",
    "surfaceParcelDef",
    "meanLayerParcelDef",
    "mostUnstableParcelDef",
    "effectiveParcelDef",
    "liftColumn",
    "capeCheckColumn",
    "dcapeColumn",
    "lapseRatePressure",
    "lapseRateHeight",
    "precipitableWater",
    "kIndex",
    "totalTotals",
    "showalter",
    "freezingLevelAgl",
    "wetBulbZeroAgl",
    "bulkRichardson",
    "bulkShear",
    "meanWind",
    "bunkersDeviate",
    "bunkersMotion",
    "helicity",
    "effectiveInflowLayer",
    "effectiveBulkShear",
    "criticalAngle",
    "stpFixed",
    "stpEffective",
    "scp",
    "ship",
    "ehi",
    "resolveMotion",
    "analyzeSounding",
    "SOUNDING_CIN_LIMIT_HPA",
    "SOUNDING_GRAVITY",
    "SOUNDING_KELVIN_OFFSET",
    "SOUNDING_RD"
].sort());
    assert.equal(Object.values(met).filter(value => typeof value === 'function').length, 60);
    for (const path of ['met/thermo', 'met/constants', 'packages/met/dist/analyze.js']) {
        await assert.rejects(import('@edgewarn/web-utils/' + path), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    }
});
