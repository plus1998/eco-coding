# Packaging assets

Platform icons for electron-builder and dev/runtime (generated from repo-root `logo.png`):

| File | Platform |
|------|----------|
| `icon.icns` | macOS (.app, DMG, Dock in dev) |
| `icon.ico` | Windows (installer, taskbar) |
| `icon.png` | Linux (AppImage) and cross-platform fallback |

Windows bakes transparent rounded corners into `icon.ico` (32-bit DIB frames for Explorer). Linux `icon.png` uses the same baked shape. macOS `.icns` stays square; the Dock applies its mask.

Regenerate after updating the logo (requires **Bun 1.4+**):

```bash
bun run icons   # from apps/desktop, or: bun run --cwd apps/desktop icons
```

`electron-builder.yml` uses this folder as `buildResources`; icons are picked up automatically when packing.

Icons are committed to the repo so CI can pack on all platforms without running `bun run icons` on every agent.
