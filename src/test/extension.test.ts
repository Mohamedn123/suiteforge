import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present and activate', async () => {
        const published = vscode.extensions.getExtension('MohamedNashaat00.suiteforge');
        assert.ok(published, 'SuiteForge extension should be installed in the test host');
        await published.activate();
        assert.ok(published.isActive, 'SuiteForge extension should activate on demand');
    });

    test('All contributed commands should be registered', async () => {
        const expected = [
            'suiteforge.browseReference',
            'suiteforge.newScript',
            'suiteforge.newSdfScript',
            'suiteforge.newSdfRecord',
            'suiteforge.newSdfField',
            'suiteforge.newSdfForm',
            'suiteforge.newSdfPlugin',
            'suiteforge.newSdfCenter',
            'suiteforge.newSdfAnalytics',
            'suiteforge.newSdfTemplate',
            'suiteforge.newSdfOther',
            'suiteforge.runSdfCommand',
            'suiteforge.deployActiveFile',
            'suiteforge.selectDeploymentAccount',
            'suiteforge.addNetSuiteAccount',
            'suiteforge.manageSavedAccounts',
            'suiteforge.refreshSdfCommands',
            'suiteforge.checkSuiteCloudCliUpdates',
            'suiteforge.updateSuiteCloudCli',
        ];
        const registered = await vscode.commands.getCommands();
        for (const id of expected) {
            assert.ok(
                registered.includes(id),
                `Command "${id}" should be registered`,
            );
        }
    });

    test('Deployment account safeguards have secure defaults', () => {
        const configuration = vscode.workspace.getConfiguration('suiteforge');
        assert.strictEqual(configuration.inspect('deploy.accountPicker')?.defaultValue, 'always');
        assert.strictEqual(configuration.inspect('deploy.confirmProduction')?.defaultValue, true);
        assert.strictEqual(configuration.inspect('suiteCloudCli.updateChecks')?.defaultValue, 'daily');
        assert.strictEqual(configuration.inspect('suiteCloudCli.showStatusBar')?.defaultValue, true);
    });
});
