import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SDF_OBJECTS, SDF_CATEGORY_META, type SdfCategory, type SdfObjectDef } from './sdfObjectRegistry';
import { resolveTargetFolder, writeAndOpen, validateScriptId } from './utils';

export function registerSdfObjectCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
    return SDF_CATEGORY_META.map(cat =>
        vscode.commands.registerCommand(cat.command, (uri?: vscode.Uri) =>
            pickAndGenerate(context, cat.id, uri),
        ),
    );
}

async function pickAndGenerate(
    context: vscode.ExtensionContext,
    category: SdfCategory,
    folderUri?: vscode.Uri,
): Promise<void> {
    const targetFolder = await resolveTargetFolder(folderUri);
    if (!targetFolder) { return; }

    const types = SDF_OBJECTS.filter(o => o.category === category);

    interface ObjItem extends vscode.QuickPickItem { def: SdfObjectDef }

    const items: ObjItem[] = types.map(def => ({
        label: `$(file-code) ${def.label}`,
        description: def.prefix,
        detail: def.description,
        def,
    }));

    const picked = await vscode.window.showQuickPick(items, {
        title: 'SuiteForge — Select Object Type',
        placeHolder: 'Choose an SDF object type to create',
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked) { return; }

    const def = picked.def;

    const id = await vscode.window.showInputBox({
        title: `SuiteForge — New ${def.label}`,
        prompt: `Enter the ID (the "${def.prefix}" prefix is added automatically)`,
        placeHolder: 'e.g.  my_custom_id',
        validateInput: validateScriptId,
    });
    if (id === undefined) { return; }

    const scriptId = `${def.prefix}${id}`;
    const template = loadTemplate(context, def.type);
    const content = template.replace(/\{\{SCRIPTID\}\}/g, scriptId);
    const fileName = `${def.type === 'customrecordtype' ? 'customrecordtype' : def.rootTag}_${id}.xml`;

    await writeAndOpen(targetFolder, fileName, content);
    vscode.window.showInformationMessage(`SuiteForge: Created ${fileName}`);
}

function loadTemplate(context: vscode.ExtensionContext, type: string): string {
    const templatePath = path.join(context.extensionPath, 'templates', 'sdf', `${type}.xml`);
    try {
        return fs.readFileSync(templatePath, 'utf-8');
    } catch {
        const def = SDF_OBJECTS.find(o => o.type === type);
        if (!def) { return ''; }
        return `<${def.rootTag} scriptid="{{SCRIPTID}}">\n</${def.rootTag}>\n`;
    }
}
