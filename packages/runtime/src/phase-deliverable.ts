const planningNoisePatterns: RegExp[] = [
  /^Creating isolated worktree/i,
  /^Isolated worktree ready:/i,
  /^Local model router ready:/i,
  /^Claude Agent SDK ready/i,
  /^Agent session started/i,
  /^Agent run completed/i,
  /^已清理隔离工作树/,
  /^Requesting model/i,
  /^Compacting context/i,
  /^API retry /i,
  /^Usage recorded/i,
  /^Run finished/i,
  /^Task (?:started|updated|completed)/i,
  /^【\d+\/\d+】/,
  /^Tool:\s/i,
  /^Running tool:/i,
  /^\[tool\]/i,
];

const analysisSectionPatterns: RegExp[] = [
  /(?:^|\n)##\s+(?:分析结果|Analysis\s+Result)(?:\s|:|$)/im,
  /(?:^|\n)---\s*\n+\s*##\s+(?:分析结果|Analysis)/m,
];

const planSectionPatterns: RegExp[] = [
  /(?:^|\n)##\s+(?:实现计划|Implementation\s+Plan|Plan\b)/im,
  /(?:^|\n)---\s*\n+\s*##\s+/m,
  /here(?:'s| is) (?:the )?(?:detailed )?implementation plan[:\s]*\n+---/i,
  /implementation plan[:\s]*\n+---/i,
  /here(?:'s| is) (?:the )?(?:detailed )?implementation plan[:\s]*\n+##/i,
];

/**
 * Strips tool/system noise from a planning-phase transcript and returns the user-facing deliverable.
 */
export function extractPhaseDeliverable(transcript: string, kind: "plan" | "analysis"): string {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return "";
  }

  if (kind === "plan") {
    const planStart = findPlanSectionStart(trimmed);
    if (planStart >= 0) {
      return trimmed.slice(planStart).trim();
    }
  }

  if (kind === "analysis") {
    const analysisStart = findAnalysisSectionStart(trimmed);
    if (analysisStart >= 0) {
      return trimmed.slice(analysisStart).trim();
    }
  }

  return stripPlanningTranscriptNoise(trimmed);
}

/** Splits a single planning-session transcript into analysis (optional) and plan sections. */
export function extractPlanningDeliverables(transcript: string): { analysis: string; plan: string } {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return { analysis: "", plan: "" };
  }

  const planStart = findPlanSectionStart(trimmed);
  const plan = planStart >= 0 ? trimmed.slice(planStart).trim() : extractPhaseDeliverable(trimmed, "plan");

  let analysis = "";
  const analysisStart = findAnalysisSectionStart(trimmed);
  if (analysisStart >= 0) {
    const analysisEnd = planStart >= 0 && planStart > analysisStart ? planStart : trimmed.length;
    analysis = trimmed.slice(analysisStart, analysisEnd).trim();
  } else if (planStart > 0) {
    analysis = stripPlanningTranscriptNoise(trimmed.slice(0, planStart)).trim();
  } else {
    analysis = extractPhaseDeliverable(trimmed, "analysis");
  }

  return { analysis, plan };
}

export function findAnalysisSectionStart(text: string): number {
  for (const pattern of analysisSectionPatterns) {
    const match = pattern.exec(text);
    if (match && match.index !== undefined) {
      return match.index;
    }
  }
  const phrase = /(?:^|\n)(?:##\s+)?分析结果/im.exec(text);
  if (phrase && phrase.index !== undefined) {
    return phrase.index;
  }
  return -1;
}

export function findPlanSectionStart(text: string): number {
  const candidates: number[] = [];

  for (const pattern of planSectionPatterns) {
    const match = pattern.exec(text);
    if (match && match.index !== undefined) {
      candidates.push(match.index);
    }
  }

  const phrase = /here(?:'s| is) (?:the )?(?:detailed )?implementation plan/i.exec(text);
  if (phrase) {
    const after = text.slice(phrase.index);
    const hr = after.search(/\n---\s*\n/);
    const heading = after.search(/\n##\s+/);
    if (hr >= 0) {
      candidates.push(phrase.index + hr + 1);
    }
    if (heading >= 0) {
      candidates.push(phrase.index + heading + 1);
    }
  }

  const planPhrase = /(?:^|\n)(?:##\s+)?实现计划/im.exec(text);
  if (planPhrase && planPhrase.index !== undefined) {
    candidates.push(planPhrase.index);
  }

  if (candidates.length > 0) {
    return Math.max(...candidates);
  }

  const headings = [...text.matchAll(/(?:^|\n)(##\s+[^\n]+)/gm)];
  const last = headings.at(-1);
  if (last?.index !== undefined) {
    return last.index;
  }

  return -1;
}

export function stripPlanningTranscriptNoise(text: string): string {
  const lines = text.split(/\n/);
  const kept: string[] = [];
  let blankRun = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      blankRun += 1;
      if (blankRun <= 1 && kept.length > 0) {
        kept.push("");
      }
      continue;
    }
    blankRun = 0;
    if (isPlanningNoiseLine(line)) {
      continue;
    }
    kept.push(rawLine.trimEnd());
  }

  return kept.join("\n").trim();
}

function isPlanningNoiseLine(line: string): boolean {
  return planningNoisePatterns.some((pattern) => pattern.test(line));
}
