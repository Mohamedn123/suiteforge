import { parse } from '@babel/parser';
import babelTraverseImport from '@babel/traverse';
const traverse = (babelTraverseImport as typeof babelTraverseImport & { default?: typeof babelTraverseImport }).default
    ?? babelTraverseImport;

import * as t from '@babel/types';
import {
    getModule,
    getModuleMethods,
    getObjectMethods,
    getObjectProperties,
    getContextTypeId,
    getContextPropertyTypeId,
} from './moduleData';

export interface AnalysisResult {
    moduleMap: Map<string, string>;
    typeMap: Map<string, string>;
    scriptType: string | null;
    /** Lexical bindings used to narrow name-based results at a request offset. */
    scopedBindings?: ScopedBinding[];
}

export interface ScopedBinding {
    name: string;
    start: number;
    end: number;
    moduleId?: string;
    typeId?: string;
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

    // --- AST PASS ---
    let ast: any;
    try {
        ast = parse(text, {
            sourceType: 'module',
            plugins: ['typescript'],
            errorRecovery: true,
        });
    } catch (e) {
        // If AST parsing totally fails (e.g. invalid syntax at EOF), ast remains undefined.
        // We will fall back to regex.
    }

    if (ast) {
        // Helper to evaluate type of an expression node
        function evaluateExpressionType(node: t.Node): string | undefined {
            if (t.isIdentifier(node)) {
                return typeMap.get(node.name);
            }
            
            if (t.isCallExpression(node)) {
                if (t.isMemberExpression(node.callee)) {
                    let objectName: string | undefined;
                    let propertyName: string | undefined;

                    if (t.isIdentifier(node.callee.object)) {
                        objectName = node.callee.object.name;
                    } else if (t.isMemberExpression(node.callee.object)) {
                        if (t.isIdentifier(node.callee.object.object)) {
                            objectName = node.callee.object.object.name;
                        }
                    }
                    
                    if (t.isIdentifier(node.callee.property)) {
                        propertyName = node.callee.property.name;
                    }

                    if (objectName && propertyName) {
                        let returnedType: string | undefined;
                        const modId = moduleMap.get(objectName);
                        
                        if (modId) {
                            const methods = getModuleMethods(modId);
                            const method = methods.find(m => m.name === propertyName);
                            if (method?.returnType) {
                                returnedType = method.returnType;
                            } else {
                                if (t.isMemberExpression(node.callee.object) && t.isIdentifier(node.callee.object.property)) {
                                    const parentPropName = node.callee.object.property.name;
                                    const parentMethod = methods.find(m => m.name === parentPropName);
                                    if (parentMethod?.returnType) {
                                        if (propertyName === 'promise') {
                                            returnedType = `Promise<${parentMethod.returnType}>`;
                                        }
                                    }
                                }
                            }
                        }

                        if (!returnedType) {
                            const objType = typeMap.get(objectName);
                            if (objType) {
                                const objMethods = getObjectMethods(objType);
                                const objMethod = objMethods.find(m => m.name === propertyName);
                                if (objMethod?.returnType) {
                                    returnedType = objMethod.returnType;
                                } else {
                                    if (t.isMemberExpression(node.callee.object) && t.isIdentifier(node.callee.object.property)) {
                                        const parentPropName = node.callee.object.property.name;
                                        const parentMethod = objMethods.find(m => m.name === parentPropName);
                                        if (parentMethod?.returnType && propertyName === 'promise') {
                                            returnedType = `Promise<${parentMethod.returnType}>`;
                                        }
                                    }
                                }
                            }
                        }

                        return returnedType;
                    }
                }
            }
            return undefined;
        }

        try {
            traverse(ast, {
                CallExpression(path: any) {
                    const callee = path.node.callee;
                    // AMD define()
                    if (t.isIdentifier(callee, { name: 'define' })) {
                        const args = path.node.arguments;
                        if (args.length >= 2 && t.isArrayExpression(args[0]) && (t.isFunctionExpression(args[1]) || t.isArrowFunctionExpression(args[1]))) {
                            const dependencies = args[0].elements;
                            const params = args[1].params;
                            for (let i = 0; i < Math.min(dependencies.length, params.length); i++) {
                                const dep = dependencies[i];
                                const param = params[i];
                                if (t.isStringLiteral(dep) && t.isIdentifier(param)) {
                                    const modPath = dep.value.replace(/['"]/g, '');
                                    if (getModule(modPath)) {
                                        moduleMap.set(param.name, modPath);
                                    }
                                }
                            }
                        }
                    }

                    // CJS require()
                    if (t.isIdentifier(callee, { name: 'require' })) {
                        const args = path.node.arguments;
                        if (args.length === 1 && t.isStringLiteral(args[0])) {
                            const modPath = args[0].value;
                            if (getModule(modPath)) {
                                const parent = path.parent;
                                if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                                    moduleMap.set(parent.id.name, modPath);
                                } else if (t.isAssignmentExpression(parent) && t.isIdentifier(parent.left)) {
                                    moduleMap.set(parent.left.name, modPath);
                                }
                            }
                        }
                    }
                    
                    // Method Call Returns
                    if (t.isMemberExpression(callee)) {
                        let returnedType = evaluateExpressionType(path.node);

                        if (returnedType) {
                            const parent = path.parent;
                            let targetVar: string | undefined;

                            if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                                targetVar = parent.id.name;
                            } else if (t.isAssignmentExpression(parent) && t.isIdentifier(parent.left)) {
                                targetVar = parent.left.name;
                            } else if (t.isAwaitExpression(parent)) {
                                const grandParent = path.parentPath?.parent;
                                if (grandParent && t.isVariableDeclarator(grandParent) && t.isIdentifier(grandParent.id)) {
                                    targetVar = grandParent.id.name;
                                } else if (grandParent && t.isAssignmentExpression(grandParent) && t.isIdentifier(grandParent.left)) {
                                    targetVar = grandParent.left.name;
                                }
                                if (returnedType.startsWith('Promise<') && returnedType.endsWith('>')) {
                                    returnedType = returnedType.substring(8, returnedType.length - 1);
                                }
                            }

                            if (targetVar) {
                                typeMap.set(targetVar, returnedType);
                            }
                        }
                    }

                    // Promise .then, .catch, .finally
                    if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
                        const propName = callee.property.name;
                        if (['then', 'catch', 'finally'].includes(propName)) {
                            
                            const pType = evaluateExpressionType(callee.object);
                            
                            if (pType && pType.startsWith('Promise<') && pType.endsWith('>')) {
                                const innerType = pType.substring(8, pType.length - 1);
                                const args = path.node.arguments;
                                if (args.length > 0 && (t.isFunctionExpression(args[0]) || t.isArrowFunctionExpression(args[0]))) {
                                    const params = args[0].params;
                                    if (params.length > 0 && t.isIdentifier(params[0])) {
                                        typeMap.set(params[0].name, innerType);
                                    }
                                }
                            }
                        }
                    }
                },

                Function(path: any) {
                    const node = path.node;
                    let funcName: string | undefined;

                    if (t.isFunctionDeclaration(node) && node.id) {
                        funcName = node.id.name;
                    } else if (t.isObjectMethod(node) && t.isIdentifier(node.key)) {
                        funcName = node.key.name;
                    } else if (t.isVariableDeclarator(path.parent) && t.isIdentifier(path.parent.id)) {
                        funcName = path.parent.id.name;
                    } else if (t.isObjectProperty(path.parent) && t.isIdentifier(path.parent.key)) {
                        funcName = path.parent.key.name;
                    } else if (t.isAssignmentExpression(path.parent) && t.isIdentifier(path.parent.left)) {
                        funcName = path.parent.left.name;
                    }

                    if (funcName && node.params.length > 0) {
                        const firstParam = node.params[0];
                        if (t.isIdentifier(firstParam)) {
                            const isInsideReturn = path.findParent((p: any) => p.isReturnStatement());
                            
                            if (SAFE_ENTRY_POINTS.has(funcName) || (isInsideReturn && KNOWN_ENTRY_POINTS.has(funcName))) {
                                const ctxTypeId = getContextTypeId(funcName);
                                if (ctxTypeId) {
                                    typeMap.set(firstParam.name, ctxTypeId);
                                }
                            }
                        }
                    }
                },

                MemberExpression(path: any) {
                    const node = path.node;
                    if (t.isIdentifier(node.object) && t.isIdentifier(node.property)) {
                        const sourceVar = node.object.name;
                        const propName = node.property.name;

                        const sourceType = typeMap.get(sourceVar);
                        if (sourceType?.startsWith('context#')) {
                            const entryPointName = sourceType.substring('context#'.length);
                            const propTypeId = getContextPropertyTypeId(entryPointName, propName);
                            
                            if (propTypeId) {
                                const parent = path.parent;
                                if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                                    typeMap.set(parent.id.name, propTypeId);
                                } else if (t.isAssignmentExpression(parent) && t.isIdentifier(parent.left)) {
                                    typeMap.set(parent.left.name, propTypeId);
                                }
                            }
                        }
                    }
                },

                VariableDeclarator(path: any) {
                    const node = path.node;
                    if (t.isIdentifier(node.id) && t.isIdentifier(node.init)) {
                        const targetVar = node.id.name;
                        const sourceVar = node.init.name;
                        
                        if (moduleMap.has(sourceVar)) {
                            moduleMap.set(targetVar, moduleMap.get(sourceVar)!);
                        } else {
                            moduleMap.delete(targetVar);
                        }
                        if (typeMap.has(sourceVar)) {
                            typeMap.set(targetVar, typeMap.get(sourceVar)!);
                        } else {
                            typeMap.delete(targetVar);
                        }
                    } else if (t.isIdentifier(node.id) && node.init && !t.isCallExpression(node.init)) {
                        moduleMap.delete(node.id.name);
                        typeMap.delete(node.id.name);
                    }
                },
                
                AssignmentExpression(path: any) {
                    const node = path.node;
                    if (t.isIdentifier(node.left) && t.isIdentifier(node.right)) {
                        const targetVar = node.left.name;
                        const sourceVar = node.right.name;

                        if (moduleMap.has(sourceVar)) {
                            moduleMap.set(targetVar, moduleMap.get(sourceVar)!);
                        } else {
                            moduleMap.delete(targetVar);
                        }
                        if (typeMap.has(sourceVar)) {
                            typeMap.set(targetVar, typeMap.get(sourceVar)!);
                        } else {
                            typeMap.delete(targetVar);
                        }
                    } else if (t.isIdentifier(node.left) && !t.isCallExpression(node.right)) {
                        moduleMap.delete(node.left.name);
                        typeMap.delete(node.left.name);
                    }
                }
            });
        } catch(e) {
            // ignore traverse errors
        }
    }

    // --- REGEX FALLBACK PASS ---
    // This is crucial because AST parsers often fail on incomplete documents 
    // (e.g., when the user is actively typing like "context.currentRecord.")

    // Pattern 1: AMD define()
    const defineRegex = /define\s*\(\s*\[([^\]]*)\]\s*,\s*(?:\/\*[\s\S]*?\*\/\s*)?(?:\/\/[^\n]*\n\s*)?(?:function\s*)?\(([^)]*)\)/;
    const defineMatch = defineRegex.exec(text);
    if (defineMatch) {
        const modulePaths = defineMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
        const paramNames = defineMatch[2].split(',').map(s => s.trim());
        for (let i = 0; i < Math.min(modulePaths.length, paramNames.length); i++) {
            const modPath = modulePaths[i];
            const paramName = paramNames[i];
            if (modPath && paramName && getModule(modPath) && !moduleMap.has(paramName)) {
                moduleMap.set(paramName, modPath);
            }
        }
    }

    // Pattern 2: CJS require()
    const requireRegex = /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let requireMatch: RegExpExecArray | null;
    while ((requireMatch = requireRegex.exec(text)) !== null) {
        const varName = requireMatch[1];
        const modPath = requireMatch[2];
        if (getModule(modPath) && !moduleMap.has(varName)) {
            moduleMap.set(varName, modPath);
        }
    }

    // Pattern 3a: Entry point function parameters (safe/unambiguous names)
    const entryPointPatterns = [
        /(?:const|let|var)\s+(\w+)\s*=\s*(?:function\s*)?\((\w+)/g,
        /function\s+(\w+)\s*\((\w+)/g,
    ];
    for (const regex of entryPointPatterns) {
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            const funcName = match[1];
            const paramName = match[2];
            if (SAFE_ENTRY_POINTS.has(funcName) && !typeMap.has(paramName)) {
                const ctxTypeId = getContextTypeId(funcName);
                if (ctxTypeId) {
                    typeMap.set(paramName, ctxTypeId);
                }
            }
        }
    }

    // Pattern 3b: Ambiguous entry points inside return { } blocks
    // Catches entry points like get, post, map, reduce, delete, execute, render, each
    // which only count when assigned to a property inside a return statement.
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
                if (KNOWN_ENTRY_POINTS.has(name) && !typeMap.has(param)) {
                    const ctxTypeId = getContextTypeId(name);
                    if (ctxTypeId) {
                        typeMap.set(param, ctxTypeId);
                    }
                }
            }
        }
    }

    // Pattern 4: Context property access type propagation
    const propAccessRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*\.\s*(\w+)\s*[;\r\n]/g;
    let propMatch: RegExpExecArray | null;
    while ((propMatch = propAccessRegex.exec(text)) !== null) {
        const targetVar = propMatch[1];
        const sourceVar = propMatch[2];
        const propName = propMatch[3];
        const sourceType = typeMap.get(sourceVar);
        if (sourceType?.startsWith('context#') && !typeMap.has(targetVar)) {
            const entryPointName = sourceType.substring('context#'.length);
            const propTypeId = getContextPropertyTypeId(entryPointName, propName);
            if (propTypeId) {
                typeMap.set(targetVar, propTypeId);
            }
        }
    }

    // Pattern 5: Simple variable assignment
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

    // Pattern 6: Method call return types
    const callRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(await\s+)?(\w+)\s*\.\s*([\w.]+)\s*\(/g;
    let callMatch: RegExpExecArray | null;
    while ((callMatch = callRegex.exec(text)) !== null) {
        const resultVar = callMatch[1];
        const hasAwait = !!callMatch[2];
        const objectVar = callMatch[3];
        const methodName = callMatch[4];

        if (!typeMap.has(resultVar)) {
            let returnedType: string | undefined;
            const modId = moduleMap.get(objectVar);
            if (modId) {
                const methods = getModuleMethods(modId);
                const method = methods.find(m => m.name === methodName);
                if (method?.returnType) { returnedType = method.returnType; }
            }
            if (!returnedType) {
                const objType = typeMap.get(objectVar);
                if (objType) {
                    const objMethods = getObjectMethods(objType);
                    const objMethod = objMethods.find(m => m.name === methodName);
                    if (objMethod?.returnType) { returnedType = objMethod.returnType; }
                }
            }
            if (returnedType) {
                if (hasAwait && returnedType.startsWith('Promise<') && returnedType.endsWith('>')) {
                    returnedType = returnedType.substring(8, returnedType.length - 1);
                }
                typeMap.set(resultVar, returnedType);
            }
        }
    }

    // Pattern 7: Reassignment-based method calls (x = obj.method() without const/let/var)
    const reassignCallRegex = /(\w+)\s*=\s*(await\s+)?(\w+)\s*\.\s*([\w.]+)\s*\(/g;
    let reassignMatch: RegExpExecArray | null;
    while ((reassignMatch = reassignCallRegex.exec(text)) !== null) {
        const resultVar = reassignMatch[1];
        const hasAwait = !!reassignMatch[2];
        const objectVar = reassignMatch[3];
        const methodName = reassignMatch[4];

        // Skip if this is a declaration (already handled by Pattern 6)
        const lineStart = text.lastIndexOf('\n', reassignMatch.index) + 1;
        const linePrefix = text.substring(lineStart, reassignMatch.index).trim();
        if (/^(?:const|let|var)$/.test(linePrefix)) { continue; }

        if (!typeMap.has(resultVar)) {
            let returnedType: string | undefined;
            const modId = moduleMap.get(objectVar);
            if (modId) {
                const methods = getModuleMethods(modId);
                const method = methods.find(m => m.name === methodName);
                if (method?.returnType) { returnedType = method.returnType; }
            }
            if (!returnedType) {
                const objType = typeMap.get(objectVar);
                if (objType) {
                    const objMethods = getObjectMethods(objType);
                    const objMethod = objMethods.find(m => m.name === methodName);
                    if (objMethod?.returnType) { returnedType = objMethod.returnType; }
                }
            }
            if (returnedType) {
                if (hasAwait && returnedType.startsWith('Promise<') && returnedType.endsWith('>')) {
                    returnedType = returnedType.substring(8, returnedType.length - 1);
                }
                typeMap.set(resultVar, returnedType);
            }
        }
    }

    // Pattern 8: Promise .then() callback typing (regex fallback)
    const thenRegex = /(\w+)\s*\.\s*then\s*\(\s*(?:(?:function\s*)?\(\s*(\w+)\s*\)|(\w+)\s*=>)/g;
    let thenMatch: RegExpExecArray | null;
    while ((thenMatch = thenRegex.exec(text)) !== null) {
        const promiseVar = thenMatch[1];
        const cbVar = thenMatch[2] || thenMatch[3];
        const pType = typeMap.get(promiseVar);
        if (pType && pType.startsWith('Promise<') && pType.endsWith('>')) {
            const innerType = pType.substring(8, pType.length - 1);
            if (cbVar && !typeMap.has(cbVar)) {
                typeMap.set(cbVar, innerType);
            }
        }
    }

    const scopedBindings = ast ? buildScopedBindings(ast, text.length) : undefined;
    if (scopedBindings) {
        removeConflictingGlobalBindings(scopedBindings, moduleMap, typeMap);
    }
    return { moduleMap, typeMap, scriptType, scopedBindings };
}

function removeConflictingGlobalBindings(
    bindings: ScopedBinding[],
    moduleMap: Map<string, string>,
    typeMap: Map<string, string>,
): void {
    const signaturesByName = new Map<string, Set<string>>();
    for (const binding of bindings) {
        const signatures = signaturesByName.get(binding.name) ?? new Set<string>();
        signatures.add(`${binding.moduleId ?? ''}\0${binding.typeId ?? ''}`);
        signaturesByName.set(binding.name, signatures);
    }
    for (const [name, signatures] of signaturesByName) {
        if (signatures.size > 1) {
            moduleMap.delete(name);
            typeMap.delete(name);
        }
    }
}

/**
 * Returns a copy whose name maps reflect the innermost lexical binding at the
 * supplied document offset. Unknown inner bindings deliberately hide outer
 * SuiteScript bindings rather than inheriting their completions.
 */
export function narrowAnalysisToOffset(analysis: AnalysisResult, offset: number): AnalysisResult {
    if (!analysis.scopedBindings) { return analysis; }
    const moduleMap = new Map(analysis.moduleMap);
    const typeMap = new Map(analysis.typeMap);
    const names = new Set(analysis.scopedBindings.map(binding => binding.name));

    for (const name of names) {
        const candidates = analysis.scopedBindings
            .filter(binding => binding.name === name && binding.start <= offset && offset <= binding.end)
            .sort((a, b) => ((a.end - a.start) - (b.end - b.start)) || (b.start - a.start));
        const binding = candidates[0];
        moduleMap.delete(name);
        typeMap.delete(name);
        if (binding?.moduleId) { moduleMap.set(name, binding.moduleId); }
        if (binding?.typeId) { typeMap.set(name, binding.typeId); }
    }

    return { ...analysis, moduleMap, typeMap };
}

interface BindingInference {
    moduleId?: string;
    typeId?: string;
}

/** Builds a compact symbol table without exposing Babel paths in AnalysisResult. */
function buildScopedBindings(ast: t.Node, textLength: number): ScopedBinding[] {
    const results: ScopedBinding[] = [];
    const seen = new Set<any>();
    const cache = new Map<any, BindingInference>();
    const resolving = new Set<any>();

    const functionName = (path: any): string | undefined => {
        const node = path.node;
        if (t.isFunctionDeclaration(node) && node.id) { return node.id.name; }
        if (t.isObjectMethod(node) && t.isIdentifier(node.key)) { return node.key.name; }
        if (t.isVariableDeclarator(path.parent) && t.isIdentifier(path.parent.id)) { return path.parent.id.name; }
        if ((t.isObjectProperty(path.parent) || t.isObjectMethod(path.parent)) && t.isIdentifier(path.parent.key)) {
            return path.parent.key.name;
        }
        if (t.isAssignmentExpression(path.parent) && t.isIdentifier(path.parent.left)) { return path.parent.left.name; }
        return undefined;
    };

    const inferExpression = (node: any, scope: any): BindingInference => {
        if (!node) { return {}; }
        if (t.isTSAsExpression(node) || t.isTSTypeAssertion(node) || t.isParenthesizedExpression(node)) {
            return inferExpression(node.expression, scope);
        }
        if (t.isAwaitExpression(node)) {
            const inferred = inferExpression(node.argument, scope);
            const typeId = inferred.typeId?.startsWith('Promise<') && inferred.typeId.endsWith('>')
                ? inferred.typeId.slice(8, -1)
                : inferred.typeId;
            return { ...inferred, typeId };
        }
        if (t.isIdentifier(node)) {
            const binding = scope?.getBinding(node.name);
            return binding ? inferBinding(binding) : {};
        }
        if (t.isCallExpression(node)) {
            if (t.isIdentifier(node.callee, { name: 'require' }) && t.isStringLiteral(node.arguments[0])) {
                return getModule(node.arguments[0].value) ? { moduleId: node.arguments[0].value } : {};
            }
            if (!t.isMemberExpression(node.callee) || !t.isIdentifier(node.callee.property)) { return {}; }

            const methodName = node.callee.property.name;
            if (methodName === 'promise' && t.isMemberExpression(node.callee.object)
                && t.isIdentifier(node.callee.object.property)) {
                const parentMethodName = node.callee.object.property.name;
                const receiver = inferExpression(node.callee.object.object, scope);
                const methods = receiver.moduleId
                    ? getModuleMethods(receiver.moduleId)
                    : receiver.typeId ? getObjectMethods(receiver.typeId) : [];
                const returned = methods.find(method => method.name === parentMethodName)?.returnType;
                return returned ? { typeId: `Promise<${returned}>` } : {};
            }

            const receiver = inferExpression(node.callee.object, scope);
            const methods = receiver.moduleId
                ? getModuleMethods(receiver.moduleId)
                : receiver.typeId ? getObjectMethods(receiver.typeId) : [];
            const returned = methods.find(method => method.name === methodName)?.returnType;
            return returned ? { typeId: returned } : {};
        }
        if (t.isMemberExpression(node) && t.isIdentifier(node.property) && !node.computed) {
            const propertyName = node.property.name;
            const receiver = inferExpression(node.object, scope);
            if (receiver.typeId?.startsWith('context#')) {
                const entryPoint = receiver.typeId.slice('context#'.length);
                const typeId = getContextPropertyTypeId(entryPoint, propertyName);
                return typeId ? { typeId } : {};
            }
            if (receiver.typeId) {
                const property = getObjectProperties(receiver.typeId).find(item => item.name === propertyName);
                return property?.typeId ? { typeId: property.typeId } : {};
            }
        }
        return {};
    };

    const inferBinding = (binding: any): BindingInference => {
        const cached = cache.get(binding);
        if (cached) { return cached; }
        if (resolving.has(binding)) { return {}; }
        resolving.add(binding);
        let inferred: BindingInference = {};
        const bindingPath = binding.path;

        if (binding.kind === 'param') {
            const fnPath = bindingPath.findParent((path: any) => path.isFunction());
            if (fnPath) {
                const paramIndex = fnPath.node.params.findIndex((param: any) =>
                    param === bindingPath.node || (t.isRestElement(param) && param.argument === bindingPath.node));
                const callPath = fnPath.parentPath;
                if (callPath?.isCallExpression()
                    && t.isIdentifier(callPath.node.callee, { name: 'define' })
                    && t.isArrayExpression(callPath.node.arguments[0])) {
                    const dependency = callPath.node.arguments[0].elements[paramIndex];
                    if (t.isStringLiteral(dependency) && getModule(dependency.value)) {
                        inferred = { moduleId: dependency.value };
                    }
                }

                if (!inferred.moduleId && paramIndex === 0) {
                    const name = functionName(fnPath);
                    const insideReturn = fnPath.findParent((path: any) => path.isReturnStatement());
                    if (name && (SAFE_ENTRY_POINTS.has(name) || (insideReturn && KNOWN_ENTRY_POINTS.has(name)))) {
                        const typeId = getContextTypeId(name);
                        if (typeId) { inferred = { typeId }; }
                    }
                }

                if (!inferred.typeId && paramIndex === 0 && callPath?.isCallExpression()
                    && t.isMemberExpression(callPath.node.callee)
                    && t.isIdentifier(callPath.node.callee.property, { name: 'then' })) {
                    const promise = inferExpression(callPath.node.callee.object, callPath.scope);
                    if (promise.typeId?.startsWith('Promise<') && promise.typeId.endsWith('>')) {
                        inferred = { typeId: promise.typeId.slice(8, -1) };
                    }
                }
            }
        } else if (bindingPath?.isVariableDeclarator()) {
            inferred = inferExpression(bindingPath.node.init, bindingPath.scope);
        }

        resolving.delete(binding);
        cache.set(binding, inferred);
        return inferred;
    };

    try {
        traverse(ast, {
            Identifier(path: any) {
                if (!path.isBindingIdentifier()) { return; }
                const binding = path.scope.getBinding(path.node.name);
                if (!binding || seen.has(binding)) { return; }
                seen.add(binding);

                const block = binding.scope.block;
                const start = typeof block.start === 'number' ? block.start : 0;
                const end = typeof block.end === 'number' ? block.end : textLength;
                let segmentStart = start;
                let inferred = inferBinding(binding);
                const violations = [...(binding.constantViolations ?? [])]
                    .filter((violation: any) => typeof violation.node.start === 'number' && violation.node.start <= end)
                    .sort((a: any, b: any) => a.node.start - b.node.start);

                for (const violation of violations) {
                    const violationEnd = typeof violation.node.end === 'number'
                        ? violation.node.end
                        : violation.node.start;
                    results.push({
                        name: path.node.name,
                        start: segmentStart,
                        end: violationEnd,
                        ...inferred,
                    });
                    inferred = violation.isAssignmentExpression?.()
                        && violation.node.operator === '='
                        ? inferExpression(violation.node.right, violation.scope)
                        : {};
                    segmentStart = violationEnd;
                }
                results.push({ name: path.node.name, start: segmentStart, end, ...inferred });
            },
        });
    } catch {
        return [];
    }
    return results;
}

function findReturnBlocks(text: string): string[] {
    const blocks: string[] = [];

    // Mask the contents of string literals and comments before scanning, so
    // braces inside them (e.g. "}" in a log message) don't produce
    // unbalanced/mismatched return blocks.
    const masked = text
        .replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length))
        .replace(/\/\/[^\n]*/g, match => ' '.repeat(match.length))
        .replace(/'(?:[^'\\\n]|\\.)*'/g, match => `' ${' '.repeat(Math.max(0, match.length - 2))} '`)
        .replace(/"(?:[^"\\\n]|\\.)*"/g, match => `" ${' '.repeat(Math.max(0, match.length - 2))} "`);

    const opener = /return\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = opener.exec(masked)) !== null) {
        let depth = 1;
        let i = m.index + m[0].length;
        while (i < masked.length && depth > 0) {
            if (masked[i] === '{') { depth++; }
            else if (masked[i] === '}') { depth--; }
            i++;
        }
        if (depth === 0) { blocks.push(text.substring(m.index, i)); }
    }
    return blocks;
}
