import * as vscode from 'vscode';
import { registerReferenceCommands } from './commands/reference';
import { registerGeneratorCommands } from './generators/index';
import { registerProviders } from './providers/index';
import { registerViews } from './views/index';
import { startLanguageServer, stopLanguageServer } from './lsp/client';

export function activate(context: vscode.ExtensionContext): void {
    registerReferenceCommands(context);
    registerGeneratorCommands(context);
    registerProviders(context);
    registerViews(context);
    startLanguageServer(context);
}

export async function deactivate(): Promise<void> {
    await stopLanguageServer();
}
