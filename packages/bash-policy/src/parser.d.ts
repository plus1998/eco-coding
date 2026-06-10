import type { CommandSegment, PipelineNode, ShellAst } from "./types";
export declare function parseShellCommand(command: string): ShellAst;
export declare function collectCommandSegments(ast: ShellAst): CommandSegment[];
export declare function collectPipelines(ast: ShellAst): PipelineNode[];
