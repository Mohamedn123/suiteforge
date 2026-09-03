import * as assert from 'assert';
import * as vm from 'vm';
import * as vscode from 'vscode';
import { buildHtml, operationKindForCommand } from '../views/SdfWebviewPanel';

suite('SDF Progress Presentation Test Suite', () => {
    test('uses the validation animation only for project validation', () => {
        assert.strictEqual(operationKindForCommand('project:validate'), 'validation');
    });

    test('uses the deployment animation for project and file deployment', () => {
        assert.strictEqual(operationKindForCommand('project:deploy'), 'deployment');
        assert.strictEqual(operationKindForCommand('file:upload'), 'deployment');
    });

    test('keeps other SuiteCloud commands on the generic animation', () => {
        assert.strictEqual(operationKindForCommand('project:package'), 'generic');
        assert.strictEqual(operationKindForCommand('object:import'), 'generic');
    });

    test('includes distinct, accessible animations and reduced-motion behavior', () => {
        const html = renderWebviewHtml();
        assert.ok(html.includes('validation-scene'));
        assert.ok(html.includes('deployment-scene'));
        assert.ok(html.includes('aria-live="polite"'));
        assert.ok(html.includes('@media (prefers-reduced-motion: reduce)'));
        assert.ok(html.includes('live-duration'));
    });

    test('produces syntactically valid embedded webview JavaScript', () => {
        const html = renderWebviewHtml();
        const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
        assert.ok(script, 'Expected an inline webview script');
        assert.doesNotThrow(() => new vm.Script(script));
    });
});

function renderWebviewHtml(): string {
    const webview = {
        cspSource: 'vscode-webview://suiteforge-test',
        asWebviewUri: (uri: vscode.Uri) => uri,
    } as unknown as vscode.Webview;
    return buildHtml(webview, vscode.Uri.file(process.cwd()));
}
