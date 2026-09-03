# Change Log

All notable changes to the "suiteforge" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [2.0.1] - 2026-09-03

### ✨ UX Enhancements

- Added a dedicated document-scanning animation for project validation and a package-to-cloud animation for project deployments and active-file uploads.
- Added live elapsed time plus the active project and deployment account to the running-command view.
- Added operation-specific preparing, running, completed, failed, cancelling, and cancelled states without displaying artificial percentage progress.
- Added reduced-motion behavior that preserves progress feedback while disabling decorative movement and success particles.

### 🧪 Tests

- Added progress-presentation, accessibility-markup, and embedded-script checks, bringing the extension-host suite to 91 tests.

## [2.0.0] - 2026-09-02

### 🚀 New Features

- **SuiteScript Snippets**: 16 snippets for common patterns — AMD define skeletons for every script type (UserEvent, Client, Suitelet, RESTlet, Map/Reduce), `record.load/create`, `search.create` + `.each()`, SuiteQL, HTTPS promises, sublists, `log.*`, try/catch, and a complete Suitelet form. Type `ss` in a `.js` file to see them all.
- **Deploy Active File**: upload the file you're editing straight to the NetSuite File Cabinet. Surfaces as a status-bar button (visible only for files under `src/FileCabinet/`), an editor title/context-menu action, and the `Alt+Shift+U` shortcut. Runs `suitecloud file:upload --paths <cabinet path>` with the local→cabinet path mapping (ACP and SuiteApp layouts).
- **Deployment Account Picker**: project deployments and file uploads now open a native VS Code picker containing saved SuiteCloud authentication IDs. It highlights the current profile, prioritizes recently used profiles, switches accounts through `suitecloud account:setup:ci --select`, and displays the active authentication ID in the status bar.
- **Account Management Actions**: select, add, manage, and refresh saved SuiteCloud accounts without leaving the deployment flow. SuiteForge stores only recent authentication-ID aliases; credentials, tokens, certificates, and private keys remain under SuiteCloud CLI management.
- **Deployment Safety Controls**: production and unverified environments require explicit confirmation by default. The picker can be configured to appear always, only when multiple profiles exist, or never.
- **Signature Help (LSP)**: typing inside a SuiteScript method call now shows the parameter list with the active parameter highlighted — for module methods (`record.load(`), object methods (`rec.setValue(`), `.promise` variants (`https.get.promise(`), and context chains (`context.form.addField(` in `beforeLoad`). Triggers on `(` and `,`.
- **Auto-Import Quick Fix**: using a module without importing it (e.g. `search.create(...)` when `N/search` isn't in `define()`) now produces an information diagnostic with a one-click **Add 'N/search' to define()** fix that inserts the dependency and binds the callback parameter — including into empty arrays and `define(callback)` forms that lack a dependency array entirely.
- **Validate → Problems Panel**: running **Validate Project** from the SDF sidebar now parses the CLI output and publishes errors/warnings into VS Code's Problems panel with file+line locations, so you can click through validation failures directly. Results are replaced on each run.

### ✨ Enhancements

- **Workspace-Aware CLI Execution**: SDF commands resolve the SuiteCloud project from the active file in multi-root workspaces and prompt for a project when the target is ambiguous. Interactive commands run in an integrated terminal while non-interactive commands continue to use the visual output panel.
- **Safer File Uploads and Generators**: Deploy Active File saves dirty editors before uploading and stops when saving fails. Generators now confirm before overwriting existing files, work in remote workspaces, and produce parseable XML across the full 60-object registry.
- **More Accurate IntelliSense**: lexical-scope tracking now respects shadowing, reassignment, and the innermost binding; context objects expose the correct entry-point methods; missing SuiteScript object definitions were restored; and nested option completions remain accurate around comments, strings, and malformed code.
- **More Robust XML Tooling**: completion and validation logic now handles large documents, comments, CDATA, nested elements, long headers, and project-relative or absolute validation paths without targeting the wrong file.
- **Clearer Deployment Feedback**: the selected authentication ID is included in deployment output labels, the sidebar refresh action updates correctly, and concurrent deploy attempts are rejected before the UI enters a running state.

### 🐛 Bug Fixes and Safety

- Preserved AMD dependency/parameter ordering in auto-import edits and handled empty arrays, callback-only `define()` calls, rest parameters, trailing comments, and unparenthesized arrow functions.
- Prevented missing-module diagnostics from matching comments, strings, locally declared aliases, or non-module identifiers.
- Prevented stale language-server analysis, cross-scope type leakage, and cached results from an older document version.
- Fixed SuiteScript module-path, signature, return-type, nested-option, and object-reference completion gaps, including current-record field and server-widget definitions.
- Fixed active-file path mapping for ACP, SuiteApp, nested backup folders, templates, and files outside the current SuiteCloud project.
- Hardened CLI argument handling against control characters and Windows shell injection; cancellation now terminates the full Windows process tree and cannot emit duplicate exits or misleading authentication hints.
- Prevented command-panel hangs, post-disposal webview messages, unsafe serialized webview content, and missing codicon rendering under the Content Security Policy.
- Account selection now fails closed for unreadable, conflicting, unknown, or unverified project/environment metadata; unsafe or ambiguous authentication IDs are rejected, and switching is blocked outside a local SuiteCloud project.
- Corrected RESTlet script-type casing, SDF custom-field script-ID prefixes, generated filenames, numeric XML completions, remote template loading, and docs synchronization.
- Removed the stale generated module index that shadowed the current 53-module TypeScript registry and corrected command-palette execution when no command argument is supplied.
- Fixed sidebar refresh behavior, generator script IDs, validation diagnostic targeting, build error propagation, and packaging exclusions for development-only sources and tests.

### 🔧 Infrastructure

- Consolidated server-side script-type metadata and added `BundleInstallationScript` and `SDFInstallationScript` support.
- Reused a single hardened CLI execution path for deployment, account discovery, account inspection, and account switching, with cancellation, timeout, output-size, project-boundary, and busy-state safeguards.
- Removed dead code and aligned the documented VS Code requirement with the extension manifest.

### 🧪 Verification

- Expanded the extension-host suite to **86 passing tests** covering account-list parsing and fuzzing, environment-classification conflicts, unsafe authentication IDs, account ordering and picker policies, project boundaries, CLI construction and cancellation, path mapping, generators, analyzer behavior, XML tooling, signature help, auto-import edits, and validation parsing.
- Verified the production typecheck, lint, webpack build, package inventory, and offline dependency audit. The packaged extension contains the required runtime assets and excludes source and test files.

## [1.1.3] - 2026-09-02

### 🐛 Bug Fixes

- **RESTlet Script Type Casing**: scripts annotated with the correct `@NScriptType RESTlet` no longer produce false "module not supported" warnings (the language server previously only accepted the incorrect `Restlet` casing). Generated RESTlets now use the correct annotation.
- **Correct Script ID Prefixes**: `crmcustomfield` objects now use the correct `custevent_` prefix (was `curcustomfield_`) and `othercustomfield` objects use `custrecord_` (was `curecord_`), matching the Oracle NetSuite documentation. Generated object files are now named after their full script ID (e.g. `custentity_my_field.xml`).
- **SDF Output Panel No Longer Gets Stuck**: starting a command while another one is running no longer leaves the output webview showing a running animation with no way to finish. The process is started before the UI switches to its "running" state.
- **Cancelling CLI Commands on Windows**: `ChildProcess.kill()` only killed the `cmd.exe` shim, leaving the SuiteCloud CLI running in the background. Cancellation now kills the whole process tree on Windows, and a cancelled run can no longer emit a second (stale) exit event or trigger bogus authentication advice.
- **Webview Icons Now Render**: the sidebar and output webviews referenced `codicon` classes without loading the codicon font, so no icons appeared. The font is now bundled and loaded via a Content Security Policy that uses a nonce.
- **Run SDF Command from the Palette**: invoking `SuiteForge: Run SDF Command` from the Command Palette (with no argument) no longer crashes; it now opens a picker for choosing a command.
- **Stale Committed Build Artifact Removed**: deleted the outdated `src/data/suiteScript/modules/index.js` (23 modules) that shadowed the current TypeScript source (53 modules).
- **XML Completions for Large Documents**: the enclosing-tag lookup only scanned 50 lines back, which silently failed for saved searches and large custom records. It now scans the whole document and ignores tags inside XML comments.
- **False Positives in Analyzer Regexes**: braces inside strings/comments no longer produce bogus `return { }` blocks, and option-property completions are no longer suppressed by keys from nested objects or string literals.
- **`displayheight`/`displaywidth` Completions**: these elements are numeric in SDF XML and no longer suggest T/F values.
- **Templates Load on Remote Workspaces**: SDF object templates are read through `vscode.workspace.fs` instead of Node's `fs`, so generators work over SSH, WSL, and Dev Containers.
- **Post-Dispose Message Race**: the output panel no longer posts messages to a disposed webview.
- **Docs Sync Script**: `scripts/sync-docs.js` reported `undefined` for every module because it read a nonexistent `data.id` field; it now uses `data.module`.
- **Auth/Project Error Hints**: CLI output is no longer analyzed for authentication/project-setup advice when the command was cancelled by the user.

### 🔧 Infrastructure

- Server-side script type lists are now defined once in `moduleData.ts` (adding `BundleInstallationScript` and `SDFInstallationScript`) and shared by diagnostics and completions instead of being duplicated (and diverging) in both files.
- Removed dead code (`normalizeScriptType`, `toScriptId`).
- `.vscodeignore` now excludes `scripts/` and `gemini.md` from the packaged extension.
- README version requirement corrected to v1.105.0 (matching `package.json` engines).
- Replaced the boilerplate extension test with real activation and command-registration checks; fixed a double-`done()` hazard in the CLI runner test.

## [1.1.0] - 2026-03-22

### 🚀 Language Server Enhancements

- **AST-Based Analyzer**: Migrated the SuiteScript analyzer from a regex-only approach to a hybrid AST + regex fallback architecture using Babel parser. The AST pass provides accurate parsing for well-formed code, while the regex fallback ensures completions remain functional during active editing (incomplete documents).
- **Improved Autocomplete Priority**: SuiteForge completions now appear at the **top** of the completion list instead of being buried below VS Code's built-in word suggestions. Achieved by returning a `CompletionList` with `isIncomplete: false`.
- **Ambiguous Entry Point Support**: RESTlet entry points (`get`, `post`, `put`, `delete`) and MapReduce entry points (`map`, `reduce`) now receive proper context typing when defined inside `return { }` blocks — both in the AST pass and the regex fallback.
- **Reassignment Type Tracking**: Variables reassigned via `x = obj.method()` (without `const`/`let`/`var`) now correctly inherit the method's return type.
- **Promise `.then()` Callback Typing**: The regex fallback now properly types callback parameters in `.then(function(result) { })` chains, matching the AST pass behavior.
- **Context Property Access**: `context.newRecord`, `context.oldRecord`, and similar context property accesses are now correctly resolved to their underlying SuiteScript types (e.g., `N/record#Record`).
- **Variable Alias Propagation**: Module references (`const r = record`) and typed variables (`const myRec = rec`) now properly propagate types to the alias.

### 🐛 Bug Fixes

- **Fixed Autocomplete Ordering**: Completions from SuiteForge now appear at the top of VS Code's suggestion list rather than at the bottom.
- **Removed Stale Build Artifacts**: Deleted outdated pre-compiled `.js` files (`analyzer.js`, `moduleData.js`, `types.js`) that could have caused silent regressions if resolved by the bundler instead of the current `.ts` sources.
- **Removed `@ts-ignore` Suppression**: Replaced the `@ts-ignore` workaround for Babel traverse imports with a proper type-safe cast, now that `@types/babel__traverse` is installed.

### 🔧 Infrastructure

- **Expanded Test Suite**: Increased analyzer test coverage from 4 to 12 tests, now covering:
  - Context property access and type propagation
  - Variable and module alias propagation
  - Ambiguous entry points in return blocks (RESTlet, MapReduce)
  - `await` Promise unwrapping
  - Script type detection from JSDoc annotations
  - JSDoc comments between `define()` module array and callback
- **Dependency Management**: Ensured `@babel/parser`, `@babel/traverse`, and `@types/babel__traverse` are explicitly declared in `package.json`.

### 📖 Documentation

- **Updated Module Definitions**: SuiteScript module JSON definitions synchronized with the latest Oracle NetSuite documentation for accurate hover info and completions.
- **Updated README**: Reflects the current feature set and known issues.

## [1.0.0] - 2026-03-15

### Initial Release

- SuiteScript file scaffolding and code generation.
- SDF command runner integration.
- Language Server with IntelliSense, hover documentation, and completions for SuiteScript 2.x.
- XML template management for NetSuite custom objects.
- Reference browser for SDF documentation.

## [0.0.1]

- Pre-release / internal testing.
