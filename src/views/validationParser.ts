import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Parses SuiteCloud CLI `project:validate` output and publishes findings to
 * the Problems panel.
 *
 * The CLI reports validation errors in two shapes:
 *
 *   1. A per-file block:
 *        The following object customization definition files contain validation errors:
 *        File: src/Objects/customrecord_bad.xml
 *        Details: <message>
 *
 *   2. Inline file references (single-line):
 *        src/FileCabinet/SuiteScripts/foo.js:34: Unexpected token }
 *        src/Objects/customrecord_bad.xml [WARNING] some message
 *
 * The parser handles both, resolving relative paths against the project root
 * and defaulting to line 0 when no line number is given.
 */

export interface ParsedValidationIssue {
    file: vscode.Uri;
    line: number;          // 0-based
    column: number;        // 0-based
    message: string;
    severity: 'error' | 'warning';
    sourceLine: string;     // original CLI line (for debugging)
}

const DIAGNOSTIC_COLLECTION_KEY = 'suiteforge-sdf-validate';
let diagnosticCollection: vscode.DiagnosticCollection | undefined;

function getCollection(): vscode.DiagnosticCollection {
    if (!diagnosticCollection) {
        diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_COLLECTION_KEY);
    }
    return diagnosticCollection;
}

export function parseValidateOutput(
    output: string,
    projectRoot: vscode.Uri,
): ParsedValidationIssue[] {
    const issues: ParsedValidationIssue[] = [];
    const lines = output.split(/\r?\n/);

    let currentFile: string | null = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        // Block form: "File: src/Objects/foo.xml"
        const fileMatch = /^File:\s*(.+)$/i.exec(line);
        if (fileMatch) {
            currentFile = fileMatch[1].trim();
            continue;
        }

        // Details line for the block form
        const detailsMatch = /^Details:\s*(.*)$/i.exec(line);
        if (detailsMatch && currentFile) {
            const resolved = resolveFile(currentFile, projectRoot);
            if (resolved) {
                issues.push({
                    file: resolved,
                    line: 0,
                    column: 0,
                    message: detailsMatch[1].trim(),
                    severity: /warning/i.test(detailsMatch[1]) ? 'warning' : 'error',
                    sourceLine: line,
                });
            }
            currentFile = null;
            continue;
        }

        // Inline form: path(:line(:col))? [: ] message
        // e.g. "src/SuiteScripts/foo.js:34:1 Unexpected token }"
        const inline = /^(.+?\.(?:xml|js|ts|json|html|tpl)):(\d+)(?::(\d+))?\s*:?\s*(.*)$/.exec(line);
        if (inline) {
            const resolved = resolveFile(inline[1], projectRoot);
            if (resolved) {
                issues.push({
                    file: resolved,
                    line: Math.max(0, (parseInt(inline[2], 10) || 1) - 1),
                    column: Math.max(0, (parseInt(inline[3] || '1', 10) || 1) - 1),
                    message: inline[4].trim(),
                    severity: /warning/i.test(inline[4]) ? 'warning' : 'error',
                    sourceLine: line,
                });
            }
            continue;
        }

        const inlineNoLine = /^(.+?\.(?:xml|js|ts|json|html|tpl))\s+(:?\[?(?:ERROR|WARNING)\]?\s*.*)$/i.exec(line);
        if (inlineNoLine) {
            const resolved = resolveFile(inlineNoLine[1], projectRoot);
            if (resolved) {
                issues.push({
                    file: resolved,
                    line: 0,
                    column: 0,
                    message: inlineNoLine[2].replace(/^:\s*/, '').trim(),
                    severity: /warning/i.test(inlineNoLine[2]) ? 'warning' : 'error',
                    sourceLine: line,
                });
            }
        }
    }

    return issues;
}

function resolveFile(relPath: string, root: vscode.Uri): vscode.Uri | null {
    // Normalize separators and drop a leading "./".
    const rawPath = relPath.trim();
    if (path.isAbsolute(rawPath)) {
        const absoluteUri = vscode.Uri.file(path.normalize(rawPath));
        return isWithinProject(absoluteUri, root) ? absoluteUri : null;
    }

    const norm = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (norm.length === 0) { return null; }

    // CLI reports paths relative to the project root, sometimes with or
    // without a leading "src/". Try a small set of candidate locations and
    // prefer one that exists on disk.
    const candidates = [
        norm,
        norm.replace(/^src\//, ''),
        norm.startsWith('src/') ? norm : `src/${norm}`,
    ];
    const seen = new Set<string>();
    const uniqueCandidates: vscode.Uri[] = [];
    for (const cand of candidates) {
        if (seen.has(cand)) { continue; }
        seen.add(cand);
        const uri = vscode.Uri.joinPath(root, ...cand.split('/'));
        if (!isWithinProject(uri, root)) { continue; }
        uniqueCandidates.push(uri);
        if (uri.scheme === 'file' && fs.existsSync(uri.fsPath)) {
            return uri;
        }
    }
    // Validation is produced by the local CLI, but keep a deterministic
    // fallback for files that have just been created/deleted during a run.
    return uniqueCandidates[0] ?? null;
}

function isWithinProject(candidate: vscode.Uri, root: vscode.Uri): boolean {
    if (candidate.scheme !== 'file' || root.scheme !== 'file') { return false; }
    const relative = path.relative(root.fsPath, candidate.fsPath);
    return relative === ''
        || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Publishes parsed issues to the Problems panel, replacing previous results. */
export function publishValidationDiagnostics(issues: ParsedValidationIssue[]): void {
    const collection = getCollection();

    // Group by file.
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const issue of issues) {
        const key = issue.file.toString();
        const list = byFile.get(key) ?? [];
        const range = new vscode.Range(
            issue.line, issue.column,
            issue.line, issue.column + Math.max(1, issue.message.length),
        );
        const diag = new vscode.Diagnostic(
            range,
            issue.message,
            issue.severity === 'warning'
                ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Error,
        );
        diag.source = 'SuiteForge';
        list.push(diag);
        byFile.set(key, list);
    }

    // Replace everything: files that no longer have issues are cleared
    // because we own this collection exclusively.
    collection.clear();
    for (const [uri, diags] of byFile) {
        collection.set(vscode.Uri.parse(uri), diags);
    }
}

/** Clears all published validation diagnostics. */
export function clearValidationDiagnostics(): void {
    getCollection().clear();
}

export function disposeValidationDiagnostics(): void {
    diagnosticCollection?.dispose();
    diagnosticCollection = undefined;
}
