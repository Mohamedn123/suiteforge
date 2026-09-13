import * as assert from 'assert';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TextDocumentEdit, WorkspaceEdit } from 'vscode-languageserver/node';
import { DefinitionHost, getDefinition } from '../lsp/server/definitions';
import { getCustomCompletions, getCustomHover, getCustomSignature } from '../lsp/server/customIntelliSense';
import { findSymbolReferences, prepareSymbolRename, renameSymbol } from '../lsp/server/workspaceSymbols';

function fixture(files: Record<string, string>, selected = 'main.js') {
    const docs = Object.entries(files).map(([name, text]) => TextDocument.create(
        pathToFileURL(path.resolve('custom-fixture', name)).href, 'javascript', 1, text.replace('|', '')));
    const document = docs[Object.keys(files).indexOf(selected)];
    const position = document.positionAt(files[selected].indexOf('|'));
    const host: DefinitionHost = { readDocument: async uri => docs.find(doc => doc.uri === uri) };
    return { docs, document, position, host };
}

function applyWorkspaceEdit(docs: TextDocument[], edit: WorkspaceEdit): TextDocument[] {
    return docs.map(doc => {
        const changes = edit.documentChanges?.find((change): change is TextDocumentEdit => TextDocumentEdit.is(change) && change.textDocument.uri === doc.uri);
        return changes ? TextDocument.create(doc.uri, 'javascript', doc.version + 1, TextDocument.applyEdits(doc, changes.edits)) : doc;
    });
}

suite('V3 custom module IntelliSense', () => {
    test('completes exported functions with parameter types, return types and JSDoc', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], helpers => { helpers.| });`, 'lib.js': `define([], () => {
/** Calculates a total.
 * @param {number} amount - Amount to calculate.
 * @param {number} [tax=0] - Tax amount.
 * @returns {number}
 */
function calculate(amount, tax = 0) { return amount + tax; }
return { calculate };
});` });
        const items = await getCustomCompletions(f.document, f.position, f.host);
        assert.deepStrictEqual(items.map(item => item.label), ['calculate']);
        assert.match(items[0].detail!, /calculate\(amount: number, tax = 0: number\): number/);
        assert.match(JSON.stringify(items[0].documentation), /Calculates a total/);
    });

    test('completes nested objects and aliases without leaking shadowed modules', async () => {
        for (const [caller, expected] of [
            [`define(['./lib'], lib => { lib.math.| });`, ['calculate']],
            [`define(['./lib'], lib => { const math = lib.math; math.ca| });`, ['calculate']],
            [`define(['./lib'], lib => { function inner(lib) { lib.| } });`, []],
        ] as const) {
            const f = fixture({ 'main.js': caller, 'lib.js': 'define([], () => ({ math: { calculate() {} } }));' });
            assert.deepStrictEqual((await getCustomCompletions(f.document, f.position, f.host)).map(item => item.label), [...expected]);
        }
    });

    test('shows hover and signature information for a cross-file function alias', async () => {
        const files = { 'main.js': `define(['./lib'], lib => { lib.ca|lculate(1, 2); });`,
            'lib.js': 'define([], () => { /** Adds amounts. */ function sum(left, right) {} return { calculate: sum }; });' };
        let f = fixture(files);
        assert.match(JSON.stringify(await getCustomHover(f.document, f.position, f.host)), /calculate\(left, right\)/);
        f = fixture({ ...files, 'main.js': `define(['./lib'], lib => { lib.calculate(1, |); });` });
        const signature = await getCustomSignature(f.document, f.position, f.host);
        assert.strictEqual(signature?.signatures[0].label, 'calculate(left, right)');
        assert.strictEqual(signature?.activeParameter, 1);
    });

    test('handles an unfinished call without editing the real buffer', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], lib => { lib.calculate(| });`, 'lib.js': 'define([], () => ({ calculate(amount) {} }));' });
        assert.strictEqual((await getCustomSignature(f.document, f.position, f.host))?.signatures[0].label, 'calculate(amount)');
        assert.ok(f.document.getText().includes('calculate( }'));
    });

    test('preserves built-in module completion fallback', async () => {
        const f = fixture({ 'main.js': `define(['N/record'], record => { record.| });` });
        assert.deepStrictEqual(await getCustomCompletions(f.document, f.position, f.host), []);
    });

    test('completes CommonJS named exports and ES namespace imports', async () => {
        for (const [caller, library] of [
            [`const lib = require('./lib'); lib.|`, 'exports.calculate = function calculate(amount) {};'],
            [`import * as lib from './lib'; lib.|`, 'export function calculate(amount) {}'],
        ]) {
            const f = fixture({ 'main.js': caller, 'lib.js': library });
            const items = await getCustomCompletions(f.document, f.position, f.host);
            assert.deepStrictEqual(items.map(item => item.label), ['calculate']);
            assert.strictEqual(items[0].detail, 'calculate(amount)');
        }
    });

    test('uses edited module contents for subsequent completion requests', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], lib => { lib.| });`, 'lib.js': 'define([], () => ({ calculate() {} }));' });
        assert.strictEqual((await getCustomCompletions(f.document, f.position, f.host))[0]?.label, 'calculate');
        f.docs[1] = TextDocument.create(f.docs[1].uri, 'javascript', 2, 'define([], () => ({ compute() {} }));');
        assert.strictEqual((await getCustomCompletions(f.document, f.position, f.host))[0]?.label, 'compute');
    });
});

suite('V3 references and safe rename', () => {
    const library = 'define([], () => { function calculate(amount) { return amount; } return { calculate }; });';

    test('finds the declaration, export and callers across files without same-name false matches', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], lib => { lib.ca|lculate(1); });`, 'lib.js': library,
            'other.js': `define(['./lib'], other => { const run = other.calculate; run(2); });`,
            'unrelated.js': 'const lib = { calculate() {} }; lib.calculate(); // calculate' });
        const refs = await findSymbolReferences(f.document, f.position, f.docs, f.host, true);
        assert.strictEqual(refs.length, 6);
        assert.ok(refs.every(ref => !ref.uri.endsWith('/unrelated.js')));
        const without = await findSymbolReferences(f.document, f.position, f.docs, f.host, false);
        assert.strictEqual(without.length, 5);
    });

    test('renames a function, shorthand exports and callers as one previewable workspace edit', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], lib => { lib.ca|lculate(1); });`, 'lib.js': library,
            'other.js': `define(['./lib'], other => { other['calculate'](2); });` });
        const edit = await renameSymbol(f.document, f.position, 'compute', f.docs, f.host);
        assert.strictEqual(edit.changeAnnotations?.['suiteforge.rename'].needsConfirmation, true);
        assert.strictEqual(edit.documentChanges?.length, 3);
        const updated = applyWorkspaceEdit(f.docs, edit);
        assert.ok(updated.every(doc => !doc.getText().includes('calculate')));
        const host = { readDocument: async (uri: string) => updated.find(doc => doc.uri === uri) };
        const caller = updated[0];
        assert.strictEqual((await getDefinition(caller, caller.positionAt(caller.getText().indexOf('compute')), host))[0]?.uri, updated[1].uri);
        assert.ok(f.document.getText().includes('calculate'), 'Rename must not apply edits on the server');
    });

    test('renames an exported alias without changing its implementation name', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], lib => lib.ca|lculate());`,
            'lib.js': 'define([], () => { function sum() {} return { calculate: sum }; });' });
        const updated = applyWorkspaceEdit(f.docs, await renameSymbol(f.document, f.position, 'compute', f.docs, f.host));
        assert.ok(updated[1].getText().includes('function sum()'));
        assert.ok(updated[1].getText().includes('compute: sum'));
    });

    test('renames the implementation while preserving a separately named public API', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], lib => lib.calculate());`,
            'lib.js': 'define([], () => { function su|m() {} return { calculate: sum }; });' }, 'lib.js');
        const updated = applyWorkspaceEdit(f.docs, await renameSymbol(f.document, f.position, 'add', f.docs, f.host));
        assert.ok(updated[0].getText().includes('lib.calculate'));
        assert.ok(updated[1].getText().includes('calculate: add'));
    });

    test('renames a local function alias without changing its module API', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], lib => { const run = lib.calculate; ru|n(); });`, 'lib.js': library });
        const updated = applyWorkspaceEdit(f.docs, await renameSymbol(f.document, f.position, 'execute', f.docs, f.host));
        assert.strictEqual(updated[1].getText(), library);
        assert.ok(updated[0].getText().includes('const execute = lib.calculate; execute()'));
    });

    test('preserves shorthand destructured and ES imports when renaming only the local binding', async () => {
        for (const caller of [
            `const { calculate } = require('./lib'); ca|lculate();`,
            `import { calculate } from './lib'; ca|lculate();`,
        ]) {
            const f = fixture({ 'main.js': caller, 'lib.js': 'export function calculate() {}' });
            const updated = applyWorkspaceEdit(f.docs, await renameSymbol(f.document, f.position, 'run', f.docs, f.host));
            assert.ok(/calculate(?::| as) run/.test(updated[0].getText()));
            assert.strictEqual(updated[1].getText(), 'export function calculate() {}');
        }
    });

    test('rejects invalid identifiers, collisions and dynamic callers', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], lib => lib.ca|lculate());`,
            'lib.js': 'define([], () => ({ calculate() {}, compute() {} }));' });
        for (const name of ['1bad', 'class', 'bad-name', 'compute']) {
            await assert.rejects(() => renameSymbol(f.document, f.position, name, f.docs, f.host));
        }
        const dynamic = fixture({ 'main.js': `define(['./lib'], lib => { lib.ca|lculate(); lib[someName](); });`, 'lib.js': library });
        await assert.rejects(() => renameSymbol(dynamic.document, dynamic.position, 'compute', dynamic.docs, dynamic.host), /dynamic/);
    });

    test('rejects syntax errors and concurrent source edits instead of applying partial changes', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], lib => lib.ca|lculate());`, 'lib.js': library, 'broken.js': 'const x = (' });
        await assert.rejects(() => renameSymbol(f.document, f.position, 'compute', f.docs, f.host), /syntax errors/);
        f.docs.pop();
        const changing: DefinitionHost = { readDocument: async uri => {
            const doc = await f.host.readDocument(uri);
            return doc && TextDocument.create(doc.uri, doc.languageId, doc.version + 1, doc.getText() + '\n');
        } };
        await assert.rejects(() => renameSymbol(f.document, f.position, 'compute', f.docs, changing), /changed during rename/);
    });

    test('prepares only resolvable symbols and handles cancellation', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], lib => lib.ca|lculate());`, 'lib.js': library });
        assert.strictEqual((await prepareSymbolRename(f.document, f.position, f.host))?.placeholder, 'calculate');
        const cancelled = { isCancellationRequested: true, onCancellationRequested: () => ({ dispose() {} }) };
        await assert.rejects(() => renameSymbol(f.document, f.position, 'compute', f.docs, f.host, cancelled), /cancelled/);
    });

    test('finds and renames references that inherit entry-point AMD configuration', async () => {
        const f = fixture({
            'main.js': `/** @NAmdConfig ./config.json */ define(['helpers/wrapper'], lib => lib.ca|lculate());`,
            'config.json': '{"paths":{"helpers":"./lib"}}',
            'lib/wrapper.js': `define(['helpers/math'], math => ({ calculate: math.calculate }));`,
            'lib/math.js': 'define([], () => ({ calculate() {} }));',
        });
        const sources = f.docs.filter(doc => !doc.uri.endsWith('.json'));
        const refs = await findSymbolReferences(f.document, f.position, sources, f.host, true);
        assert.ok(refs.some(ref => ref.uri.endsWith('/wrapper.js')));
        const updated = applyWorkspaceEdit(sources, await renameSymbol(f.document, f.position, 'compute', sources, f.host));
        assert.ok(updated.every(doc => !doc.getText().includes('calculate')));
    });

    test('refuses ambiguous module mappings shared by multiple entry points', async () => {
        const f = fixture({
            'main.js': `/** @NAmdConfig ./a.json */ define(['./wrapper'], lib => lib.ca|lculate());`,
            'second.js': `/** @NAmdConfig ./b.json */ define(['./wrapper'], lib => lib.calculate());`,
            'a.json': '{"paths":{"math":"./one"}}', 'b.json': '{"paths":{"math":"./two"}}',
            'wrapper.js': `define(['math'], math => ({ calculate: math.calculate }));`,
            'one.js': 'define([], () => ({ calculate() {} }));', 'two.js': 'define([], () => ({ calculate() {} }));',
        });
        await assert.rejects(() => renameSymbol(f.document, f.position, 'compute', f.docs.filter(doc => !doc.uri.endsWith('.json')), f.host), /ambiguous/);
    });

    test('refuses conditional exports instead of renaming only one runtime branch', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], lib => lib.ca|lculate());`,
            'lib.js': 'define([], () => { if (condition) { return { calculate() {} }; } return { calculate() {} }; });' });
        await assert.rejects(() => renameSymbol(f.document, f.position, 'compute', f.docs, f.host), /ambiguous/);
    });

    test('renames a module parameter and preserves function aliases in re-exporting modules', async () => {
        const f = fixture({ 'main.js': `define(['./lib'], he|lpers => { helpers.calculate(); });`, 'lib.js': library });
        const updated = applyWorkspaceEdit(f.docs, await renameSymbol(f.document, f.position, 'math', f.docs, f.host));
        assert.ok(updated[0].getText().includes('math => { math.calculate()'));
        assert.strictEqual(updated[1].getText(), library);
        const g = fixture({ 'main.js': `define(['./wrapper'], lib => lib.run());`,
            'wrapper.js': `define(['./lib'], lib => ({ run: lib.calculate }));`,
            'lib.js': library.replace('function calculate', 'function cal|culate') }, 'lib.js');
        const changed = applyWorkspaceEdit(g.docs, await renameSymbol(g.document, g.position, 'compute', g.docs, g.host));
        assert.ok(changed[0].getText().includes('lib.run()'));
        assert.ok(changed[1].getText().includes('run: lib.compute'));
    });

    test('preserves TypeScript annotations on function variables', async () => {
        const f = fixture({ 'main.js': `define(['./lib.ts'], lib => lib.ca|lculate());`,
            'lib.ts': 'export const calculate: (amount: number) => number = (amount) => amount;' });
        const updated = applyWorkspaceEdit(f.docs, await renameSymbol(f.document, f.position, 'compute', f.docs, f.host));
        assert.ok(updated[1].getText().includes('compute: (amount: number) => number'));
    });
});
