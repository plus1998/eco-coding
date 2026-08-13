/**
 * Eco extension factory for PI: registers the Agent delegation tool.
 * Schema agent enum comes only from the thread orchestration snapshot.
 */
import { Type, type Static, type TSchema } from "typebox";
import type { AgentEvent } from "../../shared/src";
import {
  listEnabledPiSubagents,
  PI_AGENT_TOOL_NAME,
  truncatePiSubagentResult,
  type PiEnabledSubagent,
  type PiSubagentSpawnHandler,
} from "./pi-subagent.js";
import type { EcoAgentRuntimeConfig } from "./agent-orchestration.js";

type SideEventEmitter = (event: AgentEvent) => void;

export interface EcoPiExtensionApi {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    parameters: TSchema;
    executionMode?: "sequential" | "parallel";
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: ((partial: { content: Array<{ type: "text"; text: string }>; details: unknown }) => void) | undefined,
      ctx: { cwd: string },
    ) => Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
  }): void;
}

export interface CreateEcoPiAgentExtensionInput {
  threadId: string;
  registry: EcoAgentRuntimeConfig;
  onSubagentSpawn: PiSubagentSpawnHandler;
  /** Push child Eco feed events into the parent prompt stream. */
  emitSideEvent: SideEventEmitter;
  /** Nested PI sessions must not register Agent again. */
  disableSubagents?: boolean;
}

export function createEcoPiAgentExtensionFactory(
  input: CreateEcoPiAgentExtensionInput,
): (pi: EcoPiExtensionApi) => void {
  return (pi) => {
    if (input.disableSubagents) {
      return;
    }
    const agents = listEnabledPiSubagents(input.registry);
    if (agents.length === 0) {
      return;
    }
    registerAgentTool(pi, {
      threadId: input.threadId,
      agents,
      onSubagentSpawn: input.onSubagentSpawn,
      emitSideEvent: input.emitSideEvent,
    });
  };
}

function registerAgentTool(
  pi: EcoPiExtensionApi,
  input: {
    threadId: string;
    agents: readonly PiEnabledSubagent[];
    onSubagentSpawn: PiSubagentSpawnHandler;
    emitSideEvent: SideEventEmitter;
  },
): void {
  const agentKeys = input.agents.map((agent) => agent.agentKey);
  const byKey = new Map(input.agents.map((agent) => [agent.agentKey, agent]));
  const guidance = input.agents
    .map((agent) => `- ${agent.agentKey}: ${agent.description.split("\n")[0] ?? agent.displayName}`)
    .join("\n");

  const agentSchema =
    agentKeys.length === 1
      ? Type.Literal(agentKeys[0]!)
      : Type.Union(agentKeys.map((key) => Type.Literal(key)));

  const parameters = Type.Object({
    agent: agentSchema,
    task: Type.String({
      minLength: 1,
      description: "Self-contained task for the selected subagent (goal, constraints, expected output).",
    }),
  });

  type Params = Static<typeof parameters>;

  pi.registerTool({
    name: PI_AGENT_TOOL_NAME,
    label: "Agent",
    description: [
      "Delegate a self-contained task to a specialized subagent with an isolated context window.",
      "Available agents for THIS session only:",
      guidance,
      "Do not invent agent names. Subagents cannot launch further subagents.",
    ].join("\n"),
    promptSnippet: "Delegate work to a session-scoped specialized subagent",
    parameters,
    executionMode: "sequential",
    async execute(toolCallId, rawParams, signal, onUpdate) {
      const params = rawParams as Params;
      const agentKey = String(params.agent ?? "").trim();
      const task = String(params.task ?? "").trim();
      const agent = byKey.get(agentKey);
      if (!agent) {
        const known = agentKeys.join(", ");
        throw new Error(`Unknown agent "${agentKey}". Available in this session: ${known || "none"}.`);
      }
      if (!task) {
        throw new Error("Agent task must be a non-empty string.");
      }

      onUpdate?.({
        content: [{ type: "text", text: `Delegating to ${agent.displayName} (${agentKey})…` }],
        details: { agent: agentKey, status: "starting" },
      });

      const result = await input.onSubagentSpawn({
        threadId: input.threadId,
        parentToolUseId: toolCallId,
        agentKey,
        task,
        ...(signal ? { signal } : {}),
        emitEvent: input.emitSideEvent,
      });

      const truncated = truncatePiSubagentResult(result.text);
      onUpdate?.({
        content: [{ type: "text", text: truncated.text }],
        details: {
          agent: agentKey,
          agentId: result.agentId,
          truncated: truncated.truncated,
          status: "completed",
        },
      });

      return {
        content: [{ type: "text", text: truncated.text }],
        details: {
          agent: agentKey,
          agentId: result.agentId,
          truncated: truncated.truncated,
        },
      };
    },
  });
}
