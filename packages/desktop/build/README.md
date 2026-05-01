# Desktop build resources

`electron-builder` reads the app icons from this directory.

| Platform | File         | Required size |
| -------- | ------------ | ------------- |
| macOS    | `icon.icns`  | 1024×1024     |
| Windows  | `icon.ico`   | 256×256       |
| Linux    | `icon.png`   | 512×512+      |

The repo ships generated `icon.icns` and `icon.ico` assets alongside the
source `icon.png`. Regenerate them from the PNG when the app icon changes.
