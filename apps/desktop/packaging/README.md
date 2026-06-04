# Packaging assets

Platform icons for electron-builder and dev/runtime (generated from repo-root `logo.png`):

| File | Platform |
|------|----------|
| `icon.icns` | macOS (.app, DMG, Dock in dev) |
| `icon.ico` | Windows (installer, taskbar) |
| `icon.png` | Linux (AppImage) and cross-platform fallback |

Regenerate after updating the logo:

```bash
bun run icons   # from apps/desktop, or: bun run --cwd apps/desktop icons
```

`electron-builder.yml` uses this folder as `buildResources`; icons are picked up automatically when packing.
