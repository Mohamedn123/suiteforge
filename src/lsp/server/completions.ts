import {
    CompletionItem,
    CompletionItemKind,
    MarkupKind,
    Hover,
    MarkupContent,
} from 'vscode-languageserver';
import type { AnalysisResult } from './analyzer';
import {
    getModule,
    getObjectType,
    getModuleMethods,
    getModuleEnums,
    getObjectMethods,
    getObjectProperties,
    getContextPropertyTypeId,
    getAllModules,
} from './moduleData';

export function getCompletions(
    textBeforeCursor: string,
    analysis: AnalysisResult,
): CompletionItem[] {
    // Module path completions inside define([...]) or require('...')
    const modulePathItems = getModulePathCompletions(textBeforeCursor, analysis);
    if (modulePathItems) { return modulePathItems; }

    // Method parameter completions inside options objects: record.load({ | })
    const paramItems = getMethodParamCompletions(textBeforeCursor, analysis);
    if (paramItems) { return paramItems; }

    const dotExprMatch = textBeforeCursor.match(/(\w+(?:\.\w+)*)\.(\w*)\s*$/);
    if (!dotExprMatch) { return []; }

    const fullExpr = dotExprMatch[1];
    const parts = fullExpr.split('.');

    if (parts.length === 1) {
        const varName = parts[0];
        let items = getCompletionsForVariable(varName, analysis);
        if (items.length === 0) {
            items = getContextFallbackCompletions(varName, textBeforeCursor, analysis);
        }
        return items;
    }

    if (parts.length >= 2) {
        const varName = parts[0];
        const remainder = parts.slice(1).join('.');

        const items = getCompletionsForVariable(varName, analysis);

        const prefix = remainder + '.';
        const filteredItems: CompletionItem[] = [];
        const seenLabels = new Set<string>();

        if (parts.length === 2) {
            const enumCompletions = getCompletionsForEnumMembers(varName, parts[1], analysis);
            filteredItems.push(...enumCompletions);
        }

        for (const item of items) {
            if (item.label.startsWith(prefix)) {
                const suffix = item.label.substring(prefix.length);
                const nextPart = suffix.split('.')[0];

                if (!seenLabels.has(nextPart)) {
                    seenLabels.add(nextPart);
                    filteredItems.push({
                        ...item,
                        label: nextPart,
                        insertText: nextPart,
                        sortText: '\0' + nextPart
                    });
                }
            }
        }

        // Chain resolution: e.g. context.form. → resolve form's type → show its completions
        if (filteredItems.length === 0) {
            let resolvedType = resolvePropertyChain(parts, analysis);
            // Fallback: if root var isn't in typeMap, try context detection
            if (!resolvedType) {
                resolvedType = resolvePropertyChainWithFallback(parts, textBeforeCursor);
            }
            if (resolvedType) {
                const chainedItems = getCompletionsForTypeId(resolvedType, parts[parts.length - 1], analysis);
                filteredItems.push(...chainedItems);
            }
        }

        // If still nothing and parts.length === 2, maybe varName.prop where varName is a context param
        if (filteredItems.length === 0 && parts.length === 2) {
            const ctxTypeId = detectEntryPointContext(varName, textBeforeCursor);
            if (ctxTypeId) {
                const ctxObjType = getObjectType(ctxTypeId);
                if (ctxObjType) {
                    const st = analysis.scriptType;
                    for (const method of ctxObjType.methods ?? []) {
                        if (!isSupportedInScript(method.supportedIn, st)) { continue; }
                        filteredItems.push({
                            label: method.name,
                            kind: CompletionItemKind.Method,
                            detail: `${method.returns}  —  ${ctxObjType.name}`,
                            documentation: buildMethodDoc(method),
                            sortText: '\0' + method.name,
                        });
                    }
                    for (const prop of ctxObjType.properties ?? []) {
                        const roTag = prop.readOnly ? ' *(read-only)*' : '';
                        filteredItems.push({
                            label: prop.name,
                            kind: CompletionItemKind.Property,
                            detail: `${prop.type}${prop.readOnly ? ' (read-only)' : ''}  —  ${ctxObjType.name}`,
                            documentation: { kind: MarkupKind.Markdown, value: (prop.description ?? '') + roTag },
                            sortText: '\0' + prop.name,
                        });
                    }
                }
            }
        }

        return filteredItems;
    }

    return [];
}

const CLIENT_SCRIPT_TYPES = new Set(['ClientScript']);
const SERVER_SCRIPT_TYPES = new Set([
    'UserEventScript', 'Suitelet', 'RESTlet', 'ScheduledScript',
    'MapReduceScript', 'WorkflowActionScript', 'MassUpdateScript',
    'Portlet', 'BundleInstallationScript',
]);

export function normalizeScriptType(scriptType: string | null): string | null {
    if (!scriptType) { return null; }
    if (CLIENT_SCRIPT_TYPES.has(scriptType)) { return 'client'; }
    if (SERVER_SCRIPT_TYPES.has(scriptType)) { return 'server'; }
    return scriptType;
}

function isSupportedInScript(
    supportedIn: string[] | undefined,
    scriptType: string | null,
): boolean {
    if (!supportedIn || !scriptType) { return true; }
    const normalized = normalizeScriptType(scriptType);
    if (!normalized) { return true; }
    return supportedIn.includes(normalized);
}

function getCompletionsForVariable(
    varName: string,
    analysis: AnalysisResult,
): CompletionItem[] {
    const items: CompletionItem[] = [];
    const st = analysis.scriptType;

    const modId = analysis.moduleMap.get(varName);
    if (modId) {
        const mod = getModule(modId);
        if (mod) {
            for (const method of mod.methods ?? []) {
                if (!isSupportedInScript(method.supportedIn, st)) { continue; }
                items.push({
                    label: method.name,
                    kind: CompletionItemKind.Method,
                    detail: `${method.returns}  —  ${modId}`,
                    documentation: buildMethodDoc(method),
                    sortText: '\0' + method.name,
                });
            }
            for (const en of mod.enums ?? []) {
                items.push({
                    label: en.name,
                    kind: CompletionItemKind.Enum,
                    detail: `enum  —  ${modId}`,
                    documentation: { kind: MarkupKind.Markdown, value: en.description ?? '' },
                    sortText: '\0' + en.name,
                });
            }
        }
        return items;
    }

    const rawTypeId = analysis.typeMap.get(varName);
    if (rawTypeId) {
        let typeId = rawTypeId;

        if (typeId.startsWith('Promise<') && typeId.endsWith('>')) {
            const innerType = typeId.substring(8, typeId.length - 1);
            items.push(
                {
                    label: 'then',
                    kind: CompletionItemKind.Method,
                    detail: `Promise<${innerType}>.then()`,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `**then**(onFulfilled, onRejected)\n\nAttaches callbacks for the resolution and/or rejection of the Promise.\n\n**Parameters:**\n- \`onFulfilled\`: \`(value: ${innerType}) => any\` — Called when the Promise is resolved\n- \`onRejected\`: \`(reason: any) => any\` — Called when the Promise is rejected *(optional)*\n\n**Returns:** \`Promise\``,
                    },
                    sortText: '\0then',
                },
                {
                    label: 'catch',
                    kind: CompletionItemKind.Method,
                    detail: `Promise<${innerType}>.catch()`,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `**catch**(onRejected)\n\nAttaches a callback for only the rejection of the Promise.\n\n**Parameters:**\n- \`onRejected\`: \`(reason: any) => any\` — Called when the Promise is rejected\n\n**Returns:** \`Promise\``,
                    },
                    sortText: '\0catch',
                },
                {
                    label: 'finally',
                    kind: CompletionItemKind.Method,
                    detail: `Promise<${innerType}>.finally()`,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `**finally**(onFinally)\n\nAttaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The resolved value cannot be modified from the callback.\n\n**Parameters:**\n- \`onFinally\`: \`() => void\` — Called when the Promise is settled\n\n**Returns:** \`Promise<${innerType}>\``,
                    },
                    sortText: '\0finally',
                },
            );
            return items;
        }

        const objType = getObjectType(typeId);
        if (objType) {
            for (const method of objType.methods ?? []) {
                if (!isSupportedInScript(method.supportedIn, st)) { continue; }
                items.push({
                    label: method.name,
                    kind: CompletionItemKind.Method,
                    detail: `${method.returns}  —  ${objType.name}`,
                    documentation: buildMethodDoc(method),
                    sortText: '\0' + method.name,
                });
            }
            for (const prop of objType.properties ?? []) {
                const roTag = prop.readOnly ? ' *(read-only)*' : '';
                items.push({
                    label: prop.name,
                    kind: CompletionItemKind.Property,
                    detail: `${prop.type}${prop.readOnly ? ' (read-only)' : ''}  —  ${objType.name}`,
                    documentation: { kind: MarkupKind.Markdown, value: (prop.description ?? '') + roTag },
                    sortText: '\0' + prop.name,
                });
            }
        }
        return items;
    }

    return items;
}

function getCompletionsForEnumMembers(
    varName: string,
    enumName: string,
    analysis: AnalysisResult,
): CompletionItem[] {
    const modId = analysis.moduleMap.get(varName);
    if (!modId) { return []; }

    const enums = getModuleEnums(modId);
    const en = enums.find(e => e.name === enumName);
    if (!en) { return []; }

    return (en.members ?? []).map(member => ({
        label: member.name,
        kind: CompletionItemKind.EnumMember,
        detail: `"${member.value}"`,
        documentation: { kind: MarkupKind.Markdown, value: member.description ?? '' } satisfies MarkupContent,
        sortText: '\0' + member.name,
    }));
}

/**
 * Detect when the cursor is inside a module path string in define([...]) or require('...').
 * Returns module path completions, or null if we're not in that context.
 */
function getModulePathCompletions(
    textBeforeCursor: string,
    analysis: AnalysisResult,
): CompletionItem[] | null {
    // Match cursor inside define(['...  or  define(["...
    // Also match require('...  or  require("...
    const defineMatch = textBeforeCursor.match(
        /(?:define\s*\(\s*\[(?:[^\]]*,\s*)?|require\s*\(\s*)['"]([^'"]*?)$/
    );
    if (!defineMatch) { return null; }

    const partial = defineMatch[1]; // e.g. "N/re" or "N/" or ""
    const allMods = getAllModules();
    const st = analysis.scriptType;

    const items: CompletionItem[] = [];
    for (const mod of allMods) {
        const modId = mod.module;
        if (partial && !modId.startsWith(partial)) { continue; }

        const supported = !st || !mod.supportedIn || mod.supportedIn.includes(st);
        const methodCount = (mod.methods ?? []).length;
        const enumCount = (mod.enums ?? []).length;
        const stats = [
            methodCount && `${methodCount} method${methodCount > 1 ? 's' : ''}`,
            enumCount && `${enumCount} enum${enumCount > 1 ? 's' : ''}`,
        ].filter(Boolean).join(', ');

        items.push({
            label: modId,
            kind: CompletionItemKind.Module,
            detail: supported ? 'SuiteScript Module' : `SuiteScript Module (not supported in ${st})`,
            documentation: {
                kind: MarkupKind.Markdown,
                value: [
                    mod.description,
                    '',
                    stats ? `*${stats}*` : '',
                    !supported ? `\n\n**Warning:** Not supported in ${st}.` : '',
                ].filter(Boolean).join('\n'),
            },
            // Only insert the part after what's already typed
            insertText: modId.substring(partial.length),
            sortText: '\0' + modId,
            filterText: modId,
        });
    }

    return items;
}

/**
 * Provide completions for options-object properties inside a method call.
 * Triggers on `record.load({  |  })` or `record.load({ type: 'x',  |  })`.
 * Scans backwards to find the enclosing `{`, then checks whether it belongs
 * to a known module/object-type method call.
 */
function getMethodParamCompletions(
    textBeforeCursor: string,
    analysis: AnalysisResult,
): CompletionItem[] | null {
    // Find the nearest unmatched '{' (skip nested {} pairs)
    let depth = 0;
    let bracePos = -1;
    for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
        const ch = textBeforeCursor[i];
        if (ch === '}') { depth++; }
        else if (ch === '{') {
            if (depth === 0) { bracePos = i; break; }
            depth--;
        }
    }
    if (bracePos < 0) { return null; }

    // Determine whether the cursor is in a "key" position (not a "value" position).
    // Track ':' and ',' at nesting depth 0 within the object.
    let inValue = false;
    let nestDepth = 0;
    for (let i = bracePos + 1; i < textBeforeCursor.length; i++) {
        const ch = textBeforeCursor[i];
        if (ch === '{' || ch === '[' || ch === '(') { nestDepth++; }
        else if (ch === '}' || ch === ']' || ch === ')') { nestDepth--; }
        else if (nestDepth === 0) {
            if (ch === ':') { inValue = true; }
            else if (ch === ',') { inValue = false; }
        }
    }
    if (inValue) { return null; }

    // Check if '{' is preceded by a method call: varName.methodName(
    const beforeBrace = textBeforeCursor.substring(0, bracePos).trimEnd();
    const callMatch = beforeBrace.match(/(\w+)\s*\.\s*([\w.]+)\s*\(\s*$/);
    if (!callMatch) { return null; }

    const objectVar = callMatch[1];
    const methodName = callMatch[2];

    // Resolve the method from module or object type
    type MethodDef = { params?: { name: string; type: string; description: string; optional?: boolean }[] };
    let method: MethodDef | undefined;

    const modId = analysis.moduleMap.get(objectVar);
    if (modId) {
        const methods = getModuleMethods(modId);
        method = methods.find(m => m.name === methodName);
    }

    if (!method) {
        const typeId = analysis.typeMap.get(objectVar);
        if (typeId) {
            let resolved = typeId;
            if (resolved.startsWith('Promise<') && resolved.endsWith('>')) {
                resolved = resolved.substring(8, resolved.length - 1);
            }
            const methods = getObjectMethods(resolved);
            method = methods.find(m => m.name === methodName);
        }
    }

    if (!method?.params) { return null; }

    // Collect options.* params (properties of the options object)
    const optionParams = method.params.filter(p => p.name.startsWith('options.'));
    if (optionParams.length === 0) { return null; }

    // Detect properties already specified in the current object
    const textInObject = textBeforeCursor.substring(bracePos + 1);
    const existingProps = new Set<string>();
    const propRegex = /(\w+)\s*:/g;
    let pm: RegExpExecArray | null;
    while ((pm = propRegex.exec(textInObject)) !== null) {
        existingProps.add(pm[1]);
    }

    const owner = modId ?? objectVar;
    const items: CompletionItem[] = [];

    for (const param of optionParams) {
        const propName = param.name.substring('options.'.length);
        if (existingProps.has(propName)) { continue; }

        const requiredTag = param.optional ? 'optional' : 'required';
        items.push({
            label: propName,
            kind: CompletionItemKind.Property,
            detail: `(${requiredTag}) ${param.type}  —  ${owner}.${methodName}`,
            documentation: {
                kind: MarkupKind.Markdown,
                value: [
                    param.description ?? '',
                    '',
                    param.optional ? '*Optional*' : '**Required**',
                ].filter(Boolean).join('\n'),
            },
            insertText: `${propName}: `,
            sortText: '\0' + (param.optional ? '1' : '0') + propName,
        });
    }

    return items.length > 0 ? items : null;
}

const ALL_ENTRY_POINTS = new Set([
    'pageInit', 'fieldChanged', 'postSourcing', 'lineInit',
    'validateField', 'validateLine', 'validateInsert', 'validateDelete', 'saveRecord',
    'beforeLoad', 'beforeSubmit', 'afterSubmit',
    'execute',
    'getInputData', 'map', 'reduce', 'summarize',
    'onRequest',
    'get', 'post', 'put', 'delete',
    'render', 'each', 'onAction',
]);

/**
 * Fallback: if the analyzer didn't type a variable, scan the text to check
 * whether it's a parameter of an enclosing entry point function.
 * Handles: `const pageInit = (ctx) => {`, `function beforeSubmit(ctx) {`,
 * and `entryPoint: function(ctx) {` inside return blocks.
 */
function getContextFallbackCompletions(
    varName: string,
    textBeforeCursor: string,
    analysis: AnalysisResult,
): CompletionItem[] {
    // Search backwards from cursor for the nearest function that takes varName as a parameter
    // and whose name is a known entry point.
    const patterns = [
        // const entryPoint = (varName) =>
        // const entryPoint = function(varName)
        new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:function\\s*)?\\(\\s*${varName}\\b`, 'g'),
        // function entryPoint(varName)
        new RegExp(`function\\s+(\\w+)\\s*\\(\\s*${varName}\\b`, 'g'),
        // entryPoint: function(varName) — inside return {}
        new RegExp(`(\\w+)\\s*:\\s*(?:function\\s*)?\\(\\s*${varName}\\b`, 'g'),
        // entryPoint(varName) — shorthand method syntax
        new RegExp(`(\\w+)\\s*\\(\\s*${varName}\\b`, 'g'),
    ];

    let bestMatch: { name: string; index: number } | null = null;
    for (const regex of patterns) {
        let m: RegExpExecArray | null;
        while ((m = regex.exec(textBeforeCursor)) !== null) {
            const funcName = m[1];
            if (ALL_ENTRY_POINTS.has(funcName)) {
                if (!bestMatch || m.index > bestMatch.index) {
                    bestMatch = { name: funcName, index: m.index };
                }
            }
        }
    }

    if (!bestMatch) { return []; }

    const ctxTypeId = `context#${bestMatch.name}`;
    const objType = getObjectType(ctxTypeId);
    if (!objType) { return []; }

    const st = analysis.scriptType;
    const items: CompletionItem[] = [];
    for (const method of objType.methods ?? []) {
        if (!isSupportedInScript(method.supportedIn, st)) { continue; }
        items.push({
            label: method.name,
            kind: CompletionItemKind.Method,
            detail: `${method.returns}  —  ${objType.name}`,
            documentation: buildMethodDoc(method),
            sortText: '\0' + method.name,
        });
    }
    for (const prop of objType.properties ?? []) {
        const roTag = prop.readOnly ? ' *(read-only)*' : '';
        items.push({
            label: prop.name,
            kind: CompletionItemKind.Property,
            detail: `${prop.type}${prop.readOnly ? ' (read-only)' : ''}  —  ${objType.name}`,
            documentation: { kind: MarkupKind.Markdown, value: (prop.description ?? '') + roTag },
            sortText: '\0' + prop.name,
        });
    }
    return items;
}

/**
 * Like resolvePropertyChain, but for root variables not in the typeMap.
 * Uses context detection to resolve the root, then walks the rest.
 */
function resolvePropertyChainWithFallback(
    parts: string[],
    textBeforeCursor: string,
): string | undefined {
    if (parts.length < 2) { return undefined; }
    const rootCtxType = detectEntryPointContext(parts[0], textBeforeCursor);
    if (!rootCtxType) { return undefined; }

    let currentType = rootCtxType;
    for (let i = 1; i < parts.length; i++) {
        if (currentType.startsWith('context#')) {
            const entryPoint = currentType.substring('context#'.length);
            const propTypeId = getContextPropertyTypeId(entryPoint, parts[i]);
            if (propTypeId) {
                currentType = propTypeId;
                continue;
            }
        }
        const objType = getObjectType(currentType);
        if (!objType) { return undefined; }
        const prop = (objType.properties ?? []).find(p => p.name === parts[i]);
        if (!prop) {
            const method = (objType.methods ?? []).find(m => m.name === parts[i]);
            if (method?.returnType) {
                currentType = method.returnType;
                continue;
            }
            return undefined;
        }
        if ((prop as { typeId?: string }).typeId) {
            currentType = (prop as { typeId?: string }).typeId!;
        } else {
            return undefined;
        }
    }
    return currentType;
}

/**
 * Scan text backwards from cursor to find the nearest function taking the given
 * parameter name whose function name is a known entry point. Returns the
 * context typeId (e.g. "context#pageInit") or null.
 */
function detectEntryPointContext(paramName: string, textBeforeCursor: string): string | null {
    const patterns = [
        new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:function\\s*)?\\(\\s*${paramName}\\b`, 'g'),
        new RegExp(`function\\s+(\\w+)\\s*\\(\\s*${paramName}\\b`, 'g'),
        new RegExp(`(\\w+)\\s*:\\s*(?:function\\s*)?\\(\\s*${paramName}\\b`, 'g'),
        new RegExp(`(\\w+)\\s*\\(\\s*${paramName}\\b`, 'g'),
    ];

    let best: { name: string; index: number } | null = null;
    for (const regex of patterns) {
        let m: RegExpExecArray | null;
        while ((m = regex.exec(textBeforeCursor)) !== null) {
            if (ALL_ENTRY_POINTS.has(m[1]) && (!best || m.index > best.index)) {
                best = { name: m[1], index: m.index };
            }
        }
    }

    return best ? `context#${best.name}` : null;
}

/**
 * Walk a property chain like ['context', 'form'] and resolve to a final typeId.
 * Uses context property typeIds for context types.
 */
function resolvePropertyChain(parts: string[], analysis: AnalysisResult): string | undefined {
    if (parts.length === 0) { return undefined; }

    let currentType = analysis.typeMap.get(parts[0]);
    if (!currentType) { return undefined; }

    for (let i = 1; i < parts.length; i++) {
        if (currentType.startsWith('Promise<') && currentType.endsWith('>')) {
            currentType = currentType.substring(8, currentType.length - 1);
        }

        if (currentType.startsWith('context#')) {
            const entryPoint = currentType.substring('context#'.length);
            const propType = getContextPropertyTypeId(entryPoint, parts[i]);
            if (propType) {
                currentType = propType;
                continue;
            }
        }

        return undefined;
    }

    return currentType;
}

/** Get completions for a known typeId (used by chain resolution). */
function getCompletionsForTypeId(
    typeId: string,
    _lastPart: string,
    analysis: AnalysisResult,
): CompletionItem[] {
    const items: CompletionItem[] = [];
    const st = analysis.scriptType;

    let resolvedId = typeId;
    if (resolvedId.startsWith('Promise<') && resolvedId.endsWith('>')) {
        resolvedId = resolvedId.substring(8, resolvedId.length - 1);
    }

    const objType = getObjectType(resolvedId);
    if (objType) {
        for (const method of objType.methods ?? []) {
            if (!isSupportedInScript(method.supportedIn, st)) { continue; }
            items.push({
                label: method.name,
                kind: CompletionItemKind.Method,
                detail: `${method.returns}  —  ${objType.name}`,
                documentation: buildMethodDoc(method),
                sortText: '\0' + method.name,
            });
        }
        for (const prop of objType.properties ?? []) {
            const roTag = prop.readOnly ? ' *(read-only)*' : '';
            items.push({
                label: prop.name,
                kind: CompletionItemKind.Property,
                detail: `${prop.type}${prop.readOnly ? ' (read-only)' : ''}  —  ${objType.name}`,
                documentation: { kind: MarkupKind.Markdown, value: (prop.description ?? '') + roTag },
                sortText: '\0' + prop.name,
            });
        }
    }
    return items;
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

export function getHoverInfo(
    word: string,
    textBeforeCursor: string,
    analysis: AnalysisResult,
): Hover | null {
    // --- Module variable ---
    const modId = analysis.moduleMap.get(word);
    if (modId) {
        const mod = getModule(modId);
        if (mod) {
            const methodCount = (mod.methods ?? []).length;
            const enumCount = (mod.enums ?? []).length;
            const stats = [
                methodCount && `${methodCount} method${methodCount > 1 ? 's' : ''}`,
                enumCount && `${enumCount} enum${enumCount > 1 ? 's' : ''}`,
            ].filter(Boolean).join(', ');

            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: [
                        `\`\`\`typescript`,
                        `(module) ${modId}`,
                        `\`\`\``,
                        `---`,
                        mod.description,
                        ``,
                        stats ? `*${stats}*` : '',
                    ].filter(Boolean).join('\n'),
                },
            };
        }
    }

    // --- Typed variable ---
    const rawTypeId = analysis.typeMap.get(word);
    if (rawTypeId) {
        let typeId = rawTypeId;
        let isPromise = false;

        if (typeId.startsWith('Promise<') && typeId.endsWith('>')) {
            typeId = typeId.substring(8, typeId.length - 1);
            isPromise = true;
        }

        const objType = getObjectType(typeId);
        if (objType) {
            const methodCount = (objType.methods ?? []).length;
            const propCount = (objType.properties ?? []).length;
            const stats = [
                methodCount && `${methodCount} method${methodCount > 1 ? 's' : ''}`,
                propCount && `${propCount} ${propCount > 1 ? 'properties' : 'property'}`,
            ].filter(Boolean).join(', ');

            const displayType = isPromise ? `Promise<${typeId}>` : typeId;
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: [
                        `\`\`\`typescript`,
                        `(variable) ${word}: ${displayType}`,
                        `\`\`\``,
                        `---`,
                        objType.description,
                        ``,
                        stats ? `*${stats}*` : '',
                    ].filter(Boolean).join('\n'),
                },
            };
        }

        if (isPromise) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: [
                        `\`\`\`typescript`,
                        `(variable) ${word}: Promise<${typeId}>`,
                        `\`\`\``,
                        `---`,
                        `Asynchronous operation resolving to \`${typeId}\`.`,
                    ].join('\n'),
                },
            };
        }

        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: [
                    `\`\`\`typescript`,
                    `(variable) ${word}: ${rawTypeId}`,
                    `\`\`\``,
                ].join('\n'),
            },
        };
    }

    // --- Fallback: detect entry point context variable ---
    {
        const ctxType = detectEntryPointContext(word, textBeforeCursor);
        if (ctxType) {
            const objType = getObjectType(ctxType);
            if (objType) {
                const methodCount = (objType.methods ?? []).length;
                const propCount = (objType.properties ?? []).length;
                const stats = [
                    methodCount && `${methodCount} method${methodCount > 1 ? 's' : ''}`,
                    propCount && `${propCount} ${propCount > 1 ? 'properties' : 'property'}`,
                ].filter(Boolean).join(', ');
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: [
                            `\`\`\`typescript`,
                            `(parameter) ${word}: ${ctxType}`,
                            `\`\`\``,
                            `---`,
                            objType.description,
                            ``,
                            stats ? `*${stats}*` : '',
                        ].filter(Boolean).join('\n'),
                    },
                };
            }
        }
    }

    // --- Method / property on a known object or module ---
    const dotMatch = textBeforeCursor.match(/([\w.]+)\.\s*$/);
    if (dotMatch) {
        const path = dotMatch[1].split('.');
        const parentVar = path[0];
        const methodOrPropPath = path.slice(1).concat(word).join('.');

        const parentModId = analysis.moduleMap.get(parentVar);
        if (parentModId) {
            const methods = getModuleMethods(parentModId);
            const method = methods.find(m => m.name === methodOrPropPath);
            if (method) {
                return { contents: buildMethodHoverDoc(method, parentModId) };
            }

            if (path.length === 2) {
                const enums = getModuleEnums(parentModId);
                const en = enums.find(e => e.name === path[1]);
                if (en) {
                    const member = (en.members ?? []).find(m => m.name === word);
                    if (member) {
                        return {
                            contents: {
                                kind: MarkupKind.Markdown,
                                value: [
                                    `\`\`\`typescript`,
                                    `(enum member) ${en.name}.${member.name} = "${member.value}"`,
                                    `\`\`\``,
                                    `---`,
                                    member.description ?? '',
                                ].join('\n'),
                            },
                        };
                    }
                }
            }
        }

        let parentTypeId = analysis.typeMap.get(parentVar) ?? undefined;
        // Fallback: detect entry point context for untyped parents
        if (!parentTypeId) {
            parentTypeId = detectEntryPointContext(parentVar, textBeforeCursor) ?? undefined;
        }
        if (parentTypeId) {
            if (parentTypeId.startsWith('Promise<') && parentTypeId.endsWith('>')) {
                parentTypeId = parentTypeId.substring(8, parentTypeId.length - 1);
            }

            const methods = getObjectMethods(parentTypeId);
            const method = methods.find(m => m.name === methodOrPropPath);
            if (method) {
                const ownerType = getObjectType(parentTypeId);
                return { contents: buildMethodHoverDoc(method, ownerType?.name) };
            }

            if (path.length === 1) {
                const props = getObjectProperties(parentTypeId);
                const prop = props.find(p => p.name === word);
                if (prop) {
                    const readOnlyTag = prop.readOnly ? ' *(read-only)*' : '';
                    return {
                        contents: {
                            kind: MarkupKind.Markdown,
                            value: [
                                `\`\`\`typescript`,
                                `(property) ${prop.name}: ${prop.type}`,
                                `\`\`\``,
                                `---`,
                                (prop.description ?? '') + readOnlyTag,
                            ].join('\n'),
                        },
                    };
                }
            }

            // Chain resolution: e.g. context.form.addField → resolve context.form to its type
            if (path.length >= 2) {
                const chainType = resolvePropertyChain(path, analysis);
                if (chainType) {
                    let resolved = chainType;
                    if (resolved.startsWith('Promise<') && resolved.endsWith('>')) {
                        resolved = resolved.substring(8, resolved.length - 1);
                    }
                    const chainMethods = getObjectMethods(resolved);
                    const chainMethod = chainMethods.find(m => m.name === word);
                    if (chainMethod) {
                        const owner = getObjectType(resolved);
                        return { contents: buildMethodHoverDoc(chainMethod, owner?.name) };
                    }
                    const chainProps = getObjectProperties(resolved);
                    const chainProp = chainProps.find(p => p.name === word);
                    if (chainProp) {
                        const roTag = chainProp.readOnly ? ' *(read-only)*' : '';
                        return {
                            contents: {
                                kind: MarkupKind.Markdown,
                                value: [
                                    `\`\`\`typescript`,
                                    `(property) ${chainProp.name}: ${chainProp.type}`,
                                    `\`\`\``,
                                    `---`,
                                    (chainProp.description ?? '') + roTag,
                                ].join('\n'),
                            },
                        };
                    }
                }
            }
        }
    }

    return null;
}

// ---------------------------------------------------------------------------
// Documentation builders
// ---------------------------------------------------------------------------

function buildMethodDoc(method: {
    name: string;
    description: string;
    params?: { name: string; type: string; description: string; optional?: boolean }[];
    returns: string;
}): MarkupContent {
    const params = method.params ?? [];
    const sig = params.map(p => p.name + (p.optional ? '?' : '')).join(', ');
    const paramLines = params
        .map(p => `- \`${p.name}\`: \`${p.type}\` — ${p.description ?? ''}${p.optional ? ' *(optional)*' : ''}`)
        .join('\n');

    return {
        kind: MarkupKind.Markdown,
        value: [
            `**${method.name}**(${sig})`,
            ``,
            method.description,
            ``,
            paramLines ? `**Parameters:**\n${paramLines}` : '',
            ``,
            `**Returns:** \`${method.returns}\``,
        ].filter(Boolean).join('\n'),
    };
}

function buildMethodHoverDoc(method: {
    name: string;
    description: string;
    params?: { name: string; type: string; description: string; optional?: boolean }[];
    returns: string;
}, owner?: string): MarkupContent {
    const params = method.params ?? [];
    const paramSig = params.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ');
    const paramLines = params
        .map(p => `- \`${p.name}\`: \`${p.type}\` — ${p.description ?? ''}${p.optional ? ' *(optional)*' : ''}`)
        .join('\n');

    return {
        kind: MarkupKind.Markdown,
        value: [
            `\`\`\`typescript`,
            `(method) ${owner ? owner + '.' : ''}${method.name}(${paramSig}): ${method.returns}`,
            `\`\`\``,
            `---`,
            method.description,
            ``,
            paramLines ? `**Parameters:**\n${paramLines}` : '',
            ``,
            `**Returns:** \`${method.returns}\``,
        ].filter(Boolean).join('\n'),
    };
}
