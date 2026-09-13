import { parse } from '@babel/parser';
import babelTraverseImport, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import * as path from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import { Location, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

const traverse = (babelTraverseImport as typeof babelTraverseImport & { default?: typeof babelTraverseImport }).default
    ?? babelTraverseImport;

interface ImportedBinding { module: string; members: string[] }
interface ExportedValue { members: string[]; node: t.Node }
export interface ModuleSource {
    document: TextDocument;
    paths: Map<t.Node, NodePath>;
    imports: Map<t.Identifier, ImportedBinding>;
    exports: ExportedValue[];
    moduleStrings: Set<t.StringLiteral>;
    configPath?: string;
}
type Source = ModuleSource;

export interface DefinitionHost {
    /** Return open buffers before reading disk, including unsaved edits. */
    readDocument(uri: string): Promise<TextDocument | undefined>;
}

export function documentKey(uri: string): string {
    if (!uri.startsWith('file:')) { return uri; }
    const filename = path.normalize(fileURLToPath(uri));
    return process.platform === 'win32' ? filename.toLowerCase() : filename;
}

export function createDefinitionHost(getOpenDocuments: () => TextDocument[]): DefinitionHost {
    return {
        async readDocument(uri) {
            const key = documentKey(uri);
            const open = getOpenDocuments().find(document => documentKey(document.uri) === key);
            if (open) { return open; }
            try {
                if (!uri.startsWith('file:')) { return undefined; }
                const text = await readFile(fileURLToPath(uri), 'utf8');
                return TextDocument.create(uri, 'javascript', 0, text);
            } catch { return undefined; }
        },
    };
}

export function propertyName(node: t.Node, computed = false): string | undefined {
    if (t.isIdentifier(node) && !computed) { return node.name; }
    if (t.isStringLiteral(node)) { return node.value; }
    return undefined;
}

function isLoaderReference(source: Source, p: NodePath, name: string): boolean {
    const binding = p.scope.getBinding(name);
    return !binding || (binding.constant && name === 'require' && source.imports.get(binding.identifier)?.module === 'require');
}

function amdParts(node: t.CallExpression): { dependencies?: t.ArrayExpression; factory: t.FunctionExpression | t.ArrowFunctionExpression } | undefined {
    if (!t.isIdentifier(node.callee) || !['define', 'require'].includes(node.callee.name)) { return undefined; }
    const args = t.isStringLiteral(node.arguments[0]) ? node.arguments.slice(1) : node.arguments;
    const factory = args[args.length - 1];
    if (!t.isFunctionExpression(factory) && !t.isArrowFunctionExpression(factory)) { return undefined; }
    return { dependencies: t.isArrayExpression(args[0]) ? args[0] : undefined, factory };
}

export function parseSource(document: TextDocument): Source | undefined {
    try {
        const ast = parse(document.getText(), { sourceType: 'unambiguous', plugins: ['typescript'], errorRecovery: true });
        if (ast.errors?.length) { return undefined; }
        const source: Source = { document, paths: new Map(), imports: new Map(), exports: [], moduleStrings: new Set() };
        source.configPath = ast.comments?.map(comment => /@NAmdConfig\s+([^\s*]+)/.exec(comment.value)?.[1]).find(Boolean);
        traverse(ast, { enter(p) { source.paths.set(p.node, p); } });
        for (const [node, p] of source.paths) {
            if (t.isCallExpression(node)) {
                const amd = amdParts(node);
                if (amd && t.isIdentifier(node.callee) && isLoaderReference(source, p, node.callee.name)) {
                    amd.dependencies?.elements.forEach((dep, index) => {
                        if (!t.isStringLiteral(dep)) { return; }
                        source.moduleStrings.add(dep);
                        const param = amd.factory.params[index];
                        if (t.isIdentifier(param)) { source.imports.set(param, { module: dep.value, members: [] }); }
                    });
                    if (t.isIdentifier(node.callee, { name: 'define' })) {
                        if (!t.isBlockStatement(amd.factory.body)) {
                            source.exports.push({ members: [], node: amd.factory.body });
                        } else {
                            for (const [candidate, candidatePath] of source.paths) {
                                if (t.isReturnStatement(candidate) && candidate.argument && candidatePath.getFunctionParent()?.node === amd.factory) {
                                    source.exports.push({ members: [], node: candidate.argument });
                                }
                            }
                        }
                    }
                }
                if (t.isIdentifier(node.callee, { name: 'require' }) && isLoaderReference(source, p, 'require') && t.isStringLiteral(node.arguments[0])) {
                    source.moduleStrings.add(node.arguments[0]);
                }
            }
            if (t.isImportDeclaration(node)) {
                source.moduleStrings.add(node.source);
                for (const specifier of node.specifiers) {
                    const members = t.isImportNamespaceSpecifier(specifier) ? []
                        : [t.isImportDefaultSpecifier(specifier) ? 'default' : propertyName(specifier.imported)!];
                    source.imports.set(specifier.local, { module: node.source.value, members });
                }
            }
            if (t.isExportDefaultDeclaration(node)) { source.exports.push({ members: ['default'], node: node.declaration }); }
            if (t.isExportNamedDeclaration(node) && !node.source) {
                if (t.isFunctionDeclaration(node.declaration) && node.declaration.id) {
                    source.exports.push({ members: [node.declaration.id.name], node: node.declaration });
                }
                if (t.isVariableDeclaration(node.declaration)) {
                    for (const declaration of node.declaration.declarations) {
                        if (t.isIdentifier(declaration.id) && declaration.init) {
                            source.exports.push({ members: [declaration.id.name], node: declaration.init });
                        }
                    }
                }
                for (const specifier of node.specifiers) {
                    if (t.isExportSpecifier(specifier)) { source.exports.push({ members: [propertyName(specifier.exported)!], node: specifier.local }); }
                }
            }
            // CommonJS modules are also used by local helper libraries.
            if (t.isAssignmentExpression(node, { operator: '=' })) {
                const chain: string[] = [];
                let left: t.Node = node.left;
                while (t.isMemberExpression(left)) {
                    const name = propertyName(left.property, left.computed);
                    if (!name) { break; }
                    chain.unshift(name);
                    left = left.object;
                }
                if (t.isIdentifier(left)) {
                    const binding = p.scope.getBinding(left.name);
                    const moduleName = binding ? source.imports.get(binding.identifier)?.module : left.name;
                    if (moduleName === 'module' && chain[0] === 'exports') { source.exports.push({ members: chain.slice(1), node: node.right }); }
                    if (moduleName === 'exports' && chain.length) { source.exports.push({ members: chain, node: node.right }); }
                }
            }
        }
        return source;
    } catch { return undefined; }
}

/** Resolve static SuiteScript paths only; never execute project configuration or fetch NetSuite files. */
export function moduleFileCandidates(fromUri: string, moduleId: string): string[] {
    if (!fromUri.startsWith('file:') || !moduleId || /^(?:N(?:\/|$)|[\w+.-]+:)/.test(moduleId) || /[\0\\?#!]/.test(moduleId) || ['require', 'exports', 'module'].includes(moduleId)) { return []; }
    const from = fileURLToPath(fromUri);
    const bases: string[] = [];
    if (moduleId.startsWith('.')) {
        bases.push(path.resolve(path.dirname(from), moduleId));
    } else if (/^\/?(?:SuiteScripts|SuiteApps)\//.test(moduleId) || moduleId.startsWith('/')) {
        const relative = moduleId.replace(/^\/+/, '');
        if (relative.split('/').includes('..')) { return []; }
        let directory = path.dirname(from);
        for (;;) {
            if (path.basename(directory).toLowerCase() === 'filecabinet') {
                bases.push(path.join(directory, relative));
                break;
            }
            bases.push(path.join(directory, 'src', 'FileCabinet', relative), path.join(directory, 'FileCabinet', relative));
            const parent = path.dirname(directory);
            if (parent === directory) { break; }
            directory = parent;
        }
    } else {
        // Plain custom module names are relative to the importing script.
        bases.push(path.resolve(path.dirname(from), moduleId));
    }
    return [...new Set(bases.flatMap(base => /\.(?:[cm]?js|ts|json)$/i.test(base) ? [base] : [`${base}.js`, `${base}.ts`]))]
        .map(candidate => pathToFileURL(candidate).href);
}

/** Each request owns its caches: edits, renames and deleted files cannot leave stale targets. */
export function createModuleResolver(document: TextDocument, host: DefinitionHost) {
    const initial = parseSource(document);
    if (!initial) { return undefined; }
    const sources = new Map<string, Source | undefined>([[document.uri, initial]]);
    const visited = new Set<string>();
    const configs = new Map<string, Record<string, unknown> | undefined>();

    async function loadModule(source: Source, moduleId: string): Promise<Source | undefined> {
        // Entry-point AMD configuration also applies to its dependencies. Only
        // static JSON paths are interpreted; no JavaScript config is executed.
        const configSource = source.configPath ? source : (initial ?? source);
        if (configSource.configPath && !/^(?:N\/|\.|\/)/.test(moduleId)) {
            if (!configs.has(configSource.document.uri)) {
                let config: Record<string, unknown> | undefined;
                for (const uri of moduleFileCandidates(configSource.document.uri, configSource.configPath)) {
                    const doc = await host.readDocument(uri);
                    if (!doc) { continue; }
                    try {
                        const parsed: unknown = JSON.parse(doc.getText());
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { config = parsed as Record<string, unknown>; }
                    } catch { /* An incomplete config cannot supply aliases. */ }
                    break;
                }
                configs.set(configSource.document.uri, config);
            }
            const config = configs.get(configSource.document.uri);
            if (config?.paths && typeof config.paths === 'object' && !Array.isArray(config.paths)) {
                const paths = config.paths as Record<string, unknown>;
                const alias = Object.keys(paths).sort((a, b) => b.length - a.length)
                    .find(key => moduleId === key || moduleId.startsWith(`${key}/`));
                if (alias && typeof paths[alias] === 'string') {
                    moduleId = paths[alias] + moduleId.slice(alias.length);
                    source = configSource;
                }
            }
        }
        for (const uri of moduleFileCandidates(source.document.uri, moduleId)) {
            if (!sources.has(uri)) {
                const doc = await host.readDocument(uri);
                sources.set(uri, doc ? parseSource(doc) : undefined);
            }
            const found = sources.get(uri);
            if (found) { return found; }
        }
        return undefined;
    }

    function location(source: Source, node: t.Node): Location[] {
        if (typeof node.start !== 'number' || typeof node.end !== 'number') { return []; }
        return [Location.create(source.document.uri, {
            start: source.document.positionAt(node.start), end: source.document.positionAt(node.end),
        })];
    }

    async function imported(source: Source, moduleId: string, members: string[], depth: number): Promise<Location[]> {
        const target = await loadModule(source, moduleId);
        if (!target) { return []; }
        for (const exported of target.exports) {
            if (!exported.members.every((name, index) => members[index] === name)) { continue; }
            const result = await resolve(target, exported.node, members.slice(exported.members.length), depth + 1);
            if (result.length) { return result; }
        }
        return [];
    }

    async function resolve(source: Source, node: t.Node, members: string[], depth: number): Promise<Location[]> {
        if (depth > 40) { return []; }
        const key = JSON.stringify([source.document.uri, node.start, node.end, members]);
        if (visited.has(key)) { return []; }
        visited.add(key);
        const p = source.paths.get(node);
        if (!p) { return []; }
        if (t.isIdentifier(node)) {
            const binding = p.scope.getBinding(node.name);
            if (!binding) { return []; }
            const dependency = source.imports.get(binding.identifier);
            if (dependency) {
                return binding.constant ? imported(source, dependency.module, [...dependency.members, ...members], depth) : [];
            }
            if (binding.path.isVariableDeclarator() && binding.constant) {
                const declaration = binding.path.node;
                if (declaration.init) {
                    if (t.isIdentifier(declaration.id)) { return resolve(source, declaration.init, members, depth + 1); }
                    if (t.isObjectPattern(declaration.id)) {
                        const property = declaration.id.properties.find(item => t.isObjectProperty(item) && item.value === binding.identifier);
                        if (t.isObjectProperty(property)) {
                            const name = propertyName(property.key, property.computed);
                            if (name) { return resolve(source, declaration.init, [name, ...members], depth + 1); }
                        }
                    }
                }
            }
            if (members.length) { return []; }
            return location(source, binding.identifier);
        }
        if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
            const name = propertyName(node.property, node.computed);
            return name ? resolve(source, node.object, [name, ...members], depth + 1) : [];
        }
        if (t.isCallExpression(node) && t.isIdentifier(node.callee, { name: 'require' }) && isLoaderReference(source, p, 'require') && node.arguments.length === 1 && t.isStringLiteral(node.arguments[0])) {
            return imported(source, node.arguments[0].value, members, depth);
        }
        if (t.isObjectExpression(node) && members.length) {
            for (const property of [...node.properties].reverse()) {
                if (t.isSpreadElement(property)) {
                    const result = await resolve(source, property.argument, members, depth + 1);
                    if (result.length) { return result; }
                } else if (propertyName(property.key, property.computed) === members[0]) {
                    return t.isObjectMethod(property)
                        ? (members.length === 1 ? location(source, property.key) : [])
                        : resolve(source, property.value, members.slice(1), depth + 1);
                }
            }
        }
        if (t.isObjectExpression(node) && !members.length) { return location(source, node); }
        if ((t.isFunctionExpression(node) || t.isArrowFunctionExpression(node) || t.isFunctionDeclaration(node)) && !members.length) {
            if ('id' in node && node.id) { return location(source, node.id); }
            const parent = p.parent;
            if (t.isVariableDeclarator(parent)) { return location(source, parent.id); }
            if (t.isObjectProperty(parent)) { return location(source, parent.key); }
            return location(source, node);
        }
        return [];
    }

    async function definitionOf(source: Source, selected: t.Node): Promise<Location[]> {
        visited.clear();
        const p = source.paths.get(selected);
        const parent = p?.parent;
        if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === selected) {
            if (!parent.computed || t.isStringLiteral(selected)) { selected = parent; }
        } else if ((t.isObjectProperty(parent) || t.isObjectMethod(parent)) && parent.key === selected) {
            if (t.isObjectMethod(parent)) { return location(source, parent.key); }
            if (p?.parentPath?.parentPath?.isObjectPattern()) {
                const declaration = p.parentPath.parentPath.parentPath;
                const name = propertyName(parent.key, parent.computed);
                if (name && declaration?.isVariableDeclarator() && declaration.node.init) {
                    return resolve(source, declaration.node.init, [name], 0);
                }
                return [];
            }
            return resolve(source, parent.value, [], 0);
        } else if (t.isImportSpecifier(parent) && parent.imported === selected) {
            return resolve(source, parent.local, [], 0);
        } else if (t.isExportSpecifier(parent) && parent.exported === selected) {
            return resolve(source, parent.local, [], 0);
        } else if (t.isStringLiteral(selected)) { return []; }
        return resolve(source, selected, [], 0);
    }

    async function membersOf(source: Source, node: t.Node, depth = 0): Promise<string[]> {
        if (depth > 30) { return []; }
        const p = source.paths.get(node);
        if (!p) { return []; }
        if (t.isIdentifier(node)) {
            const binding = p.scope.getBinding(node.name);
            const dependency = binding && source.imports.get(binding.identifier);
            if (dependency && binding?.constant && !dependency.members.length) {
                const target = await loadModule(source, dependency.module);
                if (!target) { return []; }
                const names: string[] = [];
                for (const exported of target.exports) {
                    names.push(...(exported.members.length ? [exported.members[0]] : await membersOf(target, exported.node, depth + 1)));
                }
                return [...new Set(names)];
            }
            if (binding?.constant && binding.path.isVariableDeclarator() && t.isIdentifier(binding.path.node.id) && binding.path.node.init) {
                return membersOf(source, binding.path.node.init, depth + 1);
            }
        }
        if (t.isCallExpression(node) && t.isIdentifier(node.callee, { name: 'require' })
            && isLoaderReference(source, p, 'require') && t.isStringLiteral(node.arguments[0])) {
            const target = await loadModule(source, node.arguments[0].value);
            if (!target) { return []; }
            const names: string[] = [];
            for (const exported of target.exports) {
                names.push(...(exported.members.length ? [exported.members[0]] : await membersOf(target, exported.node, depth + 1)));
            }
            return [...new Set(names)];
        }
        if (t.isObjectExpression(node)) {
            const names: string[] = [];
            for (const property of node.properties) {
                if (t.isSpreadElement(property)) { names.push(...await membersOf(source, property.argument, depth + 1)); }
                else {
                    const name = propertyName(property.key, property.computed);
                    if (name) { names.push(name); }
                }
            }
            return [...new Set(names)];
        }
        visited.clear();
        const targets = await resolve(source, node, [], 0);
        const target = targets[0] && await nodeAtLocation(targets[0]);
        if (!target || (target.source === source && target.node === node)) { return []; }
        return membersOf(target.source, target.node, depth + 1);
    }

    async function nodeAtLocation(target: Location): Promise<{ source: Source; node: t.Node } | undefined> {
        let source = [...sources.values()].find(s => s && documentKey(s.document.uri) === documentKey(target.uri));
        if (!source) {
            const doc = await host.readDocument(target.uri);
            source = doc && parseSource(doc);
            if (source) { sources.set(target.uri, source); }
        }
        if (!source) { return undefined; }
        const start = source.document.offsetAt(target.range.start);
        const end = source.document.offsetAt(target.range.end);
        const node = [...source.paths.keys()].find(n => n.start === start && n.end === end);
        return node ? { source, node } : undefined;
    }

    return { source: initial, definitionOf, membersOf, nodeAtLocation, loadModule, location,
        resolve: async (source: Source, node: t.Node, members: string[] = []) => {
            visited.clear();
            return resolve(source, node, members, 0);
        },
    };
}

export function symbolAt(source: ModuleSource, offset: number): t.Node | undefined {
    return [...source.paths.keys()].find(node =>
        (t.isIdentifier(node) || t.isStringLiteral(node)) && typeof node.start === 'number' && typeof node.end === 'number'
        && node.start <= offset && offset < node.end);
}

export async function getDefinition(document: TextDocument, position: Position, host: DefinitionHost): Promise<Location[]> {
    const resolver = createModuleResolver(document, host);
    if (!resolver) { return []; }
    const selected = symbolAt(resolver.source, document.offsetAt(position));
    if (!selected) { return []; }
    if (t.isStringLiteral(selected) && resolver.source.moduleStrings.has(selected)) {
        const target = await resolver.loadModule(resolver.source, selected.value);
        return target ? [Location.create(target.document.uri, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } })] : [];
    }
    return resolver.definitionOf(resolver.source, selected);
}

export type ModuleResolver = NonNullable<ReturnType<typeof createModuleResolver>>;
