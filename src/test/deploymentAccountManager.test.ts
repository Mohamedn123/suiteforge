import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    environmentLabel,
    isSuiteCloudProjectRoot,
    normalizeAccountPickerMode,
    requiresDeploymentAccount,
    shouldShowAccountPicker,
    shouldConfirmDeployment,
    sortAccountProfiles,
} from '../views/deploymentAccountManager';

suite('Deployment Account Manager Test Suite', () => {
    test('guards only commands that can deploy files or projects', () => {
        assert.strictEqual(requiresDeploymentAccount('project:deploy'), true);
        assert.strictEqual(requiresDeploymentAccount('file:upload'), true);
        assert.strictEqual(requiresDeploymentAccount('project:validate'), false);
        assert.strictEqual(requiresDeploymentAccount('file:import'), false);
        assert.strictEqual(requiresDeploymentAccount('account:setup:ci'), false);
    });

    test('requires confirmation for production and unverified accounts', () => {
        assert.strictEqual(shouldConfirmDeployment('production', true), true);
        assert.strictEqual(shouldConfirmDeployment('unknown', true), true);
        assert.strictEqual(shouldConfirmDeployment('sandbox', true), false);
        assert.strictEqual(shouldConfirmDeployment('releasePreview', true), false);
        assert.strictEqual(shouldConfirmDeployment('production', false), false);
    });

    test('provides clear environment labels', () => {
        assert.strictEqual(environmentLabel('sandbox'), 'Sandbox');
        assert.strictEqual(environmentLabel('releasePreview'), 'Release Preview');
        assert.strictEqual(environmentLabel('production'), 'Production');
        assert.strictEqual(environmentLabel('unknown'), 'Unknown environment');
    });

    test('honors always, multiple-only, and disabled picker modes', () => {
        assert.strictEqual(shouldShowAccountPicker('always', 1), true);
        assert.strictEqual(shouldShowAccountPicker('whenMultiple', 2), true);
        assert.strictEqual(shouldShowAccountPicker('whenMultiple', 1), false);
        assert.strictEqual(shouldShowAccountPicker('never', 3), false);
        assert.strictEqual(normalizeAccountPickerMode('always'), 'always');
        assert.strictEqual(normalizeAccountPickerMode('whenMultiple'), 'whenMultiple');
        assert.strictEqual(normalizeAccountPickerMode('never'), 'never');
        assert.strictEqual(normalizeAccountPickerMode('unexpected'), 'always');
        assert.strictEqual(normalizeAccountPickerMode(undefined), 'always');
    });

    test('orders the current account first, then recent accounts, then alphabetically', () => {
        const profiles = ['zeta', 'alpha', 'current', 'recent'].map(authId => ({
            authId,
            environment: 'unknown' as const,
        }));
        assert.deepStrictEqual(
            sortAccountProfiles(profiles, 'current', ['recent']).map(profile => profile.authId),
            ['current', 'recent', 'alpha', 'zeta'],
        );
        assert.deepStrictEqual(
            profiles.map(profile => profile.authId),
            ['zeta', 'alpha', 'current', 'recent'],
            'sorting must not mutate the caller\'s account list',
        );
    });

    test('recognizes only local SuiteCloud project roots with known file markers', async () => {
        const root = vscode.Uri.file(process.platform === 'win32' ? 'C:\\project' : '/project');
        const seen: string[] = [];
        const stat = async (uri: vscode.Uri): Promise<vscode.FileStat> => {
            seen.push(uri.path);
            if (uri.path.endsWith('/src/manifest.xml')) {
                return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 1 };
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        };
        assert.strictEqual(await isSuiteCloudProjectRoot(root, stat), true);
        assert.strictEqual(seen.length, 3);

        let remoteStatCalled = false;
        const remote = vscode.Uri.parse('vscode-remote://ssh-remote+server/project');
        assert.strictEqual(await isSuiteCloudProjectRoot(remote, async () => {
            remoteStatCalled = true;
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 1 };
        }), false);
        assert.strictEqual(remoteStatCalled, false);
    });
});
