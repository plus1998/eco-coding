import type { SkillInfo } from "../shared/skills";
import { formatSkillDisplayName, parsePromptSegments, skillToken } from "./composer-skills";

const SKILL_SELECTOR = "[data-skill]";

export function serializeEditable(root: HTMLElement): string {
  let out = "";
  for (const node of root.childNodes) {
    out += serializeNode(node);
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
  const skillName = node.dataset.skill;
  if (skillName) {
    return skillToken(skillName);
  }
  if (node.tagName === "DIV" || node.tagName === "P") {
    let block = "";
    for (const child of node.childNodes) {
      block += serializeNode(child);
    }
    return block;
  }
  let inline = "";
  for (const child of node.childNodes) {
    inline += serializeNode(child);
  }
  return inline;
}

function skillTokenLength(node: HTMLElement): number {
  const name = node.dataset.skill;
  return name ? skillToken(name).length : 0;
}

export function getSelectionOffsets(root: HTMLElement): { start: number; end: number } {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { start: 0, end: 0 };
  }
  return {
    start: offsetFromRoot(root, selection.anchorNode, selection.anchorOffset),
    end: offsetFromRoot(root, selection.focusNode, selection.focusOffset),
  };
}

export function getCursorOffset(root: HTMLElement): number {
  return getSelectionOffsets(root).end;
}

function offsetFromRoot(root: HTMLElement, targetNode: Node | null, targetOffset: number): number {
  if (!targetNode) {
    return 0;
  }
  let offset = 0;
  let found = false;

  function walk(parent: Node): void {
    if (found) {
      return;
    }
    for (const child of parent.childNodes) {
      if (found) {
        return;
      }
      if (child === targetNode) {
        if (child.nodeType === Node.TEXT_NODE) {
          offset += targetOffset;
        }
        found = true;
        return;
      }
      if (child instanceof HTMLElement && child.matches(SKILL_SELECTOR)) {
        const len = skillTokenLength(child);
        if (child.contains(targetNode)) {
          offset += len;
          found = true;
          return;
        }
        offset += len;
        continue;
      }
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (child === targetNode) {
          offset += targetOffset;
          found = true;
          return;
        }
        offset += text.length;
        continue;
      }
      if (child instanceof HTMLElement) {
        if (child.contains(targetNode)) {
          walk(child);
          return;
        }
        offset += serializeNode(child).length;
      }
    }
  }

  walk(root);
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

function locatePosition(
  root: HTMLElement,
  target: number,
): { node: Node; offset: number } | null {
  let remaining = target;

  function walk(parent: Node): { node: Node; offset: number } | null {
    for (const child of parent.childNodes) {
      if (child instanceof HTMLElement && child.matches(SKILL_SELECTOR)) {
        const len = skillTokenLength(child);
        if (remaining <= len) {
          if (remaining === 0) {
            return { node: parent, offset: Array.from(parent.childNodes).indexOf(child) };
          }
          return { node: parent, offset: Array.from(parent.childNodes).indexOf(child) + 1 };
        }
        remaining -= len;
        continue;
      }
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (remaining <= text.length) {
          return { node: child, offset: remaining };
        }
        remaining -= text.length;
        continue;
      }
      if (child instanceof HTMLElement) {
        const hit = walk(child);
        if (hit) {
          return hit;
        }
      }
    }
    return { node: parent, offset: parent.childNodes.length };
  }

  return walk(root);
}

const SKILL_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';

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
    const skill = skillsByName.get(segment.name);
    const span = document.createElement("span");
    span.className = "composer-skill-inline";
    span.contentEditable = "false";
    span.dataset.skill = segment.name;
    if (skill?.description) {
      span.title = skill.description;
    }
    const icon = document.createElement("span");
    icon.className = "composer-skill-inline-icon";
    icon.innerHTML = SKILL_ICON_SVG;
    const label = document.createElement("span");
    label.className = "composer-skill-inline-label";
    label.textContent = formatSkillDisplayName(segment.name, skill);
    span.append(icon, label);
    root.appendChild(span);
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
