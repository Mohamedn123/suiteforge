import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    buildSuiteCloudInvocation,
    captureSuiteCloudCommand,
    SdfCliRunner,
    SuiteCloudCliInputError,
    isUnsafeWindowsArg,
    quoteArg,
} from '../views/sdfCliRunner';

suite('SdfCliRunner Test Suite', () => {
    test('Should construct with no process running and support listeners', () => {
        const runner = new SdfCliRunner();

        // Structural test: no child process is running before run() is called,
        // and the EventEmitter contract works. run() itself is not exercised
        // here because it requires a workspace folder and a real CLI binary.
        assert.strictEqual(runner.isRunning, false);

        let sawOutput = false;
        runner.on('output', () => { sawOutput = true; });

        // cancel() on an idle runner is a no-op and must not emit.
        runner.cancel();
        assert.strictEqual(sawOutput, false);
        assert.strictEqual(runner.isRunning, false);
    });

    test('Quotes safe Windows arguments and rejects cmd metacharacters', () => {
        assert.strictEqual(quoteArg('/SuiteScripts/My File.js', true), '"/SuiteScripts/My File.js"');
        assert.strictEqual(isUnsafeWindowsArg('/SuiteScripts/My File.js'), false);
        assert.strictEqual(isUnsafeWindowsArg('/SuiteScripts/a&whoami.js'), true);
        assert.strictEqual(isUnsafeWindowsArg('%COMSPEC%'), true);
    });

    test('Builds shell-free POSIX invocations and hardened Windows invocations', () => {
        const posix = buildSuiteCloudInvocation(
            'account:setup:ci',
            ['--select', 'qa_auth'],
            '/project',
            false,
        );
        assert.strictEqual(posix.executable, 'suitecloud');
        assert.deepStrictEqual(posix.args, ['account:setup:ci', '--select', 'qa_auth']);
        assert.strictEqual(posix.options.cwd, '/project');

        const windows = buildSuiteCloudInvocation(
            'file:upload',
            ['--paths', '/SuiteScripts/My File.js'],
            'C:\\project',
            true,
        );
        assert.strictEqual(windows.executable, 'cmd.exe');
        assert.deepStrictEqual(windows.args.slice(0, 3), ['/d', '/s', '/c']);
        assert.strictEqual(windows.options.windowsVerbatimArguments, true);
        assert.ok(windows.args[3].includes('"/SuiteScripts/My File.js"'));
    });

    test('Rejects invalid commands and unsafe dynamic values before spawning', () => {
        assert.throws(
            () => buildSuiteCloudInvocation('whoami', [], '/project', false),
            SuiteCloudCliInputError,
        );
        assert.throws(
            () => buildSuiteCloudInvocation('file:upload', ['ok\nwhoami'], '/project', false),
            SuiteCloudCliInputError,
        );
        assert.throws(
            () => buildSuiteCloudInvocation('account:setup:ci', ['--select', 'qa&whoami'], 'C:\\project', true),
            SuiteCloudCliInputError,
        );
    });

    test('Does not spawn a discovery command when cancellation was already requested', async () => {
        const cancellation = new vscode.CancellationTokenSource();
        cancellation.cancel();
        try {
            const result = await captureSuiteCloudCommand(
                'account:manageauth',
                ['--list'],
                vscode.Uri.file(process.platform === 'win32' ? 'C:\\project' : '/project'),
                { cancellationToken: cancellation.token },
            );
            assert.strictEqual(result.cancelled, true);
            assert.strictEqual(result.code, 1);
            assert.strictEqual(result.stdout, '');
        } finally {
            cancellation.dispose();
        }
    });
});
