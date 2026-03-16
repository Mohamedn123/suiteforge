import * as vscode from 'vscode';
import { generateScript } from './script';
import { registerSdfObjectCommands } from './sdfObject';

export function registerGeneratorCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'suiteforge.newScript',
            (uri?: vscode.Uri) => generateScript(uri),
        ),
        ...registerSdfObjectCommands(context),
    );
}
