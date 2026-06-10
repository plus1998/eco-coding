const COMPOUND_SPLIT = /\s*(?:&&|\|\||;)\s*/g;
const PIPELINE_SPLIT = /\s*\|\s*/g;
export function parseShellCommand(command) {
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
function parseCompoundSegment(raw) {
    const stageRaws = raw.split(PIPELINE_SPLIT).map((segment) => segment.trim()).filter(Boolean);
    const stages = stageRaws.map((stageRaw) => tokenizeShellSegment(stageRaw));
    return {
        raw,
        pipelines: [{ raw, stages }],
    };
}
function tokenizeShellSegment(segment) {
    const hasHeredoc = segment.includes("<<");
    const withoutEnv = segment.replace(/^\s*(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*/, "").trim();
    const tokens = withoutEnv.split(/\s+/g).filter(Boolean);
    const program = tokens[0] ?? "";
    const flags = [];
    const args = [];
    const targets = [];
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
export function collectCommandSegments(ast) {
    const segments = [];
    for (const compound of ast.compounds) {
        for (const pipeline of compound.pipelines) {
            segments.push(...pipeline.stages);
        }
    }
    return segments;
}
export function collectPipelines(ast) {
    const pipelines = [];
    for (const compound of ast.compounds) {
        pipelines.push(...compound.pipelines);
    }
    return pipelines;
}
