import * as assert from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { analyzeDocument } from '../lsp/server/analyzer';
import {
    getMissingModuleDiagnostics,
    computeAddModuleEdits,
    MISSING_MODULE_CODE,
    type MissingModuleInfo,
} from '../lsp/server/moduleImports';

function makeDoc(text: string): TextDocument {
    return TextDocument.create('file:///test.js', 'javascript', 1, text);
}

function editsToString(doc: TextDocument, edits: { range: { start: any; end: any }; newText: string }[] | null): string {
    if (!edits) { return '<no edits>'; }
    // Apply edits from last to first (assume non-overlapping).
    const spans = edits.map(e => ({
        start: doc.offsetAt(e.range.start),
        end: doc.offsetAt(e.range.end),
        newText: e.newText,
    })).sort((a, b) => b.start - a.start);
    let text = doc.getText();
    for (const s of spans) {
        text = text.substring(0, s.start) + s.newText + text.substring(s.end);
    }
    return text;
}

suite('Missing Module Quick Fix Test Suite', () => {
    test('Detects unimported module usage', () => {
        const text = `
            define(['N/record'], (record) => {
                const s = search.create({ type: 'salesorder' });
                return {};
            });
        `;
        const doc = makeDoc(text);
        const diags = getMissingModuleDiagnostics(doc, analyzeDocument(text));
        assert.strictEqual(diags.length, 1, `expected 1 diagnostic, got ${diags.length}`);
        assert.strictEqual(diags[0].code, MISSING_MODULE_CODE);
        assert.deepStrictEqual(diags[0].data satisfies MissingModuleInfo, { module: 'N/search', varName: 'search' });
    });

    test('No diagnostic when module is imported', () => {
        const text = `
            define(['N/search'], (search) => {
                const s = search.create({ type: 'salesorder' });
            });
        `;
        const doc = makeDoc(text);
        const diags = getMissingModuleDiagnostics(doc, analyzeDocument(text));
        assert.strictEqual(diags.length, 0);
    });

    test('No diagnostic for non-module-looking vars', () => {
        const text = `
            define([], () => {
                const x = myThing.doStuff(1);
            });
        `;
        const doc = makeDoc(text);
        const diags = getMissingModuleDiagnostics(doc, analyzeDocument(text));
        assert.strictEqual(diags.length, 0);
    });

    test('Edit appends module to existing define deps and params', () => {
        const before = "define(['N/record'], (record) => {\n    record.load({ type: 'salesorder' });\n});\n";
        const doc = makeDoc(before);
        const edits = computeAddModuleEdits(before, 'N/search');
        const after = editsToString(doc, edits as any);
        assert.ok(after.includes("'N/record', 'N/search'"), `deps not appended: ${after}`);
        assert.ok(after.includes('(record, search)'), `params not appended in dependency order: ${after}`);
        assert.ok(after.includes("record.load"), 'original code preserved');
    });

    test('Edit adds module to empty deps array', () => {
        const before = "define([], () => {\n    search.create({});\n});\n";
        const doc = makeDoc(before);
        const edits = computeAddModuleEdits(before, 'N/search');
        const after = editsToString(doc, edits as any);
        assert.ok(after.includes("['N/search']"), `array not filled: ${after}`);
        assert.ok(/\(search\s*\)|\(search,/.test(after) || /\(\s*search/.test(after), `param not added: ${after}`);
    });

    test('Edit adds deps array to define without one', () => {
        const before = "define((context) => {\n    search.create({});\n});\n";
        const doc = makeDoc(before);
        const edits = computeAddModuleEdits(before, 'N/search');
        const after = editsToString(doc, edits as any);
        assert.ok(after.includes("define(['N/search'],"), `array not inserted: ${after}`);
        assert.ok(after.includes('(search, context)'), `param not prepended: ${after}`);
    });

    test('Returns null for code without define', () => {
        assert.strictEqual(computeAddModuleEdits('const x = 1;', 'N/search'), null);
    });

    test('Does not generate invalid edits after a rest parameter', () => {
        const before = "define(['N/record'], (...modules) => { search.create({}); });";
        assert.strictEqual(computeAddModuleEdits(before, 'N/search'), null);
    });

    test('Preserves a separator when existing dependencies use spaced commas', () => {
        const before = "define(['N/record' , 'N/runtime'], (record, runtime) => { search.create({}); });";
        const after = editsToString(makeDoc(before), computeAddModuleEdits(before, 'N/search') as any);
        assert.ok(after.includes("'N/runtime', 'N/search'"), `missing dependency separator: ${after}`);
    });

    test('Closes the parameter list for an unparenthesized arrow callback', () => {
        const before = 'define(context => { search.create({}); });';
        const after = editsToString(makeDoc(before), computeAddModuleEdits(before, 'N/search') as any);
        assert.strictEqual(after, "define(['N/search'], (search, context) => { search.create({}); });");
    });

    test('Inserts a dependency before a trailing line comment', () => {
        const before = `define([\n  'N/record' // core module\n], (record) => { search.create({}); });`;
        const after = editsToString(makeDoc(before), computeAddModuleEdits(before, 'N/search') as any);
        assert.ok(after.includes("'N/record', 'N/search' // core module"), `dependency was commented out: ${after}`);
        assert.strictEqual(analyzeDocument(after).moduleMap.get('search'), 'N/search');
    });

    test('Ignores module-looking calls in comments and strings', () => {
        const text = `define([], () => {
            /* search.create({}) */
            const note = 'search.create()';
        });`;
        const doc = makeDoc(text);
        assert.strictEqual(getMissingModuleDiagnostics(doc, analyzeDocument(text)).length, 0);
    });

    test('Ignores a locally declared object that shares a module alias', () => {
        const text = `define([], () => {
            const search = { create() { return {}; } };
            search.create();
        });`;
        const doc = makeDoc(text);
        assert.strictEqual(getMissingModuleDiagnostics(doc, analyzeDocument(text)).length, 0);
    });
});
