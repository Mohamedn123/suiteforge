import * as vscode from 'vscode';
import { sdfScriptTypes } from '../data';
import type { SdfScriptType } from '../data';
import { resolveTargetFolder, writeAndOpen, validateScriptId } from './utils';

interface ScriptTypeItem extends vscode.QuickPickItem { data: SdfScriptType; }

const COMMON_MODULES = [
    { label: 'N/record', description: 'Work with NetSuite records' },
    { label: 'N/search', description: 'Work with saved searches' },
    { label: 'N/log', description: 'Log messages' },
    { label: 'N/runtime', description: 'Access runtime context' },
    { label: 'N/query', description: 'SuiteQL queries' },
    { label: 'N/https', description: 'Make outbound HTTPS requests' },
    { label: 'N/format', description: 'Format and parse data' },
    { label: 'N/currentRecord', description: 'Access current record (Client only)' },
];

export async function generateScript(folderUri?: vscode.Uri): Promise<void> {
    const targetFolder = await resolveTargetFolder(folderUri);
    if (!targetFolder) { return; }

    // Step 1: pick a script type from our data layer
    const items: ScriptTypeItem[] = sdfScriptTypes.map(st => ({
        label: `$(file-code) ${st.label}`,
        description: `@NScriptType ${st.scriptTypeAnnotation}`,
        detail: st.description,
        data: st,
    }));

    const selectedType = await vscode.window.showQuickPick<ScriptTypeItem>(items, {
        title: 'SuiteForge — New Script (1/3)',
        placeHolder: 'Select a script type',
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!selectedType) { return; }

    // Step 2: ask for the script ID
    const id = await vscode.window.showInputBox({
        title: `SuiteForge — New ${selectedType.data.label} (2/3)`,
        prompt: 'Enter the script ID  (the "customscript_" prefix will be added automatically)',
        placeHolder: 'e.g.  my_client_script',
        validateInput: validateScriptId,
    });
    if (id === undefined) { return; }

    // Step 3: ask for common modules
    const selectedModules = await vscode.window.showQuickPick(COMMON_MODULES, {
        title: `SuiteForge — Select Modules (3/3)`,
        placeHolder: 'Select modules to include (optional)',
        canPickMany: true,
    });
    // selectedModules could be undefined if cancelled, but let's treat as [] if they just press Enter without selecting? No, if undefined they hit escape.
    if (selectedModules === undefined) { return; }

    const moduleNames = selectedModules.map(m => m.label);

    const fileName = `${id}.js`;
    await writeAndOpen(targetFolder, fileName, buildScriptContent(selectedType.data, id, moduleNames));
    vscode.window.showInformationMessage(`SuiteForge: Created ${fileName}  (${selectedType.data.label})`);
}

// JS reserved words that cannot be used as variable names.
// When an entry point name collides, we prefix it with '_' for the variable
// and use the original name as the property key in the return object.
const JS_RESERVED = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
    'for', 'function', 'if', 'import', 'in', 'instanceof', 'new',
    'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof',
    'var', 'void', 'while', 'with', 'yield',
]);

function safeVarName(name: string): string {
    return JS_RESERVED.has(name) ? `_${name}` : name;
}

function buildScriptContent(scriptType: SdfScriptType, scriptId: string, modules: string[]): string {
    const booleanReturns = new Set([
        'validateField', 'validateLine', 'validateInsert', 'validateDelete', 'saveRecord',
    ]);

    const dataReturns: Record<string, string> = {
        getInputData: '        return [];',
        get:          '        return {};',
        post:         '        return {};',
        put:          '        return {};',
        delete:       '        return {};',
    };

    const functions = scriptType.entryPoints.map(ep => {
        const varName = safeVarName(ep.id);
        let body = '';
        if (booleanReturns.has(ep.id)) {
            body = '\n        return true;';
        } else if (dataReturns[ep.id]) {
            body = `\n${dataReturns[ep.id]}`;
        }
        return [
            `    /**`,
            `     * ${ep.description}`,
            `     * @param {Object} context`,
            `     */`,
            `    const ${varName} = (context) => {${body}`,
            `    };`,
        ].join('\n');
    });

    // In the return object, map reserved-word entry points explicitly:
    //   delete: _delete     (reserved — needs explicit key: value)
    //   get                 (not reserved — shorthand is fine)
    const returnObject = scriptType.entryPoints
        .map(ep => {
            const varName = safeVarName(ep.id);
            return varName !== ep.id
                ? `        ${ep.id}: ${varName}`
                : `        ${ep.id}`;
        })
        .join(',\n');

    const moduleArrayString = modules.length > 0 
        ? `[${modules.map(m => `'${m}'`).join(', ')}]` 
        : `[]`;
    
    const moduleParamString = modules.length > 0 
        ? `(${modules.map(m => m.split('/')[1]).join(', ')})` 
        : `()`;

    return [
        `/**`,
        ` * @NApiVersion 2.1`,
        ` * @NScriptType ${scriptType.scriptTypeAnnotation}`,
        ` *`,
        ` * Script Object ID: customscript_${scriptId}`,
        ` */`,
        `define(${moduleArrayString}, ${moduleParamString} => {`,
        ``,
        functions.join('\n\n'),
        ``,
        `    return {`,
        returnObject,
        `    };`,
        `});`,
        ``,
    ].join('\n');
}
