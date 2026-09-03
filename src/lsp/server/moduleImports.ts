import {
    Diagnostic,
    DiagnosticSeverity,
    CodeAction,
    CodeActionKind,
    Range,
    WorkspaceEdit,
    TextEdit,
    TextDocument,
} from 'vscode-languageserver';
import type { AnalysisResult } from './analyzer';
import { getAllModules, getModuleMethods } from './moduleData';
import { parse } from '@babel/parser';
import babelTraverseImport from '@babel/traverse';
import * as t from '@babel/types';

const babelTraverse = (babelTraverseImport as typeof babelTraverseImport & { default?: typeof babelTraverseImport }).default
    ?? babelTraverseImport;

/**
 * Diagnostics + quick fixes for missing module imports.
 *
 * Detects identifiers that are used like a SuiteScript module (they call a
 * known module method, e.g. `search.create(...)`), but are not bound in the
 * AMD define() dependency list — and offers a quick fix that adds the module
 * path to define() and binds it to a callback parameter.
 */

/** Guesses: variable name → module path, derived from the module registry. */
const moduleNameGuesses = new Map<string, string>();
for (const mod of getAllModules()) {
    const shortName = mod.module.split('/').pop() ?? mod.module;
    // First registration wins so real modules (N/search) take precedence over
    // the synthetic N/scriptTypes/restlet entry.
    if (!moduleNameGuesses.has(shortName)) {
        moduleNameGuesses.set(shortName, mod.module);
    }
}

export const MISSING_MODULE_CODE = 'suiteforge-missing-module';

export interface MissingModuleInfo {
    module: string;
    varName: string;
}

export function getMissingModuleDiagnostics(
    document: TextDocument,
    analysis: AnalysisResult,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Only offer this in files that use the AMD define() pattern.
    if (!/\bdefine\s*\(/.test(document.getText())) { return diagnostics; }

    const text = document.getText();
    const seen = new Set<string>();

    const addDiagnostic = (varName: string, methodName: string, offset: number): void => {
        if (analysis.moduleMap.has(varName) || analysis.typeMap.has(varName) || seen.has(varName)) { return; }
        const guessedModule = moduleNameGuesses.get(varName);
        if (!guessedModule) { return; }
        const methods = getModuleMethods(guessedModule);
        if (!methods.some(m => m.name === methodName || m.name.startsWith(methodName + '.'))) { return; }

        seen.add(varName);
        diagnostics.push({
            severity: DiagnosticSeverity.Information,
            range: {
                start: document.positionAt(offset),
                end: document.positionAt(offset + varName.length),
            },
            message: `'${varName}' is used like the ${guessedModule} module but is not imported in define().`,
            source: 'SuiteForge',
            code: MISSING_MODULE_CODE,
            data: { module: guessedModule, varName } satisfies MissingModuleInfo,
        });
    };

    // Use lexical bindings from the AST so comments, strings, and legitimate
    // local objects named `search`, `record`, etc. do not produce diagnostics.
    try {
        const ast = parse(text, {
            sourceType: 'unambiguous',
            plugins: ['typescript'],
            errorRecovery: true,
        });
        babelTraverse(ast, {
            CallExpression(path) {
                const callee = path.node.callee;
                if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.object) || !t.isIdentifier(callee.property)) {
                    return;
                }
                const varName = callee.object.name;
                if (path.scope.hasBinding(varName)) { return; }
                addDiagnostic(varName, callee.property.name, callee.object.start ?? 0);
            },
        });
    } catch {
        // In a severely incomplete document, use a masked fallback that keeps
        // offsets stable while excluding comments and literal contents.
        const masked = maskNonCode(text);
        const callRegex = /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
        let match: RegExpExecArray | null;
        while ((match = callRegex.exec(masked)) !== null) {
            addDiagnostic(match[1], match[2], match.index);
        }
    }

    return diagnostics;
}

/**
 * Computes the text edits needed to add `modulePath` to the define() call,
 * binding it to a parameter named after the module. Returns null when the
 * define() shape is not recognized.
 *
 * Positions are anchored on structural characters ([, ], () rather than on
 * captured group text, because groups can be empty (indexOf('') is 0).
 *
 * Shape 1 — define([deps], (params) => { / define([deps], function (params) {
 *   groups: 1 = array contents, 2 = optional "function" keyword,
 *           3 = open paren (or '' when the single param has no parens),
 *           4 = params, 5 = close paren + arrow/brace
 * Shape 2 — define(callback) with no dependency array:
 *   groups: 1 = optional "function" keyword, 2 = open paren, 3 = params,
 *           4 = close paren + arrow/brace
 */
export function computeAddModuleEdits(text: string, modulePath: string): TextEdit[] | null {
    const varName = modulePath.split('/').pop() ?? modulePath;

    const shape1 = /\bdefine\s*\(\s*\[([^\]]*)\]\s*,?\s*(?:\/\*[\s\S]*?\*\/\s*)?(?:\/\/[^\n]*\n\s*)?(function\s*)?(\(?)([^)]*)(\)?\s*(?:=>|\{))/.exec(text);
    if (shape1) {
        const matchText = shape1[0];
        const bracketIdx = matchText.search(/\[/);
        const closeBracketIdx = matchText.indexOf(']', bracketIdx);
        if (bracketIdx < 0 || closeBracketIdx < 0) { return null; }
        const parenIdx = matchText.indexOf('(', closeBracketIdx);

        const arrayContent = shape1[1] ?? '';
        const hasDeps = arrayContent.trim().length > 0;
        const quote = hasDeps && arrayContent.includes('"') ? '"' : "'";

        const edits: TextEdit[] = [];
        if (hasDeps) {
            // Append to the existing dependency list, right before the ']', and
            // fix up the comma placement around the existing content.
            const trimmedEnd = arrayContent.replace(/\s+$/, '');
            const trailingWs = arrayContent.length - trimmedEnd.length;
            const lastLineStart = Math.max(trimmedEnd.lastIndexOf('\n'), trimmedEnd.lastIndexOf('\r')) + 1;
            const lineCommentIndex = arrayContent.indexOf('//', lastLineStart);
            let insertOffset = lineCommentIndex >= 0 ? lineCommentIndex : arrayContent.length - trailingWs;
            if (lineCommentIndex >= 0) {
                while (insertOffset > lastLineStart && /[ \t]/.test(arrayContent[insertOffset - 1])) { insertOffset--; }
            }
            const commentAlreadySeparated = lineCommentIndex >= 0 && insertOffset < lineCommentIndex;
            const contentBeforeInsert = arrayContent.slice(0, insertOffset).replace(/\s+$/, '');
            const insertAt = shape1.index + bracketIdx + 1 + insertOffset;
            const needsComma = !/,$/.test(contentBeforeInsert);
            edits.push(TextEdit.insert(
                offsetToPosition(text, insertAt),
                `${needsComma ? ',' : ''} ${quote}${modulePath}${quote}${lineCommentIndex >= 0 && !commentAlreadySeparated ? ' ' : ''}`,
            ));
        } else {
            // Empty dependency array — insert right after the '['.
            const insertAt = shape1.index + bracketIdx + 1;
            edits.push(TextEdit.insert(offsetToPosition(text, insertAt), `${quote}${modulePath}${quote}`));
        }

        if (parenIdx < 0) { return null; } // single-ident param without parens — bail
        const paramsContent = shape1[4] ?? '';
        // A rest parameter must remain last. Appending a named binding would
        // generate invalid JavaScript, while inserting it before the rest
        // parameter would change the positional meaning of existing deps.
        if (/(?:^|,)\s*\.\.\./.test(paramsContent)) { return null; }
        const paramsStart = shape1.index + parenIdx + 1;
        if (paramsContent.trim().length > 0) {
            // The dependency is appended, so its callback parameter must also
            // be appended to preserve RequireJS positional binding.
            const paramsEnd = paramsStart + paramsContent.length;
            const trimmedEnd = paramsContent.replace(/\s+$/, '');
            const insertAt = paramsEnd - (paramsContent.length - trimmedEnd.length);
            const needsComma = !/,\s*$/.test(trimmedEnd);
            edits.push(TextEdit.insert(offsetToPosition(text, insertAt), `${needsComma ? ',' : ''} ${varName}`));
        } else {
            edits.push(TextEdit.insert(offsetToPosition(text, paramsStart), varName));
        }
        return edits;
    }

    const shape2 = /\bdefine\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?(function\s*)?(\(?)([^)]*)(\)?\s*(?:=>|\{))/.exec(text);
    if (shape2) {
        const matchText = shape2[0];
        const defineParenIdx = matchText.indexOf('(');
        if (defineParenIdx < 0) { return null; }

        const paramsContent = shape2[3] ?? '';
        const hasParams = paramsContent.trim().length > 0;

        // If the callback already has its own parens (group 2 === '('), insert
        // inside them and just prepend the param. Otherwise add parens.
        if (shape2[2] === '(') {
            // Group 2's '(' is the first '(' after the define '('.
            const cbParenIdx = matchText.indexOf('(', defineParenIdx + 1);
            if (cbParenIdx < 0) { return null; }
            const insertAt = shape2.index + cbParenIdx + 1;
            return [
                TextEdit.insert(offsetToPosition(text, insertAt), `${varName}, `),
                TextEdit.insert(
                    offsetToPosition(text, shape2.index + defineParenIdx + 1),
                    `['${modulePath}'], `,
                ),
            ];
        }

        // No callback parens: define(cb => ...). Add the dependency array and
        // opening callback paren after define(, then close it before the arrow.
        const insert = `['${modulePath}'], (${varName}${hasParams ? ', ' : ''}`;
        const insertAt = shape2.index + defineParenIdx + 1;
        const arrowIndex = matchText.lastIndexOf('=>');
        if (arrowIndex < 0) { return null; }
        let closeIndex = arrowIndex;
        while (closeIndex > 0 && /\s/.test(matchText[closeIndex - 1])) { closeIndex--; }
        const closeAt = shape2.index + closeIndex;
        return [
            TextEdit.insert(offsetToPosition(text, insertAt), insert),
            TextEdit.insert(offsetToPosition(text, closeAt), ')'),
        ];
    }

    return null;
}

export function createAddModuleToDefineAction(
    document: TextDocument,
    info: MissingModuleInfo,
    diagnostic: Diagnostic,
): CodeAction | null {
    const edits = computeAddModuleEdits(document.getText(), info.module);
    if (!edits) { return null; }

    return {
        title: `Add '${info.module}' to define()`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: { changes: { [document.uri]: edits } },
    };
}

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
    let line = 0;
    let lastLineStart = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') {
            line++;
            lastLineStart = i + 1;
        }
    }
    return { line, character: offset - lastLineStart };
}

function maskNonCode(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, value => ' '.repeat(value.length))
        .replace(/\/\/[^\n]*/g, value => ' '.repeat(value.length))
        .replace(/'(?:[^'\\\n]|\\.)*'/g, value => ' '.repeat(value.length))
        .replace(/"(?:[^"\\\n]|\\.)*"/g, value => ' '.repeat(value.length))
        .replace(/`(?:[^`\\]|\\.)*`/g, value => ' '.repeat(value.length));
}

// Re-export Range type used by consumers that build diagnostics themselves.
export type { Range };
