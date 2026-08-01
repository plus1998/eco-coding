import { generateManifest, type Manifest } from "material-icon-theme";

const manifest: Manifest = generateManifest();

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] || trimmed;
}

function resolveFileIconName(fileName: string, light: boolean): string {
  const lower = fileName.toLowerCase();

  if (manifest.fileNames?.[lower]) {
    const override = light ? manifest.light?.fileNames?.[lower] : undefined;
    return override ?? manifest.fileNames[lower]!;
  }

  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i += 1) {
    const extension = parts.slice(i).join(".");
    if (manifest.fileExtensions?.[extension]) {
      const override = light ? manifest.light?.fileExtensions?.[extension] : undefined;
      return override ?? manifest.fileExtensions[extension]!;
    }
  }

  return manifest.file ?? "file";
}

/** Resolve a Material Icon Theme icon id for a file path. */
export function resolveMaterialIconName(path: string, options: { light?: boolean } = {}): string {
  return resolveFileIconName(basename(path), Boolean(options.light));
}

/** Bundled URL for a Material Icon Theme icon id. */
export function getMaterialIconUrl(iconName: string): string {
  const base = import.meta.env.BASE_URL || "./";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}material-icons/${iconName}.svg`;
}

export function resolveMaterialIconUrl(path: string, options: { light?: boolean } = {}): string {
  return getMaterialIconUrl(resolveMaterialIconName(path, options));
}
