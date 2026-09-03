import * as vscode from 'vscode';
import * as path from 'path';
import { SdfWebviewPanel } from './SdfWebviewPanel';
import { DeploymentAccountCoordinator, environmentLabel } from './deploymentAccountManager';

/**
 * "Deploy Active File" — uploads the currently open file to the NetSuite
 * File Cabinet with `suitecloud file:upload --paths <cabinetPath>`.
 *
 * SDF projects mirror the File Cabinet under `src/FileCabinet/`, so a file at
 *   <project>/src/FileCabinet/SuiteScripts/mylib/foo.js
 * lives at
 *   /SuiteScripts/mylib/foo.js
 * in the File Cabinet (account customization projects), or
 *   /SuiteApps/<bundle>/mylib/foo.js
 * for SuiteApps.
 */

const FILE_CABINET_SEGMENT = 'FileCabinet';
const SUITEAPP_ROOT = 'SuiteApps';

/** Maps a local file path to its File Cabinet path, or undefined if not under FileCabinet. */
export function toFileCabinetPath(fileUri: vscode.Uri, workspaceRoot?: vscode.Uri): string | undefined {
    let root: vscode.Uri | undefined = workspaceRoot;
    if (!root) {
        const folder = vscode.workspace.getWorkspaceFolder(fileUri);
        if (!folder) { return undefined; }
        root = folder.uri;
    }

    const relativePath = path.relative(root.fsPath, fileUri.fsPath);
    if (!relativePath
        || relativePath === '..'
        || relativePath.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativePath)) {
        return undefined;
    }
    const parts = relativePath.split(path.sep);

    // Only the exact project-root layout src/FileCabinet/... is deployable. A
    // backup tree such as backup/src/FileCabinet must not map to the account.
    if (parts[0] !== 'src' || parts[1] !== FILE_CABINET_SEGMENT) { return undefined; }
    const cabinetIndex = 1;

    const rel = parts.slice(cabinetIndex + 1);
    if (rel.length === 0) { return undefined; }
    // SuiteApp projects: src/FileCabinet/SuiteApps/<bundle>/... maps to
    // /SuiteApps/<bundle>/... — the SuiteApps segment is the cabinet root.
    if (rel[0] === SUITEAPP_ROOT) {
        return '/' + rel.join('/');
    }
    // Account customization: src/FileCabinet/SuiteScripts/... → /SuiteScripts/...
    return '/' + rel.join('/');
}

export function registerDeployActiveFile(
    context: vscode.ExtensionContext,
    accountManager: DeploymentAccountCoordinator,
): void {
    const command = vscode.commands.registerCommand('suiteforge.deployActiveFile', async (uri?: vscode.Uri) => {
        // Prefer the explicitly provided uri (e.g. editor context menu),
        // otherwise the active editor's document.
        let fileUri: vscode.Uri | undefined = uri;
        if (!fileUri) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.scheme === 'file') {
                fileUri = editor.document.uri;
            }
        }
        if (!fileUri) {
            vscode.window.showErrorMessage('SuiteForge: Open a file in the editor to deploy it.');
            return;
        }

        const cabinetPath = toFileCabinetPath(fileUri);
        if (!cabinetPath) {
            vscode.window.showErrorMessage(
                `SuiteForge: "${path.basename(fileUri.fsPath)}" is not inside a FileCabinet folder — nothing to upload. Files must live under src/FileCabinet/ (e.g. src/FileCabinet/SuiteScripts/).`,
            );
            return;
        }

        const folder = vscode.workspace.getWorkspaceFolder(fileUri);
        if (!folder) { return; }

        const openDocument = vscode.workspace.textDocuments.find(
            document => document.uri.toString() === fileUri!.toString(),
        );
        if (openDocument?.isDirty) {
            const saved = await openDocument.save();
            if (!saved) {
                vscode.window.showErrorMessage('SuiteForge: The active file could not be saved, so it was not deployed.');
                return;
            }
        }

        if (SdfWebviewPanel.commandIsRunning) {
            vscode.window.showWarningMessage('SuiteForge: A command is already running. Cancel it before deploying.');
            return;
        }

        const account = await accountManager.prepareForDeployment(folder.uri);
        if (!account) { return; }

        if (SdfWebviewPanel.commandIsRunning) {
            vscode.window.showWarningMessage('SuiteForge: Another command started while the account picker was open. Deployment was cancelled.');
            return;
        }

        const panel = SdfWebviewPanel.getOrCreate(context.extensionUri);
        panel.runCommand(
            {
                id: 'file:upload',
                label: `Upload ${path.basename(fileUri.fsPath)} → ${account.authId}`,
                description: `Uploads ${cabinetPath} using ${account.authId} (${environmentLabel(account.environment)}).`,
                flow: 'upload',
                icon: 'cloud-upload',
            },
            ['--paths', cabinetPath],
            folder.uri,
        );
    });
    context.subscriptions.push(command);

    // Status bar button — only visible when the active file is deployable.
    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusItem.command = 'suiteforge.deployActiveFile';
    statusItem.text = '$(cloud-upload) Deploy File';
    statusItem.tooltip = 'SuiteForge: Upload the active file to the NetSuite File Cabinet (suitecloud file:upload)';

    function updateStatus(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.scheme === 'file' && toFileCabinetPath(editor.document.uri)) {
            statusItem.show();
        } else {
            statusItem.hide();
        }
    }

    context.subscriptions.push(
        statusItem,
        vscode.window.onDidChangeActiveTextEditor(updateStatus),
        vscode.workspace.onDidOpenTextDocument(() => updateStatus()),
    );
    updateStatus();
}
