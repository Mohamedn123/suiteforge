import * as vscode from 'vscode';
import { sdfFieldTypes } from '../data';
import sdfEnums from '../data/sdf/sdfEnums.json';
import { getEnclosingTagName } from './xmlUtils';

// Build O(1) lookup maps for all enum types
const fieldTypeMap = new Map(sdfFieldTypes.map(ft => [ft.id.toUpperCase(), ft]));

type EnumEntry = { value: string; label: string; description: string };
type EnumLookup = Map<string, EnumEntry>;

function buildLookup(entries: EnumEntry[]): EnumLookup {
    return new Map(entries.map(e => [e.value.toUpperCase(), e]));
}

const accessLookup = buildLookup(sdfEnums.accesstype);
const displayLookup = buildLookup(sdfEnums.displaytype);
const deployStatusLookup = buildLookup(sdfEnums.scriptdeploymentstatus);
const logLevelLookup = buildLookup(sdfEnums.loglevel);
const portletTypeLookup = buildLookup(sdfEnums.portlettype);
const returnTypeLookup = buildLookup(sdfEnums.returntype);
const hierarchyLookup = buildLookup([
    { value: 'FLAT', label: 'Flat list', description: 'No parent-child relationship.' },
    { value: 'TREE', label: 'Hierarchical tree', description: 'Records form a parent-child tree.' },
]);

const TAG_LOOKUP = new Map<string, EnumLookup>([
    ['accesstype', accessLookup],
    ['displaytype', displayLookup],
    ['status', deployStatusLookup],
    ['loglevel', logLevelLookup],
    ['portlettype', portletTypeLookup],
    ['returntype', returnTypeLookup],
    ['hierarchytype', hierarchyLookup],
]);

export class SdfHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.Hover | undefined {
        const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
        if (!wordRange) { return undefined; }

        const word = document.getText(wordRange).toUpperCase();
        const tag = getEnclosingTagName(document, position);
        if (!tag) { return undefined; }

        // Field type hover
        if (tag === 'fieldtype') {
            const ft = fieldTypeMap.get(word);
            if (ft) {
                const md = new vscode.MarkdownString();
                md.appendMarkdown(`### \`${ft.id}\` — ${ft.label}\n\n${ft.description}`);
                md.appendMarkdown(`\n\n*SDF XML value:* \`${ft.xmlValue}\``);
                return new vscode.Hover(md, wordRange);
            }
        }

        // Generic enum hover (access type, display type, deploy status, etc.)
        const lookup = TAG_LOOKUP.get(tag);
        if (lookup) {
            const entry = lookup.get(word);
            if (entry) {
                const md = new vscode.MarkdownString();
                md.appendMarkdown(`### \`${entry.value}\` — ${entry.label}\n\n${entry.description}`);
                return new vscode.Hover(md, wordRange);
            }
        }

        // Boolean flag hover
        if (word === 'T' || word === 'F') {
            const boolValue = word === 'T';
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`\`${word}\` — **${boolValue ? 'True' : 'False'}**`);
            md.appendMarkdown(`\n\nValue for \`<${tag}>\` flag.`);
            return new vscode.Hover(md, wordRange);
        }

        return undefined;
    }
}
