import * as vscode from 'vscode';
import { SdfSidebarProvider } from './SdfSidebarProvider';
import { SdfWebviewPanel } from './SdfWebviewPanel';
import type { SdfCommand } from '../data';

export function registerViews(context: vscode.ExtensionContext): void {
    const sidebarProvider = new SdfSidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SdfSidebarProvider.viewType,
            sidebarProvider,
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('suiteforge.refreshSdfCommands', () => {
            // no-op for now; webview sidebar is self-contained
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'suiteforge.runSdfCommand',
            (command: SdfCommand) => {
                const panel = SdfWebviewPanel.getOrCreate(context.extensionUri);
                panel.runCommand(command);
            },
        ),
    );
}
