import type { SkillInfo } from "../shared/skills";
import { getMaterialIconUrl, resolveMaterialIconName } from "./material-file-icon";
import {
  formatSkillDisplayName,
  parsePromptSegments,
  skillToken,
} from "./composer-skills";
import {
  fileAttachmentToken,
  workspaceFileReferenceBasename,
} from "./workspace-file-reference";

const SKILL_SELECTOR = "[data-skill]";
const FILE_SELECTOR = "[data-file-path]";

function isBlockElement(node: ChildNode): node is HTMLElement {
  return node instanceof HTMLElement && (node.tagName === "DIV" || node.tagName === "P");
}

function isSkillElement(node: ChildNode): node is HTMLElement {
  return node instanceof HTMLElement && node.matches(SKILL_SELECTOR);
}

function isFileElement(node: ChildNode): node is HTMLElement {
  return node instanceof HTMLElement && node.matches(FILE_SELECTOR);
}

function isAtomicChipElement(node: ChildNode): node is HTMLElement {
  return isSkillElement(node) || isFileElement(node);
}

function skillTokenLength(node: HTMLElement): number {
  const name = node.dataset.skill;
  return name ? skillToken(name).length : 0;
}

function fileTokenLength(node: HTMLElement): number {
  const path = node.dataset.filePath;
  return path ? fileAttachmentToken(path).length : 0;
}

function needsBlockSeparator(prev: ChildNode, next: ChildNode): boolean {
  return isBlockElement(prev) || isBlockElement(next);
}

function serializeChildren(parent: Node): string {
  const children = [...parent.childNodes];
  let out = "";
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index]!;
    if (index > 0 && needsBlockSeparator(children[index - 1]!, node)) {
      out += "\n";
    }
    out += serializeNode(node);
  }
  return out;
}

export function serializeEditable(root: HTMLElement): string {
  const out = serializeChildren(root);
  // Chromium keeps a lone <br> in an empty contenteditable; treat that as blank.
  if (
    out === "\n" &&
    root.childNodes.length === 1 &&
    root.firstChild instanceof HTMLElement &&
    root.firstChild.tagName === "BR"
  ) {
    return "";
  }
  return out;
}

function serializeNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }
  if (node.tagName === "BR") {
    return "\n";
  }
  if (isSkillElement(node)) {
    return skillToken(node.dataset.skill!);
  }
  if (isFileElement(node)) {
    return fileAttachmentToken(node.dataset.filePath!);
  }
  if (isBlockElement(node)) {
    return serializeChildren(node);
  }
  return serializeChildren(node);
}

function serializedLength(node: ChildNode): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").length;
  }
  if (!(node instanceof HTMLElement)) {
    return 0;
  }
  if (node.tagName === "BR") {
    return 1;
  }
  if (isSkillElement(node)) {
    return skillTokenLength(node);
  }
  if (isFileElement(node)) {
    return fileTokenLength(node);
  }
  const element = node as HTMLElement;
  const children = [...element.childNodes];
  let length = 0;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    if (index > 0 && needsBlockSeparator(children[index - 1]!, child)) {
      length += 1;
    }
    length += serializedLength(child);
  }
  return length;
}

function sumChildLengths(parent: Node, childIndex: number): number {
  let length = 0;
  const children = parent.childNodes;
  for (let index = 0; index < childIndex && index < children.length; index += 1) {
    const child = children[index]!;
    if (index > 0 && needsBlockSeparator(children[index - 1]!, child)) {
      length += 1;
    }
    length += serializedLength(child);
  }
  return length;
}

export function getSelectionOffsets(root: HTMLElement): { start: number; end: number } {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { start: 0, end: 0 };
  }
  return {
    start: measureOffset(root, selection.anchorNode, selection.anchorOffset),
    end: measureOffset(root, selection.focusNode, selection.focusOffset),
  };
}

export function getCursorOffset(root: HTMLElement): number {
  return getSelectionOffsets(root).end;
}

function measureOffset(container: Node, targetNode: Node | null, targetOffset: number): number {
  if (!targetNode) {
    return 0;
  }
  if (container === targetNode) {
    return sumChildLengths(container, targetOffset);
  }

  let offset = 0;
  const children = container.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    if (index > 0 && needsBlockSeparator(children[index - 1]!, child)) {
      offset += 1;
    }
    if (child === targetNode) {
      if (child.nodeType === Node.TEXT_NODE) {
        return offset + targetOffset;
      }
      return offset + sumChildLengths(child, targetOffset);
    }
    if (child.contains(targetNode)) {
      return offset + measureOffset(child, targetNode, targetOffset);
    }
    offset += serializedLength(child);
  }
  return offset;
}

export function setCursorOffset(root: HTMLElement, offset: number): void {
  setSelectionOffsets(root, offset, offset);
}

export function setSelectionOffsets(root: HTMLElement, start: number, end: number): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const startPos = locatePosition(root, start);
  const endPos = locatePosition(root, end);
  if (!startPos || !endPos) {
    return;
  }
  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function locatePosition(root: HTMLElement, target: number): { node: Node; offset: number } | null {
  return locateInParent(root, target);
}

function locateInParent(parent: Node, target: number): { node: Node; offset: number } | null {
  let remaining = target;
  const children = parent.childNodes;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    if (index > 0 && needsBlockSeparator(children[index - 1]!, child)) {
      if (remaining === 0) {
        return { node: parent, offset: index };
      }
      remaining -= 1;
    }

    const childLength = serializedLength(child);
    if (remaining <= childLength) {
      if (child.nodeType === Node.TEXT_NODE) {
        return { node: child, offset: remaining };
      }
      if (child instanceof HTMLElement && child.tagName === "BR") {
        return remaining === 0 ? { node: parent, offset: index } : { node: parent, offset: index + 1 };
      }
      if (isAtomicChipElement(child)) {
        return remaining === 0 ? { node: parent, offset: index } : { node: parent, offset: index + 1 };
      }
      const nested = locateInParent(child, remaining);
      if (nested) {
        return nested;
      }
    }
    remaining -= childLength;
  }

  return { node: parent, offset: children.length };
}

const SKILL_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';

function appendSkillChip(
  root: HTMLElement,
  name: string,
  skillsByName: ReadonlyMap<string, SkillInfo>,
): void {
  const skill = skillsByName.get(name);
  const span = document.createElement("span");
  span.className = "composer-skill-inline";
  span.contentEditable = "false";
  span.dataset.skill = name;
  if (skill?.description) {
    span.title = skill.description;
  }
  const icon = document.createElement("span");
  icon.className = "composer-skill-inline-icon";
  icon.innerHTML = SKILL_ICON_SVG;
  const label = document.createElement("span");
  label.className = "composer-skill-inline-label";
  label.textContent = formatSkillDisplayName(name, skill);
  span.append(icon, label);
  root.appendChild(span);
}

function appendFileChip(root: HTMLElement, path: string): void {
  const span = document.createElement("span");
  span.className = "composer-file-inline";
  span.contentEditable = "false";
  span.dataset.filePath = path;
  span.title = path;
  const icon = document.createElement("img");
  icon.className = "composer-file-inline-icon";
  icon.src = getMaterialIconUrl(resolveMaterialIconName(path));
  icon.alt = "";
  icon.width = 14;
  icon.height = 14;
  icon.draggable = false;
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "composer-file-inline-label";
  label.textContent = workspaceFileReferenceBasename(path);
  span.append(icon, label);
  root.appendChild(span);
}

export function renderEditablePrompt(
  root: HTMLElement,
  text: string,
  skillsByName: ReadonlyMap<string, SkillInfo>,
): void {
  root.replaceChildren();
  if (!text) {
    return;
  }
  for (const segment of parsePromptSegments(text)) {
    if (segment.type === "text") {
      appendTextWithNewlines(root, segment.value);
      continue;
    }
    if (segment.type === "skill") {
      appendSkillChip(root, segment.name, skillsByName);
      continue;
    }
    appendFileChip(root, segment.path);
  }
}

function appendTextWithNewlines(root: HTMLElement, value: string): void {
  const parts = value.split("\n");
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index]) {
      root.appendChild(document.createTextNode(parts[index]!));
    }
    if (index < parts.length - 1) {
      root.appendChild(document.createElement("br"));
    }
  }
}

export function insertPlainTextAtSelection(text: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  selection.deleteFromDocument();
  const range = selection.getRangeAt(0);
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Insert a line break at the current selection without rebuilding the editor from React state. */
export function insertNewlineAtSelection(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  selection.deleteFromDocument();
  const range = selection.getRangeAt(0);
  const br = document.createElement("br");
  range.insertNode(br);
  range.setStartAfter(br);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
