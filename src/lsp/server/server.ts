import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeResult,
    TextDocumentSyncKind,
    CompletionParams,
    CompletionList,
    HoverParams,
    SignatureHelpParams,
    SignatureHelp,
    CodeActionParams,
    CodeAction,
    Diagnostic,
    DiagnosticSeverity,
    ResponseError,
    ErrorCodes,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { analyzeDocument, narrowAnalysisToOffset, AnalysisResult } from './analyzer';
import { getCompletions, getHoverInfo } from './completions';
import { getSignatureHelp } from './signature';
import { getModule } from './moduleData';
import { createDefinitionHost, getDefinition } from './definitions';
import { getCustomCompletions, getCustomHover, getCustomSignature } from './customIntelliSense';
import { findSymbolReferences, prepareSymbolRename, renameSymbol, workspaceDocuments } from './workspaceSymbols';
import {
    getMissingModuleDiagnostics,
    createAddModuleToDefineAction,
    MISSING_MODULE_CODE,
    type MissingModuleInfo,
} from './moduleImports';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const definitionHost = createDefinitionHost(() => documents.all());
let workspaceRoots: string[] = [];
let supportsWorkspaceFolders = false;

const analysisCache = new Map<string, AnalysisResult>();
const validationDelays: Record<string, NodeJS.Timeout> = {};

connection.onInitialize((params): InitializeResult => {
    workspaceRoots = params.workspaceFolders?.map(folder => folder.uri) ?? (params.rootUri ? [params.rootUri] : []);
    supportsWorkspaceFolders = params.capabilities.workspace?.workspaceFolders === true;
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                triggerCharacters: ['.', '/', "'", '"', '{', ','],
                resolveProvider: false,
            },
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: { prepareProvider: true },
            workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
            signatureHelpProvider: {
                triggerCharacters: ['(', ','],
            },
            codeActionProvider: {
                codeActionKinds: ['quickfix'],
            },
        },
    };
});

connection.onInitialized(() => {
    if (supportsWorkspaceFolders) {
        connection.workspace.onDidChangeWorkspaceFolders(event => {
            const removed = new Set(event.removed.map(folder => folder.uri));
            workspaceRoots = [...new Set([...workspaceRoots.filter(uri => !removed.has(uri)), ...event.added.map(folder => folder.uri)])];
        });
    }
});

function validateTextDocument(document: TextDocument): void {
    try {
        const text = document.getText();
        const analysis = analyzeDocument(text);
        analysisCache.set(document.uri, analysis);

        const diagnostics: Diagnostic[] = [];

        if (analysis.scriptType) {
            const seen = new Set<string>();
            for (const [, modId] of analysis.moduleMap) {
                if (seen.has(modId)) { continue; }
                seen.add(modId);

                const mod = getModule(modId);
                // moduleData.ts expands 'server' into specific script types
                // so we just check if the actual script type is supported.
                if (mod?.supportedIn && !mod.supportedIn.includes(analysis.scriptType)) {
                    const pattern = new RegExp(`['"]${modId.replace(/\//g, '\\/')}['"]`);
                    const match = pattern.exec(text);
                    const importIndex = match ? match.index + 1 : text.indexOf(modId);
                    if (importIndex >= 0) {
                        diagnostics.push({
                            severity: DiagnosticSeverity.Warning,
                            range: {
                                start: document.positionAt(importIndex),
                                end: document.positionAt(importIndex + modId.length),
                            },
                            message: `"${modId}" is not supported in ${analysis.scriptType}. Supported in: ${mod.supportedIn.join(', ')}.`,
                            source: 'SuiteForge',
                        });
                    }
                }
            }
        }

        // Missing-module quick-fix diagnostics (e.g. `search.create(...)` used
        // without 'N/search' in define()).
        diagnostics.push(...getMissingModuleDiagnostics(document, analysis));

        connection.sendDiagnostics({
            uri: document.uri,
            diagnostics,
        });
    } catch (e) {
        console.error('Validation error:', e);
        connection.sendDiagnostics({
            uri: document.uri,
            diagnostics: [],
        });
    }
}

documents.onDidChangeContent(change => {
    // Debounce validation to prevent thrashing while user types
    const uri = change.document.uri;
    // Never serve completions/hover data from the previous document version.
    // Validation remains debounced, but interactive requests can recompute the
    // current text immediately when the cache is empty.
    analysisCache.delete(uri);
    if (validationDelays[uri]) {
        clearTimeout(validationDelays[uri]);
    }
    validationDelays[uri] = setTimeout(() => {
        validateTextDocument(change.document);
        delete validationDelays[uri];
    }, 300);
});

documents.onDidClose(e => {
    analysisCache.delete(e.document.uri);
    if (validationDelays[e.document.uri]) {
        clearTimeout(validationDelays[e.document.uri]);
        delete validationDelays[e.document.uri];
    }
});

connection.onCompletion(async (params: CompletionParams): Promise<CompletionList> => {
    try {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) { return { isIncomplete: false, items: [] }; }

        let analysis = analysisCache.get(doc.uri);
        if (!analysis) {
            analysis = analyzeDocument(doc.getText());
            analysisCache.set(doc.uri, analysis);
        }

        const offset = doc.offsetAt(params.position);
        const text = doc.getText();
        const textBeforeCursor = text.substring(0, offset);

        // A trailing dot is temporarily invalid JavaScript. Patch only the
        // analysis copy so Babel can still provide lexical scope information.
        if (analysis.scopedBindings === undefined && text[offset - 1] === '.') {
            analysis = analyzeDocument(`${text.substring(0, offset)}__suiteforge_member__${text.substring(offset)}`);
        }
        analysis = narrowAnalysisToOffset(analysis, offset);

        const items = getCompletions(textBeforeCursor, analysis) || [];
        const custom = await getCustomCompletions(doc, params.position, definitionHost);
        const names = new Set(custom.map(item => item.label));
        return { isIncomplete: false, items: [...custom, ...items.filter(item => !names.has(item.label))] };
    } catch (e) {
        console.error('Completion error:', e);
        return { isIncomplete: false, items: [] };
    }
});

connection.onHover(async (params: HoverParams) => {
    try {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) { return null; }

        let analysis = analysisCache.get(doc.uri);
        if (!analysis) {
            analysis = analyzeDocument(doc.getText());
            analysisCache.set(doc.uri, analysis);
        }

        const offset = doc.offsetAt(params.position);
        const text = doc.getText();

        let wordStart = offset;
        let wordEnd = offset;
        while (wordStart > 0 && /\w/.test(text[wordStart - 1])) { wordStart--; }
        while (wordEnd < text.length && /\w/.test(text[wordEnd])) { wordEnd++; }
        const word = text.substring(wordStart, wordEnd);
        if (!word) { return null; }

        const textBeforeWord = text.substring(0, wordStart);

        return await getCustomHover(doc, params.position, definitionHost)
            ?? getHoverInfo(word, textBeforeWord, narrowAnalysisToOffset(analysis, wordStart));
    } catch (e) {
        console.error('Hover error:', e);
        return null;
    }
});

connection.onDefinition(async params => {
    try {
        const document = documents.get(params.textDocument.uri);
        if (!document) { return []; }
        return await getDefinition(document, params.position, definitionHost);
    } catch (error) {
        console.error('Definition error:', error);
        return [];
    }
});

connection.onReferences(async (params, token) => {
    try {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) { return []; }
        if (!workspaceRoots.length) { throw new Error('Open a workspace folder to find references across files.'); }
        const snapshot = await workspaceDocuments(workspaceRoots, documents.all(), definitionHost, token);
        return await findSymbolReferences(doc, params.position, snapshot, definitionHost, params.context.includeDeclaration, token);
    } catch (error) {
        throw new ResponseError(ErrorCodes.InvalidRequest, error instanceof Error ? error.message : String(error));
    }
});

connection.onPrepareRename(async params => {
    const doc = documents.get(params.textDocument.uri);
    return doc ? prepareSymbolRename(doc, params.position, definitionHost) : null;
});

connection.onRenameRequest(async (params, token) => {
    try {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) { throw new Error('Open the source file before renaming.'); }
        if (!workspaceRoots.length) { throw new Error('Open a workspace folder to rename across files.'); }
        const snapshot = await workspaceDocuments(workspaceRoots, documents.all(), definitionHost, token);
        return await renameSymbol(doc, params.position, params.newName, snapshot, definitionHost, token);
    } catch (error) {
        throw new ResponseError(ErrorCodes.InvalidRequest, error instanceof Error ? error.message : String(error));
    }
});

connection.onSignatureHelp(async (params: SignatureHelpParams): Promise<SignatureHelp | null> => {
    try {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) { return null; }

        let analysis = analysisCache.get(doc.uri);
        if (!analysis) {
            analysis = analyzeDocument(doc.getText());
            analysisCache.set(doc.uri, analysis);
        }

        const offset = doc.offsetAt(params.position);
        const textBeforeCursor = doc.getText().substring(0, offset);

        return await getCustomSignature(doc, params.position, definitionHost)
            ?? getSignatureHelp(textBeforeCursor, narrowAnalysisToOffset(analysis, offset));
    } catch (e) {
        console.error('Signature help error:', e);
        return null;
    }
});

connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
    try {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) { return []; }

        const actions: CodeAction[] = [];
        for (const diag of params.context.diagnostics) {
            if (diag.code === MISSING_MODULE_CODE) {
                const info = diag.data as MissingModuleInfo | undefined;
                if (info?.module) {
                    const action = createAddModuleToDefineAction(doc, info, diag);
                    if (action) { actions.push(action); }
                }
            }
        }
        return actions;
    } catch (e) {
        console.error('Code action error:', e);
        return [];
    }
});

documents.listen(connection);
connection.listen();
