import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const rendererRoot = path.join(desktopRoot, "src/renderer");
const publicRoot = path.join(desktopRoot, "public");

/**
 * Packaged renderer is loaded through `loadFile(file://.../dist/renderer/index.html)`
 * (vite `base: "./"`). A root-absolute URL such as `/provider-icons/openai.svg`
 * resolves to the filesystem root and renders as a broken-image placeholder,
 * while `./provider-icons/openai.svg` resolves next to index.html.
 */
const publicAssetPrefixes = readdirSync(publicRoot)
  .filter((entry) => statSync(path.join(publicRoot, entry)).isDirectory())
  .concat(readdirSync(publicRoot).filter((entry) => entry.endsWith(".png") || entry.endsWith(".svg")))
  .map((entry) => `/${entry}`);

const resourceUrlLiteral = /["'`](\/(?!\/)[^"'`\s]*)["'`]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

test("public assets are referenced with relative URLs so they resolve in packaged builds", () => {
  expect(publicAssetPrefixes).toContain("/provider-icons");

  const violations: string[] = [];
  for (const file of walk(rendererRoot)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(resourceUrlLiteral)) {
      const literal = match[1] ?? "";
      if (!publicAssetPrefixes.some((prefix) => literal === prefix || literal.startsWith(`${prefix}/`))) {
        continue;
      }
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(`${path.relative(desktopRoot, file)}:${line}: ${literal}`);
    }
  }

  expect(violations).toEqual([]);
});
