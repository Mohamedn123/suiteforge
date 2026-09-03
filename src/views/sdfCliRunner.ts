import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';

export interface CliRunEvent {
    type: 'stdout' | 'stderr' | 'exit' | 'error';
    data: string;
    code?: number;
    cancelled?: boolean;
}

export interface CliCaptureResult {
    stdout: string;
    stderr: string;
    code: number;
    cancelled: boolean;
    timedOut: boolean;
}

export interface CliCaptureOptions {
    cancellationToken?: vscode.CancellationToken;
    timeoutMs?: number;
    maxOutput?: number;
}

export interface SuiteCloudInvocation {
    executable: string;
    args: string[];
    options: SpawnOptions;
    displayCommand: string;
}

export class SuiteCloudCliInputError extends Error {}

const CLI_COMMAND_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/;
const DEFAULT_CAPTURE_TIMEOUT = 30_000;
const DEFAULT_MAX_CAPTURED_OUTPUT = 1024 * 1024;

/**
 * Builds the platform-specific SuiteCloud invocation in one place so regular
 * commands and account-discovery probes receive identical argument hardening.
 */
export function buildSuiteCloudInvocation(
    commandId: string,
    args: string[],
    cwd: string,
    windows = process.platform === 'win32',
): SuiteCloudInvocation {
    const fullArgs = [commandId, ...args];
    if (!CLI_COMMAND_PATTERN.test(commandId)) {
        throw new SuiteCloudCliInputError('Refused an invalid CLI command.');
    }
    if (fullArgs.some(arg => /[\0\r\n]/.test(arg))) {
        throw new SuiteCloudCliInputError('Refused a CLI argument containing control characters.');
    }
    if (windows && args.some(isUnsafeWindowsArg)) {
        throw new SuiteCloudCliInputError('Refused an unsafe Windows CLI argument.');
    }

    const displayCommand = ['suitecloud', ...fullArgs.map(arg => quoteArg(arg, windows))].join(' ');
    if (windows) {
        return {
            executable: 'cmd.exe',
            args: ['/d', '/s', '/c', `"${displayCommand}"`],
            options: {
                cwd,
                env: { ...process.env },
                // displayCommand is already fully quoted. Without this flag,
                // Node escapes the nested quotes a second time.
                windowsVerbatimArguments: true,
            },
            displayCommand,
        };
    }

    return {
        executable: 'suitecloud',
        args: fullArgs,
        options: { cwd, env: { ...process.env } },
        displayCommand,
    };
}

/** Runs a short, non-interactive SuiteCloud command and captures its output. */
export function captureSuiteCloudCommand(
    commandId: string,
    args: string[],
    workspaceRoot: vscode.Uri,
    options: CliCaptureOptions = {},
): Promise<CliCaptureResult> {
    if (workspaceRoot.scheme !== 'file') {
        return Promise.reject(new Error('SuiteCloud CLI commands require a local workspace folder.'));
    }
    if (options.cancellationToken?.isCancellationRequested) {
        return Promise.resolve({
            stdout: '',
            stderr: '',
            code: 1,
            cancelled: true,
            timedOut: false,
        });
    }

    const invocation = buildSuiteCloudInvocation(commandId, args, workspaceRoot.fsPath);
    const timeoutMs = options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT;
    const maxOutput = options.maxOutput ?? DEFAULT_MAX_CAPTURED_OUTPUT;

    return new Promise<CliCaptureResult>((resolve, reject) => {
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
        let cancelled = false;
        let timedOut = false;

        const cancellation = options.cancellationToken?.onCancellationRequested(() => {
            cancelled = true;
            terminateSuiteCloudProcess(child);
        });
        const timer = setTimeout(() => {
            timedOut = true;
            terminateSuiteCloudProcess(child);
        }, timeoutMs);

        const finish = (result: CliCaptureResult): void => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            cancellation?.dispose();
            resolve(result);
        };

        const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
            const data = chunk.toString();
            if (stdout.length + stderr.length + data.length > maxOutput) {
                stderr += '\nSuiteForge: SuiteCloud CLI output exceeded the capture limit.';
                timedOut = true;
                terminateSuiteCloudProcess(child);
                return;
            }
            if (target === 'stdout') { stdout += data; } else { stderr += data; }
        };

        child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
        child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));
        child.on('error', error => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            cancellation?.dispose();
            reject(error);
        });
        child.on('close', code => finish({
            stdout,
            stderr,
            code: code ?? 1,
            cancelled,
            timedOut,
        }));
    });
}

function terminateSuiteCloudProcess(child: ChildProcess): void {
    if (process.platform === 'win32') {
        if (child.pid) {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        }
    } else {
        child.kill();
    }
}

/**
 * Wraps child_process.spawn for SDF CLI commands.
 *
 * Usage:
 *   const runner = new SdfCliRunner();
 *   runner.on('output', (event: CliRunEvent) => { ... });
 *   runner.run('validate');
 *   runner.cancel();
 *
 * We use Node's EventEmitter (not VS Code's) because this runs in the
 * extension host (Node process), not in a webview.
 */
export class SdfCliRunner extends EventEmitter {
    private process: ChildProcess | null = null;
    private outputBuffer: string = '';
    private cancelled = false;
    private runToken = 0;
    private static readonly MAX_CAPTURED_OUTPUT = 5 * 1024 * 1024;

    get isRunning(): boolean {
        return this.process !== null;
    }

    run(commandId: string, args: string[] = [], workspaceRoot?: vscode.Uri): boolean {
        if (this.process) {
            vscode.window.showWarningMessage('SuiteForge: A command is already running. Cancel it first.');
            // Emit an error event so any UI waiting in its "running" state
            // (e.g. the output webview) receives a finish signal.
            this.emit('output', {
                type: 'error',
                data: 'SuiteForge: A command is already running. Cancel it first.\n',
            } satisfies CliRunEvent);
            return false;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        const root = workspaceRoot ?? workspaceFolders?.[0]?.uri;
        if (!root) {
            vscode.window.showErrorMessage('SuiteForge: No workspace folder is open.');
            // Emit an error event so any UI waiting in its "running" state
            // (e.g. the output webview) receives a finish signal.
            this.emit('output', {
                type: 'error',
                data: 'SuiteForge: No workspace folder is open.\n',
            } satisfies CliRunEvent);
            return false;
        }

        if (root.scheme !== 'file') {
            this.emit('output', {
                type: 'error',
                data: 'SuiteForge: SuiteCloud CLI commands require a local workspace folder.\n',
            } satisfies CliRunEvent);
            return false;
        }
        const cwd = root.fsPath;

        // SuiteCloud CLI for Node.js is invoked as `suitecloud <command>`.
        // On Windows, globally installed npm packages expose a `suitecloud.cmd`
        // shim, and Node refuses to spawn .cmd/.bat shims directly (throws
        // EINVAL — the BatBadBut hardening), so we go through cmd.exe.
        // Cancellation still works because we tree-kill via taskkill /T.
        // On POSIX we spawn without a shell so kill() stops the CLI directly.
        // commandId always comes from our own sdfCommands.json. Extra args
        // (e.g. --paths for file:upload) are quoted when they contain spaces.
        this.outputBuffer = '';
        this.cancelled = false;
        const token = ++this.runToken;

        let invocation: SuiteCloudInvocation;
        try {
            invocation = buildSuiteCloudInvocation(commandId, args, cwd);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof SuiteCloudCliInputError) {
                vscode.window.showErrorMessage(`SuiteForge: ${message}`);
            }
            this.emit('output', { type: 'error', data: `SuiteForge: ${message}\n` } satisfies CliRunEvent);
            return false;
        }

        try {
            this.process = spawn(invocation.executable, invocation.args, invocation.options);
        } catch (err) {
            this.process = null;
            this.emit('output', {
                type: 'error',
                data: `Failed to start: ${(err as Error).message}\n`,
            } satisfies CliRunEvent);
            return false;
        }

        // Emitted after the spawn succeeds — listeners (the output webview)
        // have already switched to the "running" state by this point, so the
        // banner lands in the log instead of being cleared by it.
        this.emit('output', {
            type: 'stdout',
            data: `> ${invocation.displayCommand}\n`,
        } satisfies CliRunEvent);

        this.process.stdout?.on('data', (chunk: Buffer) => {
            const data = chunk.toString();
            this.appendCapturedOutput(data);
            this.emit('output', {
                type: 'stdout',
                data,
            } satisfies CliRunEvent);
        });

        this.process.stderr?.on('data', (chunk: Buffer) => {
            const data = chunk.toString();
            this.appendCapturedOutput(data);
            this.emit('output', {
                type: 'stderr',
                data,
            } satisfies CliRunEvent);
        });

        this.process.on('error', (err: Error) => {
            if (token !== this.runToken) { return; }
            // A close event normally follows an error. Invalidate this run so
            // the UI receives exactly one terminal event.
            this.runToken++;
            this.emit('output', {
                type: 'error',
                data: `Failed to start: ${err.message}\n\nMake sure @oracle/suitecloud-cli is installed globally:\n  npm install -g @oracle/suitecloud-cli\n`,
            } satisfies CliRunEvent);
            this.process = null;

            vscode.window.showErrorMessage('SuiteForge: Failed to start SuiteCloud CLI. Is it installed?', 'Learn More').then(res => {
                if (res === 'Learn More') {
                    vscode.env.openExternal(vscode.Uri.parse('https://docs.oracle.com/en/cloud/saas/netsuite/ns-go-live/article_1562577413.html'));
                }
            });
        });

        this.process.on('close', (code: number | null) => {
            // If this run was cancelled (or superseded by a newer run), the
            // 'exit' event was already emitted from cancel() — don't emit twice.
            if (token !== this.runToken) { return; }
            this.process = null;
            this.emit('output', {
                type: 'exit',
                data: `\nProcess exited with code ${code ?? 'unknown'}\n`,
                code: code ?? 1,
            } satisfies CliRunEvent);

            // Skip "did it fail because of auth/setup?" hints when the user
            // cancelled — the output is truncated and would produce false advice.
            if (!this.cancelled && code !== 0) {
                this.analyzeOutputForErrors(root);
            }
        });

        return true;
    }

    private analyzeOutputForErrors(workspaceRoot: vscode.Uri): void {
        const lowerOutput = this.outputBuffer.toLowerCase();

        if (lowerOutput.includes('not authenticated') || lowerOutput.includes('no valid auth id') || lowerOutput.includes('run suitecloud account:setup')) {
            vscode.window.showErrorMessage(
                'SuiteCloud CLI: You are not authenticated.',
                'Run account:setup'
            ).then(selection => {
                if (selection === 'Run account:setup') {
                    // Route through the registered command so interactive CLI
                    // commands use a real terminal and retain the project that
                    // produced the error.
                    void vscode.commands.executeCommand(
                        'suiteforge.runSdfCommand',
                        'account:setup',
                        workspaceRoot,
                    );
                }
            });
        } else if (lowerOutput.includes('project not set up') || lowerOutput.includes('not a suitecloud project') || lowerOutput.includes('run suitecloud project:create')) {
             vscode.window.showErrorMessage(
                'SuiteCloud CLI: This directory is not a SuiteCloud project.',
                'Run project:create'
            ).then(selection => {
                if (selection === 'Run project:create') {
                    void vscode.commands.executeCommand(
                        'suiteforge.runSdfCommand',
                        'project:create',
                        workspaceRoot,
                    );
                }
            });
        }
    }

    private appendCapturedOutput(data: string): void {
        this.outputBuffer += data;
        if (this.outputBuffer.length > SdfCliRunner.MAX_CAPTURED_OUTPUT) {
            this.outputBuffer = this.outputBuffer.slice(-SdfCliRunner.MAX_CAPTURED_OUTPUT);
        }
    }

    cancel(): void {
        if (!this.process) { return; }
        this.cancelled = true;
        // Bump the run token so the real 'close' event of the dying process
        // (which arrives after taskkill/kill takes effect) is recognized as
        // stale and does not emit a second 'exit' after our cancellation one.
        this.runToken++;

        // On Windows, ChildProcess.kill() only terminates the immediate
        // cmd.exe shim; the underlying node process keeps running. taskkill
        // with /T walks the process tree and kills children too.
        terminateSuiteCloudProcess(this.process);

        this.process = null;
        this.emit('output', {
            type: 'exit',
            data: '\n--- Cancelled by user ---\n',
            code: 1,
            cancelled: true,
        } satisfies CliRunEvent);
    }
}

/** Formats a CLI argument for execution on Windows or display on POSIX. */
export function quoteArg(arg: string, windows = process.platform === 'win32'): string {
    if (windows) {
        // Unsafe cmd.exe metacharacters are rejected before this function.
        return `"${arg}"`;
    }
    if (!/\s/.test(arg)) { return arg; }
    return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function isUnsafeWindowsArg(arg: string): boolean {
    return /[\0\r\n&|<>^%!()"]/.test(arg);
}
