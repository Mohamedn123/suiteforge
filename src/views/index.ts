import * as vscode from 'vscode';
import { SdfSidebarProvider } from './SdfSidebarProvider';
import { SdfWebviewPanel } from './SdfWebviewPanel';
import { registerDeployActiveFile } from './deployActiveFile';
import type { SdfCommand } from '../data';
import { sdfCommandCategories } from '../data';
import { disposeValidationDiagnostics } from './validationParser';
import {
    DeploymentAccountManager,
    environmentLabel,
    requiresDeploymentAccount,
} from './deploymentAccountManager';

export function registerViews(context: vscode.ExtensionContext): void {
    const sidebarProvider = new SdfSidebarProvider(context.extensionUri);
    const accountManager = new DeploymentAccountManager(context);
    context.subscriptions.push(
        accountManager,
        vscode.window.registerWebviewViewProvider(
            SdfSidebarProvider.viewType,
            sidebarProvider,
        ),
        vscode.commands.registerCommand('suiteforge.refreshSdfCommands', () => {
            sidebarProvider.refresh();
        }),
        vscode.commands.registerCommand('suiteforge.selectDeploymentAccount', (workspaceRoot?: vscode.Uri) =>
            accountManager.selectDeploymentAccount(workspaceRoot),
        ),
        vscode.commands.registerCommand('suiteforge.addNetSuiteAccount', (workspaceRoot?: vscode.Uri) =>
            accountManager.addNetSuiteAccount(workspaceRoot),
        ),
        vscode.commands.registerCommand('suiteforge.manageSavedAccounts', (workspaceRoot?: vscode.Uri) =>
            accountManager.manageSavedAccounts(workspaceRoot),
        ),
        vscode.commands.registerCommand(
            'suiteforge.runSdfCommand',
            async (command?: SdfCommand | string, preferredWorkspaceRoot?: vscode.Uri) => {
                // When invoked from the Command Palette there is no argument;
                // let the user pick a command instead of crashing on undefined.
                const commandId = typeof command === 'string' ? command : command?.id;
                const cmd = commandId ? findKnownCommand(commandId) : await pickSdfCommand();
                if (!cmd) { return; }
                const folder = await pickWorkspaceFolder(preferredWorkspaceRoot);
                if (!folder) { return; }

                const isDeployment = requiresDeploymentAccount(cmd.id);
                if (isDeployment && SdfWebviewPanel.commandIsRunning) {
                    vscode.window.showWarningMessage('SuiteForge: A command is already running. Cancel it before deploying.');
                    return;
                }

                const account = isDeployment
                    ? await accountManager.prepareForDeployment(folder.uri)
                    : undefined;
                if (isDeployment && !account) { return; }
                if (isDeployment && SdfWebviewPanel.commandIsRunning) {
                    vscode.window.showWarningMessage('SuiteForge: Another command started while the account picker was open. Deployment was cancelled.');
                    return;
                }

                const targetedCommand = account
                    ? {
                        ...cmd,
                        label: `${cmd.label} → ${account.authId}`,
                        description: `${cmd.description} Target: ${account.authId} (${environmentLabel(account.environment)}).`,
                    }
                    : cmd;

                if (cmd.interactive) {
                    const terminal = vscode.window.createTerminal({
                        name: `SuiteForge: ${cmd.label}${account ? ` — ${account.authId}` : ''}`,
                        cwd: folder.uri,
                    });
                    terminal.show();
                    if (cmd.id === 'account:setup:ci') {
                        // CI setup has no --interactive mode because it needs
                        // certificate/account arguments. Pre-fill the command
                        // and leave the cursor ready for the user to add them.
                        terminal.sendText(`suitecloud ${cmd.id} `, false);
                    } else {
                        terminal.sendText(`suitecloud ${cmd.id} --interactive`, true);
                    }
                    return;
                }
                const panel = SdfWebviewPanel.getOrCreate(context.extensionUri);
                panel.runCommand(targetedCommand, undefined, folder.uri, {
                    accountAuthId: account?.authId,
                });
            },
        ),
        { dispose: disposeValidationDiagnostics },
    );

    registerDeployActiveFile(context, accountManager);
}

function findKnownCommand(id: string): SdfCommand | undefined {
    return sdfCommandCategories.flatMap(category => category.commands).find(command => command.id === id);
}

async function pickWorkspaceFolder(preferredWorkspaceRoot?: vscode.Uri): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('SuiteForge: No workspace folder is open.');
        return undefined;
    }
    if (preferredWorkspaceRoot) {
        const preferred = folders.find(folder => folder.uri.toString() === preferredWorkspaceRoot.toString());
        if (preferred) { return preferred; }
    }
    if (folders.length === 1) { return folders[0]; }

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
    if (activeFolder) { return activeFolder; }

    return vscode.window.showWorkspaceFolderPick({
        placeHolder: 'Select the SuiteCloud project for this command',
    });
}

async function pickSdfCommand(): Promise<SdfCommand | undefined> {
    interface CommandItem extends vscode.QuickPickItem { cmd: SdfCommand }
    const items: CommandItem[] = sdfCommandCategories.flatMap(cat =>
        cat.commands.map(c => ({
            label: `$(play) ${c.label}`,
            description: c.id,
            detail: `${cat.category} — ${c.description}`,
            cmd: c,
        })),
    );

    const picked = await vscode.window.showQuickPick<CommandItem>(items, {
        title: 'SuiteForge — Run SDF Command',
        placeHolder: 'Choose a SuiteCloud CLI command to run',
        matchOnDescription: true,
        matchOnDetail: true,
    });
    return picked?.cmd;
}
