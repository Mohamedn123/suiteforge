import * as vscode from 'vscode';
import { SdfCompletionProvider } from './sdfCompletionProvider';
import { SdfHoverProvider } from './sdfHoverProvider';

// Use both selectors so we match regardless of how VS Code detected the file language.
// { language: 'xml' } — standard XML language ID
// { pattern: '**/*.xml' } — fallback by file extension
const XML_SELECTOR: vscode.DocumentSelector = [
    { language: 'xml', scheme: 'file' },
    { language: 'xml', scheme: 'untitled' },
    { pattern: '**/*.xml', scheme: 'file' },
];

export function registerProviders(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        // Register '>' as a trigger character.
        // This means: when the user types '>' to close an opening tag like <fieldtype>,
        // VS Code immediately calls provideCompletionItems. Without trigger characters,
        // VS Code only fires the provider when quickSuggestions decides to, which
        // often does not happen inside XML text nodes.
        vscode.languages.registerCompletionItemProvider(
            XML_SELECTOR,
            new SdfCompletionProvider(),
            '>',   // fires after typing <fieldtype>
            '\n',  // fires after pressing Enter inside an open tag
        ),

        vscode.languages.registerHoverProvider(
            XML_SELECTOR,
            new SdfHoverProvider(),
        ),
    );
}
