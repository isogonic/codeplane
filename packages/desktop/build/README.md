# Desktop build resources

`electron-builder` reads the app icons from this directory.

| Platform | File         | Required size |
| -------- | ------------ | ------------- |
| macOS    | `icon.icns`  | 1024×1024     |
| Windows  | `icon.ico`   | 256×256       |
| Linux    | `icon.png`   | 512×512+      |

The repo ships generated `icon.icns` and `icon.ico` assets alongside the
source `icon.svg` and generated `icon.png`.

Regenerate the desktop icons with:

```bash
bun ./build/generate-icons.ts
```

This generator currently requires macOS because it uses `sips` and `iconutil`.
