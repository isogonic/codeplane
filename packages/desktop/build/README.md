# Desktop build resources

`electron-builder` reads the app icons from this directory.

| Platform | File         | Required size |
| -------- | ------------ | ------------- |
| macOS    | `icon.icns`  | 1024×1024     |
| Windows  | `icon.ico`   | 256×256       |
| Linux    | `icon.png`   | 512×512+      |

The repo currently ships only `icon.png` (sourced from the VS Code extension
icon). On macOS and Windows builds, electron-builder converts the PNG to the
required format automatically when the platform-specific file is missing —
the conversions are good enough for the dev/draft pipeline. Replace these
files with hand-tuned per-platform icons before promoting a release.
