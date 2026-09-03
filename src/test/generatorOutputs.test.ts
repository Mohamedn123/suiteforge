import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import { sdfScriptTypes } from '../data';
import { buildScriptContent } from '../generators/script';
import { SDF_OBJECTS } from '../generators/sdfObjectRegistry';
import { analyzeDocument } from '../lsp/server/analyzer';

suite('Generator Output Test Suite', () => {
    test('Every script type produces valid JavaScript with aligned module bindings', () => {
        for (const scriptType of sdfScriptTypes) {
            const output = buildScriptContent(scriptType, 'audit_script', ['N/record', 'N/search']);
            assert.doesNotThrow(
                () => parse(output, { sourceType: 'script' }),
                `${scriptType.id} generated invalid JavaScript`,
            );
            const analysis = analyzeDocument(output);
            assert.strictEqual(analysis.moduleMap.get('record'), 'N/record', scriptType.id);
            assert.strictEqual(analysis.moduleMap.get('search'), 'N/search', scriptType.id);
            assert.ok(output.includes(`@NScriptType ${scriptType.scriptTypeAnnotation}`), scriptType.id);
        }
    });

    test('Every registered SDF object has a packaged template with the declared root tag', () => {
        const templateRoot = path.resolve(__dirname, '..', '..', 'templates', 'sdf');
        for (const object of SDF_OBJECTS) {
            const templatePath = path.join(templateRoot, `${object.type}.xml`);
            assert.ok(fs.existsSync(templatePath), `missing template: ${object.type}.xml`);
            const xml = fs.readFileSync(templatePath, 'utf8');
            const root = /^\s*(?:<\?xml[^>]*>\s*)?<([A-Za-z][A-Za-z0-9_.-]*)\b/.exec(xml)?.[1];
            assert.strictEqual(root, object.rootTag, `${object.type}.xml root tag`);
            assert.ok(xml.includes('{{SCRIPTID}}'), `${object.type}.xml has no SCRIPTID placeholder`);
        }
    });
});
