import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeResult,
    TextDocumentSyncKind,
    CompletionParams,
    HoverParams,
    Diagnostic,
    DiagnosticSeverity,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { analyzeDocument, AnalysisResult } from './analyzer';
import { getCompletions, getHoverInfo, normalizeScriptType } from './completions';
import { getModule } from './moduleData';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const analysisCache = new Map<string, AnalysisResult>();

connection.onInitialize((): InitializeResult => {
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                triggerCharacters: ['.', '/', "'", '"', '{', ','],
                resolveProvider: false,
            },
            hoverProvider: true,
        },
    };
});

documents.onDidChangeContent(change => {
    try {
        const text = change.document.getText();
        const analysis = analyzeDocument(text);
        analysisCache.set(change.document.uri, analysis);

        const diagnostics: Diagnostic[] = [];

        if (analysis.scriptType) {
            const seen = new Set<string>();
            for (const [, modId] of analysis.moduleMap) {
                if (seen.has(modId)) { continue; }
                seen.add(modId);

                const mod = getModule(modId);
                const normalizedSt = normalizeScriptType(analysis.scriptType);
                if (mod?.supportedIn && normalizedSt && !mod.supportedIn.includes(normalizedSt)) {
                    const pattern = new RegExp(`['"]${modId.replace(/\//g, '\\/')}['"]`);
                    const match = pattern.exec(text);
                    const importIndex = match ? match.index + 1 : text.indexOf(modId);
                    if (importIndex >= 0) {
                        diagnostics.push({
                            severity: DiagnosticSeverity.Warning,
                            range: {
                                start: change.document.positionAt(importIndex),
                                end: change.document.positionAt(importIndex + modId.length),
                            },
                            message: `"${modId}" is not supported in ${analysis.scriptType}. Supported in: ${mod.supportedIn.join(', ')}.`,
                            source: 'SuiteForge',
                        });
                    }
                }
            }
        }

        connection.sendDiagnostics({
            uri: change.document.uri,
            diagnostics,
        });
    } catch (_e) {
        connection.sendDiagnostics({
            uri: change.document.uri,
            diagnostics: [],
        });
    }
});

documents.onDidClose(e => {
    analysisCache.delete(e.document.uri);
});

connection.onCompletion((params: CompletionParams) => {
    try {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) { return []; }

        let analysis = analysisCache.get(doc.uri);
        if (!analysis) {
            analysis = analyzeDocument(doc.getText());
            analysisCache.set(doc.uri, analysis);
        }

        const offset = doc.offsetAt(params.position);
        const textBeforeCursor = doc.getText().substring(0, offset);

        return getCompletions(textBeforeCursor, analysis);
    } catch (_e) {
        return [];
    }
});

connection.onHover((params: HoverParams) => {
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

        return getHoverInfo(word, textBeforeWord, analysis);
    } catch (_e) {
        return null;
    }
});

documents.listen(connection);
connection.listen();
