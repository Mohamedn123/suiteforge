import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    AccountProfile,
    classifyAccountEnvironment,
    parseAccountInfo,
    parseAccountList,
    parseDefaultAuthId,
    SuiteCloudAccountService,
} from '../views/accountProfiles';
import type { CliCaptureResult } from '../views/sdfCliRunner';

suite('SuiteCloud Account Profiles Test Suite', () => {
    const root = vscode.Uri.file(process.platform === 'win32' ? 'C:\\project' : '/project');

    test('parses saved accounts, terminal colors, CRLF, and duplicate rows', () => {
        const output = [
            '\u001b[32mdev_auth\u001b[0m | Developer @ Example Inc. | 123-sb1.app.netsuite.com',
            'prod_auth | Administrator @ Example Inc.',
            'noise from a future CLI version',
            'bad auth | Developer @ Ignored',
            'pipe_auth | Developer @ Example | Holdings | 123-sb1.app.netsuite.com',
            'dev_auth | QA Role @ Updated Example | system.sandbox.netsuite.com',
        ].join('\r');

        assert.deepStrictEqual(parseAccountList(output), [
            {
                authId: 'dev_auth',
                role: 'QA Role',
                accountName: 'Updated Example',
                domain: 'system.sandbox.netsuite.com',
                environment: 'unknown',
            },
            {
                authId: 'prod_auth',
                role: 'Administrator',
                accountName: 'Example Inc.',
                domain: undefined,
                environment: 'unknown',
            },
            {
                authId: 'pipe_auth',
                role: 'Developer',
                accountName: 'Example | Holdings',
                domain: '123-sb1.app.netsuite.com',
                environment: 'unknown',
            },
        ]);
    });

    test('parses a deterministic matrix of valid profile rows without accepting injected IDs', () => {
        for (let index = 0; index < 75; index++) {
            const authId = `profile_${index}`;
            const role = `Role ${index}`;
            const accountName = index % 3 === 0
                ? `Company ${index} @ Region | Division`
                : `Company ${index}`;
            const domain = index % 2 === 0 ? `123-sb${index}.app.netsuite.com` : undefined;
            const line = `${authId} | ${role} @ ${accountName}${domain ? ` | ${domain}` : ''}`;
            const parsed = parseAccountList(index % 4 === 0 ? `\u001b[1m${line}\u001b[0m` : line);
            assert.strictEqual(parsed.length, 1, `profile row ${index} should parse`);
            assert.strictEqual(parsed[0].authId, authId);
            assert.strictEqual(parsed[0].role, role);
            assert.strictEqual(parsed[0].accountName, accountName);
            assert.strictEqual(parsed[0].domain, domain);
        }

        for (const unsafeId of ['bad id', 'bad&run', 'bad|pipe', 'bad%PATH%', 'bad"quote']) {
            assert.deepStrictEqual(
                parseAccountList(`${unsafeId} | Administrator @ Example Inc.`),
                [],
                `unsafe ID ${unsafeId} must not become selectable`,
            );
        }
    });

    test('parses inspected account details and classifies sandbox', () => {
        const fallback: AccountProfile = { authId: 'dev_auth', environment: 'unknown' };
        const parsed = parseAccountInfo([
            'Authentication ID: dev_auth',
            'Account Name: Example: Europe',
            'Account ID: 123456_SB2',
            'Role: Developer',
            'Domain: 123456-sb2.app.netsuite.com',
            'Account Type: Sandbox',
        ].join('\n'), fallback);

        assert.deepStrictEqual(parsed, {
            authId: 'dev_auth',
            accountName: 'Example: Europe',
            accountId: '123456_SB2',
            role: 'Developer',
            domain: '123456-sb2.app.netsuite.com',
            environment: 'sandbox',
        });
    });

    test('does not trust a malformed auth ID returned by account info', () => {
        const fallback: AccountProfile = {
            authId: 'known_safe',
            role: 'Developer',
            environment: 'unknown',
        };
        const parsed = parseAccountInfo(
            'Authentication ID: bad&whoami\nAccount ID: 123456\nAccount Type: Production',
            fallback,
        );
        assert.strictEqual(parsed.authId, 'known_safe');
        assert.strictEqual(parsed.environment, 'unknown');
    });

    test('fails closed when account identity or environment metadata conflicts', () => {
        const fallback: AccountProfile = { authId: 'requested_auth', environment: 'unknown' };
        const mismatchedIdentity = parseAccountInfo([
            'Authentication ID: different_safe_auth',
            'Account ID: 123456_SB1',
            'Account Type: Sandbox',
        ].join('\n'), fallback);
        assert.strictEqual(mismatchedIdentity.authId, 'requested_auth');
        assert.strictEqual(mismatchedIdentity.environment, 'unknown');

        assert.strictEqual(classifyAccountEnvironment('123456', 'Sandbox'), 'unknown');
        assert.strictEqual(classifyAccountEnvironment('123456_SB1', 'Production'), 'unknown');
    });

    test('classifies account types conservatively', () => {
        assert.strictEqual(classifyAccountEnvironment('123_SB1'), 'sandbox');
        assert.strictEqual(classifyAccountEnvironment('123_RP'), 'releasePreview');
        assert.strictEqual(classifyAccountEnvironment('123456'), 'production');
        assert.strictEqual(classifyAccountEnvironment(undefined, 'Sandbox'), 'unknown');
        assert.strictEqual(classifyAccountEnvironment(undefined, 'Release Preview'), 'unknown');
        assert.strictEqual(classifyAccountEnvironment(), 'unknown');
    });

    test('reads only a valid defaultAuthId from project JSON', () => {
        assert.strictEqual(parseDefaultAuthId('{"defaultAuthId":"qa_auth"}'), 'qa_auth');
        assert.throws(() => parseDefaultAuthId('{"defaultAuthId":"bad&whoami"}'));
        assert.strictEqual(parseDefaultAuthId('{"other":true}'), undefined);
        assert.throws(() => parseDefaultAuthId('[]'));
        assert.throws(() => parseDefaultAuthId('{broken'));
    });

    test('uses exact non-interactive CLI commands for list, inspect, and select', async () => {
        const calls: Array<{ commandId: string; args: string[] }> = [];
        const capture = async (commandId: string, args: string[]): Promise<CliCaptureResult> => {
            calls.push({ commandId, args });
            if (args[0] === '--list') {
                return successful('qa_auth | Developer @ Example Inc. | qa.example.com');
            }
            if (args[0] === '--info') {
                return successful('Authentication ID: qa_auth\nAccount ID: 123_SB1\nAccount Type: Sandbox');
            }
            return successful('The authentication ID "qa_auth" is now the default.');
        };
        const service = new SuiteCloudAccountService(capture);

        const profiles = await service.list(root);
        const inspected = await service.inspect(root, profiles[0]);
        await service.select(root, inspected.authId);

        assert.strictEqual(inspected.environment, 'sandbox');
        assert.deepStrictEqual(calls, [
            { commandId: 'account:manageauth', args: ['--list'] },
            { commandId: 'account:manageauth', args: ['--info', 'qa_auth'] },
            { commandId: 'account:setup:ci', args: ['--select', 'qa_auth'] },
        ]);
    });

    test('reads missing, valid, and corrupt project account configuration safely', async () => {
        const tempRoot = vscode.Uri.file(path.join(
            os.tmpdir(),
            `suiteforge-account-test-${process.pid}-${Date.now()}`,
        ));
        const projectJson = vscode.Uri.joinPath(tempRoot, 'project.json');
        const service = new SuiteCloudAccountService(async () => successful(''));
        await vscode.workspace.fs.createDirectory(tempRoot);
        try {
            assert.strictEqual(await service.getCurrentAuthId(tempRoot), undefined);

            await vscode.workspace.fs.writeFile(projectJson, Buffer.from('{"defaultAuthId":"safe_auth"}'));
            assert.strictEqual(await service.getCurrentAuthId(tempRoot), 'safe_auth');

            await vscode.workspace.fs.writeFile(projectJson, Buffer.from('{"defaultAuthId":"bad&unsafe"}'));
            await assert.rejects(() => service.getCurrentAuthId(tempRoot), /invalid JSON/);

            await vscode.workspace.fs.writeFile(projectJson, Buffer.from('{broken'));
            await assert.rejects(() => service.getCurrentAuthId(tempRoot), /invalid JSON/);
        } finally {
            await vscode.workspace.fs.delete(tempRoot, { recursive: true, useTrash: false });
        }
    });

    test('blocks selection of unsafe authentication IDs before invoking the CLI', async () => {
        let called = false;
        const service = new SuiteCloudAccountService(async () => {
            called = true;
            return successful('');
        });

        await assert.rejects(() => service.select(root, 'bad&whoami'), /invalid authentication ID/);
        assert.strictEqual(called, false);
    });

    test('surfaces CLI failures and cancellation without returning partial profiles', async () => {
        const failed = new SuiteCloudAccountService(async () => ({
            stdout: '',
            stderr: 'first line\nOracle CLI rejected the request',
            code: 1,
            cancelled: false,
            timedOut: false,
        }));
        await assert.rejects(() => failed.list(root), /Oracle CLI rejected the request/);

        const cancelled = new SuiteCloudAccountService(async () => ({
            stdout: 'partial_auth | Role @ Partial',
            stderr: '',
            code: 1,
            cancelled: true,
            timedOut: false,
        }));
        await assert.rejects(
            () => cancelled.list(root),
            error => error instanceof vscode.CancellationError,
        );
    });
});

function successful(stdout: string): CliCaptureResult {
    return { stdout, stderr: '', code: 0, cancelled: false, timedOut: false };
}
