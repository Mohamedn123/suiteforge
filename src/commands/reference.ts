import * as vscode from 'vscode';
import { sdfFieldTypes, sdfScriptTypes, sdfRecordTypes } from '../data';
import type { SdfFieldType, SdfScriptType, SdfRecordType } from '../data';

// We extend QuickPickItem to carry the original data object alongside the display fields.
// This is a common VS Code extension pattern: show something to the user, but keep the
// raw data object attached so you can act on it after selection.

interface FieldTypeItem extends vscode.QuickPickItem { data: SdfFieldType; }
interface ScriptTypeItem extends vscode.QuickPickItem { data: SdfScriptType; }
interface RecordTypeItem extends vscode.QuickPickItem { data: SdfRecordType; }

type Category = 'fieldTypes' | 'scriptTypes' | 'recordTypes';
interface CategoryItem extends vscode.QuickPickItem { value: Category; }

export function registerReferenceCommands(context: vscode.ExtensionContext): void {
    const cmd = vscode.commands.registerCommand('suiteforge.browseReference', browseReference);
    context.subscriptions.push(cmd);
}

async function browseReference(): Promise<void> {
    const categories: CategoryItem[] = [
        {
            label: '$(symbol-field) Field Types',
            description: `${sdfFieldTypes.length} types`,
            detail: 'Custom record field type options — TEXT, SELECT, CHECKBOX, CURRENCY, and more',
            value: 'fieldTypes',
        },
        {
            label: '$(file-code) Script Types',
            description: `${sdfScriptTypes.length} types`,
            detail: 'All SuiteScript script types with their entry points documented',
            value: 'scriptTypes',
        },
        {
            label: '$(database) Record Types',
            description: `${sdfRecordTypes.length} types`,
            detail: 'Standard NetSuite record types with their SuiteScript IDs',
            value: 'recordTypes',
        },
    ];

    const selected = await vscode.window.showQuickPick<CategoryItem>(categories, {
        title: 'SuiteForge — SDF Reference',
        placeHolder: 'Select a category to browse',
        matchOnDescription: true,
        matchOnDetail: true,
    });

    if (!selected) { return; }

    const handlers: Record<Category, () => Promise<void>> = {
        fieldTypes: browseFieldTypes,
        scriptTypes: browseScriptTypes,
        recordTypes: browseRecordTypes,
    };
    await handlers[selected.value]();
}

async function browseFieldTypes(): Promise<void> {
    const items: FieldTypeItem[] = sdfFieldTypes.map(ft => ({
        label: `$(symbol-field) ${ft.id}`,
        description: ft.label,
        detail: ft.description,
        data: ft,
    }));

    const selected = await vscode.window.showQuickPick<FieldTypeItem>(items, {
        title: 'SuiteForge — Field Types',
        placeHolder: 'Search field types...',
        matchOnDescription: true,
        matchOnDetail: true,
    });

    if (!selected) { return; }

    const action = await vscode.window.showInformationMessage(
        `$(symbol-field) ${selected.data.id}  ·  ${selected.data.label}\n\n${selected.data.description}`,
        'Copy XML Value',
        'Back',
    );

    if (action === 'Copy XML Value') {
        await vscode.env.clipboard.writeText(selected.data.xmlValue);
        vscode.window.showInformationMessage(`Copied "${selected.data.xmlValue}" to clipboard.`);
    } else if (action === 'Back') {
        await browseReference();
    }
}

async function browseScriptTypes(): Promise<void> {
    const items: ScriptTypeItem[] = sdfScriptTypes.map(st => ({
        label: `$(file-code) ${st.label}`,
        description: `@NScriptType ${st.scriptTypeAnnotation}`,
        detail: st.description,
        data: st,
    }));

    const selected = await vscode.window.showQuickPick<ScriptTypeItem>(items, {
        title: 'SuiteForge — Script Types',
        placeHolder: 'Search script types...',
        matchOnDescription: true,
        matchOnDetail: true,
    });

    if (!selected) { return; }

    // Build a readable summary of all entry points for this script type
    const entryPointsSummary = selected.data.entryPoints
        .map(ep => `• ${ep.id}`)
        .join('  ');

    const action = await vscode.window.showInformationMessage(
        `$(file-code) ${selected.data.label}\n\nEntry Points: ${entryPointsSummary}`,
        'Browse Entry Points',
        'Copy @NScriptType',
        'Back',
    );

    if (action === 'Browse Entry Points') {
        await browseEntryPoints(selected.data);
    } else if (action === 'Copy @NScriptType') {
        await vscode.env.clipboard.writeText(selected.data.scriptTypeAnnotation);
        vscode.window.showInformationMessage(`Copied "${selected.data.scriptTypeAnnotation}" to clipboard.`);
    } else if (action === 'Back') {
        await browseReference();
    }
}

async function browseEntryPoints(scriptType: SdfScriptType): Promise<void> {
    const items = scriptType.entryPoints.map(ep => ({
        label: `$(symbol-method) ${ep.id}`,
        detail: ep.description,
        data: ep,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        title: `SuiteForge — ${scriptType.label} Entry Points`,
        placeHolder: 'Select an entry point to see details',
        matchOnDetail: true,
    });

    if (!selected) { return; }

    const action = await vscode.window.showInformationMessage(
        `$(symbol-method) ${selected.data.id}\n\n${selected.data.description}`,
        'Copy Function Name',
        'Back',
    );

    if (action === 'Copy Function Name') {
        await vscode.env.clipboard.writeText(selected.data.id);
        vscode.window.showInformationMessage(`Copied "${selected.data.id}" to clipboard.`);
    } else if (action === 'Back') {
        await browseScriptTypes();
    }
}

async function browseRecordTypes(): Promise<void> {
    const items: RecordTypeItem[] = sdfRecordTypes.map(rt => ({
        label: `$(database) ${rt.label}`,
        description: rt.scriptId,
        detail: rt.description,
        data: rt,
    }));

    const selected = await vscode.window.showQuickPick<RecordTypeItem>(items, {
        title: 'SuiteForge — Record Types',
        placeHolder: 'Search record types...',
        matchOnDescription: true,
        matchOnDetail: true,
    });

    if (!selected) { return; }

    const action = await vscode.window.showInformationMessage(
        `$(database) ${selected.data.label}\n\nScript ID: ${selected.data.scriptId}\n\n${selected.data.description}`,
        'Copy Script ID',
        'Back',
    );

    if (action === 'Copy Script ID') {
        await vscode.env.clipboard.writeText(selected.data.scriptId);
        vscode.window.showInformationMessage(`Copied "${selected.data.scriptId}" to clipboard.`);
    } else if (action === 'Back') {
        await browseReference();
    }
}
