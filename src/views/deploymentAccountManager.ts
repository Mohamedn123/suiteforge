import * as vscode from 'vscode';
import {
    AccountEnvironment,
    AccountProfile,
    SuiteCloudAccountService,
} from './accountProfiles';

export interface DeploymentAccountCoordinator {
    prepareForDeployment(workspaceRoot: vscode.Uri): Promise<AccountProfile | undefined>;
}

export type AccountPickerMode = 'always' | 'whenMultiple' | 'never';
type AccountPickerAction = 'select' | 'add' | 'manage' | 'refresh';

interface AccountQuickPickItem extends vscode.QuickPickItem {
    action: AccountPickerAction;
    profile?: AccountProfile;
}

const DEPLOYMENT_COMMANDS = new Set(['project:deploy', 'file:upload']);

export function requiresDeploymentAccount(commandId: string): boolean {
    return DEPLOYMENT_COMMANDS.has(commandId);
}

export function environmentLabel(environment: AccountEnvironment): string {
    switch (environment) {
        case 'sandbox': return 'Sandbox';
        case 'releasePreview': return 'Release Preview';
        case 'production': return 'Production';
        default: return 'Unknown environment';
    }
}

export function shouldConfirmDeployment(environment: AccountEnvironment, enabled: boolean): boolean {
    return enabled && (environment === 'production' || environment === 'unknown');
}

export function shouldShowAccountPicker(mode: AccountPickerMode, profileCount: number): boolean {
    return mode === 'always' || (mode === 'whenMultiple' && profileCount > 1);
}

export function normalizeAccountPickerMode(value: unknown): AccountPickerMode {
    return value === 'whenMultiple' || value === 'never' ? value : 'always';
}

export function sortAccountProfiles(
    profiles: AccountProfile[],
    currentAuthId?: string,
    recent: string[] = [],
): AccountProfile[] {
    const rank = (profile: AccountProfile): number => {
        if (profile.authId === currentAuthId) { return -2; }
        const recentIndex = recent.indexOf(profile.authId);
        return recentIndex < 0 ? Number.MAX_SAFE_INTEGER : recentIndex;
    };
    return [...profiles].sort((left, right) =>
        rank(left) - rank(right) || left.authId.localeCompare(right.authId),
    );
}

export type WorkspaceStat = (uri: vscode.Uri) => Thenable<vscode.FileStat>;

export async function isSuiteCloudProjectRoot(
    workspaceRoot: vscode.Uri,
    stat: WorkspaceStat = uri => vscode.workspace.fs.stat(uri),
): Promise<boolean> {
    if (workspaceRoot.scheme !== 'file') { return false; }
    const markers = [
        vscode.Uri.joinPath(workspaceRoot, 'suitecloud.config.js'),
        vscode.Uri.joinPath(workspaceRoot, 'src', 'manifest.xml'),
        vscode.Uri.joinPath(workspaceRoot, 'manifest.xml'),
    ];
    const results = await Promise.all(markers.map(async marker => {
        try {
            const markerStat = await stat(marker);
            return (markerStat.type & vscode.FileType.File) !== 0;
        } catch {
            return false;
        }
    }));
    return results.some(Boolean);
}

export class DeploymentAccountManager implements vscode.Disposable, DeploymentAccountCoordinator {
    private readonly accountService: SuiteCloudAccountService;
    private readonly statusItem: vscode.StatusBarItem;
    private readonly disposables: vscode.Disposable[] = [];
    private accountOperationRunning = false;
    private statusRefreshToken = 0;

    constructor(private readonly context: vscode.ExtensionContext, accountService?: SuiteCloudAccountService) {
        this.accountService = accountService ?? new SuiteCloudAccountService();
        this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.statusItem.command = 'suiteforge.selectDeploymentAccount';
        this.statusItem.name = 'SuiteForge Deployment Account';
        this.disposables.push(
            this.statusItem,
            vscode.window.onDidChangeActiveTextEditor(() => { void this.refreshStatus(); }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => { void this.refreshStatus(); }),
        );

        for (const pattern of ['**/project.json', '**/suitecloud.config.js', '**/manifest.xml']) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            this.disposables.push(
                watcher,
                watcher.onDidCreate(() => { void this.refreshStatus(); }),
                watcher.onDidChange(() => { void this.refreshStatus(); }),
                watcher.onDidDelete(() => { void this.refreshStatus(); }),
            );
        }
        void this.refreshStatus();
    }

    dispose(): void {
        for (const disposable of this.disposables) { disposable.dispose(); }
    }

    async prepareForDeployment(workspaceRoot: vscode.Uri): Promise<AccountProfile | undefined> {
        return this.runExclusive(async () => {
            if (!await this.ensureSuiteCloudProject(workspaceRoot)) { return undefined; }
            const configuration = vscode.workspace.getConfiguration('suiteforge', workspaceRoot);
            const mode = normalizeAccountPickerMode(configuration.get<unknown>('deploy.accountPicker', 'always'));
            // Only the explicit boolean false disables this safety gate. Invalid
            // hand-edited settings therefore fail safe with confirmation enabled.
            const confirmProduction = configuration.get<unknown>('deploy.confirmProduction', true) !== false;

            const selected = mode === 'never'
                ? await this.loadCurrentProfile(workspaceRoot)
                : await this.pickSavedAccount(workspaceRoot, mode);
            if (!selected) { return undefined; }

            const inspected = await this.runWithProgress(
                `Inspecting ${selected.authId}`,
                token => this.accountService.inspect(workspaceRoot, selected, token),
            );
            if (!inspected) { return undefined; }

            if (shouldConfirmDeployment(inspected.environment, confirmProduction)) {
                const confirmed = await this.confirmSensitiveDeployment(inspected);
                if (!confirmed) { return undefined; }
            }

            const current = await this.getCurrentAuthIdOrReport(workspaceRoot);
            if (!current.succeeded) { return undefined; }
            if (current.authId !== inspected.authId) {
                const switched = await this.runWithProgress(
                    `Selecting ${inspected.authId}`,
                    async token => {
                        await this.accountService.select(workspaceRoot, inspected.authId, token);
                        return true;
                    },
                );
                if (!switched) { return undefined; }
            }

            const verified = await this.getCurrentAuthIdOrReport(workspaceRoot);
            if (!verified.succeeded) { return undefined; }
            if (verified.authId !== inspected.authId) {
                vscode.window.showErrorMessage(
                    `SuiteForge: The project did not switch to "${inspected.authId}", so deployment was cancelled.`,
                );
                return undefined;
            }

            await this.rememberAccount(workspaceRoot, inspected.authId);
            await this.refreshStatus(workspaceRoot);
            return inspected;
        });
    }

    async selectDeploymentAccount(workspaceRoot?: vscode.Uri): Promise<void> {
        await this.runExclusive(async () => {
            const root = workspaceRoot ?? await this.pickWorkspaceRoot();
            if (!root) { return; }
            if (!await this.ensureSuiteCloudProject(root)) { return; }
            const selected = await this.pickSavedAccount(root, 'always');
            if (!selected) { return; }

            const current = await this.getCurrentAuthIdOrReport(root);
            if (!current.succeeded) { return; }
            if (current.authId !== selected.authId) {
                const switched = await this.runWithProgress(
                    `Selecting ${selected.authId}`,
                    async token => {
                        await this.accountService.select(root, selected.authId, token);
                        return true;
                    },
                );
                if (!switched) { return; }
            }
            const verified = await this.getCurrentAuthIdOrReport(root);
            if (!verified.succeeded) { return; }
            if (verified.authId !== selected.authId) {
                vscode.window.showErrorMessage(
                    `SuiteForge: The project did not switch to "${selected.authId}".`,
                );
                return;
            }
            await this.rememberAccount(root, selected.authId);
            await this.refreshStatus(root);
            vscode.window.showInformationMessage(`SuiteForge: "${selected.authId}" is now the deployment account for this project.`);
        });
    }

    async addNetSuiteAccount(workspaceRoot?: vscode.Uri): Promise<void> {
        const root = workspaceRoot ?? await this.pickWorkspaceRoot();
        if (root && await this.ensureSuiteCloudProject(root)) {
            this.openInteractiveAccountCommand(root, 'account:setup', 'Add NetSuite Account');
        }
    }

    async manageSavedAccounts(workspaceRoot?: vscode.Uri): Promise<void> {
        const root = workspaceRoot ?? await this.pickWorkspaceRoot();
        if (root) { this.openInteractiveAccountCommand(root, 'account:manageauth', 'Manage NetSuite Accounts'); }
    }

    async refreshStatus(preferredRoot?: vscode.Uri): Promise<void> {
        const token = ++this.statusRefreshToken;
        const root = preferredRoot ?? this.getActiveWorkspaceRoot();
        if (!root) {
            this.statusItem.hide();
            return;
        }
        try {
            if (!await isSuiteCloudProjectRoot(root)) {
                if (token === this.statusRefreshToken) { this.statusItem.hide(); }
                return;
            }
            const authId = await this.accountService.getCurrentAuthId(root);
            if (token !== this.statusRefreshToken) { return; }
            if (!authId) {
                this.statusItem.text = '$(account) Select NetSuite Account';
                this.statusItem.tooltip = 'SuiteForge: Select the deployment account for this project';
            } else {
                this.statusItem.text = `$(account) ${authId}`;
                this.statusItem.tooltip = `SuiteForge deployment account: ${authId}\nClick to change account`;
            }
            this.statusItem.show();
        } catch {
            if (token !== this.statusRefreshToken) { return; }
            this.statusItem.text = '$(warning) NetSuite Account';
            this.statusItem.tooltip = 'SuiteForge: Could not read this project\'s deployment account';
            this.statusItem.show();
        }
    }

    private async pickSavedAccount(
        workspaceRoot: vscode.Uri,
        mode: AccountPickerMode,
    ): Promise<AccountProfile | undefined> {
        for (;;) {
            const loaded = await this.loadAccounts(workspaceRoot);
            if (!loaded) { return undefined; }
            const { profiles, currentAuthId } = loaded;
            if (profiles.length === 0) {
                await this.offerAccountSetup(workspaceRoot);
                return undefined;
            }

            if (!shouldShowAccountPicker(mode, profiles.length)) {
                return profiles[0];
            }

            const items = this.buildPickerItems(workspaceRoot, profiles, currentAuthId);
            const picked = await vscode.window.showQuickPick(items, {
                title: `SuiteForge — Deploy from ${this.workspaceName(workspaceRoot)}`,
                placeHolder: 'Choose the NetSuite account and role for this deployment',
                matchOnDescription: true,
                matchOnDetail: true,
            });
            if (!picked) { return undefined; }
            if (picked.action === 'select') { return picked.profile; }
            if (picked.action === 'refresh') { continue; }
            if (picked.action === 'add') {
                this.openInteractiveAccountCommand(workspaceRoot, 'account:setup', 'Add NetSuite Account');
                return undefined;
            }
            this.openInteractiveAccountCommand(workspaceRoot, 'account:manageauth', 'Manage NetSuite Accounts');
            return undefined;
        }
    }

    private async loadAccounts(workspaceRoot: vscode.Uri): Promise<{
        profiles: AccountProfile[];
        currentAuthId?: string;
    } | undefined> {
        return this.runWithProgress('Loading saved NetSuite accounts', async token => {
            const [profiles, currentAuthId] = await Promise.all([
                this.accountService.list(workspaceRoot, token),
                this.accountService.getCurrentAuthId(workspaceRoot),
            ]);
            return { profiles, currentAuthId };
        });
    }

    private async loadCurrentProfile(workspaceRoot: vscode.Uri): Promise<AccountProfile | undefined> {
        const current = await this.getCurrentAuthIdOrReport(workspaceRoot);
        if (!current.succeeded) { return undefined; }
        if (current.authId) {
            return { authId: current.authId, environment: 'unknown' };
        }
        const selection = await vscode.window.showErrorMessage(
            'SuiteForge: This project has no deployment account configured.',
            'Select Account',
            'Add Account',
        );
        if (selection === 'Select Account') { return this.pickSavedAccount(workspaceRoot, 'always'); }
        if (selection === 'Add Account') {
            this.openInteractiveAccountCommand(workspaceRoot, 'account:setup', 'Add NetSuite Account');
        }
        return undefined;
    }

    private buildPickerItems(
        workspaceRoot: vscode.Uri,
        profiles: AccountProfile[],
        currentAuthId?: string,
    ): AccountQuickPickItem[] {
        const recent = this.context.workspaceState.get<string[]>(this.recentKey(workspaceRoot), []);
        const sorted = sortAccountProfiles(profiles, currentAuthId, recent);

        const accountItems: AccountQuickPickItem[] = sorted.map(profile => ({
            label: `${profile.authId === currentAuthId ? '$(check)' : '$(key)'} ${profile.authId}`,
            description: profile.authId === currentAuthId ? 'Current project account' : undefined,
            detail: [
                profile.role && profile.accountName ? `${profile.role} @ ${profile.accountName}` : undefined,
                profile.domain ? `Non-production domain: ${profile.domain}` : undefined,
            ].filter(Boolean).join(' — '),
            action: 'select',
            profile,
        }));

        return [
            ...accountItems,
            { label: '', kind: vscode.QuickPickItemKind.Separator, action: 'refresh' },
            { label: '$(add) Add another account', detail: 'Open the official SuiteCloud account setup flow', action: 'add' },
            { label: '$(settings-gear) Manage saved accounts', detail: 'List, rename, or remove SuiteCloud authentication IDs', action: 'manage' },
            { label: '$(refresh) Refresh account list', action: 'refresh' },
        ];
    }

    private async confirmSensitiveDeployment(profile: AccountProfile): Promise<boolean> {
        const isProduction = profile.environment === 'production';
        const action = isProduction ? 'Deploy to Production' : 'Deploy Anyway';
        const detail = [
            `Authentication ID: ${profile.authId}`,
            profile.accountName ? `Account: ${profile.accountName}` : undefined,
            profile.accountId ? `Account ID: ${profile.accountId}` : undefined,
            profile.role ? `Role: ${profile.role}` : undefined,
            `Environment: ${environmentLabel(profile.environment)}`,
        ].filter(Boolean).join('\n');
        const message = isProduction
            ? 'SuiteForge: Confirm deployment to a production NetSuite account.'
            : 'SuiteForge could not verify this account environment. Treat it as production before continuing.';
        const selected = await vscode.window.showWarningMessage(
            message,
            { modal: true, detail },
            action,
        );
        return selected === action;
    }

    private async runWithProgress<T>(
        title: string,
        task: (token: vscode.CancellationToken) => Promise<T>,
    ): Promise<T | undefined> {
        try {
            return await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `SuiteForge: ${title}`,
                    cancellable: true,
                },
                (_progress, token) => task(token),
            );
        } catch (error) {
            if (!(error instanceof vscode.CancellationError)) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(message);
            }
            return undefined;
        }
    }

    private async getCurrentAuthIdOrReport(workspaceRoot: vscode.Uri): Promise<
        { succeeded: true; authId?: string } | { succeeded: false }
    > {
        try {
            return { succeeded: true, authId: await this.accountService.getCurrentAuthId(workspaceRoot) };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(message);
            return { succeeded: false };
        }
    }

    private async ensureSuiteCloudProject(workspaceRoot: vscode.Uri): Promise<boolean> {
        if (workspaceRoot.scheme !== 'file') {
            vscode.window.showErrorMessage('SuiteForge: SuiteCloud CLI deployment requires a local workspace folder.');
            return false;
        }
        if (await isSuiteCloudProjectRoot(workspaceRoot)) { return true; }
        vscode.window.showErrorMessage(
            `SuiteForge: "${this.workspaceName(workspaceRoot)}" is not a SuiteCloud project. No account was changed and nothing was deployed.`,
        );
        return false;
    }

    private async offerAccountSetup(workspaceRoot: vscode.Uri): Promise<void> {
        const selection = await vscode.window.showErrorMessage(
            'SuiteForge: No saved SuiteCloud authentication IDs were found.',
            'Add Account',
            'Manage Accounts',
        );
        if (selection === 'Add Account') {
            this.openInteractiveAccountCommand(workspaceRoot, 'account:setup', 'Add NetSuite Account');
        } else if (selection === 'Manage Accounts') {
            this.openInteractiveAccountCommand(workspaceRoot, 'account:manageauth', 'Manage NetSuite Accounts');
        }
    }

    private openInteractiveAccountCommand(workspaceRoot: vscode.Uri, commandId: string, label: string): void {
        const terminal = vscode.window.createTerminal({ name: `SuiteForge: ${label}`, cwd: workspaceRoot });
        terminal.show();
        terminal.sendText(`suitecloud ${commandId} --interactive`, true);
    }

    private async rememberAccount(workspaceRoot: vscode.Uri, authId: string): Promise<void> {
        const key = this.recentKey(workspaceRoot);
        const recent = this.context.workspaceState.get<string[]>(key, []);
        await this.context.workspaceState.update(key, [authId, ...recent.filter(id => id !== authId)].slice(0, 5));
    }

    private recentKey(workspaceRoot: vscode.Uri): string {
        return `suiteforge.recentDeploymentAccounts.${workspaceRoot.toString()}`;
    }

    private async runExclusive<T>(task: () => Promise<T>): Promise<T | undefined> {
        if (this.accountOperationRunning) {
            vscode.window.showWarningMessage('SuiteForge: An account selection is already in progress.');
            return undefined;
        }
        this.accountOperationRunning = true;
        try {
            return await task();
        } finally {
            this.accountOperationRunning = false;
        }
    }

    private getActiveWorkspaceRoot(): vscode.Uri | undefined {
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
        if (activeFolder) { return activeFolder.uri; }
        const folders = vscode.workspace.workspaceFolders;
        return folders?.length === 1 ? folders[0].uri : undefined;
    }

    private async pickWorkspaceRoot(): Promise<vscode.Uri | undefined> {
        const active = this.getActiveWorkspaceRoot();
        if (active) { return active; }
        const selected = await vscode.window.showWorkspaceFolderPick({
            placeHolder: 'Select the SuiteCloud project whose account you want to change',
        });
        return selected?.uri;
    }

    private workspaceName(workspaceRoot: vscode.Uri): string {
        return vscode.workspace.getWorkspaceFolder(workspaceRoot)?.name ?? workspaceRoot.fsPath;
    }
}
