# codeplane VS Code Extension

A Visual Studio Code extension that integrates [codeplane](https://github.com/devinoldenburg/codeplane) directly into your development workflow.

## Prerequisites

This extension requires the [codeplane CLI](https://github.com/devinoldenburg/codeplane) to be installed on your system. Visit [example.invalid](https://github.com/devinoldenburg/codeplane) for installation instructions.

## Features

- **Quick Launch**: Use `Cmd+Esc` (Mac) or `Ctrl+Esc` (Windows/Linux) to open the CodePlane web app for your current workspace.
- **New Server**: Use `Cmd+Shift+Esc` (Mac) or `Ctrl+Shift+Esc` (Windows/Linux) to start a fresh local CodePlane web server.
- **Context Awareness**: Automatically open CodePlane with your current selection or tab as prompt context.
- **File Reference Shortcuts**: Use `Cmd+Option+K` (Mac) or `Alt+Ctrl+K` (Linux/Windows) to open CodePlane with a file reference like `@File#L37-42`.

## Support

This is an early release. If you encounter issues or have feedback, please create an issue at https://github.com/devinoldenburg/codeplane/issues.

## Development

1. `code sdks/vscode` - Open the `sdks/vscode` directory in VS Code. **Do not open from repo root.**
2. `bun install` - Run inside the `sdks/vscode` directory.
3. Press `F5` to start debugging - This launches a new VS Code window with the extension loaded.

#### Making Changes

`tsc` and `esbuild` watchers run automatically during debugging. Changes to the extension are automatically rebuilt in the background.

To test your changes:

1. In the debug VS Code window, press `Cmd+Shift+P`
2. Search for `Developer: Reload Window`
3. Reload to see your changes without restarting the debug session
