import type { CommandSegment, CompoundSegment, PipelineNode, ShellAst } from "./types";

const COMPOUND_SPLIT = /\s*(?:&&|\|\||;)\s*/g;
const PIPELINE_SPLIT = /\s*\|\s*/g;

export function parseShellCommand(command: string): ShellAst {
  const trimmed = command.trim();
  if (!trimmed) {
    return { compounds: [] };
  }

  const compounds = trimmed
    .split(COMPOUND_SPLIT)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(parseCompoundSegment);

  return { compounds };
}

function parseCompoundSegment(raw: string): CompoundSegment {
  const stageRaws = raw.split(PIPELINE_SPLIT).map((segment) => segment.trim()).filter(Boolean);
  const stages = stageRaws.map((stageRaw) => tokenizeShellSegment(stageRaw));
  return {
    raw,
    pipelines: [{ raw, stages }],
  };
}

function tokenizeShellSegment(segment: string): CommandSegment {
  const hasHeredoc = segment.includes("<<");
  const withoutEnv = segment.replace(/^\s*(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*/, "").trim();
  const tokens = withoutEnv.split(/\s+/g).filter(Boolean);
  const program = tokens[0] ?? "";
  const flags: string[] = [];
  const args: string[] = [];
  const targets: string[] = [];

  for (const token of tokens.slice(1)) {
    if (token.startsWith("-")) {
      flags.push(token);
      continue;
    }
    args.push(token);
    targets.push(token);
  }

  return {
    program,
    flags,
    args,
    targets,
    raw: segment,
    ...(hasHeredoc ? { hasHeredoc: true } : {}),
  };
}

export function collectCommandSegments(ast: ShellAst): CommandSegment[] {
  const segments: CommandSegment[] = [];
  for (const compound of ast.compounds) {
    for (const pipeline of compound.pipelines) {
      segments.push(...pipeline.stages);
    }
  }
  return segments;
}

export function collectPipelines(ast: ShellAst): PipelineNode[] {
  const pipelines: PipelineNode[] = [];
  for (const compound of ast.compounds) {
    pipelines.push(...compound.pipelines);
  }
  return pipelines;
}
