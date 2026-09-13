import * as assert from 'assert';
import { fork, ForkOptions } from 'child_process';
import * as path from 'path';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { createMessageConnection, IPCMessageReader, IPCMessageWriter, InitializeResult, Location, CompletionList, Hover, SignatureHelp, WorkspaceEdit } from 'vscode-languageserver/node';

suite('Definition language server integration', () => {
    test('advertises definitions and navigates disk files and current unsaved buffers', async function () {
        this.timeout(20_000);
        const directory = await mkdtemp(path.join(tmpdir(), 'suiteforge-definition-'));
        const forkOptions: ForkOptions & { windowsHide: boolean } = {
            execArgv: [],
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            windowsHide: true,
        };
        const child = fork(path.resolve(__dirname, '../../dist/server.js'), ['--node-ipc'], forkOptions);
        const connection = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
        connection.listen();
        try {
            const initialized = await connection.sendRequest<InitializeResult>('initialize', {
                processId: process.pid, rootUri: pathToFileURL(directory).href, capabilities: {},
            });
            assert.strictEqual(initialized.capabilities.definitionProvider, true);
            assert.strictEqual(initialized.capabilities.referencesProvider, true);
            assert.deepStrictEqual(initialized.capabilities.renameProvider, { prepareProvider: true });
            await connection.sendNotification('initialized', {});
            const callerUri = pathToFileURL(path.join(directory, 'main.js')).href;
            const libraryFile = path.join(directory, 'lib.js');
            const libraryUri = pathToFileURL(libraryFile).href;
            const caller = `define(['./lib'], helpers => helpers.calculate());`;
            await mkdir(path.join(directory, 'node_modules'));
            await writeFile(path.join(directory, 'node_modules', 'broken.js'), 'invalid syntax (');
            await writeFile(libraryFile, 'define([], () => {\nfunction diskImplementation() {}\nreturn { calculate: diskImplementation }; });');
            await connection.sendNotification('textDocument/didOpen', {
                textDocument: { uri: callerUri, languageId: 'javascript', version: 1, text: caller },
            });
            const request = () => connection.sendRequest<Location[]>('textDocument/definition', {
                textDocument: { uri: callerUri }, position: { line: 0, character: caller.indexOf('calculate') + 2 },
            });
            let locations = await request();
            assert.strictEqual(locations[0]?.uri, libraryUri);
            assert.deepStrictEqual(locations[0]?.range.start, { line: 1, character: 9 });

            // Equivalent URI encoding must still find the editor's unsaved text.
            const editorUri = libraryUri.replace('lib.js', '%6Cib.js');
            await connection.sendNotification('textDocument/didOpen', {
                textDocument: { uri: editorUri, languageId: 'javascript', version: 1,
                    text: 'define([], () => {\n\nconst unsavedImplementation = () => {};\nreturn { calculate: unsavedImplementation }; });' },
            });
            locations = await request();
            assert.strictEqual(locations[0]?.uri, editorUri);
            assert.deepStrictEqual(locations[0]?.range.start, { line: 2, character: 6 });
            await connection.sendNotification('textDocument/didChange', {
                textDocument: { uri: editorUri, version: 2 },
                contentChanges: [{ text: 'define([], () => ({ differentMethod() {} }));' }],
            });
            assert.deepStrictEqual(await request(), [], 'An edit removing the export must not return a stale location');
            await connection.sendNotification('textDocument/didClose', { textDocument: { uri: editorUri } });
            assert.deepStrictEqual((await request())[0]?.range.start, { line: 1, character: 9 });

            const symbolParams = { textDocument: { uri: callerUri }, position: { line: 0, character: caller.indexOf('calculate') + 2 } };
            const completions = await connection.sendRequest<CompletionList>('textDocument/completion', symbolParams);
            assert.ok(completions.items.some(item => item.label === 'calculate' && item.detail === 'calculate()'));
            const hover = await connection.sendRequest<Hover>('textDocument/hover', symbolParams);
            assert.match(JSON.stringify(hover.contents), /calculate\(\)/);
            const signature = await connection.sendRequest<SignatureHelp>('textDocument/signatureHelp', {
                textDocument: { uri: callerUri }, position: { line: 0, character: caller.indexOf('calculate') + 'calculate('.length },
            });
            assert.strictEqual(signature.signatures[0].label, 'calculate()');
            const refs = await connection.sendRequest<Location[]>('textDocument/references', { ...symbolParams, context: { includeDeclaration: true } });
            assert.strictEqual(refs.length, 4);
            const prepared = await connection.sendRequest<{ placeholder: string }>('textDocument/prepareRename', symbolParams);
            assert.strictEqual(prepared.placeholder, 'calculate');
            const rename = await connection.sendRequest<WorkspaceEdit>('textDocument/rename', { ...symbolParams, newName: 'compute' });
            assert.strictEqual(rename.documentChanges?.length, 2);
            assert.strictEqual(rename.changeAnnotations?.['suiteforge.rename'].needsConfirmation, true);
            await rm(libraryFile);
            assert.deepStrictEqual(await request(), [], 'Deleted modules must not return stale locations');
        } finally {
            connection.dispose();
            child.kill();
            assert.strictEqual(path.dirname(directory), path.resolve(tmpdir()));
            assert.ok(path.basename(directory).startsWith('suiteforge-definition-'));
            await rm(directory, { recursive: true, force: true });
        }
    });
});
