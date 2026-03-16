import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';

export interface CliRunEvent {
    type: 'stdout' | 'stderr' | 'exit' | 'error';
    data: string;
    code?: number;
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

    get isRunning(): boolean {
        return this.process !== null;
    }

    run(commandId: string): void {
        if (this.process) {
            vscode.window.showWarningMessage('SuiteForge: A command is already running. Cancel it first.');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('SuiteForge: No workspace folder is open.');
            return;
        }

        const cwd = workspaceFolders[0].uri.fsPath;

        // SuiteCloud CLI for Node.js is invoked as `suitecloud <command>`
        // On Windows, we need to use the .cmd extension for globally installed npm packages
        const isWindows = process.platform === 'win32';
        const executable = isWindows ? 'suitecloud.cmd' : 'suitecloud';

        this.emit('output', {
            type: 'stdout',
            data: `> suitecloud ${commandId}\n`,
        } satisfies CliRunEvent);

        this.process = spawn(executable, [commandId], {
            cwd,
            shell: true,
            env: { ...process.env },
        });

        this.process.stdout?.on('data', (chunk: Buffer) => {
            this.emit('output', {
                type: 'stdout',
                data: chunk.toString(),
            } satisfies CliRunEvent);
        });

        this.process.stderr?.on('data', (chunk: Buffer) => {
            this.emit('output', {
                type: 'stderr',
                data: chunk.toString(),
            } satisfies CliRunEvent);
        });

        this.process.on('error', (err: Error) => {
            this.emit('output', {
                type: 'error',
                data: `Failed to start: ${err.message}\n\nMake sure @oracle/suitecloud-cli is installed globally:\n  npm install -g @oracle/suitecloud-cli\n`,
            } satisfies CliRunEvent);
            this.process = null;
        });

        this.process.on('close', (code: number | null) => {
            this.emit('output', {
                type: 'exit',
                data: `\nProcess exited with code ${code ?? 'unknown'}\n`,
                code: code ?? 1,
            } satisfies CliRunEvent);
            this.process = null;
        });
    }

    cancel(): void {
        if (!this.process) { return; }
        this.process.kill();
        this.process = null;
        this.emit('output', {
            type: 'stderr',
            data: '\n--- Cancelled by user ---\n',
        } satisfies CliRunEvent);
    }
}
