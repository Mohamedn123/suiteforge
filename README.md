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
- **SDF Command Runner**: Run and manage SDF commands directly from VS Code.
- **Custom Views**:
  - SDF Commands View: Manage and execute SDF commands from a dedicated panel.
  - SuiteForge Sidebar: Access tools and utilities in the activity bar.
- **Template Management**: Predefined XML templates for common NetSuite custom objects.
- **Reference Browser**: Browse and explore SDF references directly within the editor.

## Installation

1. Install Visual Studio Code (v1.110.0 or later).
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
- **SuiteForge: Refresh**: Refresh the SDF Commands View.

### IntelliSense

SuiteForge's Language Server provides IntelliSense for SuiteScript 2.x files automatically. Features include:

- **Dot completions**: Type `record.` to see all available methods and enums.
- **Context typing**: Parameters in entry point functions (e.g., `beforeSubmit(context)`) are automatically typed with the correct context object.
- **Method return types**: Variables assigned from method calls (e.g., `const rec = record.create({...})`) are automatically typed, enabling further chained completions.
- **Options completions**: Inside method option objects (e.g., `record.load({ | })`), available properties are suggested with type and required/optional indicators.
- **Module path completions**: Inside `define([' | '])` or `require(' | ')`, available SuiteScript modules are listed with descriptions.

### Custom Views

- **SDF Commands View**: Manage and execute SDF commands.
- **SuiteForge Sidebar**: Access tools, utilities, and templates.

## Requirements

- Visual Studio Code v1.110.0 or later.
- Node.js and npm installed on your system.
- A valid NetSuite SDF project.

## Contributing

We welcome contributions! To contribute:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Submit a pull request with a detailed description of your changes.

## Known Issues

- Some SDF commands may require additional configuration in your NetSuite account and `suitecloud-cli` authentication.
- The Language Server's regex fallback (used during active typing) does not support all patterns that the primary AST parser handles.

## Release Notes

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
