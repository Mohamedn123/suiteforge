import { ChildProcess, spawn, SpawnOptions } from 'child_process';
import * as vscode from 'vscode';
import { isUnsafeWindowsArg, quoteArg } from './sdfCliRunner';

const CLI_PACKAGE = '@oracle/suitecloud-cli';
const INSTALL_GUIDE_URL = 'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_155929845760.html';
const RELEASE_NOTES_URL = 'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1558730192.html';
const LAST_CHECK_KEY = 'suiteforge.cliUpdate.lastCheck';
const CACHED_LATEST_KEY = 'suiteforge.cliUpdate.cachedLatest';
const NOTIFIED_VERSION_KEY = 'suiteforge.cliUpdate.notifiedVersion';
const SKIPPED_VERSION_KEY = 'suiteforge.cliUpdate.skippedVersion';
const MAX_SUPPORTED_CLI_MAJOR = 4;
const MIN_SUPPORTED_CLI_MAJOR = 3;
const TOOL_TIMEOUT_MS = 20_000;
const MAX_TOOL_OUTPUT = 256 * 1024;

export type UpdateCheckFrequency = 'daily' | 'weekly' | 'never';
type KnownTool = 'suitecloud' | 'npm' | 'node' | 'java';

interface ToolResult {
    stdout: string;
    stderr: string;
    code: number;
}

interface CliVersionState {
    installed?: string;
    latest?: string;
    checkError?: string;
}

interface ToolInvocation {
    executable: string;
    args: string[];
    options: SpawnOptions;
}

export function parseCliVersion(output: string): string | undefined {
    const match = /(?:^|[^0-9])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=$|[^0-9A-Za-z.-])/.exec(output.trim());
    return match?.[1];
}

export function compareCliVersions(left: string, right: string): number {
    const leftParts = numericVersionParts(left);
    const rightParts = numericVersionParts(right);
    for (let index = 0; index < 3; index++) {
        const difference = leftParts[index] - rightParts[index];
        if (difference !== 0) { return difference > 0 ? 1 : -1; }
    }

    const leftPrerelease = left.includes('-');
    const rightPrerelease = right.includes('-');
    if (leftPrerelease !== rightPrerelease) { return leftPrerelease ? -1 : 1; }
    return left.localeCompare(right);
}

export function isSupportedCliVersion(version: string): boolean {
    if (!isSafeCliVersion(version)) { return false; }
    const major = numericVersionParts(version)[0];
    return major >= MIN_SUPPORTED_CLI_MAJOR && major <= MAX_SUPPORTED_CLI_MAJOR;
}

export function isSafeCliVersion(version: string): boolean {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
}

export function shouldCheckForCliUpdate(
    lastCheck: number | undefined,
    frequency: UpdateCheckFrequency,
    now = Date.now(),
): boolean {
    if (frequency === 'never') { return false; }
    if (!lastCheck || lastCheck > now) { return true; }
    const interval = frequency === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return now - lastCheck >= interval;
}

export function buildKnownToolInvocation(
    tool: KnownTool,
    args: string[],
    cwd: string,
    windows = process.platform === 'win32',
): ToolInvocation {
    if (!['suitecloud', 'npm', 'node', 'java'].includes(tool)) {
        throw new Error('Refused an unsupported executable.');
    }
    if (args.some(argument => /[\0\r\n]/.test(argument))) {
        throw new Error('Refused a tool argument containing control characters.');
    }
    if (windows && args.some(isUnsafeWindowsArg)) {
        throw new Error('Refused an unsafe Windows tool argument.');
    }

    if (windows) {
        const displayCommand = [tool, ...args.map(argument => quoteArg(argument, true))].join(' ');
        return {
            executable: 'cmd.exe',
            args: ['/d', '/s', '/c', `"${displayCommand}"`],
            options: {
                cwd,
                env: { ...process.env },
                windowsVerbatimArguments: true,
                windowsHide: true,
            },
        };
    }

    return {
        executable: tool,
        args,
        options: { cwd, env: { ...process.env } },
    };
}

export function registerSuiteCloudCliManager(context: vscode.ExtensionContext): void {
    const manager = new SuiteCloudCliManager(context);
    context.subscriptions.push(
        manager,
        vscode.commands.registerCommand('suiteforge.checkSuiteCloudCliUpdates', () => manager.checkForUpdates(true)),
        vscode.commands.registerCommand('suiteforge.updateSuiteCloudCli', () => manager.updateCli()),
    );
    manager.start();
}

class SuiteCloudCliManager implements vscode.Disposable {
    private readonly statusItem: vscode.StatusBarItem;
    private readonly disposables: vscode.Disposable[] = [];
    private activationTimer: ReturnType<typeof setTimeout> | undefined;
    private activeCheck: Promise<void> | undefined;
    private updating = false;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
        this.statusItem.command = 'suiteforge.checkSuiteCloudCliUpdates';
        this.statusItem.name = 'SuiteForge SuiteCloud CLI Version';
        this.statusItem.text = '$(sync~spin) SuiteCloud CLI';
        this.statusItem.tooltip = 'SuiteForge: Checking SuiteCloud CLI version';
        this.refreshStatusVisibility();

        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('suiteforge.suiteCloudCli.showStatusBar')) {
                    this.refreshStatusVisibility();
                }
                if (event.affectsConfiguration('suiteforge.suiteCloudCli.updateChecks')) {
                    void this.checkForUpdates(false);
                }
            }),
        );
    }

    start(): void {
        this.activationTimer = setTimeout(() => {
            this.activationTimer = undefined;
            void this.checkForUpdates(false);
        }, 2_000);
    }

    dispose(): void {
        if (this.activationTimer) { clearTimeout(this.activationTimer); }
        this.statusItem.dispose();
        this.disposables.forEach(disposable => disposable.dispose());
    }

    async checkForUpdates(manual: boolean): Promise<void> {
        if (this.activeCheck) {
            if (manual) {
                void vscode.window.showInformationMessage('SuiteForge: A SuiteCloud CLI update check is already running.');
            }
            return this.activeCheck;
        }

        this.activeCheck = this.performCheck(manual).finally(() => {
            this.activeCheck = undefined;
        });
        return this.activeCheck;
    }

    async updateCli(targetVersion?: string): Promise<void> {
        if (this.updating) {
            void vscode.window.showInformationMessage('SuiteForge: A SuiteCloud CLI update is already running.');
            return;
        }

        const cwd = this.workingDirectory();
        let version = targetVersion;
        if (!version) {
            version = await this.resolveLatestVersion(cwd, true);
        }
        if (!version) {
            void vscode.window.showErrorMessage('SuiteForge: Could not determine the latest SuiteCloud CLI version.');
            return;
        }
        if (!isSafeCliVersion(version) || !isSupportedCliVersion(version)) {
            void vscode.window.showErrorMessage(
                `SuiteForge: SuiteCloud CLI ${version} is not in this extension's supported version range.`,
                'View Release Notes',
            ).then(choice => {
                if (choice === 'View Release Notes') { void this.openExternal(RELEASE_NOTES_URL); }
            });
            return;
        }

        const installed = await this.detectInstalledVersion(cwd);
        if (installed && compareCliVersions(installed, version) >= 0) {
            this.updateStatus({ installed, latest: version });
            void vscode.window.showInformationMessage(`SuiteForge: SuiteCloud CLI ${installed} is already up to date.`);
            return;
        }

        const prerequisiteWarnings = await this.checkPrerequisites(version, cwd);
        if (prerequisiteWarnings.length > 0) {
            const prerequisiteChoice = await vscode.window.showWarningMessage(
                'SuiteForge found SuiteCloud CLI prerequisite issues.',
                {
                    modal: true,
                    detail: prerequisiteWarnings.map(warning => `• ${warning}`).join('\n'),
                },
                'Continue Anyway',
                'Open Prerequisites',
            );
            if (prerequisiteChoice === 'Open Prerequisites') {
                await this.openExternal('https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1558708810.html');
                return;
            }
            if (prerequisiteChoice !== 'Continue Anyway') { return; }
        }

        const verb = installed ? 'update' : 'install';
        const choice = await vscode.window.showWarningMessage(
            `SuiteForge will ${verb} SuiteCloud CLI ${version} globally using npm.`,
            {
                modal: true,
                detail: `Command: npm install -g ${CLI_PACKAGE}@${version}\n\nThis changes developer tooling for your user or machine. Installing the package accepts Oracle's applicable license terms. SuiteForge will never run this command without confirmation.`,
            },
            `${installed ? 'Update' : 'Install'} in Terminal`,
            'View Oracle Terms',
        );
        if (choice === 'View Oracle Terms') {
            await this.openExternal(INSTALL_GUIDE_URL);
            return;
        }
        if (choice !== `${installed ? 'Update' : 'Install'} in Terminal`) { return; }

        await this.runUpdateInTerminal(version, cwd);
    }

    private async performCheck(manual: boolean): Promise<void> {
        const cwd = this.workingDirectory();
        const installed = await this.detectInstalledVersion(cwd);
        if (!installed) {
            this.updateStatus({ checkError: 'SuiteCloud CLI was not found on PATH.' });
            if (manual || this.context.globalState.get<string>(NOTIFIED_VERSION_KEY) !== 'missing') {
                await this.context.globalState.update(NOTIFIED_VERSION_KEY, 'missing');
                const choice = await vscode.window.showWarningMessage(
                    'SuiteForge: SuiteCloud CLI is not installed or is not available on PATH.',
                    'Install',
                    'Installation Guide',
                );
                if (choice === 'Install') { await this.updateCli(); }
                if (choice === 'Installation Guide') { await this.openExternal(INSTALL_GUIDE_URL); }
            }
            return;
        }

        if (!manual && this.updateFrequency() === 'never') {
            this.updateStatus({ installed, checkError: 'Automatic update checks are disabled.' });
            return;
        }

        const latest = await this.resolveLatestVersion(cwd, manual);
        const state: CliVersionState = { installed, latest };
        if (!latest) {
            state.checkError = 'The latest version could not be checked.';
            this.updateStatus(state);
            if (manual) {
                void vscode.window.showWarningMessage(
                    `SuiteForge: SuiteCloud CLI ${installed} is installed, but the npm registry could not be checked.`,
                    'Installation Guide',
                ).then(choice => {
                    if (choice === 'Installation Guide') { void this.openExternal(INSTALL_GUIDE_URL); }
                });
            }
            return;
        }

        this.updateStatus(state);
        if (compareCliVersions(latest, installed) <= 0) {
            if (manual) {
                void vscode.window.showInformationMessage(`SuiteForge: SuiteCloud CLI ${installed} is up to date.`);
            }
            return;
        }

        const supported = isSupportedCliVersion(latest);
        const skipped = this.context.globalState.get<string>(SKIPPED_VERSION_KEY) === latest;
        const notified = this.context.globalState.get<string>(NOTIFIED_VERSION_KEY) === latest;
        if (!manual && (skipped || notified)) { return; }

        await this.context.globalState.update(NOTIFIED_VERSION_KEY, latest);
        const message = supported
            ? `SuiteCloud CLI ${latest} is available (installed: ${installed}). SuiteForge is compatible with this release.`
            : `SuiteCloud CLI ${latest} is available, but this SuiteForge version supports CLI major versions ${MIN_SUPPORTED_CLI_MAJOR}-${MAX_SUPPORTED_CLI_MAJOR}.`;
        const actions = supported
            ? ['Update', 'View Changes', 'Skip This Version']
            : ['View Changes', 'Skip This Version'];
        const choice = await vscode.window.showInformationMessage(message, ...actions);
        if (choice === 'Update') { await this.updateCli(latest); }
        if (choice === 'View Changes') { await this.openExternal(RELEASE_NOTES_URL); }
        if (choice === 'Skip This Version') {
            await this.context.globalState.update(SKIPPED_VERSION_KEY, latest);
            void vscode.window.showInformationMessage(`SuiteForge: SuiteCloud CLI ${latest} update notifications are muted.`);
        }
    }

    private async detectInstalledVersion(cwd: string): Promise<string | undefined> {
        try {
            const result = await captureKnownTool('suitecloud', ['--version'], cwd);
            if (result.code !== 0) { return undefined; }
            return parseCliVersion(`${result.stdout}\n${result.stderr}`);
        } catch {
            return undefined;
        }
    }

    private async resolveLatestVersion(cwd: string, force: boolean): Promise<string | undefined> {
        const frequency = this.updateFrequency();
        const lastCheck = this.context.globalState.get<number>(LAST_CHECK_KEY);
        const cachedValue = this.context.globalState.get<string>(CACHED_LATEST_KEY);
        const cached = cachedValue && isSafeCliVersion(cachedValue) ? cachedValue : undefined;
        if (!force && cached && !shouldCheckForCliUpdate(lastCheck, frequency)) {
            return cached;
        }
        if (!force && frequency === 'never') { return cached; }

        try {
            const result = await captureKnownTool('npm', ['view', CLI_PACKAGE, 'version', '--json'], cwd);
            if (result.code !== 0) { return cached; }
            const latest = parseCliVersion(result.stdout);
            if (!latest || !isSafeCliVersion(latest)) { return cached; }
            await Promise.all([
                this.context.globalState.update(LAST_CHECK_KEY, Date.now()),
                this.context.globalState.update(CACHED_LATEST_KEY, latest),
            ]);
            return latest;
        } catch {
            return cached;
        }
    }

    private async runUpdateInTerminal(version: string, cwd: string): Promise<void> {
        const packageSpec = `${CLI_PACKAGE}@${version}`;
        const terminal = vscode.window.createTerminal({
            name: `SuiteForge: SuiteCloud CLI ${version}`,
            cwd,
        });
        terminal.show();

        const shellIntegration = await waitForShellIntegration(terminal, 3_000);
        if (!shellIntegration) {
            terminal.sendText(`npm install -g ${packageSpec}`, true);
            void vscode.window.showInformationMessage(
                'SuiteForge: The update is running in the terminal. Use “Check for SuiteCloud CLI Updates” after it finishes.',
            );
            return;
        }

        this.updating = true;
        this.statusItem.text = '$(sync~spin) Updating SuiteCloud CLI';
        this.statusItem.tooltip = `SuiteForge: Updating SuiteCloud CLI to ${version}`;
        let execution: vscode.TerminalShellExecution;
        try {
            execution = shellIntegration.executeCommand('npm', ['install', '-g', packageSpec]);
        } catch (error) {
            this.updating = false;
            this.updateStatus({ installed: await this.detectInstalledVersion(cwd), latest: version });
            void vscode.window.showErrorMessage(
                `SuiteForge: Could not start the update in the terminal: ${error instanceof Error ? error.message : String(error)}`,
            );
            return;
        }
        const exitCode = await waitForExecutionEnd(terminal, execution, 30 * 60 * 1000);
        this.updating = false;

        if (exitCode !== 0) {
            this.updateStatus({ installed: await this.detectInstalledVersion(cwd), latest: version });
            void vscode.window.showErrorMessage(
                exitCode === undefined
                    ? 'SuiteForge: The SuiteCloud CLI update ended without a verifiable exit code. Check the terminal output.'
                    : `SuiteForge: The SuiteCloud CLI update failed with exit code ${exitCode}. Check the terminal output.`,
            );
            return;
        }

        const installed = await this.detectInstalledVersion(cwd);
        this.updateStatus({ installed, latest: version });
        if (installed === version) {
            await this.context.globalState.update(SKIPPED_VERSION_KEY, undefined);
            void vscode.window.showInformationMessage(`SuiteForge: SuiteCloud CLI was updated to ${version}.`);
        } else {
            void vscode.window.showWarningMessage(
                `SuiteForge: npm completed, but “suitecloud --version”${installed ? ` reports ${installed}` : ' could not be verified'}. Check your PATH and terminal output.`,
            );
        }
    }

    private async checkPrerequisites(version: string, cwd: string): Promise<string[]> {
        const warnings: string[] = [];
        const [npmResult, nodeResult, javaResult] = await Promise.allSettled([
            captureKnownTool('npm', ['--version'], cwd),
            captureKnownTool('node', ['--version'], cwd),
            captureKnownTool('java', ['-version'], cwd),
        ]);

        if (npmResult.status === 'rejected' || npmResult.value.code !== 0) {
            warnings.push('npm is not available on PATH, so the global package update cannot run.');
        }

        const nodeOutput = nodeResult.status === 'fulfilled'
            ? `${nodeResult.value.stdout}\n${nodeResult.value.stderr}`
            : '';
        const nodeVersion = parseCliVersion(nodeOutput);
        if (!nodeVersion) {
            warnings.push('Node.js could not be detected.');
        } else if (numericVersionParts(version)[0] >= 4 && numericVersionParts(nodeVersion)[0] < 22) {
            warnings.push(`Node.js ${nodeVersion} is installed; SuiteCloud CLI 4.x requires a newer supported Node.js LTS release.`);
        }

        const javaOutput = javaResult.status === 'fulfilled'
            ? `${javaResult.value.stdout}\n${javaResult.value.stderr}`
            : '';
        const javaMajor = parseJavaMajorVersion(javaOutput);
        if (!javaMajor) {
            warnings.push('Java could not be detected; Oracle JDK 17 or 21 is required to run SuiteCloud CLI.');
        } else if (javaMajor !== 17 && javaMajor !== 21) {
            warnings.push(`Java ${javaMajor} is installed; Oracle documents JDK 17 or 21 for SuiteCloud CLI.`);
        }
        return warnings;
    }

    private updateStatus(state: CliVersionState): void {
        if (this.updating) { return; }
        if (!state.installed) {
            this.statusItem.text = '$(warning) SuiteCloud CLI';
            this.statusItem.tooltip = state.checkError ?? 'SuiteForge: SuiteCloud CLI was not found';
            return;
        }

        const updateAvailable = state.latest && compareCliVersions(state.latest, state.installed) > 0;
        this.statusItem.text = updateAvailable
            ? `$(arrow-up) CLI ${state.installed}`
            : `$(cloud) CLI ${state.installed}`;
        this.statusItem.tooltip = updateAvailable
            ? `SuiteCloud CLI ${state.latest} is available. Click to review the update.`
            : state.checkError
                ? `SuiteCloud CLI ${state.installed} is installed. ${state.checkError}`
                : `SuiteCloud CLI ${state.installed} is up to date.`;
    }

    private refreshStatusVisibility(): void {
        const visible = vscode.workspace.getConfiguration('suiteforge').get<boolean>(
            'suiteCloudCli.showStatusBar',
            true,
        );
        if (visible) { this.statusItem.show(); } else { this.statusItem.hide(); }
    }

    private updateFrequency(): UpdateCheckFrequency {
        const configured = vscode.workspace.getConfiguration('suiteforge').get<string>(
            'suiteCloudCli.updateChecks',
            'daily',
        );
        return configured === 'weekly' || configured === 'never' ? configured : 'daily';
    }

    private workingDirectory(): string {
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
        if (activeFolder?.uri.scheme === 'file') { return activeFolder.uri.fsPath; }
        const localFolder = vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === 'file');
        return localFolder?.uri.fsPath ?? process.cwd();
    }

    private openExternal(url: string): Thenable<boolean> {
        return vscode.env.openExternal(vscode.Uri.parse(url));
    }
}

function numericVersionParts(version: string): [number, number, number] {
    const core = version.split('-', 1)[0].split('.').map(part => Number.parseInt(part, 10));
    return [core[0] || 0, core[1] || 0, core[2] || 0];
}

export function parseJavaMajorVersion(output: string): number | undefined {
    const match = /(?:java|openjdk)\s+version\s+"?(\d+)(?:\.(\d+))?/i.exec(output);
    if (!match) { return undefined; }
    const first = Number.parseInt(match[1], 10);
    if (first === 1 && match[2]) { return Number.parseInt(match[2], 10); }
    return first;
}

async function captureKnownTool(
    tool: KnownTool,
    args: string[],
    cwd: string,
): Promise<ToolResult> {
    const invocation = buildKnownToolInvocation(tool, args, cwd);
    return new Promise<ToolResult>((resolve, reject) => {
        let child: ChildProcess;
        try {
            child = spawn(invocation.executable, invocation.args, invocation.options);
        } catch (error) {
            reject(error);
            return;
        }

        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            terminateToolProcess(child);
            finish({ stdout, stderr: `${stderr}\nSuiteForge: Version check timed out.`, code: 1 });
        }, TOOL_TIMEOUT_MS);

        const finish = (result: ToolResult): void => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
            const text = chunk.toString();
            if (stdout.length + stderr.length + text.length > MAX_TOOL_OUTPUT) {
                terminateToolProcess(child);
                finish({ stdout, stderr: `${stderr}\nSuiteForge: Version output exceeded the limit.`, code: 1 });
                return;
            }
            if (target === 'stdout') { stdout += text; } else { stderr += text; }
        };

        child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
        child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));
        child.on('error', error => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', code => finish({ stdout, stderr, code: code ?? 1 }));
    });
}

function terminateToolProcess(child: ChildProcess): void {
    if (process.platform === 'win32') {
        if (child.pid) { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); }
    } else {
        child.kill();
    }
}

function waitForShellIntegration(
    terminal: vscode.Terminal,
    timeoutMs: number,
): Promise<vscode.TerminalShellIntegration | undefined> {
    if (terminal.shellIntegration) { return Promise.resolve(terminal.shellIntegration); }
    return new Promise(resolve => {
        let settled = false;
        let listener: vscode.Disposable | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (integration?: vscode.TerminalShellIntegration): void => {
            if (settled) { return; }
            settled = true;
            if (timer) { clearTimeout(timer); }
            listener?.dispose();
            resolve(integration);
        };
        listener = vscode.window.onDidChangeTerminalShellIntegration(event => {
            if (event.terminal === terminal) { finish(event.shellIntegration); }
        });
        timer = setTimeout(() => finish(undefined), timeoutMs);
    });
}

function waitForExecutionEnd(
    terminal: vscode.Terminal,
    execution: vscode.TerminalShellExecution,
    timeoutMs: number,
): Promise<number | undefined> {
    return new Promise(resolve => {
        let settled = false;
        let endListener: vscode.Disposable | undefined;
        let closeListener: vscode.Disposable | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (exitCode: number | undefined): void => {
            if (settled) { return; }
            settled = true;
            if (timer) { clearTimeout(timer); }
            endListener?.dispose();
            closeListener?.dispose();
            resolve(exitCode);
        };
        endListener = vscode.window.onDidEndTerminalShellExecution(event => {
            if (event.terminal !== terminal || event.execution !== execution) { return; }
            finish(event.exitCode);
        });
        closeListener = vscode.window.onDidCloseTerminal(closed => {
            if (closed !== terminal) { return; }
            finish(undefined);
        });
        timer = setTimeout(() => finish(undefined), timeoutMs);
    });
}
