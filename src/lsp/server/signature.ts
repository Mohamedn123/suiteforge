import {
    SignatureHelp,
    SignatureInformation,
    ParameterInformation,
} from 'vscode-languageserver';
import type { AnalysisResult } from './analyzer';
import {
    getModuleMethods,
    getObjectMethods,
} from './moduleData';
import { resolvePropertyChain, resolvePropertyChainWithFallback } from './completions';

/**
 * Signature help for SuiteScript method calls — shows the parameter list and
 * highlights the active parameter while typing inside e.g. record.load( ... ).
 *
 * Resolution order mirrors the analyzer:
 *   1. Module method:   record.load(...)        → N/record#load
 *   2. Object method:   rec.setValue(...)       → N/record#Record#setValue
 *   3. Chain fallback:  context.form.addField(  → resolved via property chains
 */
export function getSignatureHelp(
    textBeforeCursor: string,
    analysis: AnalysisResult,
): SignatureHelp | null {
    // Find the innermost unclosed '(' before the cursor, skipping over
    // complete () pairs and stopping at any enclosing '{' boundary (we must
    // not cross into an outer function body).
    let depth = 0;
    let openParen = -1;
    for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
        const ch = textBeforeCursor[i];
        if (ch === ')') { depth++; }
        else if (ch === '(') {
            if (depth === 0) { openParen = i; break; }
            depth--;
        }
    }
    if (openParen < 0) { return null; }

    // The text before the '(' must be `receiver.method` (possibly multi-dot).
    const beforeParen = textBeforeCursor.substring(0, openParen).trimEnd();
    const callMatch = beforeParen.match(/([\w.]+)\s*$/);
    if (!callMatch) { return null; }
    const expr = callMatch[1];
    const parts = expr.split('.');
    if (parts.length < 2) { return null; }

    const methodName = parts[parts.length - 1];
    const receiverParts = parts.slice(0, -1);

    // Count commas at depth 0 inside the call args so far → active parameter.
    const argsSoFar = textBeforeCursor.substring(openParen + 1);
    let activeParam = 0;
    {
        let nest = 0;
        let inString: '"' | "'" | null = null;
        for (const ch of argsSoFar) {
            if (inString) {
                if (ch === inString) { inString = null; }
                continue;
            }
            if (ch === '"' || ch === "'") { inString = ch; continue; }
            if (ch === '(' || ch === '{' || ch === '[') { nest++; }
            else if (ch === ')' || ch === '}' || ch === ']') { nest--; }
            else if (ch === ',' && nest === 0) { activeParam++; }
        }
    }

    const method = resolveMethod(receiverParts, methodName, analysis, textBeforeCursor);
    if (!method) { return null; }

    const params = method.params ?? [];
    if (params.length === 0) { return null; }

    const signature: SignatureInformation = {
        // Use the resolved method's full name (e.g. "get.promise", not "promise").
        label: `${method.name}(${params.map(p => p.name + (p.optional ? '?' : '')).join(', ')})`,
        documentation: method.description,
        parameters: params.map(p => ({
            label: p.name,
            documentation: `${p.type}${p.optional ? ' (optional)' : ''} — ${p.description ?? ''}`,
        } satisfies ParameterInformation)),
    };

    return {
        signatures: [signature],
        activeSignature: 0,
        // For options-object style params (record.load({ type, id })), the
        // first parameter contains all keys — point at it so its docs show.
        activeParameter: Math.min(activeParam, params.length - 1),
    };
}

interface MethodDef {
    name: string;
    description: string;
    params?: { name: string; type: string; description: string; optional?: boolean }[];
    returns?: string;
}

function resolveMethod(
    receiverParts: string[],
    methodName: string,
    analysis: AnalysisResult,
    textBeforeCursor: string,
): MethodDef | undefined {
    // 1. Module receiver: record.load / https.get.promise
    const varName = receiverParts[0];
    const modId = analysis.moduleMap.get(varName);
    if (modId) {
        const dotted = receiverParts.slice(1).concat(methodName).join('.');
        const methods = getModuleMethods(modId);
        // Try the full dotted name first (e.g. "get.promise"), then just the
        // final segment for nested cases like https.get.promise.
        let m = methods.find(x => x.name === dotted);
        if (m) { return m; }
        if (receiverParts.length >= 2) {
            m = methods.find(x => x.name === methodName);
            if (m) { return m; }
        }
        return undefined;
    }

    // 2. Object-typed receiver: rec.setValue
    const typeId = analysis.typeMap.get(varName);
    if (typeId) {
        let resolved = typeId;
        if (resolved.startsWith('Promise<') && resolved.endsWith('>')) {
            resolved = resolved.substring(8, resolved.length - 1);
        }
        const methods = getObjectMethods(resolved);
        const m = methods.find(x => x.name === methodName);
        if (m) { return m; }
    }

    // 3. Context property chain fallback: context.form.addField(
    //    Walk receiverParts through context properties to a concrete type.
    if (receiverParts.length >= 2) {
        const chainType = resolvePropertyChain(receiverParts, analysis)
            ?? resolvePropertyChainWithFallback(receiverParts, textBeforeCursor);
        if (chainType) {
            const methods = getObjectMethods(chainType);
            const m = methods.find(x => x.name === methodName);
            if (m) { return m; }
        }
    }

    return undefined;
}
