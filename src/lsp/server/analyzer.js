"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeDocument = analyzeDocument;
var moduleData_1 = require("./moduleData");
// All known SuiteScript entry point names
var KNOWN_ENTRY_POINTS = new Set([
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
function analyzeDocument(text) {
    var moduleMap = new Map();
    var typeMap = new Map();
    // --- Detect script type from JSDoc annotation ---
    var scriptTypeMatch = text.match(/@NScriptType\s+(\w+)/);
    var scriptType = scriptTypeMatch ? scriptTypeMatch[1] : null;
    // --- Pattern 1: AMD define() ---
    var defineRegex = /define\s*\(\s*\[([^\]]*)\]\s*,\s*(?:function\s*)?\(([^)]*)\)/;
    var defineMatch = defineRegex.exec(text);
    if (defineMatch) {
        var modulePaths = defineMatch[1]
            .split(',')
            .map(function (s) { return s.trim().replace(/['"]/g, ''); });
        var paramNames = defineMatch[2]
            .split(',')
            .map(function (s) { return s.trim(); });
        for (var i = 0; i < Math.min(modulePaths.length, paramNames.length); i++) {
            var modPath = modulePaths[i];
            var paramName = paramNames[i];
            if (modPath && paramName && (0, moduleData_1.getModule)(modPath)) {
                moduleMap.set(paramName, modPath);
            }
        }
    }
    // --- Pattern 2: CJS require() ---
    var requireRegex = /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    var requireMatch;
    while ((requireMatch = requireRegex.exec(text)) !== null) {
        var varName = requireMatch[1];
        var modPath = requireMatch[2];
        if ((0, moduleData_1.getModule)(modPath)) {
            moduleMap.set(varName, modPath);
        }
    }
    // --- Pattern 3: Entry point function parameters ---
    // Detects patterns like:
    //   const beforeSubmit = (context) => { ... }
    //   const pageInit = function(context) { ... }
    //   function beforeSubmit(context) { ... }
    //   const onRequest = (ctx) => { ... }
    //
    // When we recognize the function name as a known entry point, we assign
    // the context type to whatever the first parameter is named.
    var entryPointPatterns = [
        // const/let/var entryPoint = (param) =>
        // const/let/var entryPoint = function(param)
        /(?:const|let|var)\s+(\w+)\s*=\s*(?:function\s*)?\((\w+)/g,
        // function entryPoint(param)
        /function\s+(\w+)\s*\((\w+)/g,
    ];
    for (var _i = 0, entryPointPatterns_1 = entryPointPatterns; _i < entryPointPatterns_1.length; _i++) {
        var regex = entryPointPatterns_1[_i];
        var match = void 0;
        while ((match = regex.exec(text)) !== null) {
            var funcName = match[1];
            var paramName = match[2];
            if (KNOWN_ENTRY_POINTS.has(funcName)) {
                var ctxTypeId = (0, moduleData_1.getContextTypeId)(funcName);
                if (ctxTypeId) {
                    typeMap.set(paramName, ctxTypeId);
                }
            }
        }
    }
    // --- Pattern 4: Method call return types ---
    // Detects `let x = rec.getValue(` OR `let x = await action.get.promise(`
    var callRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(await\s+)?(\w+)\s*\.\s*([\w\.]+)\s*\(/g;
    var callMatch;
    var _loop_1 = function () {
        var resultVar = callMatch[1];
        var hasAwait = !!callMatch[2];
        var objectVar = callMatch[3];
        var methodName = callMatch[4];
        var returnedType = void 0;
        var modId = moduleMap.get(objectVar);
        if (modId) {
            var methods = (0, moduleData_1.getModuleMethods)(modId);
            var method = methods.find(function (m) { return m.name === methodName; });
            if (method === null || method === void 0 ? void 0 : method.returnType) {
                returnedType = method.returnType;
            }
        }
        var objType = typeMap.get(objectVar);
        if (objType) {
            var objMethods = (0, moduleData_1.getObjectMethods)(objType);
            var objMethod = objMethods.find(function (m) { return m.name === methodName; });
            if (objMethod === null || objMethod === void 0 ? void 0 : objMethod.returnType) {
                returnedType = objMethod.returnType;
            }
        }
        if (returnedType) {
            // If they are await'ing a Promise<T>, unwrap it to T
            if (hasAwait && returnedType.startsWith('Promise<') && returnedType.endsWith('>')) {
                returnedType = returnedType.substring(8, returnedType.length - 1);
            }
            typeMap.set(resultVar, returnedType);
        }
    };
    while ((callMatch = callRegex.exec(text)) !== null) {
        _loop_1();
    }
    // --- Pattern 4.5: Promise .then() callbacks ---
    // e.g. promise_action.then(function(res) {
    // e.g. promise_action.then(res => {
    var thenRegex = /(\w+)\s*\.\s*then\s*\(\s*(?:function\s*)?\(\s*(\w+)\s*\)|\s*(\w+)\s*=>/g;
    var thenMatch;
    while ((thenMatch = thenRegex.exec(text)) !== null) {
        var promiseVar = thenMatch[1];
        var cbVar = thenMatch[2] || thenMatch[3];
        var pType = typeMap.get(promiseVar);
        if (pType && pType.startsWith('Promise<') && pType.endsWith('>')) {
            var innerType = pType.substring(8, pType.length - 1);
            typeMap.set(cbVar, innerType);
        }
    }
    // --- Pattern 5: Context property access type propagation ---
    // const rec = context.newRecord  →  rec is N/record#Record
    // let myRec = context.oldRecord  →  myRec is N/record#Record
    var propAccessRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*\.\s*(\w+)\s*[;\n]/g;
    var propMatch;
    while ((propMatch = propAccessRegex.exec(text)) !== null) {
        var targetVar = propMatch[1];
        var sourceVar = propMatch[2];
        var propName = propMatch[3];
        // Check if sourceVar is a context object and the property has a known type
        var sourceType = typeMap.get(sourceVar);
        if (sourceType === null || sourceType === void 0 ? void 0 : sourceType.startsWith('context#')) {
            var entryPointName = sourceType.substring('context#'.length);
            var propTypeId = (0, moduleData_1.getContextPropertyTypeId)(entryPointName, propName);
            if (propTypeId) {
                typeMap.set(targetVar, propTypeId);
            }
        }
    }
    // --- Pattern 6: Simple variable assignment (type propagation) ---
    var assignRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*[;\n]/g;
    var assignMatch;
    while ((assignMatch = assignRegex.exec(text)) !== null) {
        var targetVar = assignMatch[1];
        var sourceVar = assignMatch[2];
        if (moduleMap.has(sourceVar) && !moduleMap.has(targetVar)) {
            moduleMap.set(targetVar, moduleMap.get(sourceVar));
        }
        if (typeMap.has(sourceVar) && !typeMap.has(targetVar)) {
            typeMap.set(targetVar, typeMap.get(sourceVar));
        }
    }
    return { moduleMap: moduleMap, typeMap: typeMap, scriptType: scriptType };
}
