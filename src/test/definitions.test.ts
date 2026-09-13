import * as assert from 'assert';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createDefinitionHost, DefinitionHost, getDefinition, moduleFileCandidates } from '../lsp/server/definitions';

const root = path.resolve('definition-fixtures', 'src', 'FileCabinet');
const uri = (name: string): string => pathToFileURL(path.join(root, name)).href;
const makeDoc = (name: string, text: string): TextDocument => TextDocument.create(uri(name), 'javascript', 1, text);

async function lookup(caller: string, modules: Record<string, string>, name = 'SuiteScripts/main.js') {
    const offset = caller.indexOf('|');
    assert.ok(offset >= 0, 'Specify the cursor with |');
    const document = makeDoc(name, caller.replace('|', ''));
    const docs = new Map(Object.entries(modules).map(([file, text]) => [uri(file), makeDoc(file, text)]));
    const host: DefinitionHost = { readDocument: async file => docs.get(file) };
    const results = await getDefinition(document, document.positionAt(offset), host);
    return results.map(result => {
        const target = docs.get(result.uri) ?? document;
        return { file: result.uri, text: target.getText(result.range), line: result.range.start.line };
    });
}

suite('Cross-file definitions', () => {
    test('follows AMD exports to the original function, with dependency aliases', async () => {
        const result = await lookup(`define(['N/record', './lib'], (record, helpers) => { helpers.ca|lculate(); });`, {
            'SuiteScripts/lib.js': `define([], () => {\n function calculateTotal() {}\n return { calculate: calculateTotal }; });`,
        });
        assert.deepStrictEqual(result, [{ file: uri('SuiteScripts/lib.js'), text: 'calculateTotal', line: 1 }]);
    });

    test('handles shorthand, inline arrow functions and object methods', async () => {
        for (const body of [
            'const calculate = () => {}; return { calculate };',
            'return { calculate: () => {} };',
            'return { calculate() {} };',
        ]) {
            const result = await lookup(`define(['./lib.js'], helpers => helpers.cal|culate());`, { 'SuiteScripts/lib.js': `define([], () => { ${body} });` });
            assert.strictEqual(result[0]?.text, 'calculate');
            assert.strictEqual(result[0]?.file, uri('SuiteScripts/lib.js'));
        }
    });

    test('follows named AMD modules, parent paths, and directly exported functions', async () => {
        const result = await lookup(`define('entry', ['../lib'], function (run) { r|un(); });`, {
            'SuiteScripts/lib.js': `define('lib', [], function () { return function execute() {}; });`,
        }, 'SuiteScripts/sub/main.js');
        assert.strictEqual(result[0]?.text, 'execute');
    });

    test('adds the JavaScript extension to dotted module filenames', async () => {
        const result = await lookup(`define(['./helpers.math'], lib => lib.ca|lculate());`, {
            'SuiteScripts/helpers.math.js': 'define([], () => ({ calculate() {} }));',
        });
        assert.strictEqual(result[0]?.file, uri('SuiteScripts/helpers.math.js'));
    });

    test('resolves require callbacks including the AMD contextual require dependency', async () => {
        for (const caller of [
            `require(['./lib'], helpers => helpers.ca|lculate());`,
            `define(['require'], function(require) { require(['./lib'], helpers => helpers.ca|lculate()); });`,
        ]) {
            const result = await lookup(caller, { 'SuiteScripts/lib.js': 'define([], () => ({ calculate() {} }));' });
            assert.strictEqual(result[0]?.text, 'calculate');
        }
    });

    test('follows destructured and member aliases and static bracket access', async () => {
        for (const call of [
            'const { calculate: run } = helpers; r|un();',
            'const run = helpers.calculate; r|un();',
            'helpers["cal|culate"]();',
            'helpers?.cal|culate();',
        ]) {
            const result = await lookup(`define(['./lib'], helpers => { ${call} });`, { 'SuiteScripts/lib.js': 'define([], () => ({ calculate() {} }));' });
            assert.strictEqual(result[0]?.text, 'calculate');
        }
    });

    test('resolves File Cabinet absolute paths to the importing project', async () => {
        for (const dependency of ['/SuiteScripts/lib', 'SuiteScripts/lib', '/SuiteApps/com.example/lib']) {
            const file = dependency.replace(/^\//, '') + '.js';
            const result = await lookup(`define(['${dependency}'], helpers => helpers.ca|lculate());`, { [file]: 'define([], () => ({ calculate() {} }));' });
            assert.strictEqual(result[0]?.file, uri(file));
        }
    });

    test('follows re-exported members through multiple custom modules', async () => {
        const result = await lookup(`define(['./wrapper'], helpers => helpers.ca|lculate());`, {
            'SuiteScripts/wrapper.js': `define(['./lib'], lib => ({ calculate: lib.run }));`,
            'SuiteScripts/lib.js': 'define([], () => { function implementation() {} return { run: implementation }; });',
        });
        assert.strictEqual(result[0]?.text, 'implementation');
        assert.strictEqual(result[0]?.file, uri('SuiteScripts/lib.js'));
    });

    test('supports nested objects and object exports stored in variables', async () => {
        const result = await lookup(`define(['./lib'], helpers => helpers.math.ca|lculate());`, {
            'SuiteScripts/lib.js': 'define([], () => { const api = { math: { calculate() {} } }; return api; });',
        });
        assert.strictEqual(result[0]?.text, 'calculate');
    });

    test('resolves static NAmdConfig path aliases and inherits them through dependencies', async () => {
        const result = await lookup(`/** @NAmdConfig ./config.json */\ndefine(['helpers/wrapper'], lib => lib.ca|lculate());`, {
            'SuiteScripts/config.json': JSON.stringify({ paths: { helpers: '/SuiteScripts/lib' } }),
            'SuiteScripts/lib/wrapper.js': `define(['helpers/math'], math => ({ calculate: math.run }));`,
            'SuiteScripts/lib/math.js': 'define([], () => ({ run() {} }));',
        });
        assert.strictEqual(result[0]?.file, uri('SuiteScripts/lib/math.js'));
        assert.strictEqual(result[0]?.text, 'run');
    });

    test('supports AMD exports assignments', async () => {
        const result = await lookup(`define(['./lib'], lib => lib.ca|lculate());`, {
            'SuiteScripts/lib.js': `define(['exports'], function (exports) { function implementation() {} exports.calculate = implementation; });`,
        });
        assert.strictEqual(result[0]?.text, 'implementation');
    });

    test('supports local CommonJS helpers and ES imports', async () => {
        for (const [caller, library] of [
            [`const helpers = require('./lib'); helpers.ca|lculate();`, 'exports.calculate = function implementation() {};'],
            [`const { calculate } = require('./lib'); ca|lculate();`, 'module.exports = { calculate: function implementation() {} };'],
            [`import { calculate as run } from './lib'; r|un();`, 'export function calculate() {}'],
            [`import run from './lib'; r|un();`, 'export default function calculate() {}'],
        ]) {
            const result = await lookup(caller, { 'SuiteScripts/lib.js': library });
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0]?.file, uri('SuiteScripts/lib.js'));
        }
    });

    test('does not confuse shadowed parameters or local loaders with module imports', async () => {
        const modules = { 'SuiteScripts/lib.js': 'define([], () => ({ calculate() {} }));' };
        for (const caller of [
            `define(['./lib'], helpers => { function inner(helpers) { helpers.ca|lculate(); } });`,
            `function define(a, b) {} define(['./lib'], helpers => helpers.ca|lculate());`,
            `function require(a) {} const helpers = require('./lib'); helpers.ca|lculate();`,
            `define(['./lib'], helpers => { const key = 'calculate'; helpers[k|ey](); });`,
            `define(['./lib'], helpers => { helpers = {}; helpers.ca|lculate(); });`,
        ]) {
            const result = await lookup(caller, modules);
            assert.ok(result.every(target => target.file !== uri('SuiteScripts/lib.js')));
        }
    });

    test('ignores nested function returns when determining module exports', async () => {
        const result = await lookup(`define(['./lib'], helpers => helpers.ca|lculate());`, {
            'SuiteScripts/lib.js': 'define([], () => { function unrelated() { return { calculate() {} }; } return {}; });',
        });
        assert.deepStrictEqual(result, []);
    });

    test('handles missing files, built-in modules, invalid syntax and circular re-exports', async () => {
        assert.deepStrictEqual(await lookup(`define(['./missing'], lib => lib.ca|lculate());`, {}), []);
        assert.deepStrictEqual(await lookup(`define(['N/record'], record => record.cr|eate());`, {}), []);
        assert.deepStrictEqual(await lookup(`define(['./lib'], lib => lib.ca|lculate());`, { 'SuiteScripts/lib.js': 'define([' }), []);
        assert.deepStrictEqual(await lookup(`define(['./a'], lib => lib.ca|lculate());`, {
            'SuiteScripts/a.js': `define(['./b'], b => b);`,
            'SuiteScripts/b.js': `define(['./a'], a => a);`,
        }), []);
    });

    test('opens the custom module when clicking its dependency string', async () => {
        const result = await lookup(`define(['./l|ib'], lib => {});`, { 'SuiteScripts/lib.js': 'define([], () => ({}));' });
        assert.deepStrictEqual(result, [{ file: uri('SuiteScripts/lib.js'), text: '', line: 0 }]);
    });

    test('preserves same-file lexical function navigation', async () => {
        const result = await lookup('function calculate() {}\nca|lculate();', {});
        assert.deepStrictEqual(result, [{ file: uri('SuiteScripts/main.js'), text: 'calculate', line: 0 }]);
    });

    test('prefers open buffers even when a URI uses different percent encoding', async () => {
        const canonical = uri('SuiteScripts/lib.js');
        const open = TextDocument.create(canonical.replace('lib.js', '%6Cib.js'), 'javascript', 2, 'define([], () => ({ calculate() {} }));');
        const host = createDefinitionHost(() => [open]);
        assert.strictEqual(await host.readDocument(canonical), open);
    });

    test('does not construct local targets for built-ins, remote URLs or loader plugins', () => {
        for (const id of ['N/record', 'https://example.com/lib', 'text!./file', 'require', '/../../lib']) {
            assert.deepStrictEqual(moduleFileCandidates(uri('SuiteScripts/main.js'), id), []);
        }
    });
});
