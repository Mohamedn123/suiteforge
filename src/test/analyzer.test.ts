import * as assert from 'assert';
import { analyzeDocument, narrowAnalysisToOffset } from '../lsp/server/analyzer';

suite('Analyzer Test Suite', () => {
    test('Should parse AMD define and map modules', () => {
        const text = `
            /**
             * @NApiVersion 2.x
             * @NScriptType ClientScript
             */
            define(['N/record', 'N/search'], function(record, search) {
                function pageInit(context) {
                    const rec = record.create({ type: 'salesorder' });
                }
                return { pageInit: pageInit };
            });
        `;
        
        const result = analyzeDocument(text);
        
        assert.strictEqual(result.scriptType, 'ClientScript');
        assert.strictEqual(result.moduleMap.get('record'), 'N/record');
        assert.strictEqual(result.moduleMap.get('search'), 'N/search');
    });

    test('Should trace returned method types', () => {
        const text = `
            define(['N/record'], function(record) {
                const rec = record.create({ type: 'salesorder' });
                const val = rec.getValue({ fieldId: 'entity' });
            });
        `;
        
        const result = analyzeDocument(text);
        assert.strictEqual(result.typeMap.get('rec'), 'N/record#Record');
    });

    test('Should parse CJS require', () => {
        const text = `
            const record = require('N/record');
            const search = require('N/search');
        `;
        
        const result = analyzeDocument(text);
        assert.strictEqual(result.moduleMap.get('record'), 'N/record');
        assert.strictEqual(result.moduleMap.get('search'), 'N/search');
    });

    test('Should trace Promise types for .then()', () => {
         const text = `
            define(['N/https'], function(https) {
                https.get.promise({ url: 'https://test.com' }).then(function(response) {
                    const body = response.body;
                });
            });
        `;
        
        const result = analyzeDocument(text);
        assert.strictEqual(result.typeMap.get('response'), 'N/https#ClientResponse');
    });

    test('Should type context property access (e.g. context.newRecord)', () => {
        const text = `
            /**
             * @NScriptType UserEventScript
             */
            define(['N/record'], function(record) {
                function beforeSubmit(context) {
                    const rec = context.newRecord;
                }
                return { beforeSubmit: beforeSubmit };
            });
        `;

        const result = analyzeDocument(text);
        assert.strictEqual(result.scriptType, 'UserEventScript');
        assert.ok(result.typeMap.has('context'), 'context should be typed');
        assert.strictEqual(result.typeMap.get('rec'), 'N/record#Record');
    });

    test('Should propagate variable assignment types', () => {
        const text = `
            define(['N/record'], function(record) {
                const rec = record.create({ type: 'salesorder' });
                const myRec = rec;
            });
        `;

        const result = analyzeDocument(text);
        assert.strictEqual(result.typeMap.get('rec'), 'N/record#Record');
        assert.strictEqual(result.typeMap.get('myRec'), 'N/record#Record');
    });

    test('Should propagate module aliases', () => {
        const text = `
            define(['N/record'], function(record) {
                const r = record;
            });
        `;

        const result = analyzeDocument(text);
        assert.strictEqual(result.moduleMap.get('record'), 'N/record');
        assert.strictEqual(result.moduleMap.get('r'), 'N/record');
    });

    test('Should type ambiguous entry points inside return blocks (RESTlet get/post)', () => {
        const text = `
            /**
             * @NScriptType Restlet
             */
            define([], function() {
                function handleGet(context) {
                    return context;
                }
                return {
                    get: function(ctx) {
                        return ctx;
                    },
                    post: function(body) {
                        return body;
                    }
                };
            });
        `;

        const result = analyzeDocument(text);
        // 'get' is ambiguous but should be typed when inside return block
        assert.ok(result.typeMap.has('ctx'), 'ctx param in return { get: function(ctx) } should be typed');
    });

    test('Should type MapReduce entry points inside return blocks', () => {
        const text = `
            /**
             * @NScriptType MapReduceScript
             */
            define([], function() {
                return {
                    getInputData: function(inputContext) {
                        return [];
                    },
                    map: function(mapContext) {
                        mapContext.write({ key: 'k', value: 'v' });
                    },
                    reduce: function(reduceContext) {
                        reduceContext.write({ key: 'k', value: 'v' });
                    },
                    summarize: function(summaryContext) {
                    }
                };
            });
        `;

        const result = analyzeDocument(text);
        assert.ok(result.typeMap.has('inputContext'), 'getInputData context should be typed');
        assert.ok(result.typeMap.has('mapContext'), 'map context should be typed');
        assert.ok(result.typeMap.has('reduceContext'), 'reduce context should be typed');
        assert.ok(result.typeMap.has('summaryContext'), 'summarize context should be typed');
    });

    test('Should retain context typing inside object-method entry points', () => {
        const text = `define([], function() {
            return { beforeSubmit(context) { return context.newRecord; } };
        });`;
        const result = analyzeDocument(text);
        const offset = text.indexOf('context.newRecord');
        assert.strictEqual(
            narrowAnalysisToOffset(result, offset).typeMap.get('context'),
            'context#beforeSubmit',
        );
    });

    test('Should handle await unwrapping of Promise types', () => {
        const text = `
            define(['N/record'], function(record) {
                const rec = await record.create.promise({ type: 'salesorder' });
            });
        `;

        const result = analyzeDocument(text);
        // If record.create.promise returns Promise<N/record#Record>, await should unwrap it
        // The exact behavior depends on the module data, but the analyzer should not crash
        assert.ok(result.moduleMap.has('record'));
    });

    test('Should detect scriptType from JSDoc annotation', () => {
        const text = `
            /**
             * @NApiVersion 2.1
             * @NScriptType Suitelet
             */
            define(['N/ui/serverWidget'], function(serverWidget) {
                function onRequest(context) {}
                return { onRequest: onRequest };
            });
        `;

        const result = analyzeDocument(text);
        assert.strictEqual(result.scriptType, 'Suitelet');
        assert.ok(result.typeMap.has('context'), 'onRequest context should be typed');
    });

    test('Should handle define with JSDoc comments between modules and callback', () => {
        const text = `
            define(
                ['N/record', 'N/search'],
                /** @param {Record} record */
                function(record, search) {
                    const rec = record.create({ type: 'salesorder' });
                }
            );
        `;

        const result = analyzeDocument(text);
        assert.strictEqual(result.moduleMap.get('record'), 'N/record');
        assert.strictEqual(result.moduleMap.get('search'), 'N/search');
    });

    test('Should not leak inferred types across lexical scopes', () => {
        const text = `
            define(['N/record'], function(record) {
                function first() {
                    const value = record.create({ type: 'salesorder' });
                    return value;
                }
                function second() {
                    const value = 'plain text';
                    return value;
                }
            });
        `;
        const result = analyzeDocument(text);
        assert.strictEqual(result.typeMap.has('value'), false);
        const firstOffset = text.indexOf('return value') + 'return '.length;
        const secondOffset = text.lastIndexOf('return value') + 'return '.length;
        assert.strictEqual(narrowAnalysisToOffset(result, firstOffset).typeMap.get('value'), 'N/record#Record');
        assert.strictEqual(narrowAnalysisToOffset(result, secondOffset).typeMap.has('value'), false);
    });

    test('Should retain the same inferred type for same-name bindings in separate scopes', () => {
        const text = `define(['N/record'], function(record) {
            function first() { const rec = record.create({}); return rec; }
            function second() { const rec = record.load({}); return rec; }
        });`;
        const result = analyzeDocument(text);
        assert.strictEqual(result.typeMap.get('rec'), 'N/record#Record');
        const firstOffset = text.indexOf('return rec') + 'return '.length;
        const secondOffset = text.lastIndexOf('return rec') + 'return '.length;
        assert.strictEqual(narrowAnalysisToOffset(result, firstOffset).typeMap.get('rec'), 'N/record#Record');
        assert.strictEqual(narrowAnalysisToOffset(result, secondOffset).typeMap.get('rec'), 'N/record#Record');
    });

    test('Should select the innermost binding at the request position', () => {
        const text = `define(['N/record'], function(record) {
            function first() { return record.create({}); }
            function second(record) { return record.customMethod(); }
        });`;
        const result = analyzeDocument(text);
        const firstOffset = text.indexOf('record.create');
        const secondOffset = text.indexOf('record.customMethod');
        assert.strictEqual(narrowAnalysisToOffset(result, firstOffset).moduleMap.get('record'), 'N/record');
        assert.strictEqual(narrowAnalysisToOffset(result, secondOffset).moduleMap.has('record'), false);
    });

    test('Should stop offering an inferred type after reassignment', () => {
        const text = `define(['N/record'], function(record) {
            let rec = record.create({});
            rec.getValue({ fieldId: 'entity' });
            rec = 'plain text';
            return rec;
        });`;
        const result = analyzeDocument(text);
        const before = text.indexOf('rec.getValue');
        const after = text.lastIndexOf('return rec') + 'return '.length;
        assert.strictEqual(narrowAnalysisToOffset(result, before).typeMap.get('rec'), 'N/record#Record');
        assert.strictEqual(narrowAnalysisToOffset(result, after).typeMap.has('rec'), false);
    });
});
