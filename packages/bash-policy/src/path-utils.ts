import { realpathSync } from "node:fs";
import path from "node:path";

export function isInsidePath(candidatePath: string, parentPath: string): boolean {
  const canonicalCandidate = resolveCanonicalPath(candidatePath);
  const canonicalParent = resolveCanonicalPath(parentPath);
  if (!canonicalCandidate || !canonicalParent) {
    return false;
  }

  const relativePath = path.relative(canonicalParent, canonicalCandidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

/** Resolve existing symlinks, including when the final path does not exist yet. */
function resolveCanonicalPath(inputPath: string): string | undefined {
  let currentPath = path.resolve(inputPath);
  const missingSegments: string[] = [];

  while (true) {
    try {
      return path.resolve(realpathSync.native(currentPath), ...missingSegments);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        return undefined;
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        return undefined;
      }

      missingSegments.unshift(path.basename(currentPath));
      currentPath = parentPath;
    }
  }
}
