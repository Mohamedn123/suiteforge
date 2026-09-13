import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

suite('V3 VS Code editor integration', () => {
    test('editor commands expose custom module completion, references and cross-file rename', async function () {
        this.timeout(20_000);
        const extension = vscode.extensions.getExtension('MohamedNashaat00.suiteforge');
        assert.ok(extension);
        await extension.activate();
        const callerUri = vscode.Uri.file(path.join(extension.extensionPath, 'src/test/fixtures/custom-modules/main.js'));
        const helperUri = vscode.Uri.file(path.join(extension.extensionPath, 'src/test/fixtures/custom-modules/helpers.js'));
        const doc = await vscode.workspace.openTextDocument(callerUri);
        await vscode.window.showTextDocument(doc);
        const position = doc.positionAt(doc.getText().indexOf('calculate') + 3);
        let completions: vscode.CompletionList | undefined;
        const deadline = Date.now() + 12_000;
        do {
            completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', callerUri, position);
            if (completions?.items.some(item => item.label === 'calculate' && item.detail === 'calculate(amount)')) { break; }
            await new Promise(resolve => setTimeout(resolve, 150));
        } while (Date.now() < deadline);
        assert.ok(completions?.items.some(item => item.label === 'calculate' && item.detail === 'calculate(amount)'), 'SuiteForge completion provider should be registered');
        const refs = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', callerUri, position);
        assert.ok(refs?.some(ref => ref.uri.fsPath.toLowerCase() === helperUri.fsPath.toLowerCase()));
        const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', callerUri, position, 'compute');
        assert.ok(edit);
        assert.ok(edit.get(callerUri).some(change => change.newText === 'compute'), 'The caller should be renamed');
        assert.ok(edit.get(helperUri).some(change => change.newText === 'compute'), 'The exported API should be renamed');
        assert.ok(doc.getText().includes('helpers.calculate'), 'Requesting rename must not apply it');
    });
});
