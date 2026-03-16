import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function startLanguageServer(context: vscode.ExtensionContext): void {
    // The server is a separate Node process. We point to the bundled JS file
    // that esbuild produces at dist/server.js.
    const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));

    const serverOptions: ServerOptions = {
        run: {
            module: serverModule,
            transport: TransportKind.ipc,
        },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] },
        },
    };

    // The client options tell VS Code which files this language server handles.
    // We activate it for .js files (SuiteScript files are JavaScript).
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'javascript' },
            { scheme: 'untitled', language: 'javascript' },
        ],
    };

    client = new LanguageClient(
        'suiteforge-lsp',
        'SuiteForge SuiteScript IntelliSense',
        serverOptions,
        clientOptions,
    );

    client.start();
}

export async function stopLanguageServer(): Promise<void> {
    if (client) {
        await client.stop();
        client = undefined;
    }
}
