import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const rendererEntry = path.join(desktopRoot, "src/renderer/App.tsx");
const PI_SDK_PACKAGE = "@earendil-works/pi-coding-agent";

const FROM_SPECIFIER = /(?:^|\n)\s*(?:export|import)(\s+type)?[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveRelativeImport(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const stripped = specifier.replace(/\.(js|mjs|cjs)$/, "");
  const base = path.resolve(path.dirname(fromFile), stripped);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    base,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => isFile(candidate) && /\.(ts|tsx)$/.test(candidate));
}

function collectRendererModuleGraph(entry: string): string[] {
  const queue = [entry];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const specifiers = new Set<string>();
    for (const match of source.matchAll(FROM_SPECIFIER)) {
      specifiers.add(match[2] ?? "");
    }
    for (const match of source.matchAll(SIDE_EFFECT_IMPORT)) {
      specifiers.add(match[1] ?? "");
    }
    for (const specifier of specifiers) {
      const resolved = resolveRelativeImport(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen];
}

function importedSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  for (const match of source.matchAll(FROM_SPECIFIER)) specifiers.add(match[2] ?? "");
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT)) specifiers.add(match[1] ?? "");
  return [...specifiers];
}

function valueBarrelImports(source: string): string[] {
  const hits: string[] = [];
  for (const match of source.matchAll(FROM_SPECIFIER)) {
    const typeOnly = Boolean(match[1]);
    const specifier = match[2] ?? "";
    if (!typeOnly && specifier === "@eco/runtime") {
      hits.push(match[0].trim());
    }
  }
  return hits;
}

test("renderer graph does not import the Node-only @eco/runtime barrel", () => {
  const files = collectRendererModuleGraph(rendererEntry);
  expect(files.some((file) => file.endsWith(`${path.sep}image-view-tool.ts`))).toBe(true);

  const violations: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const statement of valueBarrelImports(source)) {
      violations.push(`${path.relative(desktopRoot, file)}: ${statement}`);
    }
    // The PI SDK is Node-only (it spawns worker threads and compiles wasm), so
    // the renderer graph must not import it — not even type-only, which would
    // drag the Node package into the renderer type graph. Before PI 1.0.3 this
    // guard named pi-mcp-adapter instead. Match real import statements rather
    // than raw text: i18n catalogs legitimately name the package in a message.
    const piSdkImports = importedSpecifiers(source).filter((specifier) => specifier === PI_SDK_PACKAGE);
    for (const specifier of piSdkImports) {
      violations.push(`${path.relative(desktopRoot, file)}: imports the Node-only ${specifier}`);
    }
  }

  expect(violations).toEqual([]);
});
