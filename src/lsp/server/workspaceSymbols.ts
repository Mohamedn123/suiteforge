import * as t from '@babel/types';
import * as path from 'path';
import { readdir } from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import { CancellationToken, Location, Position, Range, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createModuleResolver, DefinitionHost, documentKey, ModuleResolver, ModuleSource, propertyName, symbolAt } from './definitions';

const EXCLUDED = new Set(['node_modules', '.git', '.vscode', '.vscode-test', 'dist', 'out', 'coverage']);
const MAX_FILES = 3000;
const MAX_SYMBOLS = 100_000;

export class RefactorError extends Error {}

function checkCancelled(token?: CancellationToken): void {
    if (token?.isCancellationRequested) { throw new RefactorError('The workspace search was cancelled. No edits were applied.'); }
}

export async function workspaceDocuments(roots: string[], open: TextDocument[], host: DefinitionHost, token?: CancellationToken): Promise<TextDocument[]> {
    roots = roots.filter(root => root.startsWith('file:'));
    const found = new Map<string, TextDocument>();
    const visited = new Set<string>();
    async function visit(directory: string): Promise<void> {
        checkCancelled(token);
        if (visited.has(directory)) { return; }
        visited.add(directory);
        let entries;
        try { entries = await readdir(directory, { withFileTypes: true }); }
        catch { throw new RefactorError(`Could not read workspace folder ${directory}.`); }
        for (const entry of entries) {
            checkCancelled(token);
            if (entry.isSymbolicLink()) { continue; }
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory() && !EXCLUDED.has(entry.name)) { await visit(filename); }
            else if (entry.isFile() && /\.(?:[cm]?js|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
                const uri = pathToFileURL(filename).href;
                const doc = await host.readDocument(uri);
                if (!doc) { throw new RefactorError(`Could not read ${filename}.`); }
                found.set(documentKey(uri), doc);
                if (found.size > MAX_FILES) { throw new RefactorError(`Workspace search exceeds ${MAX_FILES} source files. Open a smaller project before refactoring.`); }
            }
        }
    }
    for (const root of roots) { if (root.startsWith('file:')) { await visit(fileURLToPath(root)); } }
    for (const doc of open) {
        if (doc.uri.startsWith('file:') && /\.(?:[cm]?js|ts)$/.test(fileURLToPath(doc.uri)) && roots.some(root => {
            const relative = path.relative(fileURLToPath(root), fileURLToPath(doc.uri));
            return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
        })) { found.set(documentKey(doc.uri), doc); }
    }
    if (found.size > MAX_FILES) { throw new RefactorError(`Workspace search exceeds ${MAX_FILES} source files.`); }
    return [...found.values()];
}

interface Occurrence {
    source: ModuleSource;
    node: t.Node;
    location: Location;
    target: Location;
    name: string;
    contextUri: string;
}

function sameLocation(a: Location, b: Location): boolean {
    return documentKey(a.uri) === documentKey(b.uri) && a.range.start.line === b.range.start.line
        && a.range.start.character === b.range.start.character;
}

function nameRange(source: ModuleSource, node: t.Node): Range {
    let end = node.end!;
    if (t.isIdentifier(node)) {
        end = node.typeAnnotation?.start ?? end;
        const text = source.document.getText();
        while (end > node.start! && /[\s?]/.test(text[end - 1])) { end--; }
    }
    return { start: source.document.positionAt(node.start! + (t.isStringLiteral(node) ? 1 : 0)),
        end: source.document.positionAt(end - (t.isStringLiteral(node) ? 1 : 0)) };
}

function candidate(source: ModuleSource, node: t.Node): boolean {
    if (t.isIdentifier(node)) { return true; }
    if (!t.isStringLiteral(node) || source.moduleStrings.has(node)) { return false; }
    const parent = source.paths.get(node)?.parent;
    return ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === node)
        || ((t.isObjectProperty(parent) || t.isObjectMethod(parent)) && parent.key === node);
}

function snapshotHost(docs: TextDocument[], fallback: DefinitionHost) {
    const map = new Map(docs.map(doc => [documentKey(doc.uri), doc]));
    const captured = new Map<string, TextDocument | undefined>(docs.map(doc => [doc.uri, doc]));
    return { captured, readDocument: async (uri: string): Promise<TextDocument | undefined> => {
        const existing = map.get(documentKey(uri));
        if (existing) { return existing; }
        if (!captured.has(uri)) { captured.set(uri, await fallback.readDocument(uri)); }
        return captured.get(uri);
    } };
}

async function occurrences(docs: TextDocument[], host: DefinitionHost, strict: boolean, token?: CancellationToken): Promise<Occurrence[]> {
    const results: Occurrence[] = [];
    const resolvers = new Map(docs.map(doc => [doc.uri, createModuleResolver(doc, host)]));
    const contexts = [...resolvers.values()].filter((resolver): resolver is ModuleResolver => !!resolver?.source.configPath);
    let count = 0;
    for (const doc of docs) {
        checkCancelled(token);
        const resolver = resolvers.get(doc.uri);
        if (!resolver) {
            if (strict) { throw new RefactorError(`Fix the syntax errors in ${fileURLToPath(doc.uri)} before renaming.`); }
            continue;
        }
        if (strict) {
            const exportNames = resolver.source.exports.map(value => JSON.stringify(value.members));
            if (new Set(exportNames).size !== exportNames.length) {
                throw new RefactorError(`Multiple or conditional definitions of an export in ${fileURLToPath(doc.uri)} make rename ambiguous.`);
            }
        }
        const seen = new Set<string>();
        for (const node of resolver.source.paths.keys()) {
            if (!candidate(resolver.source, node)) { continue; }
            if (++count > MAX_SYMBOLS) { throw new RefactorError('Workspace symbol search is too large. Open a smaller project before refactoring.'); }
            if (count % 100 === 0) { await new Promise<void>(resolve => setImmediate(resolve)); checkCancelled(token); }
            const possible: { target: Location; contextUri: string }[] = [];
            for (const context of resolver.source.configPath ? [resolver] : [resolver, ...contexts]) {
                const target = (await context.definitionOf(resolver.source, node))[0];
                if (target && !possible.some(value => sameLocation(value.target, target))) { possible.push({ target, contextUri: context.source.document.uri }); }
            }
            if (strict && possible.length > 1) { throw new RefactorError(`A module has different targets under multiple AMD configurations in ${fileURLToPath(doc.uri)}. Rename is ambiguous.`); }
            for (const { target, contextUri } of possible) {
                const range = nameRange(resolver.source, node);
                const key = JSON.stringify([range, target]);
                if (seen.has(key)) { continue; }
                seen.add(key);
                results.push({ source: resolver.source, node, location: Location.create(doc.uri, range), target, contextUri,
                    name: t.isIdentifier(node) ? node.name : (node as t.StringLiteral).value });
            }
        }
    }
    return results;
}

async function selectedSymbol(document: TextDocument, position: Position, host: DefinitionHost) {
    const resolver = createModuleResolver(document, host);
    const node = resolver && symbolAt(resolver.source, document.offsetAt(position));
    if (!resolver || !node || !candidate(resolver.source, node)) { return undefined; }
    const target = (await resolver.definitionOf(resolver.source, node))[0];
    if (!target) { return undefined; }
    return { resolver, node, target, name: t.isIdentifier(node) ? node.name : (node as t.StringLiteral).value };
}

export async function prepareSymbolRename(document: TextDocument, position: Position, host: DefinitionHost): Promise<{ range: Range; placeholder: string } | null> {
    const selected = await selectedSymbol(document, position, host);
    if (!selected || !t.isValidIdentifier(selected.name)) { return null; }
    return { range: nameRange(selected.resolver.source, selected.node), placeholder: selected.name };
}

export async function findSymbolReferences(document: TextDocument, position: Position, docs: TextDocument[], host: DefinitionHost, includeDeclaration: boolean, token?: CancellationToken): Promise<Location[]> {
    const frozen = snapshotHost(docs, host);
    const selected = await selectedSymbol(document, position, frozen);
    if (!selected) { return []; }
    const all = await occurrences(docs, frozen, false, token);
    return all.filter(item => sameLocation(item.target, selected.target)
        && (includeDeclaration || !sameLocation(item.location, selected.target))).map(item => item.location);
}

interface OffsetEdit { start: number; end: number; newText: string }

function offsetAfter(offset: number, edits: OffsetEdit[]): number {
    let change = 0;
    for (const edit of edits) {
        if (offset >= edit.end) { change += edit.newText.length - (edit.end - edit.start); }
        else if (offset >= edit.start) { return edit.start + change; }
    }
    return offset + change;
}

function applyEdits(doc: TextDocument, edits: OffsetEdit[]): TextDocument {
    let text = doc.getText();
    for (const edit of [...edits].reverse()) { text = text.slice(0, edit.start) + edit.newText + text.slice(edit.end); }
    return TextDocument.create(doc.uri, doc.languageId, doc.version, text);
}

function localAlias(resolver: ModuleResolver, node: t.Node) {
    if (!t.isIdentifier(node)) { return undefined; }
    const p = resolver.source.paths.get(node);
    if ((p?.parentPath?.isMemberExpression() || p?.parentPath?.isOptionalMemberExpression()) && p.parentPath.node.property === node && !p.parentPath.node.computed) { return undefined; }
    if (p?.parentPath?.isObjectMethod() && p.parentPath.node.key === node) { return undefined; }
    if (p?.parentPath?.isObjectProperty() && p.parentPath.node.key === node && !p.parentPath.node.shorthand) { return undefined; }
    const binding = p?.scope.getBinding(node.name);
    if (!binding) { return undefined; }
    const dependency = resolver.source.imports.get(binding.identifier);
    if (dependency) { return binding; }
    if (binding.path.isVariableDeclarator()) {
        const init = binding.path.node.init;
        if (init && (t.isMemberExpression(init) || t.isCallExpression(init) || t.isIdentifier(init))) { return binding; }
    }
    return undefined;
}

export async function renameSymbol(document: TextDocument, position: Position, newName: string, docs: TextDocument[], host: DefinitionHost, token?: CancellationToken): Promise<WorkspaceEdit> {
    if (!t.isValidIdentifier(newName) || ['arguments', 'eval'].includes(newName)) { throw new RefactorError('Use a valid JavaScript identifier that is not a reserved word.'); }
    const frozen = snapshotHost(docs, host);
    const currentDocument = docs.find(doc => documentKey(doc.uri) === documentKey(document.uri));
    if (!currentDocument || currentDocument.version !== document.version || currentDocument.getText() !== document.getText()) {
        throw new RefactorError('The source file changed while collecting the workspace. Please try again.');
    }
    const selected = await selectedSymbol(document, position, frozen);
    if (!selected) { throw new RefactorError('This symbol cannot be safely resolved for rename.'); }
    if (!docs.some(doc => documentKey(doc.uri) === documentKey(selected.target.uri))) { throw new RefactorError('The definition is outside the open workspace. Open its project before renaming.'); }
    if (newName === selected.name) { return { documentChanges: [] }; }
    const all = await occurrences(docs, frozen, true, token);
    const alias = localAlias(selected.resolver, selected.node);
    const aliasNodes = alias && new Set([alias.identifier.start, ...alias.referencePaths.map(p => p.node.start)]);
    const editsByUri = new Map<string, OffsetEdit[]>();
    const modified = all.filter(item => aliasNodes
        ? documentKey(item.location.uri) === documentKey(document.uri) && aliasNodes.has(item.node.start)
        : sameLocation(item.target, selected.target) && item.name === selected.name);
    if (!modified.length) { throw new RefactorError('No safe rename locations were found.'); }

    for (const item of modified) {
        const p = item.source.paths.get(item.node)!;
        const conflict = p.scope.getBinding(newName);
        if (conflict && conflict.identifier !== p.scope.getBinding(item.name)?.identifier) {
            throw new RefactorError(`Renaming to "${newName}" would conflict with an existing binding in ${fileURLToPath(item.location.uri)}.`);
        }
        const parent = p.parent;
        if (t.isObjectProperty(parent) || t.isObjectMethod(parent)) {
            const object = p.parentPath?.parent;
            if ((t.isObjectExpression(object) || t.isObjectPattern(object)) && object.properties.some(prop =>
                (t.isObjectProperty(prop) || t.isObjectMethod(prop)) && prop !== parent && propertyName(prop.key, prop.computed) === newName)) {
                throw new RefactorError(`The property "${newName}" already exists.`);
            }
        }
        if (item.source.exports.some(value => value.members[0] === newName)) { throw new RefactorError(`The export "${newName}" already exists.`); }
        let replacement = newName;
        if (alias && t.isObjectProperty(parent) && parent.shorthand) {
            replacement = `${item.name}: ${newName}`;
        } else if (alias && t.isImportSpecifier(parent) && parent.imported.start === parent.local.start) {
            replacement = `${item.name} as ${newName}`;
        }
        const doc = item.source.document;
        const key = documentKey(doc.uri);
        const edits = editsByUri.get(key) ?? [];
        const edit = { start: doc.offsetAt(item.location.range.start), end: doc.offsetAt(item.location.range.end), newText: replacement };
        if (!edits.some(existing => existing.start === edit.start)) { edits.push(edit); }
        editsByUri.set(key, edits);
    }

    // A dynamic access could hide another caller. Refuse an API rename when its
    // receiver resolves to the affected module instead of silently missing it.
    if (!alias) {
        for (const doc of docs) {
            const resolver = createModuleResolver(doc, frozen)!;
            for (const node of resolver.source.paths.keys()) {
                if ((t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) && node.computed && !t.isStringLiteral(node.property)) {
                    const target = (await resolver.resolve(resolver.source, node.object, [selected.name]))[0];
                    if (target && sameLocation(target, selected.target)) { throw new RefactorError('A dynamic property access may use this function. Replace it with a static member name before renaming.'); }
                }
            }
        }
    }
    for (const edits of editsByUri.values()) { edits.sort((a, b) => a.start - b.start); }
    const updated = docs.map(doc => applyEdits(doc, editsByUri.get(documentKey(doc.uri)) ?? []));
    const updatedMap = new Map(updated.map(doc => [documentKey(doc.uri), doc]));
    const afterHost = snapshotHost(updated, frozen);

    // Re-resolve every previously resolved symbol, including unrelated ones, so
    // capture, broken export aliases, and changed call targets reject the edit.
    const afterResolvers = new Map<string, ModuleResolver>();
    for (const doc of updated) {
        const resolver = createModuleResolver(doc, afterHost);
        if (!resolver) { throw new RefactorError('The proposed rename would produce invalid JavaScript.'); }
        afterResolvers.set(documentKey(doc.uri), resolver);
    }
    let checked = 0;
    for (const item of all) {
        if (++checked % 100 === 0) { await new Promise<void>(resolve => setImmediate(resolve)); checkCancelled(token); }
        const key = documentKey(item.location.uri);
        const resolver = afterResolvers.get(key)!;
        const edits = editsByUri.get(key) ?? [];
        let newOffset = offsetAfter(item.source.document.offsetAt(item.location.range.start), edits);
        const changed = edits.find(edit => edit.start === item.source.document.offsetAt(item.location.range.start));
        if (changed?.newText.includes(': ')) { newOffset += changed.newText.indexOf(': ') + 2; }
        if (changed?.newText.includes(' as ')) { newOffset += changed.newText.indexOf(' as ') + 4; }
        const node = symbolAt(resolver.source, newOffset);
        const context = afterResolvers.get(documentKey(item.contextUri)) ?? resolver;
        const target = node && (await context.definitionOf(resolver.source, node))[0];
        const oldTargetDoc = docs.find(doc => documentKey(doc.uri) === documentKey(item.target.uri));
        const newTargetDoc = updatedMap.get(documentKey(item.target.uri));
        let expected = item.target;
        if (oldTargetDoc && newTargetDoc) {
            const offset = offsetAfter(oldTargetDoc.offsetAt(item.target.range.start), editsByUri.get(documentKey(oldTargetDoc.uri)) ?? []);
            expected = Location.create(newTargetDoc.uri, { start: newTargetDoc.positionAt(offset), end: newTargetDoc.positionAt(offset) });
        }
        if (!target || !sameLocation(target, expected)) { throw new RefactorError('This rename would change or lose a symbol binding. Use an explicit alias or a different name.'); }
    }
    checkCancelled(token);
    // Guard against concurrent typing or external saves while the search ran.
    for (const [uri, doc] of frozen.captured) {
        const current = await host.readDocument(uri);
        if (current?.version !== doc?.version || current?.getText() !== doc?.getText()) { throw new RefactorError('A source file changed during rename. Please try again.'); }
    }
    return {
        documentChanges: docs.filter(doc => editsByUri.has(documentKey(doc.uri))).map(doc => TextDocumentEdit.create(
            { uri: doc.uri, version: doc.version === 0 ? null : doc.version },
            editsByUri.get(documentKey(doc.uri))!.map(edit => ({ ...TextEdit.replace({ start: doc.positionAt(edit.start), end: doc.positionAt(edit.end) }, edit.newText), annotationId: 'suiteforge.rename' })),
        )),
        changeAnnotations: { 'suiteforge.rename': { label: `Rename ${selected.name} to ${newName}`, needsConfirmation: true,
            description: 'Review the changes to definitions, exports and callers before applying.' } },
    };
}
