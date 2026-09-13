import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';
import { CompletionItem, CompletionItemKind, Hover, MarkupKind, Position, SignatureHelp } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createModuleResolver, DefinitionHost, ModuleResolver, ModuleSource, symbolAt } from './definitions';

interface FunctionInfo { parameters: { label: string; documentation?: string }[]; returns?: string; documentation: string }

export function functionInfo(source: ModuleSource, node: t.Node): FunctionInfo | undefined {
    let p = source.paths.get(node);
    if (t.isIdentifier(node)) {
        const binding = p?.scope.getBinding(node.name);
        if (binding?.path.isFunctionDeclaration()) { p = binding.path; }
        else if (binding?.path.isVariableDeclarator()) { p = binding.path.get('init') as typeof p; }
        else if (p?.parentPath?.isFunction()) { p = p.parentPath; }
    }
    if (p?.parentPath?.isObjectMethod()) { p = p.parentPath; }
    if (!p?.isFunction()) { return undefined; }
    const fn = p.node;
    let comment: string | undefined;
    for (let current: NodePath | null = p, depth = 0; current && depth < 3; current = current.parentPath, depth++) {
        comment = current.node.leadingComments?.find(c => c.type === 'CommentBlock' && c.value.startsWith('*'))?.value;
        if (comment) { break; }
    }
    const documentation = (comment ?? '').replace(/^\*/, '').split(/\r?\n/).map(line => line.replace(/^\s*\* ?/, '').trimEnd()).join('\n').trim();
    const parameters = fn.params.map(param => {
        const raw = source.document.getText().slice(param.start!, param.end!);
        const name = t.isIdentifier(param) ? param.name : t.isAssignmentPattern(param) && t.isIdentifier(param.left) ? param.left.name
            : t.isRestElement(param) && t.isIdentifier(param.argument) ? param.argument.name : raw;
        const tags = [...documentation.matchAll(/@param\s+(?:\{([^}]+)\}\s*)?(\[[^\]]+\]|[\w$]+)([^\n]*)/g)];
        const tag = tags.find(match => match[2].replace(/^\[|\]$/g, '').split('=')[0] === name);
        return { label: tag?.[1] && !(t.isIdentifier(param) && param.typeAnnotation) ? `${raw}: ${tag[1]}` : raw, documentation: tag?.[3]?.trim().replace(/^-\s*/, '') };
    });
    return { parameters, documentation, returns: /@returns?\s+\{([^}]+)\}/.exec(documentation)?.[1] };
}

function label(name: string, info: FunctionInfo): string {
    return `${name}(${info.parameters.map(param => param.label).join(', ')})${info.returns ? `: ${info.returns}` : ''}`;
}

async function resolvedInfo(resolver: ModuleResolver, node: t.Node, members: string[] = []): Promise<FunctionInfo | undefined> {
    const locations = await resolver.resolve(resolver.source, node, members);
    const target = locations[0] && await resolver.nodeAtLocation(locations[0]);
    return target ? functionInfo(target.source, target.node) : undefined;
}

export async function getCustomCompletions(document: TextDocument, position: Position, host: DefinitionHost): Promise<CompletionItem[]> {
    const offset = document.offsetAt(position);
    const text = document.getText();
    const match = /(?:\?\.|\.)([\w$]*)$/.exec(text.slice(0, offset));
    if (!match) { return []; }
    const start = offset - match[1].length;
    let end = offset;
    while (/[\w$]/.test(text[end] ?? '') && end < text.length) { end++; }
    const marker = '__suiteforge_completion__';
    const patched = TextDocument.create(document.uri, document.languageId, document.version, text.slice(0, start) + marker + text.slice(end));
    const resolver = createModuleResolver(patched, host);
    if (!resolver) { return []; }
    const member = [...resolver.source.paths.keys()].find(node =>
        (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) && node.property.start === start);
    if (!t.isMemberExpression(member) && !t.isOptionalMemberExpression(member)) { return []; }
    const names = await resolver.membersOf(resolver.source, member.object);
    const items: CompletionItem[] = [];
    for (const name of names) {
        if (!name.startsWith(match[1]) || !t.isValidIdentifier(name, false)) { continue; }
        const info = await resolvedInfo(resolver, member.object, [name]);
        items.push({ label: name, kind: info ? CompletionItemKind.Function : CompletionItemKind.Property,
            detail: info ? label(name, info) : 'Custom module export',
            documentation: info?.documentation ? { kind: MarkupKind.Markdown, value: info.documentation } : undefined,
            textEdit: { range: { start: document.positionAt(start), end: document.positionAt(end) }, newText: name },
        });
    }
    return items;
}

export async function getCustomHover(document: TextDocument, position: Position, host: DefinitionHost): Promise<Hover | null> {
    const resolver = createModuleResolver(document, host);
    if (!resolver) { return null; }
    const node = symbolAt(resolver.source, document.offsetAt(position));
    if (!node) { return null; }
    const locations = await resolver.definitionOf(resolver.source, node);
    const target = locations[0] && await resolver.nodeAtLocation(locations[0]);
    const info = target && functionInfo(target.source, target.node);
    if (!info) { return null; }
    const name = t.isIdentifier(node) ? node.name : t.isStringLiteral(node) ? node.value : 'function';
    return { contents: { kind: MarkupKind.Markdown, value: `\`\`\`javascript\n${label(name, info)}\n\`\`\`${info.documentation ? `\n\n${info.documentation}` : ''}` },
        range: { start: document.positionAt(node.start!), end: document.positionAt(node.end!) } };
}

export async function getCustomSignature(document: TextDocument, position: Position, host: DefinitionHost): Promise<SignatureHelp | null> {
    const text = document.getText();
    const offset = document.offsetAt(position);
    // Supply only a missing argument/closing parenthesis at the cursor while
    // the user types. The original document is never edited.
    for (const insertion of ['', ')', 'undefined)', 'undefined']) {
        const patched = TextDocument.create(document.uri, document.languageId, document.version, text.slice(0, offset) + insertion + text.slice(offset));
        const resolver = createModuleResolver(patched, host);
        if (!resolver) { continue; }
        const calls = [...resolver.source.paths.keys()].filter((node): node is t.CallExpression | t.OptionalCallExpression =>
            (t.isCallExpression(node) || t.isOptionalCallExpression(node)) && node.callee.end! < offset && node.end! >= offset);
        calls.sort((a, b) => b.start! - a.start!);
        const call = calls[0];
        if (!call) { continue; }
        const info = await resolvedInfo(resolver, call.callee);
        if (!info) { return null; }
        const callee = call.callee;
        const name = t.isIdentifier(callee) ? callee.name
            : (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) && t.isIdentifier(callee.property) ? callee.property.name : 'function';
        const active = call.arguments.filter(arg => arg && arg.end! < offset && /^\s*,/.test(text.slice(arg.end!, offset))).length;
        return { signatures: [{ label: label(name, info), parameters: info.parameters,
            documentation: { kind: MarkupKind.Markdown, value: info.documentation } }],
            activeSignature: 0, activeParameter: Math.min(active, Math.max(0, info.parameters.length - 1)) };
    }
    return null;
}
