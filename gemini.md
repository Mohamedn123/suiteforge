# SuiteForge - Project Analysis

## Overview
SuiteForge is a Visual Studio Code extension designed to streamline NetSuite SuiteCloud Development Framework (SDF) workflows. It provides scaffolding tools, SDF command execution, and a dedicated Language Server (LSP) for SuiteScript 2.x, offering robust IntelliSense, completions, and hover documentation.

This document outlines the current state of the project, known bugs, limitations, and upcoming tasks/requirements for future development.

## 🐛 Bugs & Known Issues

1. ~~**LSP Analysis Limitations (`analyzer.ts`)**:~~ **(Completed)**
   - The current Language Server uses a regex-based parser instead of a full Abstract Syntax Tree (AST) parser to handle AMD `define()` statements and variable assignments. While fast, this approach is brittle and may fail on complex nested scopes, inline comments within arguments, or heavily minified/obfuscated SuiteScript code.
   - **Promise Chaining**: While basic `.then()` callback type inference is implemented, support for type propagation through `.catch()` and `.finally()` blocks, or complex async/await control flows, may be incomplete or inaccurate.

2. ~~**Outdated Module Definitions**:~~ **(Completed)**
   - The SuiteScript module JSON definitions (e.g., `N_record.json`, `N_log.json`, `N_ui_serverWidget.json`, `contextTypes.json`, `scriptTypes.json`) may contain outdated names, types, or descriptions. They need continuous synchronization with the official Oracle NetSuite documentation to ensure accurate hover info and completions.

3. ~~**SDF Command Configuration**:~~ **(Completed)**
   - Some SDF commands triggered via the extension may fail if the local NetSuite account and `suitecloud-cli` are not fully configured or authenticated, lacking clear fallback error handling within the VS Code UI.

4. ~~**Autocomplete issue:**~~ **(Completed)**
   - on going into any script type and trying to see autocomplete for any module or any variable like current_record = context.currentRecord and then current_record. nothing appears I should see the functions included in that object module. this should be applied on everything like for example but not limited to "search, record, ...etc".

5. ~~The LSP is not working right at all:~~ **(Completed)**
   - I tried testing and then it was not working for autocomplete plus there is warning that all modules can't work in the userevent and the error message contains that it can work on userevent like record module for example.

## 📋 Requirements & Tasks

### 1. Language Server & IntelliSense Enhancements
- ~~**AST Parsing Migration**:~~ **(Completed)** Investigate transitioning from Regex-based analysis in `src/lsp/server/analyzer.ts` to a more robust AST-based approach (e.g., using TypeScript's Compiler API or Babel) to parse SuiteScript AMD/RequireJS patterns reliably.
- ~~**Advanced Type Inference**:~~ **(Completed)** Improve type inference for complex variable assignments, context-derived properties, and deep promise chains.
- ~~**Diagnostics/Linting**:~~ **(Completed)** Implement real-time diagnostics (linting) to warn developers about invalid SuiteScript method parameters, deprecated API usage, or mismatching entry point signatures.

### 2. Documentation Updating (High Priority)
- ~~**NetSuite Docs Sync**:~~ **(Completed)** Systematically review and update the descriptions and names in `modules.json`, `contextTypes.json`, and `scriptTypes.json` by referencing the latest Oracle NetSuite Help Center documentation. This ensures developers get accurate tooltips. *Note: Always notify/verify if any expected module info is missing from the data files before appending.*

### 3. Feature Additions & UX Improvements
- ~~**Code Snippets Expansion**:~~ **(Completed)** Expand the scaffolding templates (`src/generators/`) to cover newer NetSuite module patterns, including modern SuiteScript 2.1 syntax (arrow functions, template literals).

### 4. Testing & Infrastructure
- ~~**Unit Testing**:~~ **(Completed)** Expand test coverage for the LSP `completions.ts` and `analyzer.ts` (inside `.vscode-test.mjs` / `src/test`) to catch regressions in variable typing and method completions.
- ~~**Integration Testing**:~~ **(Completed)** Add automated UI integration tests to verify that VS Code commands (`suiteforge.newScript`, `suiteforge.runSdfCommand`) execute properly in simulated workspaces.

5. ~~Rerwrite the whole LSP server to be more functional and reliable and fulfilling for the purpose of SuiteScript 2.1 development. it shouldn't fail ever and should be corporate grade ready.~~ **(Completed)**
