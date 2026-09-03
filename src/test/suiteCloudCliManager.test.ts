import * as assert from 'assert';
import {
    buildKnownToolInvocation,
    compareCliVersions,
    isSafeCliVersion,
    isSupportedCliVersion,
    parseCliVersion,
    parseJavaMajorVersion,
    shouldCheckForCliUpdate,
} from '../views/suiteCloudCliManager';

suite('SuiteCloud CLI Manager Test Suite', () => {
    test('parses plain, prefixed, and JSON npm versions', () => {
        assert.strictEqual(parseCliVersion('4.0.0\n'), '4.0.0');
        assert.strictEqual(parseCliVersion('SuiteCloud CLI for Node.js v3.2.0'), '3.2.0');
        assert.strictEqual(parseCliVersion('"4.0.0"'), '4.0.0');
        assert.strictEqual(parseCliVersion('command failed'), undefined);
    });

    test('compares versions and treats prereleases as older than stable builds', () => {
        assert.strictEqual(compareCliVersions('4.0.0', '3.2.0'), 1);
        assert.strictEqual(compareCliVersions('3.2.0', '4.0.0'), -1);
        assert.strictEqual(compareCliVersions('4.0.0', '4.0.0'), 0);
        assert.strictEqual(compareCliVersions('4.0.0-beta.1', '4.0.0'), -1);
    });

    test('gates updates to safe SuiteForge-compatible versions', () => {
        assert.strictEqual(isSafeCliVersion('4.0.0'), true);
        assert.strictEqual(isSafeCliVersion('4.0.0-beta.1'), true);
        assert.strictEqual(isSafeCliVersion('4.0.0 && whoami'), false);
        assert.strictEqual(isSupportedCliVersion('3.2.0'), true);
        assert.strictEqual(isSupportedCliVersion('4.0.0'), true);
        assert.strictEqual(isSupportedCliVersion('5.0.0'), false);
    });

    test('parses current and legacy Java version banners', () => {
        assert.strictEqual(parseJavaMajorVersion('openjdk version "21.0.5" 2024-10-15'), 21);
        assert.strictEqual(parseJavaMajorVersion('java version "17.0.10"'), 17);
        assert.strictEqual(parseJavaMajorVersion('java version "1.8.0_401"'), 8);
        assert.strictEqual(parseJavaMajorVersion('java was not found'), undefined);
    });

    test('honors daily, weekly, never, missing, and future update-check timestamps', () => {
        const now = Date.UTC(2026, 8, 3);
        assert.strictEqual(shouldCheckForCliUpdate(undefined, 'daily', now), true);
        assert.strictEqual(shouldCheckForCliUpdate(now - 23 * 60 * 60 * 1000, 'daily', now), false);
        assert.strictEqual(shouldCheckForCliUpdate(now - 25 * 60 * 60 * 1000, 'daily', now), true);
        assert.strictEqual(shouldCheckForCliUpdate(now - 6 * 24 * 60 * 60 * 1000, 'weekly', now), false);
        assert.strictEqual(shouldCheckForCliUpdate(now - 8 * 24 * 60 * 60 * 1000, 'weekly', now), true);
        assert.strictEqual(shouldCheckForCliUpdate(undefined, 'never', now), false);
        assert.strictEqual(shouldCheckForCliUpdate(now + 1, 'daily', now), true);
    });

    test('builds shell-free POSIX probes and hardened Windows probes', () => {
        const posix = buildKnownToolInvocation('suitecloud', ['--version'], '/project', false);
        assert.strictEqual(posix.executable, 'suitecloud');
        assert.deepStrictEqual(posix.args, ['--version']);

        const windows = buildKnownToolInvocation('npm', ['view', '@oracle/suitecloud-cli', 'version', '--json'], 'C:\\project', true);
        assert.strictEqual(windows.executable, 'cmd.exe');
        assert.ok(windows.args[3].includes('@oracle/suitecloud-cli'));
        assert.throws(
            () => buildKnownToolInvocation('npm', ['view', 'safe&whoami'], 'C:\\project', true),
            /unsafe Windows tool argument/,
        );
        assert.throws(
            () => buildKnownToolInvocation('npm' as 'suitecloud', ['view\nwhoami'], 'C:\\project', false),
            /control characters/,
        );
        assert.throws(
            () => buildKnownToolInvocation('powershell' as 'npm', [], 'C:\\project', true),
            /unsupported executable/,
        );
    });
});
