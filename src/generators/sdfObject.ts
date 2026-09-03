import * as vscode from 'vscode';
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
        validateInput: value => value.startsWith(def.prefix)
            ? `Enter only the ID portion after "${def.prefix}".`
            : validateScriptId(value),
    });
    if (id === undefined) { return; }

    const scriptId = `${def.prefix}${id}`;
    const template = await loadTemplate(context, def.type);
    const content = template.replace(/\{\{SCRIPTID\}\}/g, scriptId);
    // Oracle SDF convention: object files are named after their full script ID
    // (e.g. customrecordtype_my_record.xml, custentity_my_field.xml).
    const fileName = `${scriptId}.xml`;

    const created = await writeAndOpen(targetFolder, fileName, content);
    if (created) {
        vscode.window.showInformationMessage(`SuiteForge: Created ${fileName}`);
    }
}

async function loadTemplate(context: vscode.ExtensionContext, type: string): Promise<string> {
    // Use the workspace file system API (not Node's fs) so this also works in
    // remote workspaces (SSH, Dev Containers, WSL, etc.).
    const templateUri = vscode.Uri.joinPath(context.extensionUri, 'templates', 'sdf', `${type}.xml`);
    try {
        const bytes = await vscode.workspace.fs.readFile(templateUri);
        return new TextDecoder('utf-8').decode(bytes);
    } catch {
        const def = SDF_OBJECTS.find(o => o.type === type);
        if (!def) { return ''; }
        return `<${def.rootTag} scriptid="{{SCRIPTID}}">\n</${def.rootTag}>\n`;
    }
}
