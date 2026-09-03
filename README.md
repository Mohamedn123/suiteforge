# SuiteForge

SuiteForge is a powerful Visual Studio Code extension designed to enhance productivity and streamline development for NetSuite SuiteCloud Development Framework (SDF). It provides scaffolding tools, code generation, SDF command execution, and a dedicated Language Server (LSP) for SuiteScript 2.x — offering robust IntelliSense, completions, hover documentation, and real-time diagnostics.

## Features

- **SuiteScript IntelliSense (LSP)**:
  - Intelligent code completions for all SuiteScript 2.x modules, methods, enums, and properties.
  - Hover documentation with method signatures, parameter details, and return types.
  - Context-aware typing for entry point parameters (`beforeSubmit`, `pageInit`, `onRequest`, etc.).
  - Automatic type inference for `record.create()`, `search.create()`, and other module method return values.
  - Promise type resolution for `.then()`, `.catch()`, `.finally()` callbacks and `await` expressions.
  - Method parameter completions inside options objects (e.g., `record.load({ | })`).
  - Module path completions inside `define([])` and `require()`.
  - Real-time diagnostics warning when a module is used in an unsupported script type.
- **Command Palette Integration**: Quickly access SuiteForge commands via the VS Code Command Palette.
- **Code Generators**:
  - Create SuiteScript files with modern 2.1 syntax (arrow functions, template literals).
  - Generate XML templates for records, fields, forms, scripts, and more.
- **SuiteScript Snippets**: 16 built-in snippets for common patterns — define skeletons for every script type, record/search/query operations, Suitelet forms, and more. Type `ss` to browse them.
- **Deploy Active File**: Upload the open file straight to the File Cabinet via a status-bar button, editor context menu, or `Alt+Shift+U`.
- **Deployment Account Picker**: Before project deploys and file uploads, choose a saved SuiteCloud authentication ID from a native VS Code picker. SuiteForge highlights the current account, switches through the official CLI, and requires confirmation for production or unverified environments.
- **SDF Command Runner**: Run and manage SDF commands directly from VS Code.
  - Commands that require prompts open in an integrated terminal; non-interactive commands use the visual output panel.
  - Multi-root workspaces execute against the active file's project, or ask you to select one.
- **Validate → Problems Panel**: `project:validate` output is parsed into Problems-panel diagnostics with file and line locations.
- **Custom Views**:
  - SDF Commands View: Manage and execute SDF commands from a dedicated panel.
  - SuiteForge Sidebar: Access tools and utilities in the activity bar.
- **Template Management**: Predefined XML templates for common NetSuite custom objects.
- **Reference Browser**: Browse and explore SDF references directly within the editor.

## Installation

1. Install Visual Studio Code (v1.105.0 or later).
2. Download and install the SuiteForge extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/).
3. Open your NetSuite SDF project in VS Code.

## Usage

### Activating the Extension

SuiteForge activates automatically when you open XML or JavaScript files or interact with the SuiteForge views.

### Available Commands

Access the following commands via the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS):

- **SuiteForge: Browse SDF Reference**: Explore NetSuite SDF references.
- **SuiteForge: New SuiteScript File...**: Generate a new SuiteScript file.
- **SuiteForge: Script Definition...**: Create a new script definition.
- **SuiteForge: Record or List...**: Define a new record or list.
- **SuiteForge: Field...**: Add a new field.
- **SuiteForge: Form...**: Create a new form.
- **SuiteForge: Plug-in...**: Define a new plug-in.
- **SuiteForge: Center & Navigation...**: Set up a new center or navigation item.
- **SuiteForge: Analytics...**: Generate analytics-related files.
- **SuiteForge: Template & Translation...**: Manage templates and translations.
- **SuiteForge: Run SDF Command**: Execute an SDF command.
- **SuiteForge: Deploy Active File**: Upload the open file to the File Cabinet.
- **SuiteForge: Select Deployment Account...**: Change the SuiteCloud authentication ID used by the current project.
- **SuiteForge: Add NetSuite Account...**: Open the official interactive SuiteCloud account setup flow.
- **SuiteForge: Manage Saved NetSuite Accounts...**: List, rename, or remove saved authentication IDs through the SuiteCloud CLI.
- **SuiteForge: Refresh**: Refresh the SDF Commands View.

### IntelliSense

SuiteForge's Language Server provides IntelliSense for SuiteScript 2.x files automatically. Features include:

- **Dot completions**: Type `record.` to see all available methods and enums.
- **Context typing**: Parameters in entry point functions (e.g., `beforeSubmit(context)`) are automatically typed with the correct context object.
- **Method return types**: Variables assigned from method calls (e.g., `const rec = record.create({...})`) are automatically typed, enabling further chained completions.
- **Options completions**: Inside method option objects (e.g., `record.load({ | })`), available properties are suggested with type and required/optional indicators.
- **Module path completions**: Inside `define([' | '])` or `require(' | ')`, available SuiteScript modules are listed with descriptions.
- **Signature help**: Inside a method call like `record.load(`, the parameter list is shown with the active parameter highlighted.
- **Auto-import quick fix**: Using a module without importing it (e.g. `search.` with no `N/search` in `define()`) offers a one-click "Add to define()" fix.

### Custom Views

- **SDF Commands View**: Manage and execute SDF commands.
- **SuiteForge Sidebar**: Access tools, utilities, and templates.

## Requirements

- Visual Studio Code v1.105.0 or later.
- Node.js and npm installed on your system.
- SuiteCloud CLI for Node.js installed and available as `suitecloud`.
- A valid NetSuite SDF project.

### Deployment Accounts

SuiteForge discovers saved accounts with `suitecloud account:manageauth --list`. Selecting an account runs `suitecloud account:setup:ci --select <authId>`, the SuiteCloud CLI's supported mechanism for updating the project's `project.json` `defaultAuthId`. SuiteForge stores only recent authentication-ID aliases for ordering; credentials, tokens, certificates, and private keys remain managed by the SuiteCloud CLI.

The account picker is shown before every deployment by default. Change **SuiteForge › Deploy: Account Picker** to show it only when multiple profiles exist or to use the project's current account without a picker. **SuiteForge › Deploy: Confirm Production** controls the additional production confirmation and is enabled by default.

## Contributing

We welcome contributions! To contribute:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Submit a pull request with a detailed description of your changes.

## Known Issues

- Some SDF commands may require additional configuration in your NetSuite account and `suitecloud-cli` authentication.
- The Language Server's regex fallback (used during active typing) does not support all patterns that the primary AST parser handles.

## Release Notes

### 2.0.0 — Productivity and Deployment Safety Release

#### 🚀 New Features

- **SuiteScript Snippets**: 16 snippets for common patterns — AMD define skeletons for every script type (UserEvent, Client, Suitelet, RESTlet, Map/Reduce), `record.load/create`, `search.create` + `.each()`, SuiteQL, HTTPS promises, sublists, `log.*`, try/catch, and a complete Suitelet form. Type `ss` in a `.js` file to see them all.
- **Deploy Active File**: upload the file you're editing straight to the NetSuite File Cabinet. Surfaces as a status-bar button (visible only for files under `src/FileCabinet/`), an editor title/context-menu action, and the `Alt+Shift+U` shortcut. Runs `suitecloud file:upload --paths <cabinet path>` with the local→cabinet path mapping (ACP and SuiteApp layouts).
- **Deployment Account Picker**: project deployments and file uploads now open a native account selector backed by saved SuiteCloud authentication IDs. The picker identifies the current profile, prioritizes recent profiles, and switches the project through the SuiteCloud CLI's supported `account:setup:ci --select` flow.
- **Account Management and Visibility**: add, manage, refresh, or select saved accounts directly from SuiteForge, and see the active authentication ID in the status bar and deployment output. Only recent authentication-ID aliases are stored by the extension; SuiteCloud CLI continues to own credentials and secrets.
- **Deployment Safety Controls**: production and unverified environments require explicit confirmation by default. Configure the picker to appear always, only when multiple profiles exist, or never.
- **Signature Help (LSP)**: typing inside a SuiteScript method call now shows the parameter list with the active parameter highlighted — for module methods (`record.load(`), object methods (`rec.setValue(`), `.promise` variants (`https.get.promise(`), and context chains (`context.form.addField(` in `beforeLoad`). Triggers on `(` and `,`.
- **Auto-Import Quick Fix**: using a module without importing it (e.g. `search.create(...)` when `N/search` isn't in `define()`) now produces an information diagnostic with a one-click **Add 'N/search' to define()** fix that inserts the dependency and binds the callback parameter — including into empty arrays and `define(callback)` forms that lack a dependency array entirely.
- **Validate → Problems Panel**: running **Validate Project** from the SDF sidebar now parses the CLI output and publishes errors/warnings into VS Code's Problems panel with file+line locations, so you can click through validation failures directly. Results are replaced on each run.

#### ✨ Enhancements

- **Workspace-Aware CLI**: commands run against the active file's SuiteCloud project in multi-root workspaces or ask you to choose when the target is ambiguous. Interactive commands open in an integrated terminal; non-interactive commands use the visual output panel.
- **Safer Uploads and Generation**: Deploy Active File saves dirty editors before upload and aborts on save failure. Generators confirm overwrites, load templates in remote workspaces, and produce valid XML for all 60 registered SDF object types.
- **More Accurate IntelliSense**: lexical scope analysis respects shadowing, reassignment, and innermost bindings. Context-chain methods, missing object definitions, nested options, module paths, signatures, and return types are resolved more reliably.
- **Robust XML and Validation Tooling**: large documents, comments, CDATA, nested elements, long headers, and both relative and absolute CLI paths are handled without losing completions or attaching diagnostics to the wrong file.
- **Clearer Runtime Feedback**: the selected authentication ID appears in deployment output, refresh actions update the sidebar, and a second deployment is rejected before the UI enters a misleading running state.

#### 🐛 Bug Fixes and Safety

- **RESTlet Script Type Casing**: scripts annotated with the correct `@NScriptType RESTlet` no longer produce false "module not supported" warnings (the language server previously only accepted the incorrect `Restlet` casing). Generated RESTlets now use the correct annotation.
- **Correct Script ID Prefixes**: `crmcustomfield` objects now use the correct `custevent_` prefix (was `curcustomfield_`) and `othercustomfield` objects use `custrecord_` (was `curecord_`), matching the Oracle NetSuite documentation. Generated object files are now named after their full script ID (e.g. `custentity_my_field.xml`).
- **SDF Output Panel No Longer Gets Stuck**: starting a command while another one is running no longer leaves the output webview showing a running animation with no way to finish.
- **Cancelling CLI Commands on Windows**: `ChildProcess.kill()` only killed the `cmd.exe` shim, leaving the SuiteCloud CLI running in the background. Cancellation now kills the whole process tree on Windows, and a cancelled run can no longer emit a second (stale) exit event or trigger bogus authentication advice.
- **Webview Icons Now Render**: the sidebar and output webviews referenced `codicon` classes without loading the codicon font, so no icons appeared. The font is now bundled and loaded via a Content Security Policy that uses a nonce.
- **Run SDF Command from the Palette**: invoking `SuiteForge: Run SDF Command` from the Command Palette (with no argument) no longer crashes; it now opens a picker for choosing a command.
- **Stale Committed Build Artifact Removed**: deleted the outdated `src/data/suiteScript/modules/index.js` (23 modules) that shadowed the current TypeScript source (53 modules).
- **XML Completions for Large Documents**: the enclosing-tag lookup only scanned 50 lines back, which silently failed for saved searches and large custom records. It now scans the whole document and ignores tags inside XML comments.
- **False Positives in Analyzer Regexes**: braces inside strings/comments no longer produce bogus `return { }` blocks, and option-property completions are no longer suppressed by keys from nested objects or string literals.
- **Lexical Scope and Stale Analysis**: language-server results no longer leak types across scopes or reuse analysis from an older document version.
- **Auto-Import Accuracy**: missing-module diagnostics ignore comments, strings, and local aliases. Quick fixes preserve AMD dependency/parameter ordering and support callback-only defines, empty arrays, rest parameters, trailing comments, and unparenthesized arrow functions.
- **Upload Path and Save Handling**: active-file deployment correctly handles ACP and SuiteApp layouts, templates, nested backup folders, files outside the project, dirty documents, and failed saves.
- **CLI and Windows Safety**: control characters and shell-injection-shaped arguments are rejected, cancellation terminates the complete process tree, and duplicate exit notifications or misleading authentication hints are suppressed.
- **Account Boundary Enforcement**: account switching is blocked outside local SuiteCloud projects and fails closed when account IDs or environment metadata are unsafe, conflicting, unreadable, unknown, or unverified.
- **XML and Validation Accuracy**: comments, CDATA, nested tags, long documents, and CLI-reported paths no longer confuse completion scope or Problems-panel targeting.
- **Generator Overwrite Protection**: existing files require confirmation before replacement, and generated script IDs, filenames, prefixes, and XML templates are validated across the complete object registry.
- **Templates Load on Remote Workspaces**: SDF object templates are read through `vscode.workspace.fs` instead of Node's `fs`, so generators work over SSH, WSL, and Dev Containers.
- **Webview Hardening**: serialized command data is escaped, icons load under a nonce-based Content Security Policy, and disposed panels no longer receive messages.
- **Refresh and Build Reliability**: the sidebar refresh action now works, build failures propagate correctly, and deployment busy-state checks prevent stuck output panels.
- **Docs Sync Script**: `scripts/sync-docs.js` reported `undefined` for every module because it read a nonexistent `data.id` field; it now uses `data.module`.

#### 🔧 Infrastructure

- Server-side script type lists are now defined once in `moduleData.ts` (adding `BundleInstallationScript` and `SDFInstallationScript`) and shared by diagnostics and completions.
- Deployment, account discovery, account inspection, and account switching share one hardened CLI execution path with cancellation, timeouts, output limits, project-boundary checks, and busy-state protection.
- Removed dead code (`normalizeScriptType`, `toScriptId`).
- Packaging excludes development-only sources and tests while retaining all required runtime assets; the documented VS Code version now matches the extension manifest.

#### 🧪 Verification

- The extension-host suite now has **86 passing tests**, covering deterministic account-list fuzzing, environment-classification conflicts, unsafe authentication IDs, account ordering and picker policies, project boundaries, CLI invocation and cancellation, analyzer scope, upload path mapping, all registered generators, XML behavior, signature help, auto-import edits, and validation parsing.
- Production typecheck, lint, webpack packaging, package-content inspection, and the offline dependency audit all pass. The dependency audit reports zero known vulnerabilities in the installed dependency tree.

### 1.1.0 — Language Server Overhaul

#### 🚀 Enhancements

- **Hybrid AST + Regex Analyzer** — The SuiteScript analyzer now uses Babel's AST parser for accurate code understanding, with an automatic regex fallback for incomplete documents during active typing. This means completions stay responsive even while you're mid-keystroke.
- **Completions Appear First** — SuiteForge suggestions now appear at the **top** of VS Code's completion list, above built-in word suggestions.
- **Ambiguous Entry Point Support** — RESTlet entry points (`get`, `post`, `put`, `delete`) and MapReduce entry points (`map`, `reduce`) now receive proper context typing when defined inside `return { }` blocks.
- **Reassignment Type Tracking** — Variables reassigned via `x = obj.method()` (without `const`/`let`/`var`) now correctly inherit the method's return type.
- **Promise `.then()` Callback Typing** — Callback parameters in `.then(function(result) { })` chains are now properly typed in both the AST and regex fallback passes.
- **Context Property Resolution** — `context.newRecord`, `context.oldRecord`, and similar context property accesses are correctly resolved to their underlying SuiteScript types.
- **Variable & Module Alias Propagation** — Module references (`const r = record`) and typed variables (`const myRec = rec`) now properly propagate types to the alias.

#### 🐛 Bug Fixes

- Fixed autocomplete items appearing at the bottom of the suggestion list.
- Removed stale pre-compiled `.js` artifacts that could cause silent regressions.
- Replaced `@ts-ignore` suppression with a proper type-safe cast.

#### 🔧 Infrastructure

- Expanded test suite from 4 to 12 tests covering context properties, variable propagation, ambiguous entry points, await unwrapping, and more.
- Explicit Babel dependency declarations in `package.json`.

### 1.0.0 — Initial Release

- SuiteScript IntelliSense with completions, hover docs, and real-time diagnostics.
- SDF command runner integration.
- SuiteScript file scaffolding and XML template generators.
- Reference browser for SDF documentation.

## Disclaimer

This extension is not an official NetSuite package. It is developed independently and is not affiliated with or endorsed by NetSuite or Oracle Corporation.
