import * as vscode from 'vscode';

/**
 * Resolves the target folder for a generator.
 *
 * When invoked from the Explorer context menu, VS Code passes the right-clicked
 * folder as the first argument to the command handler. When invoked from the
 * Command Palette there is no argument, so we fall back to the workspace root.
 */
export async function resolveTargetFolder(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (uri) {
        return uri;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('SuiteForge: No workspace folder is open.');
        return undefined;
    }

    if (workspaceFolders.length === 1) {
        return workspaceFolders[0].uri;
    }

    // Multiple workspace folders — let the user pick one
    const picks = workspaceFolders.map(f => ({
        label: f.name,
        description: f.uri.fsPath,
        uri: f.uri,
    }));

    const selected = await vscode.window.showQuickPick(picks, {
        title: 'SuiteForge — Select a workspace folder',
        placeHolder: 'Where should the file be created?',
    });

    return selected?.uri;
}

/**
 * Writes a file using VS Code's workspace file system API, then opens it in the editor.
 * Using vscode.workspace.fs instead of Node's fs ensures this works with
 * remote workspaces (SSH, Dev Containers, WSL, etc.).
 */
export async function writeAndOpen(folderUri: vscode.Uri, fileName: string, content: string): Promise<void> {
    const fileUri = vscode.Uri.joinPath(folderUri, fileName);
    await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));
    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc);
}

/**
 * Validates an SDF script ID segment (the part after the "customrecord_" prefix).
 * Must start with a letter and contain only lowercase letters, numbers, and underscores.
 * Returns an error string (shown inline in the input box) or null if valid.
 */
export function validateScriptId(value: string): string | null {
    if (!value || value.trim().length === 0) {
        return 'ID cannot be empty.';
    }
    if (!/^[a-z][a-z0-9_]*$/.test(value)) {
        return 'Use only lowercase letters, numbers, and underscores. Must start with a letter.';
    }
    return null;
}

/**
 * Converts a raw string into a suggested script ID:
 * spaces → underscores, strip special chars, lowercase.
 */
export function toScriptId(label: string): string {
    return label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}
