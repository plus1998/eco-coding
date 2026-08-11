# Packaging assets

Platform icons for electron-builder and dev/runtime (generated from repo-root `logo.png`):

| File | Platform |
|------|----------|
| `icon.icns` | macOS (.app, DMG, Dock in dev) |
| `icon.ico` | Windows (installer, taskbar) |
| `icon.png` | Linux (AppImage) and cross-platform fallback |

Source `logo.png` stays a full-bleed square. Platform bitmaps bake shape where
the OS will not (or will not always) apply a live product-icon mask:

- `icon.icns` — macOS App + DMG share one squircle alpha (continuous-corner style)
- `icon.ico` — Windows rounded-rect alpha for Explorer / installer
- `icon.png` / `public/icon.png` — stay square for Linux and generic fallbacks

Regenerate after updating the logo:

```bash
bun run icons   # from apps/desktop, or: bun run --cwd apps/desktop icons
```

`electron-builder.yml` uses this folder as `buildResources`; icons are picked up automatically when packing.

Icons are committed to the repo so CI can pack on all platforms without running `bun run icons` (which requires macOS `sips` for PNG resize).
