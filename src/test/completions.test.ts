import * as assert from 'assert';
import { analyzeDocument } from '../lsp/server/analyzer';
import { getCompletions } from '../lsp/server/completions';

suite('Completion Regression Test Suite', () => {
    test('Does not insert dotted keys for nested options metadata', () => {
        const text = `define(['N/action'], (action) => { action.execute({`;
        const items = getCompletions(text, analyzeDocument(text));
        const insertions = items.map(item => String(item.insertText ?? item.label));
        assert.ok(insertions.includes('params: '));
        assert.ok(!insertions.includes('params.recordId: '));
    });

    test('Provides completions for currentRecord Field return types', () => {
        const text = `define(['N/currentRecord'], (currentRecord) => {
            const rec = currentRecord.get();
            const field = rec.getField({ fieldId: 'entity' });
            field.`;
        const items = getCompletions(text, analyzeDocument(text));
        assert.ok(items.some(item => item.label === 'isDisabled'));
        assert.ok(items.some(item => item.label === 'isMandatory'));
    });
});

