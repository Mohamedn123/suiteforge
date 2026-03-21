# SuiteForge

SuiteForge is a powerful Visual Studio Code extension designed to enhance productivity and streamline development for NetSuite SuiteCloud Development Framework (SDF). It provides scaffolding tools, code generation, and a suite of utilities tailored for NetSuite developers.

## Features

- **Command Palette Integration**: Quickly access SuiteForge commands via the VS Code Command Palette.
- **Code Generators**:
  - Create SuiteScript files, record definitions, forms, fields, and more.
  - Generate XML templates for various NetSuite objects.
- **SDF Command Runner**: Run and manage SDF commands directly from VS Code.
- **Language Server Support**: Provides intelligent code completions, hover information, and other language features for SuiteScript and XML files.
- **Custom Views**:
  - SDF Commands View: Manage and execute SDF commands.
  - SuiteForge Sidebar: Access tools and utilities in a dedicated panel.
- **Template Management**: Predefined XML templates for common NetSuite objects.
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

### Custom Views

- **SDF Commands View**: Manage and execute SDF commands.
- **SuiteForge Sidebar**: Access tools, utilities, and templates.

## Requirements

- Visual Studio Code v1.110.0 or later.
- Node.js and npm installed on your system.
- A valid NetSuite SDF project.

## Extension Settings

This extension contributes the following settings:

- `suiteforge.enable`: Enable or disable SuiteForge features.
- `suiteforge.languageServer`: Configure the language server for SuiteScript and XML files.

## Contributing

We welcome contributions! To contribute:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Submit a pull request with a detailed description of your changes.

## Known Issues

- Some SDF commands may require additional configuration in your NetSuite account.
- Language server features may not support all SuiteScript versions.

## Release Notes

### 0.0.1

- Initial release of SuiteForge.
- Added support for SuiteScript file generation, SDF commands, and XML templates.

## Disclaimer

This extension is not an official NetSuite package. It is developed independently and is not affiliated with or endorsed by NetSuite or Oracle Corporation.
