"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.getModule = getModule;
exports.getObjectType = getObjectType;
exports.getAllModules = getAllModules;
exports.getModuleMethods = getModuleMethods;
exports.getModuleEnums = getModuleEnums;
exports.getObjectMethods = getObjectMethods;
exports.getObjectProperties = getObjectProperties;
exports.getContextTypeId = getContextTypeId;
exports.getContextPropertyTypeId = getContextPropertyTypeId;
var index_1 = require("../../data/suiteScript/modules/index");
var contextTypes_json_1 = require("../../data/suiteScript/contextTypes.json");
var modules = index_1.default;
var moduleMap = new Map();
var objectTypeMap = new Map();
var CLIENT_SCRIPTS = ['ClientScript'];
var SERVER_SCRIPTS = [
    'UserEventScript', 'ScheduledScript', 'MapReduceScript',
    'Suitelet', 'Restlet', 'Portlet', 'MassUpdateScript',
    'WorkflowActionScript',
];
var SCRIPT_GROUPS = {
    client: CLIENT_SCRIPTS,
    server: SERVER_SCRIPTS,
    all: __spreadArray(__spreadArray([], CLIENT_SCRIPTS, true), SERVER_SCRIPTS, true),
};
function resolveSupportedIn(supportedIn) {
    if (!supportedIn)
        return undefined;
    return supportedIn.flatMap(function (s) { var _a; return (_a = SCRIPT_GROUPS[s]) !== null && _a !== void 0 ? _a : [s]; });
}
for (var _i = 0, modules_1 = modules; _i < modules_1.length; _i++) {
    var mod = modules_1[_i];
    mod.supportedIn = resolveSupportedIn(mod.supportedIn);
    for (var _b = 0, _c = mod.methods; _b < _c.length; _b++) {
        var method = _c[_b];
        method.supportedIn = resolveSupportedIn(method.supportedIn);
    }
    moduleMap.set(mod.module, mod);
    for (var _d = 0, _e = mod.objectTypes; _d < _e.length; _d++) {
        var ot = _e[_d];
        objectTypeMap.set("".concat(mod.module, "#").concat(ot.name), ot);
    }
}
var contextTypes = contextTypes_json_1.default;
var entryPointContextMap = new Map();
for (var _f = 0, _g = Object.entries(contextTypes); _f < _g.length; _f++) {
    var _h = _g[_f], entryPointName = _h[0], ctxDef = _h[1];
    var typeId = "context#".concat(entryPointName);
    entryPointContextMap.set(entryPointName, typeId);
    var objType = {
        name: ctxDef.name,
        description: ctxDef.description,
        methods: ((_a = ctxDef.methods) !== null && _a !== void 0 ? _a : []).map(function (m) { return (__assign(__assign({}, m), { params: m.params.map(function (p) { return (__assign(__assign({}, p), { optional: false })); }) })); }),
        properties: ctxDef.properties.map(function (p) { return ({
            name: p.name,
            type: p.type,
            description: p.description,
        }); }),
    };
    objectTypeMap.set(typeId, objType);
}
// Also store which context properties have known typeIds (e.g. context.newRecord → N/record#Record)
var contextPropertyTypes = new Map();
for (var _j = 0, _k = Object.entries(contextTypes); _j < _k.length; _j++) {
    var _l = _k[_j], entryPointName = _l[0], ctxDef = _l[1];
    var propMap = new Map();
    for (var _m = 0, _o = ctxDef.properties; _m < _o.length; _m++) {
        var prop = _o[_m];
        if (prop.typeId) {
            propMap.set(prop.name, prop.typeId);
        }
    }
    if (propMap.size > 0) {
        contextPropertyTypes.set(entryPointName, propMap);
    }
}
function getModule(moduleId) {
    return moduleMap.get(moduleId);
}
function getObjectType(typeId) {
    return objectTypeMap.get(typeId);
}
function getAllModules() {
    return modules;
}
function getModuleMethods(moduleId) {
    var _a, _b;
    return (_b = (_a = moduleMap.get(moduleId)) === null || _a === void 0 ? void 0 : _a.methods) !== null && _b !== void 0 ? _b : [];
}
function getModuleEnums(moduleId) {
    var _a, _b;
    return (_b = (_a = moduleMap.get(moduleId)) === null || _a === void 0 ? void 0 : _a.enums) !== null && _b !== void 0 ? _b : [];
}
function getObjectMethods(typeId) {
    var _a, _b;
    return (_b = (_a = objectTypeMap.get(typeId)) === null || _a === void 0 ? void 0 : _a.methods) !== null && _b !== void 0 ? _b : [];
}
function getObjectProperties(typeId) {
    var _a, _b;
    return (_b = (_a = objectTypeMap.get(typeId)) === null || _a === void 0 ? void 0 : _a.properties) !== null && _b !== void 0 ? _b : [];
}
function getContextTypeId(entryPointName) {
    return entryPointContextMap.get(entryPointName);
}
function getContextPropertyTypeId(entryPointName, propertyName) {
    var _a;
    return (_a = contextPropertyTypes.get(entryPointName)) === null || _a === void 0 ? void 0 : _a.get(propertyName);
}
