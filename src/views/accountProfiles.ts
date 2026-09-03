import * as vscode from 'vscode';
import {
    captureSuiteCloudCommand,
    CliCaptureOptions,
    CliCaptureResult,
} from './sdfCliRunner';

export type AccountEnvironment = 'sandbox' | 'releasePreview' | 'production' | 'unknown';

export interface AccountProfile {
    authId: string;
    accountName?: string;
    accountId?: string;
    role?: string;
    domain?: string;
    environment: AccountEnvironment;
}

export type CliCapture = (
    commandId: string,
    args: string[],
    workspaceRoot: vscode.Uri,
    options?: CliCaptureOptions,
) => Promise<CliCaptureResult>;

const ANSI_PATTERN = /\u001B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const AUTH_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function stripAnsi(value: string): string {
    return value.replace(ANSI_PATTERN, '');
}

/** Parses the stable human-readable rows emitted by account:manageauth --list. */
export function parseAccountList(output: string): AccountProfile[] {
    const profiles = new Map<string, AccountProfile>();
    for (const rawLine of stripAnsi(output).split(/[\r\n]+/)) {
        const parts = rawLine.split('|').map(part => part.trim());
        if (parts.length < 2 || !AUTH_ID_PATTERN.test(parts[0])) { continue; }

        const finalPart = parts.at(-1);
        const hasDomain = parts.length > 2 && Boolean(finalPart && /(?:^|\.)netsuite\.com(?:\/|$)/i.test(finalPart));
        const domain = hasDomain ? finalPart : undefined;
        // The first segment after the auth ID must contain "role @ account".
        // This removes ambiguity with a malicious ID such as "safe|injected",
        // while later pipe characters remain valid in the company name.
        const firstDetails = parts[1];
        const separator = firstDetails.indexOf(' @ ');
        if (separator <= 0 || separator >= firstDetails.length - 3) { continue; }

        const authId = parts[0];
        const role = firstDetails.slice(0, separator).trim();
        const accountSegments = [
            firstDetails.slice(separator + 3).trim(),
            ...parts.slice(2, hasDomain ? -1 : undefined),
        ];
        const accountName = accountSegments.join(' | ').trim();
        if (!role || !accountName) { continue; }

        profiles.set(authId, {
            authId,
            role,
            accountName,
            domain,
            environment: 'unknown',
        });
    }
    return [...profiles.values()];
}

/** Parses account:manageauth --info, falling back safely if CLI text changes. */
export function parseAccountInfo(output: string, fallback: AccountProfile): AccountProfile {
    const fields = new Map<string, string>();
    for (const rawLine of stripAnsi(output).split(/[\r\n]+/)) {
        const separator = rawLine.indexOf(':');
        if (separator <= 0) { continue; }
        const key = rawLine.slice(0, separator).trim().toLowerCase();
        const value = rawLine.slice(separator + 1).trim();
        if (value) { fields.set(key, value); }
    }

    const reportedAuthId = fields.get('authentication id');
    const identityMatches = reportedAuthId === fallback.authId;
    const accountId = fields.get('account id') ?? fallback.accountId;
    const accountType = fields.get('account type');
    const domain = fields.get('domain') ?? fallback.domain;

    return {
        // Never let human-readable CLI output redirect the selection to a
        // different profile, even if that unexpected ID is syntactically safe.
        authId: fallback.authId,
        accountName: fields.get('account name') ?? fallback.accountName,
        accountId,
        role: fields.get('role') ?? fallback.role,
        domain,
        environment: identityMatches ? classifyAccountEnvironment(accountId, accountType) : 'unknown',
    };
}

export function classifyAccountEnvironment(accountId?: string, accountType?: string): AccountEnvironment {
    const normalizedType = accountType?.trim().toLowerCase();
    const typeEnvironment: AccountEnvironment | undefined = normalizedType?.includes('release preview')
        ? 'releasePreview'
        : normalizedType?.includes('sandbox')
            ? 'sandbox'
            : normalizedType?.includes('production')
                ? 'production'
                : undefined;

    const normalizedId = accountId?.trim().toUpperCase();
    if (!normalizedId) { return 'unknown'; }
    const idEnvironment: AccountEnvironment = /_SB\d*$/.test(normalizedId)
        ? 'sandbox'
        : /_RP\d*$/.test(normalizedId)
            ? 'releasePreview'
            // Oracle's CLI uses the same suffix rule and treats other IDs as production.
            : 'production';
    return typeEnvironment && typeEnvironment !== idEnvironment ? 'unknown' : (typeEnvironment ?? idEnvironment);
}

export function parseDefaultAuthId(projectJson: string): string | undefined {
    const parsed: unknown = JSON.parse(projectJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new SyntaxError('project.json must contain a JSON object.');
    }
    const value = (parsed as Record<string, unknown>).defaultAuthId;
    if (value === undefined) { return undefined; }
    if (typeof value !== 'string' || !AUTH_ID_PATTERN.test(value)) {
        throw new SyntaxError('project.json contains an invalid defaultAuthId.');
    }
    return value;
}

export class SuiteCloudAccountService {
    constructor(private readonly capture: CliCapture = captureSuiteCloudCommand) {}

    async list(workspaceRoot: vscode.Uri, cancellationToken?: vscode.CancellationToken): Promise<AccountProfile[]> {
        const result = await this.capture(
            'account:manageauth',
            ['--list'],
            workspaceRoot,
            { cancellationToken },
        );
        this.assertSucceeded(result, 'load saved SuiteCloud accounts');
        return parseAccountList(`${result.stdout}\n${result.stderr}`);
    }

    async inspect(
        workspaceRoot: vscode.Uri,
        profile: AccountProfile,
        cancellationToken?: vscode.CancellationToken,
    ): Promise<AccountProfile> {
        const result = await this.capture(
            'account:manageauth',
            ['--info', profile.authId],
            workspaceRoot,
            { cancellationToken },
        );
        this.assertSucceeded(result, `inspect authentication ID "${profile.authId}"`);
        return parseAccountInfo(`${result.stdout}\n${result.stderr}`, profile);
    }

    async select(
        workspaceRoot: vscode.Uri,
        authId: string,
        cancellationToken?: vscode.CancellationToken,
    ): Promise<void> {
        if (!AUTH_ID_PATTERN.test(authId)) {
            throw new Error('SuiteForge refused an invalid authentication ID.');
        }
        const result = await this.capture(
            'account:setup:ci',
            ['--select', authId],
            workspaceRoot,
            { cancellationToken },
        );
        this.assertSucceeded(result, `select authentication ID "${authId}"`);
    }

    async getCurrentAuthId(workspaceRoot: vscode.Uri): Promise<string | undefined> {
        const projectJson = vscode.Uri.joinPath(workspaceRoot, 'project.json');
        try {
            const bytes = await vscode.workspace.fs.readFile(projectJson);
            return parseDefaultAuthId(Buffer.from(bytes).toString('utf8'));
        } catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                return undefined;
            }
            if (error instanceof SyntaxError) {
                throw new Error(`SuiteForge could not read ${projectJson.fsPath}: invalid JSON.`);
            }
            throw error;
        }
    }

    private assertSucceeded(result: CliCaptureResult, action: string): void {
        if (result.cancelled) { throw new vscode.CancellationError(); }
        if (result.timedOut) {
            throw new Error(`SuiteForge timed out while trying to ${action}.`);
        }
        if (result.code === 0) { return; }

        const detail = stripAnsi(result.stderr || result.stdout)
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .slice(-3)
            .join(' ')
            .slice(0, 500);
        throw new Error(`SuiteForge could not ${action}.${detail ? ` ${detail}` : ''}`);
    }
}
