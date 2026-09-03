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
    const lines = stripAnsi(output).split(/\r?\n/);

    let currentFile: string | null = null;
    let currentLine = 0;
    let currentColumn = 0;
    let currentSeverity: ParsedValidationIssue['severity'] = 'error';

    const addIssue = (
        file: string,
        message: string,
        sourceLine: string,
        line = 0,
        column = 0,
        severity: ParsedValidationIssue['severity'] = /warning/i.test(message) ? 'warning' : 'error',
    ): void => {
        const resolved = resolveFile(file, projectRoot);
        if (!resolved) { return; }
        issues.push({
            file: resolved,
            line: Math.max(0, line),
            column: Math.max(0, column),
            message: message.trim(),
            severity,
            sourceLine,
        });
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();

        // Legacy and 4.x contextual header:
        // "Errors for file C:\project\src\Objects\bad.xml."
        const fileHeader = /^(Errors?|Warnings?)\s+for\s+file\s+(.+?\.(?:xml|js|ts|json|html|tpl))\.?$/i.exec(line);
        if (fileHeader) {
            currentFile = fileHeader[2].trim();
            currentLine = 0;
            currentColumn = 0;
            currentSeverity = /^Warning/i.test(fileHeader[1]) ? 'warning' : 'error';
            continue;
        }

        // Block form: "File: src/Objects/foo.xml"
        const fileMatch = /^File:\s*(.+)$/i.exec(line);
        if (fileMatch) {
            currentFile = fileMatch[1].trim();
            currentLine = 0;
            currentColumn = 0;
            currentSeverity = /warning/i.test(line) ? 'warning' : 'error';
            continue;
        }

        // Contextual location emitted separately from the message.
        const locationMatch = /^Line(?:\s+No\.)?\s*:\s*(\d+)(?:\s*[,;]\s*Column\s*:\s*(\d+))?$/i.exec(line);
        if (locationMatch && currentFile) {
            currentLine = Math.max(0, Number.parseInt(locationMatch[1], 10) - 1);
            currentColumn = Math.max(0, Number.parseInt(locationMatch[2] ?? '1', 10) - 1);
            continue;
        }

        // Legacy indented detail:
        // "- Line No. 90 - Error Message: Invalid field"
        const legacyDetail = /^-?\s*Line\s+No\.\s*(\d+)(?:\s*[,;]\s*Column\s*(?:No\.)?\s*(\d+))?\s*-\s*(Error|Warning)\s+Message:\s*(.*)$/i.exec(line);
        if (legacyDetail && currentFile) {
            addIssue(
                currentFile,
                legacyDetail[4],
                line,
                Number.parseInt(legacyDetail[1], 10) - 1,
                Number.parseInt(legacyDetail[2] ?? '1', 10) - 1,
                /^Warning/i.test(legacyDetail[3]) ? 'warning' : 'error',
            );
            continue;
        }

        // Details line for the block form
        const detailsMatch = /^Details:\s*(.*)$/i.exec(line);
        if (detailsMatch && currentFile) {
            const severity = /warning/i.test(detailsMatch[1]) ? 'warning' : currentSeverity;
            addIssue(currentFile, detailsMatch[1], line, currentLine, currentColumn, severity);
            currentFile = null;
            continue;
        }

        const messageMatch = /^(?:(Error|Warning)\s+)?Message:\s*(.*)$/i.exec(line);
        if (messageMatch && currentFile) {
            const severity = messageMatch[1]
                ? (/^Warning/i.test(messageMatch[1]) ? 'warning' : 'error')
                : currentSeverity;
            addIssue(currentFile, messageMatch[2], line, currentLine, currentColumn, severity);
            currentFile = null;
            continue;
        }

        // 4.x summary/table row:
        // "│ ERROR │ src/Objects/bad.xml │ 12:4 │ Invalid field │"
        const tableRow = /^[│|]\s*(ERROR|WARNING)\s*[│|]\s*(.+?\.(?:xml|js|ts|json|html|tpl))\s*[│|]\s*(?:(\d+)(?::(\d+))?)?\s*[│|]\s*(.*?)\s*[│|]?$/i.exec(line);
        if (tableRow) {
            addIssue(
                tableRow[2],
                tableRow[5],
                line,
                Number.parseInt(tableRow[3] ?? '1', 10) - 1,
                Number.parseInt(tableRow[4] ?? '1', 10) - 1,
                /^WARNING$/i.test(tableRow[1]) ? 'warning' : 'error',
            );
            continue;
        }

        // 4.x prefixed summary:
        // "[ERROR] src/Objects/bad.xml (line 12, column 4): Invalid field"
        const prefixed = /^\[?(ERROR|WARNING)\]?\s+(?:in\s+)?(.+?\.(?:xml|js|ts|json|html|tpl))(?:\s+\(\s*line\s+(\d+)(?:\s*,\s*column\s+(\d+))?\s*\))?\s*[:—-]\s*(.*)$/i.exec(line);
        if (prefixed) {
            addIssue(
                prefixed[2],
                prefixed[5],
                line,
                Number.parseInt(prefixed[3] ?? '1', 10) - 1,
                Number.parseInt(prefixed[4] ?? '1', 10) - 1,
                /^WARNING$/i.test(prefixed[1]) ? 'warning' : 'error',
            );
            continue;
        }

        // Inline form: path(:line(:col))? [: ] message
        // e.g. "src/SuiteScripts/foo.js:34:1 Unexpected token }"
        const inline = /^(.+?\.(?:xml|js|ts|json|html|tpl)):(\d+)(?::(\d+))?\s*:?\s*(.*)$/.exec(line);
        if (inline) {
            addIssue(
                inline[1],
                inline[4],
                line,
                (Number.parseInt(inline[2], 10) || 1) - 1,
                (Number.parseInt(inline[3] || '1', 10) || 1) - 1,
            );
            continue;
        }

        const inlineNoLine = /^(.+?\.(?:xml|js|ts|json|html|tpl))\s+(:?\[?(?:ERROR|WARNING)\]?\s*.*)$/i.exec(line);
        if (inlineNoLine) {
            addIssue(inlineNoLine[1], inlineNoLine[2].replace(/^:\s*/, ''), line);
        }
    }

    const unique = new Map<string, ParsedValidationIssue>();
    for (const issue of issues) {
        const key = [issue.file.toString(), issue.line, issue.column, issue.severity, issue.message].join('\0');
        if (!unique.has(key)) { unique.set(key, issue); }
    }
    return [...unique.values()];
}

function stripAnsi(value: string): string {
    // ANSI CSI sequences used by both the legacy and 4.x CLI renderers.
    return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
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
