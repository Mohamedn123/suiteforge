import * as assert from 'assert';
import * as vscode from 'vscode';
import { toFileCabinetPath } from '../views/deployActiveFile';

suite('Deploy Active File Test Suite', () => {
    // Path separators in expected values follow the platform's path.sep, so
    // build expectations with join to stay OS-independent.
    const sep = process.platform === 'win32' ? '\\' : '/';
    const root = vscode.Uri.file(process.platform === 'win32' ? 'C:\\proj' : '/proj');

    test('maps ACP paths under src/FileCabinet', () => {
        const file = vscode.Uri.file(`${root.fsPath}${sep}src${sep}FileCabinet${sep}SuiteScripts${sep}mylib${sep}foo.js`);
        assert.strictEqual(toFileCabinetPath(file, root), '/SuiteScripts/mylib/foo.js');
    });

    test('maps SuiteApp paths under SuiteApps', () => {
        const file = vscode.Uri.file(`${root.fsPath}${sep}src${sep}FileCabinet${sep}SuiteApps${sep}com.example.app${sep}lib${sep}bar.js`);
        assert.strictEqual(toFileCabinetPath(file, root), '/SuiteApps/com.example.app/lib/bar.js');
    });

    test('maps templates folder', () => {
        const file = vscode.Uri.file(`${root.fsPath}${sep}src${sep}FileCabinet${sep}Templates${sep}my.tpl.html`);
        assert.strictEqual(toFileCabinetPath(file, root), '/Templates/my.tpl.html');
    });

    test('returns undefined for files outside FileCabinet', () => {
        const file = vscode.Uri.file(`${root.fsPath}${sep}src${sep}Objects${sep}customrecord_thing.xml`);
        assert.strictEqual(toFileCabinetPath(file, root), undefined);
    });

    test('returns undefined for the FileCabinet folder itself (no cabinet path)', () => {
        const file = vscode.Uri.file(`${root.fsPath}${sep}src${sep}FileCabinet`);
        assert.strictEqual(toFileCabinetPath(file, root), undefined);
    });

    test('returns undefined for a FileCabinet path outside the workspace root', () => {
        const file = vscode.Uri.file(process.platform === 'win32'
            ? `C:${sep}other${sep}src${sep}FileCabinet${sep}SuiteScripts${sep}outside.js`
            : `${sep}other${sep}src${sep}FileCabinet${sep}SuiteScripts${sep}outside.js`);
        assert.strictEqual(toFileCabinetPath(file, root), undefined);
    });

    test('returns undefined for a nested backup of src/FileCabinet', () => {
        const file = vscode.Uri.file(`${root.fsPath}${sep}backup${sep}src${sep}FileCabinet${sep}SuiteScripts${sep}old.js`);
        assert.strictEqual(toFileCabinetPath(file, root), undefined);
    });
});
