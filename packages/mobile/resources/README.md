# Mobile resources

Place these source assets here and the Capacitor `cap sync` step copies
them into the iOS and Android projects:

| File             | Required size     | Used for                                                        |
| ---------------- | ----------------- | --------------------------------------------------------------- |
| `icon.png`       | 1024×1024, no α   | App icon (Capacitor's `@capacitor/assets` generates all sizes)  |
| `splash.png`     | 2732×2732, square | Splash screen (centered, scales to all phone aspect ratios)     |
| `splash-dark.png`| 2732×2732, square | Optional dark-mode splash                                       |
| `icon-fg.png`    | 432×432           | Android adaptive-icon foreground layer                          |
| `icon-bg.png`    | 432×432           | Android adaptive-icon background layer (or use `--icon-background-color`) |

The desktop already ships a 1024-px icon at
[`packages/desktop/build/icon.png`](../../desktop/build/icon.png) — the easiest
path is to copy that here as `icon.png` so iOS/Android keep the same brand
look as the desktop app.

## Generating the per-platform variants

After dropping the source PNGs in here, run:

```bash
bunx @capacitor/assets generate --android --ios
```

That populates `android/app/src/main/res/mipmap-*` and
`ios/App/App/Assets.xcassets` for you. Re-run whenever you change the
source assets.
