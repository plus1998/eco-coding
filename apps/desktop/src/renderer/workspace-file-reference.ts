export interface WorkspaceFileReference {
  path: string;
  line?: number;
  column?: number;
}

export function workspaceFileReferenceBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || trimmed;
}

export function workspaceFileExtensionBadge(path: string): string {
  const name = workspaceFileReferenceBasename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot >= name.length - 1) {
    return "file";
  }
  return name.slice(dot + 1, dot + 5);
}

export function formatWorkspaceFileReferenceLabel(reference: WorkspaceFileReference): string {
  const name = workspaceFileReferenceBasename(reference.path);
  if (reference.line !== undefined) {
    return `${name} (line ${reference.line})`;
  }
  return name;
}

export interface WorkspaceFileReferenceAstNode {
  type?: string;
  value?: string;
  url?: string;
  children?: WorkspaceFileReferenceAstNode[];
}

export function isWorkspacePathContained(workspacePath: string, targetPath: string): boolean {
  const normalize = (value: string) => {
    const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
    return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  const workspace = normalize(workspacePath);
  const target = normalize(targetPath);
  return target === workspace || target.startsWith(`${workspace}/`);
}

export const WORKSPACE_FILE_REFERENCE_EVENT = "eco:workspace-file-reference";

const PATH_PATTERN =
  /(?<![\p{L}\p{N}_])(?<!https:)(?<!http:)(?<!file:)(?<!https:\/)(?<!http:\/)(?<!file:\/)(?<!https:\/\/)(?<!http:\/\/)(?<!file:\/\/)(?:\/[^\s"'`()\[\]<>:]+(?:[^\s"'`()\[\]<>:]*)?|[A-Za-z]:[\\/][^\s"'`()\[\]<>:]+(?:[^\s"'`()\[\]<>:]*)?)(?::([1-9]\d*)(?::([1-9]\d*))?)?/gu;

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.,;!?)}\]]+$/, "");
}

export function parseWorkspaceFileReference(value: string): WorkspaceFileReference | undefined {
  const match = value.match(PATH_PATTERN);
  if (!match || match[0] !== value) {
    return undefined;
  }
  const parsed = [...value.matchAll(PATH_PATTERN)][0];
  if (!parsed) {
    return undefined;
  }
  const path = trimTrailingPunctuation(parsed[0]);
  if (!path || /^https?:/i.test(path) || /^file:/i.test(path)) {
    return undefined;
  }
  const suffix = path.match(/:(\d+)(?::(\d+))?$/);
  const filePath = suffix ? path.slice(0, -suffix[0].length) : path;
  if (!filePath || !/^(?:\/|[A-Za-z]:[\\/])/.test(filePath)) {
    return undefined;
  }
  return {
    path: filePath,
    ...(suffix ? { line: Number(suffix[1]) } : {}),
    ...(suffix?.[2] ? { column: Number(suffix[2]) } : {}),
  };
}

export function encodeWorkspaceFileReference(reference: WorkspaceFileReference): string {
  return encodeURIComponent(JSON.stringify(reference));
}

export function decodeWorkspaceFileReference(value: string | undefined): WorkspaceFileReference | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as WorkspaceFileReference;
    if (
      !parsed ||
      typeof parsed.path !== "string" ||
      !/^(?:\/|[A-Za-z]:[\\/])/.test(parsed.path) ||
      (parsed.line !== undefined && (!Number.isInteger(parsed.line) || parsed.line < 1)) ||
      (parsed.column !== undefined && (!Number.isInteger(parsed.column) || parsed.column < 1))
    ) {
      return undefined;
    }
    return {
      path: parsed.path,
      ...(parsed.line !== undefined ? { line: parsed.line } : {}),
      ...(parsed.column !== undefined ? { column: parsed.column } : {}),
    };
  } catch {
    return undefined;
  }
}

export function parseWorkspaceFileReferenceHref(
  href: string | undefined,
): WorkspaceFileReference | undefined {
  if (!href) {
    return undefined;
  }
  if (href.startsWith("eco-file:")) {
    return decodeWorkspaceFileReference(href.slice("eco-file:".length));
  }
  if (href.startsWith("//")) {
    return undefined;
  }
  try {
    const decoded = decodeURI(href);
    if (
      decoded.startsWith("//") ||
      /[\u0000-\u001f\u007f]/.test(decoded) ||
      !/^(?:\/|[A-Za-z]:[\\/])/.test(decoded)
    ) {
      return undefined;
    }
    const suffix = decoded.match(/:(\d+)(?::(\d+))?$/);
    const path = suffix ? decoded.slice(0, -suffix[0].length) : decoded;
    if (!path) {
      return undefined;
    }
    return {
      path,
      ...(suffix ? { line: Number(suffix[1]) } : {}),
      ...(suffix?.[2] ? { column: Number(suffix[2]) } : {}),
    };
  } catch {
    return undefined;
  }
}

export function linkifyWorkspaceFileReferences(text: string): Array<
  { type: "text"; value: string } | { type: "link"; value: string; reference: WorkspaceFileReference }
> {
  const result: Array<
    { type: "text"; value: string } | { type: "link"; value: string; reference: WorkspaceFileReference }
  > = [];
  let lastIndex = 0;
  for (const match of text.matchAll(PATH_PATTERN)) {
    const raw = match[0];
    const reference = parseWorkspaceFileReference(trimTrailingPunctuation(raw));
    if (!reference || match.index === undefined) {
      continue;
    }
    const end = match.index + raw.length;
    if (match.index > lastIndex) {
      result.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    result.push({ type: "link", value: trimTrailingPunctuation(raw), reference });
    const linkEnd = match.index + trimTrailingPunctuation(raw).length;
    if (linkEnd < end) {
      result.push({ type: "text", value: text.slice(linkEnd, end) });
    }
    lastIndex = end;
  }
  if (lastIndex < text.length) {
    result.push({ type: "text", value: text.slice(lastIndex) });
  }
  return result;
}

export function workspaceFileReferenceRemarkPlugin(): (
  tree: WorkspaceFileReferenceAstNode,
) => void {
  return (tree) => {
    const visit = (node: WorkspaceFileReferenceAstNode, parent?: WorkspaceFileReferenceAstNode) => {
      if (node.type === "text" && typeof node.value === "string" && parent?.type !== "link") {
        const parts = linkifyWorkspaceFileReferences(node.value);
        if (parts.some((part) => part.type === "link")) {
          const index = parent?.children?.indexOf(node) ?? -1;
          if (index >= 0 && Array.isArray(parent?.children)) {
            parent.children.splice(
              index,
              1,
              ...parts.map((part) =>
                part.type === "link"
                  ? { type: "link", url: `eco-file:${encodeWorkspaceFileReference(part.reference)}`, children: [{ type: "text", value: part.value }] }
                  : { type: "text", value: part.value },
              ),
            );
          }
          return;
        }
      }
      if (Array.isArray(node.children)) {
        for (const child of [...node.children]) {
          visit(child, node);
        }
      }
    };
    visit(tree);
  };
}

export function dispatchWorkspaceFileReference(reference: WorkspaceFileReference): void {
  window.dispatchEvent(
    new CustomEvent<WorkspaceFileReference>(WORKSPACE_FILE_REFERENCE_EVENT, { detail: reference }),
  );
}
