export interface StreamingDisplaySnapshot {
  displayText: string;
  pendingBlock: boolean;
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
  };
}

function findStreamingHoldFromIndex(text: string): number | null {
  return findIncompleteStructuredEditHoldFrom(text);
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
