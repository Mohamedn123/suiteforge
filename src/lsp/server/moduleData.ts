import type { SsModuleDefinition, SsMethod, SsObjectType, SsEnum } from '../../data/suiteScript/types';
import modulesRaw from '../../data/suiteScript/modules/index';
import contextTypesRaw from '../../data/suiteScript/contextTypes.json';

const modules: SsModuleDefinition[] = modulesRaw;

const moduleMap = new Map<string, SsModuleDefinition>();
const objectTypeMap = new Map<string, SsObjectType>();
const CLIENT_SCRIPTS = ['ClientScript'];
const SERVER_SCRIPTS = [
    'UserEventScript', 'ScheduledScript', 'MapReduceScript',
    'Suitelet', 'Restlet', 'Portlet', 'MassUpdateScript',
    'WorkflowActionScript',
];
const SCRIPT_GROUPS: Record<string, string[]> = {
    client: CLIENT_SCRIPTS,
    server: SERVER_SCRIPTS,
    all: [...CLIENT_SCRIPTS, ...SERVER_SCRIPTS],
};
function resolveSupportedIn(supportedIn?: string[]): string[] | undefined {
    if (!supportedIn) return undefined;
    return supportedIn.flatMap(s => SCRIPT_GROUPS[s] ?? [s]);
}
for (const mod of modules) {
    mod.supportedIn = resolveSupportedIn(mod.supportedIn);
    for (const method of mod.methods ?? []) {
        method.supportedIn = resolveSupportedIn(method.supportedIn);
    }
    moduleMap.set(mod.module, mod);
    for (const ot of mod.objectTypes ?? []) {
        ot.supportedIn = resolveSupportedIn(ot.supportedIn);
        for (const method of ot.methods ?? []) {
            method.supportedIn = resolveSupportedIn(method.supportedIn);
        }
        objectTypeMap.set(`${mod.module}#${ot.name}`, ot);
    }
}

// ---- Context type registration ----
// Entry point contexts are stored keyed by entry point name (e.g. "beforeSubmit").
// We register them as object types under "context#<EntryPointName>" so the analyzer
// can assign them to function parameters.

interface ContextTypeDef {
    name: string;
    description: string;
    properties: { name: string; type: string; description: string; typeId?: string }[];
    methods?: { name: string; description: string; params: { name: string; type: string; description: string }[]; returns: string }[];
}

const contextTypes = contextTypesRaw as Record<string, ContextTypeDef>;
const entryPointContextMap = new Map<string, string>();

for (const [entryPointName, ctxDef] of Object.entries(contextTypes)) {
    const typeId = `context#${entryPointName}`;
    entryPointContextMap.set(entryPointName, typeId);

    const objType: SsObjectType = {
        name: ctxDef.name,
        description: ctxDef.description,
        methods: (ctxDef.methods ?? []).map(m => ({
            ...m,
            params: (m.params ?? []).map(p => ({ ...p, optional: false })),
        })),
        properties: (ctxDef.properties ?? []).map(p => ({
            name: p.name,
            type: p.type,
            description: p.description,
        })),
    };
    objectTypeMap.set(typeId, objType);
}

// Also store which context properties have known typeIds (e.g. context.newRecord → N/record#Record)
const contextPropertyTypes = new Map<string, Map<string, string>>();
for (const [entryPointName, ctxDef] of Object.entries(contextTypes)) {
    const propMap = new Map<string, string>();
    for (const prop of ctxDef.properties) {
        if (prop.typeId) {
            propMap.set(prop.name, prop.typeId);
        }
    }
    if (propMap.size > 0) {
        contextPropertyTypes.set(entryPointName, propMap);
    }
}
export function getModule(moduleId: string): SsModuleDefinition | undefined {
    return moduleMap.get(moduleId);
}

export function getObjectType(typeId: string): SsObjectType | undefined {
    return objectTypeMap.get(typeId);
}

export function getAllModules(): SsModuleDefinition[] {
    return modules;
}

export function getModuleMethods(moduleId: string): SsMethod[] {
    return moduleMap.get(moduleId)?.methods ?? [];
}

export function getModuleEnums(moduleId: string): SsEnum[] {
    return moduleMap.get(moduleId)?.enums ?? [];
}

export function getObjectMethods(typeId: string): SsMethod[] {
    return objectTypeMap.get(typeId)?.methods ?? [];
}

export function getObjectProperties(typeId: string): SsObjectType['properties'] {
    return objectTypeMap.get(typeId)?.properties ?? [];
}

export function getContextTypeId(entryPointName: string): string | undefined {
    return entryPointContextMap.get(entryPointName);
}

export function getContextPropertyTypeId(entryPointName: string, propertyName: string): string | undefined {
    return contextPropertyTypes.get(entryPointName)?.get(propertyName);
}
