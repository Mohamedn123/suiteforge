import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseValidateOutput } from '../views/validationParser';

suite('Validate Output Parser Test Suite', () => {
    const root = vscode.Uri.file(process.platform === 'win32' ? 'C:\\proj' : '/proj');
    const sep = process.platform === 'win32' ? '\\' : '/';

    test('Parses File:/Details: block form', () => {
        const output = [
            'The following object customization definition files contain validation errors:',
            'File: src/Objects/customrecord_bad.xml',
            'Details: Invalid element name: recordtyp2 (expected recordtype)',
            '',
        ].join('\n');
        const issues = parseValidateOutput(output, root);
        assert.strictEqual(issues.length, 1);
        assert.ok(issues[0].file.fsPath.endsWith(`${sep}Objects${sep}customrecord_bad.xml`), `path was ${issues[0].file.fsPath}`);
        assert.ok(issues[0].message.includes('Invalid element name'));
        assert.strictEqual(issues[0].severity, 'error');
    });

    test('Parses inline form with line and column', () => {
        const output = 'src/FileCabinet/SuiteScripts/foo.js:34:5 Unexpected token }';
        const issues = parseValidateOutput(output, root);
        assert.strictEqual(issues.length, 1);
        assert.strictEqual(issues[0].line, 33, '0-based line');
        assert.strictEqual(issues[0].column, 4, '0-based column');
        assert.strictEqual(issues[0].message, 'Unexpected token }');
    });

    test('Parses inline form without line number', () => {
        const output = 'src/Objects/custentity_bad.xml [WARNING] ismandatory is deprecated';
        const issues = parseValidateOutput(output, root);
        assert.strictEqual(issues.length, 1);
        assert.strictEqual(issues[0].severity, 'warning');
        assert.strictEqual(issues[0].line, 0);
    });

    test('Ignores output without file references', () => {
        const output = [
            'Unit testing validation finished.',
            'Validation passed. No issues detected.',
        ].join('\n');
        const issues = parseValidateOutput(output, root);
        assert.strictEqual(issues.length, 0);
    });

    test('Handles multiple mixed-format issues', () => {
        const output = [
            'The following object customization definition files contain validation errors:',
            'File: src/Objects/a.xml',
            'Details: Problem with a.xml',
            'File: src/Objects/b.xml',
            'Details: [WARNING] something mild',
            'src/FileCabinet/SuiteScripts/c.js:10:2 SyntaxError: bad',
        ].join('\n');
        const issues = parseValidateOutput(output, root);
        assert.strictEqual(issues.length, 3);
        assert.strictEqual(issues[0].severity, 'error');
        assert.strictEqual(issues[1].severity, 'warning');
        assert.strictEqual(issues[2].line, 9);
    });

    test('Deduplicates candidate resolution to a single issue per line', () => {
        const output = 'src/Objects/only.xml:1: Missing required element';
        const issues = parseValidateOutput(output, root);
        assert.strictEqual(issues.length, 1);
    });

    test('Parses indented inline paths containing spaces', () => {
        const output = '    src/Objects/My Custom Object.xml:12:3 Invalid field';
        const issues = parseValidateOutput(output, root);
        assert.strictEqual(issues.length, 1);
        assert.ok(issues[0].file.fsPath.endsWith(`${sep}src${sep}Objects${sep}My Custom Object.xml`));
        assert.strictEqual(issues[0].line, 11);
        assert.strictEqual(issues[0].column, 2);
    });

    test('Ignores relative paths that escape the project root', () => {
        const issues = parseValidateOutput('../../outside.js:2: Escaped project', root);
        assert.strictEqual(issues.length, 0);
    });

    test('Ignores absolute paths outside the project root', () => {
        const outside = process.platform === 'win32' ? 'C:\\outside\\evil.js' : '/outside/evil.js';
        const issues = parseValidateOutput(`${outside}:2: Outside project`, root);
        assert.strictEqual(issues.length, 0);
    });

    test('Parses legacy Errors for file and Line No output', () => {
        const projectPath = vscode.Uri.joinPath(root, 'src', 'Objects', 'legacy.xml').fsPath;
        const output = [
            `Errors for file ${projectPath}.`,
            '    - Line No. 17 - Error Message: Missing required field',
        ].join('\n');
        const issues = parseValidateOutput(output, root);
        assert.strictEqual(issues.length, 1);
        assert.strictEqual(issues[0].line, 16);
        assert.strictEqual(issues[0].message, 'Missing required field');
    });

    test('Parses ANSI-colored 4.x prefixed summaries', () => {
        const output = '\u001b[31m[ERROR]\u001b[0m src/Objects/new-output.xml (line 12, column 4): Invalid field value';
        const issues = parseValidateOutput(output, root);
        assert.strictEqual(issues.length, 1);
        assert.strictEqual(issues[0].line, 11);
        assert.strictEqual(issues[0].column, 3);
        assert.strictEqual(issues[0].severity, 'error');
    });

    test('Parses 4.x table summaries and removes exact duplicates', () => {
        const row = '│ WARNING │ src/Objects/table-output.xml │ 8:2 │ Deprecated field │';
        const issues = parseValidateOutput(`${row}\n${row}`, root);
        assert.strictEqual(issues.length, 1);
        assert.strictEqual(issues[0].line, 7);
        assert.strictEqual(issues[0].column, 1);
        assert.strictEqual(issues[0].severity, 'warning');
    });
});
