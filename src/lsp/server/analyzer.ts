/**
 * Variable type analyzer for SuiteScript files.
 *
 * Parses the source text using regex-based heuristics to build two maps:
 *   1. moduleMap:  variable name → SuiteScript module ID  (e.g. "record" → "N/record")
 *   2. typeMap:    variable name → return type ID          (e.g. "inv" → "N/record#Record")
 *
 * WHY REGEX INSTEAD OF A FULL AST PARSER:
 * SuiteScript 2.x uses AMD `define([], function(...){})` which is difficult for
 * TypeScript-based AST parsers to handle (they expect ESM or CJS). Regex is simpler,
 * faster, has zero dependencies, and covers the patterns used in 95%+ of real SuiteScript.
 */

import {
    getModule,
    getModuleMethods,
    getObjectMethods,
    getContextTypeId,
    getContextPropertyTypeId,
} from './moduleData';

export interface AnalysisResult {
    moduleMap: Map<string, string>;
    typeMap: Map<string, string>;
    scriptType: string | null;
}

const KNOWN_ENTRY_POINTS = new Set([
    'pageInit', 'fieldChanged', 'postSourcing', 'lineInit',
    'validateField', 'validateLine', 'validateInsert', 'validateDelete', 'saveRecord',
    'beforeLoad', 'beforeSubmit', 'afterSubmit',
    'execute',
    'getInputData', 'map', 'reduce', 'summarize',
    'onRequest',
    'get', 'post', 'put', 'delete',
    'render',
    'each',
    'onAction',
]);

// Entry points that are unambiguous enough to match outside a return statement.
// Short/generic names like get, post, map, delete, execute, render, each are
// excluded here — they only count when assigned to a property in a return { }.
const SAFE_ENTRY_POINTS = new Set([
    'pageInit', 'fieldChanged', 'postSourcing', 'lineInit',
    'validateField', 'validateLine', 'validateInsert', 'validateDelete', 'saveRecord',
    'beforeLoad', 'beforeSubmit', 'afterSubmit',
    'getInputData', 'summarize',
    'onRequest', 'onAction',
]);

export function analyzeDocument(text: string): AnalysisResult {
    const moduleMap = new Map<string, string>();
    const typeMap = new Map<string, string>();

    const scriptTypeMatch = text.match(/@NScriptType\s+(\w+)/);
    const scriptType = scriptTypeMatch ? scriptTypeMatch[1] : null;

    // --- Pattern 1: AMD define() ---
    // Allow optional block comments (JSDoc) or line comments between the module
    // array and the callback function, which is common in SuiteScript files.
    const defineRegex = /define\s*\(\s*\[([^\]]*)\]\s*,\s*(?:\/\*[\s\S]*?\*\/\s*)?(?:\/\/[^\n]*\n\s*)?(?:function\s*)?\(([^)]*)\)/;
    const defineMatch = defineRegex.exec(text);
    if (defineMatch) {
        const modulePaths = defineMatch[1]
            .split(',')
            .map(s => s.trim().replace(/['"]/g, ''));
        const paramNames = defineMatch[2]
            .split(',')
            .map(s => s.trim());

        for (let i = 0; i < Math.min(modulePaths.length, paramNames.length); i++) {
            const modPath = modulePaths[i];
            const paramName = paramNames[i];
            if (modPath && paramName && getModule(modPath)) {
                moduleMap.set(paramName, modPath);
            }
        }
    }

    // --- Pattern 2: CJS require() ---
    const requireRegex = /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let requireMatch: RegExpExecArray | null;
    while ((requireMatch = requireRegex.exec(text)) !== null) {
        const varName = requireMatch[1];
        const modPath = requireMatch[2];
        if (getModule(modPath)) {
            moduleMap.set(varName, modPath);
        }
    }

    // --- Pattern 3: Entry point function parameters ---
    // Safe (unambiguous) names match anywhere:
    //   const beforeSubmit = (context) => { ... }
    //   function beforeSubmit(context) { ... }
    // Ambiguous names (get, map, delete, etc.) only match inside return { }:
    //   return { get: function(context) { ... } }
    //   return { get(context) { ... } }
    const entryPointPatterns = [
        /(?:const|let|var)\s+(\w+)\s*=\s*(?:function\s*)?\((\w+)/g,
        /function\s+(\w+)\s*\((\w+)/g,
    ];

    for (const regex of entryPointPatterns) {
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            const funcName = match[1];
            const paramName = match[2];

            if (SAFE_ENTRY_POINTS.has(funcName)) {
                const ctxTypeId = getContextTypeId(funcName);
                if (ctxTypeId) {
                    typeMap.set(paramName, ctxTypeId);
                }
            }
        }
    }

    // Entry points inside return { name: function(param) } or return { name(param) }
    // Matches ALL known entry points here — safe ones may already be typed by
    // Pattern 3, but reassigning the same type is harmless. This catches the common
    // pattern where the function is defined inline in the return object.
    for (const block of findReturnBlocks(text)) {
        const returnPatterns = [
            /(\w+)\s*:\s*(?:function\s*)?\((\w+)/g,
            /(\w+)\s*\((\w+)/g,
        ];
        for (const regex of returnPatterns) {
            let m: RegExpExecArray | null;
            while ((m = regex.exec(block)) !== null) {
                const name = m[1];
                const param = m[2];
                if (KNOWN_ENTRY_POINTS.has(name)) {
                    const ctxTypeId = getContextTypeId(name);
                    if (ctxTypeId) {
                        typeMap.set(param, ctxTypeId);
                    }
                }
            }
        }
    }

    // --- Pattern 5: Context property access type propagation ---
    // Must run BEFORE method call resolution so that variables derived from
    // context (e.g. const rec = context.newRecord) are typed before their
    // methods are analyzed.
    const propAccessRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*\.\s*(\w+)\s*[;\r\n]/g;
    let propMatch: RegExpExecArray | null;
    while ((propMatch = propAccessRegex.exec(text)) !== null) {
        const targetVar = propMatch[1];
        const sourceVar = propMatch[2];
        const propName = propMatch[3];

        const sourceType = typeMap.get(sourceVar);
        if (sourceType?.startsWith('context#')) {
            const entryPointName = sourceType.substring('context#'.length);
            const propTypeId = getContextPropertyTypeId(entryPointName, propName);
            if (propTypeId) {
                typeMap.set(targetVar, propTypeId);
            }
        }
    }

    // --- Pattern 6: Simple variable assignment (type propagation) ---
    // Must also run before method call resolution for the same reason.
    const assignRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*[;\r\n]/g;
    let assignMatch: RegExpExecArray | null;
    while ((assignMatch = assignRegex.exec(text)) !== null) {
        const targetVar = assignMatch[1];
        const sourceVar = assignMatch[2];

        if (moduleMap.has(sourceVar) && !moduleMap.has(targetVar)) {
            moduleMap.set(targetVar, moduleMap.get(sourceVar)!);
        }
        if (typeMap.has(sourceVar) && !typeMap.has(targetVar)) {
            typeMap.set(targetVar, typeMap.get(sourceVar)!);
        }
    }

    // --- Pattern 4: Method call return types ---
    // Now runs after context/assignment propagation so chained calls like
    // const rec = context.newRecord; const val = rec.getValue({...}) work.
    const callRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(await\s+)?(\w+)\s*\.\s*([\w.]+)\s*\(/g;
    let callMatch: RegExpExecArray | null;
    while ((callMatch = callRegex.exec(text)) !== null) {
        const resultVar = callMatch[1];
        const hasAwait = !!callMatch[2];
        const objectVar = callMatch[3];
        const methodName = callMatch[4];

        let returnedType: string | undefined;

        const modId = moduleMap.get(objectVar);
        if (modId) {
            const methods = getModuleMethods(modId);
            const method = methods.find(m => m.name === methodName);
            if (method?.returnType) {
                returnedType = method.returnType;
            }
        }

        if (!returnedType) {
            const objType = typeMap.get(objectVar);
            if (objType) {
                const objMethods = getObjectMethods(objType);
                const objMethod = objMethods.find(m => m.name === methodName);
                if (objMethod?.returnType) {
                    returnedType = objMethod.returnType;
                }
            }
        }

        if (returnedType) {
            if (hasAwait && returnedType.startsWith('Promise<') && returnedType.endsWith('>')) {
                returnedType = returnedType.substring(8, returnedType.length - 1);
            }
            typeMap.set(resultVar, returnedType);
        }
    }

    // --- Pattern 4.5: Promise .then() callbacks ---
    const thenRegex = /(\w+)\s*\.\s*then\s*\(\s*(?:(?:function\s*)?\(\s*(\w+)\s*\)|(\w+)\s*=>)/g;
    let thenMatch: RegExpExecArray | null;
    while ((thenMatch = thenRegex.exec(text)) !== null) {
        const promiseVar = thenMatch[1];
        const cbVar = thenMatch[2] || thenMatch[3];

        const pType = typeMap.get(promiseVar);
        if (pType && pType.startsWith('Promise<') && pType.endsWith('>')) {
            const innerType = pType.substring(8, pType.length - 1);
            if (cbVar) {
                typeMap.set(cbVar, innerType);
            }
        }
    }

    return { moduleMap, typeMap, scriptType };
}

/** Extract return { ... } blocks using brace counting to handle nesting. */
function findReturnBlocks(text: string): string[] {
    const blocks: string[] = [];
    const opener = /return\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = opener.exec(text)) !== null) {
        let depth = 1;
        let i = m.index + m[0].length;
        while (i < text.length && depth > 0) {
            if (text[i] === '{') { depth++; }
            else if (text[i] === '}') { depth--; }
            i++;
        }
        if (depth === 0) {
            blocks.push(text.substring(m.index, i));
        }
    }
    return blocks;
}
