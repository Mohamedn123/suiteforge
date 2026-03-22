# Change Log

All notable changes to the "suiteforge" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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