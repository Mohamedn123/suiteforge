import * as assert from 'assert';
import { analyzeDocument } from '../lsp/server/analyzer';
import { getSignatureHelp } from '../lsp/server/signature';

suite('Signature Help Test Suite', () => {
    const analyze = (text: string) => analyzeDocument(text);

    test('Provides signature for module method record.load', () => {
        const text = `
            define(['N/record'], (record) => {
                const rec = record.load({
        `;
        const help = getSignatureHelp(text, analyze(text));
        assert.ok(help, 'signature help should be provided');
        assert.strictEqual(help.signatures.length, 1);
        const sig = help.signatures[0];
        assert.ok(sig.label.startsWith('load('), `label was: ${sig.label}`);
        assert.ok((sig.parameters ?? []).some(p => p.label === 'options.type'), 'options.type param expected');
        assert.strictEqual(help.activeParameter, 0);
    });

    test('Provides signature for object method rec.setValue', () => {
        const text = `
            define(['N/record'], (record) => {
                const rec = record.create({ type: 'salesorder' });
                rec.setValue(
        `;
        const help = getSignatureHelp(text, analyze(text));
        assert.ok(help, 'signature help should be provided');
        const sig = help.signatures[0];
        assert.ok(sig.label.startsWith('setValue('), `label was: ${sig.label}`);
    });

    test('Tracks active parameter across commas', () => {
        const text = `
            define(['N/record'], (record) => {
                record.attach({ record: { type: 'salesorder', id: 1 } },
        `;
        const help = getSignatureHelp(text, analyze(text));
        assert.ok(help);
        assert.strictEqual(help.activeParameter, 1, 'second parameter (options.to) should be active');
    });

    test('Provides signature for context property chain (beforeLoad form)', () => {
        const text = `
            /**
             * @NScriptType UserEventScript
             */
            define([], () => {
                function beforeLoad(context) {
                    context.form.addField(
        `;
        const help = getSignatureHelp(text, analyze(text));
        assert.ok(help, 'signature help should be provided');
        const sig = help.signatures[0];
        assert.ok(sig.label.startsWith('addField('), `label was: ${sig.label}`);
    });

    test('Provides signature for .promise variant', () => {
        const text = `
            define(['N/https'], (https) => {
                https.get.promise(
        `;
        const help = getSignatureHelp(text, analyze(text));
        assert.ok(help);
        const sig = help.signatures[0];
        assert.ok(sig.label.startsWith('get.promise('), `label was: ${sig.label}`);
    });

    test('Returns null when cursor is not inside a call', () => {
        const text = `
            define(['N/record'], (record) => {
                const x = 1;
        `;
        const help = getSignatureHelp(text, analyze(text));
        assert.strictEqual(help, null);
    });
});
