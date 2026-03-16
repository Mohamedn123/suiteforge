import * as vscode from 'vscode';
import { sdfFieldTypes } from '../data';
import sdfEnums from '../data/sdf/sdfEnums.json';
import { getEnclosingTagName } from './xmlUtils';

// ---------------------------------------------------------------------------
// Pre-built completion item lists
// ---------------------------------------------------------------------------

const FIELD_TYPE_ITEMS: vscode.CompletionItem[] = sdfFieldTypes.map(ft => {
    const item = new vscode.CompletionItem(ft.id, vscode.CompletionItemKind.EnumMember);
    item.detail = ft.label;
    item.documentation = new vscode.MarkdownString(
        `**${ft.id}** — ${ft.label}\n\n${ft.description}`,
    );
    item.insertText = ft.xmlValue;
    return item;
});

const BOOLEAN_ITEMS: vscode.CompletionItem[] = [
    buildBooleanItem('T', 'True', 'Set this flag to **true**.'),
    buildBooleanItem('F', 'False', 'Set this flag to **false**.'),
];

const HIERARCHY_TYPE_ITEMS = buildEnumItems(
    [{ value: 'FLAT', label: 'Flat list', description: 'No parent-child relationship.' },
     { value: 'TREE', label: 'Hierarchical tree', description: 'Records can have a parent.' }],
);

// Build completion items from sdfEnums.json
const ACCESS_TYPE_ITEMS = buildEnumItems(sdfEnums.accesstype);
const DISPLAY_TYPE_ITEMS = buildEnumItems(sdfEnums.displaytype);
const DEPLOY_STATUS_ITEMS = buildEnumItems(sdfEnums.scriptdeploymentstatus);
const LOG_LEVEL_ITEMS = buildEnumItems(sdfEnums.loglevel);
const PORTLET_TYPE_ITEMS = buildEnumItems(sdfEnums.portlettype);
const RETURN_TYPE_ITEMS = buildEnumItems(sdfEnums.returntype);
const ALL_ROLES_ITEMS = buildEnumItems(sdfEnums.audienceallroles);

// ---------------------------------------------------------------------------
// Tag name → completion list mapping
// ---------------------------------------------------------------------------

const TAG_COMPLETIONS = new Map<string, vscode.CompletionItem[]>();

// Field types
for (const tag of ['fieldtype']) {
    TAG_COMPLETIONS.set(tag, FIELD_TYPE_ITEMS);
}

// Boolean flags — comprehensive list of all T/F elements in SDF XML
for (const tag of [
    'isinactive', 'ismandatory', 'isordered', 'showid',
    'allowattachments', 'allowinlineediting', 'allowpdfprinting',
    'allowquickadd', 'allowquicksearch', 'allowuiaccess',
    'islocked', 'isparent', 'showdisplayentry', 'istranslatable',
    'isformula', 'defaultchecked', 'isonline', 'ispublic',
    'enablemailmerge', 'enablesourcing', 'hashtml',
    'showhierarchy', 'allowemptysource', 'checkspelling',
    'istext', 'isrecordtype', 'alllocalizationcontexts',
    'allrecords', 'allroles', 'isimportant', 'displayheight',
    'displaywidth', 'issortable', 'allowhyperlinks',
    'storevalue', 'showinnewsearchcolumn', 'showinnewlistcolumn',
]) {
    TAG_COMPLETIONS.set(tag, BOOLEAN_ITEMS);
}

TAG_COMPLETIONS.set('hierarchytype', HIERARCHY_TYPE_ITEMS);
TAG_COMPLETIONS.set('accesstype', ACCESS_TYPE_ITEMS);
TAG_COMPLETIONS.set('displaytype', DISPLAY_TYPE_ITEMS);
TAG_COMPLETIONS.set('status', DEPLOY_STATUS_ITEMS);
TAG_COMPLETIONS.set('loglevel', LOG_LEVEL_ITEMS);
TAG_COMPLETIONS.set('portlettype', PORTLET_TYPE_ITEMS);
TAG_COMPLETIONS.set('returntype', RETURN_TYPE_ITEMS);
TAG_COMPLETIONS.set('allroles', ALL_ROLES_ITEMS);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class SdfCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.CompletionItem[] | undefined {
        const tag = getEnclosingTagName(document, position);
        if (!tag) { return undefined; }
        return TAG_COMPLETIONS.get(tag);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildBooleanItem(
    value: 'T' | 'F',
    label: string,
    description: string,
): vscode.CompletionItem {
    const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
    item.detail = label;
    item.documentation = new vscode.MarkdownString(description);
    return item;
}

function buildEnumItems(
    entries: { value: string; label: string; description: string }[],
): vscode.CompletionItem[] {
    return entries.map(e => {
        const item = new vscode.CompletionItem(e.value, vscode.CompletionItemKind.EnumMember);
        item.detail = e.label;
        item.documentation = new vscode.MarkdownString(e.description);
        return item;
    });
}
