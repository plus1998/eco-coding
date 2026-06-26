export type StreamingPendingKind = "code" | "bash" | "diff" | "file";

export interface StreamingDisplaySnapshot {
  displayText: string;
  pendingBlock: boolean;
  pendingKind?: StreamingPendingKind;
}

export function resolveStreamingDisplaySnapshot(
  text: string,
  streaming: boolean,
): StreamingDisplaySnapshot {
  if (!streaming || !text) {
    return { displayText: text, pendingBlock: false };
  }

  const holdFrom = findStreamingHoldFromIndex(text);
  if (holdFrom === null) {
    return { displayText: text, pendingBlock: false };
  }

  const pending = text.slice(holdFrom);
  return {
    displayText: text.slice(0, holdFrom),
    pendingBlock: pending.length > 0,
    ...(pending.length > 0 && { pendingKind: classifyPendingBlock(pending) }),
  };
}

function findStreamingHoldFromIndex(text: string): number | null {
  const fenceHold = findIncompleteFenceHoldFrom(text);
  if (fenceHold !== null) {
    return fenceHold;
  }
  return findIncompleteStructuredEditHoldFrom(text);
}

function findIncompleteFenceHoldFrom(text: string): number | null {
  const lines = text.split("\n");
  let inFence = false;
  let fenceStartLineIndex = -1;
  let fenceMarker = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(/^(`{3,}|~{3,})(.*)$/);
    if (!match?.[1]) {
      continue;
    }
    const marker = match[1];
    if (!inFence) {
      inFence = true;
      fenceStartLineIndex = index;
      fenceMarker = marker;
      continue;
    }
    if (marker[0] === fenceMarker[0] && marker.length >= fenceMarker.length) {
      inFence = false;
      fenceStartLineIndex = -1;
      fenceMarker = "";
    }
  }

  if (!inFence || fenceStartLineIndex < 0) {
    return null;
  }

  let charIndex = 0;
  for (let index = 0; index < fenceStartLineIndex; index += 1) {
    charIndex += (lines[index]?.length ?? 0) + 1;
  }
  return charIndex;
}

function findIncompleteStructuredEditHoldFrom(text: string): number | null {
  const searchReplaceOpen = text.lastIndexOf("<<<<<<< SEARCH");
  if (searchReplaceOpen >= 0) {
    const tail = text.slice(searchReplaceOpen);
    if (!tail.includes(">>>>>>> REPLACE")) {
      return searchReplaceOpen;
    }
  }

  const conflictOpen = text.lastIndexOf("<<<<<<<");
  if (conflictOpen >= 0 && !text.slice(conflictOpen).includes(">>>>>>>")) {
    return conflictOpen;
  }

  return null;
}

function classifyPendingBlock(pending: string): StreamingPendingKind {
  const firstLine = pending.split("\n")[0] ?? "";
  const language = firstLine.replace(/^[`~]{3,}/, "").trim().toLowerCase();
  if (["bash", "sh", "shell", "zsh", "console", "terminal"].includes(language)) {
    return "bash";
  }
  if (["diff", "patch"].includes(language)) {
    return "diff";
  }
  if (pending.includes("<<<<<<<") || pending.includes(">>>>>>>")) {
    return "file";
  }
  return "code";
}
