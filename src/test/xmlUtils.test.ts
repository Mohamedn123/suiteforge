import * as assert from 'assert';
import * as vscode from 'vscode';
import { getEnclosingTagName, isLikelySdfDocument } from '../providers/xmlUtils';

suite('XML Utility Test Suite', () => {
    test('Ignores tags inside CDATA', async () => {
        const text = '<customrecordtype><![CDATA[<fieldtype>TEXT</fieldtype>]]>\n';
        const document = await vscode.workspace.openTextDocument({ content: text, language: 'xml' });
        assert.strictEqual(getEnclosingTagName(document, document.positionAt(text.length)), 'customrecordtype');
    });

    test('Handles greater-than characters inside quoted attributes', async () => {
        const text = '<customrecordtype description="a > b"><fieldtype>';
        const document = await vscode.workspace.openTextDocument({ content: text, language: 'xml' });
        assert.strictEqual(getEnclosingTagName(document, document.positionAt(text.length)), 'fieldtype');
    });

    test('Does not identify unrelated XML as SDF', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: '<catalog><fieldtype>TEXT</fieldtype></catalog>',
            language: 'xml',
        });
        assert.strictEqual(isLikelySdfDocument(document), false);
    });

    test('Ignores a fake SDF root tag inside a comment', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: '<!-- <customrecordtype> --><catalog />',
            language: 'xml',
        });
        assert.strictEqual(isLikelySdfDocument(document), false);
    });

    test('Finds an SDF root after a long leading comment', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: `<!-- ${'x'.repeat(5000)} --><customrecordtype />`,
            language: 'xml',
        });
        assert.strictEqual(isLikelySdfDocument(document), true);
    });
});
