# Desktop build resources

`electron-builder` reads the app icons from this directory.

| Platform | File                     | Required size      |
| -------- | ------------------------ | ------------------ |
| macOS    | `icon.icns`              | 1024×1024          |
| Windows  | `icon.ico`               | 256×256            |
| Linux    | `icon.png`               | 512×512+           |
| DMG      | `dmg-background.png`     | 540×380 (+ @2x)    |

The repo ships generated `icon.icns`, `icon.ico`, and DMG background PNGs
alongside the source `icon.svg`, `dmg-background.svg`, and generated
`icon.png`.

Regenerate the desktop icons with:

```bash
bun ./build/generate-icons.ts
```

This generator currently requires macOS because it uses `sips` and `iconutil`.
