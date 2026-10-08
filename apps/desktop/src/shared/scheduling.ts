import type { CoreKind } from "@eco/runtime";
import type { ThreadRuntimeConfig } from "./thread-runtime-config";

export type ScheduleTrigger =
  | { type: "at"; at: string }
  | { type: "interval"; everySeconds: number; anchorAt: string }
  | { type: "cron"; expression: string; timezone: string };

export interface ScheduleExecutionProfile {
  coreKind: CoreKind;
  runtimeConfig: ThreadRuntimeConfig;
}

export type ScheduleCreateInput = {
  /** Stable key: retries of the same creation return the same definition. */
  requestId: string;
  name: string;
  trigger: ScheduleTrigger;
  maxLatenessSeconds?: number;
} & (
  | { kind: "session_message"; threadId: string; prompt: string }
  | { kind: "scheduled_task"; workspacePath: string; prompt: string; executionProfile: ScheduleExecutionProfile }
);

export interface ScheduleDefinition {
  id: string;
  kind: "session_message" | "scheduled_task";
  name: string;
  prompt: string;
  trigger: ScheduleTrigger;
  enabled: boolean;
  maxLatenessSeconds: number;
  source: "user" | "agent";
  originThreadId?: string;
  threadId?: string;
  workspacePath?: string;
  executionProfile?: ScheduleExecutionProfile;
  revision: number;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  error?: string;
  /** Original creation payload fingerprint; edits never change its idempotency identity. */
  creationSignature?: string;
}

export interface ScheduleUpdateInput {
  id: string;
  expectedRevision: number;
  name?: string;
  prompt?: string;
  trigger?: ScheduleTrigger;
  enabled?: boolean;
  maxLatenessSeconds?: number;
  workspacePath?: string;
  executionProfile?: ScheduleExecutionProfile;
}

export type ScheduleOccurrenceStatus = "pending" | "dispatching" | "running" | "waiting_user" | "completed" | "failed" | "skipped" | "unknown" | "cancelled";
export interface ScheduleOccurrence {
  id: string;
  scheduleId: string;
  scheduledAt: string;
  status: ScheduleOccurrenceStatus;
  definition: ScheduleDefinition;
  threadId?: string;
  followUpId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulingSnapshot {
  schedules: ScheduleDefinition[];
  occurrences: ScheduleOccurrence[];
}

/** A paused one-shot whose planned date has passed; re-arming it has no future tick to offer. */
export function isExpiredOneShotSchedule(definition: ScheduleDefinition, now = Date.now()): boolean {
  return !definition.enabled && definition.trigger.type === "at" && Date.parse(definition.trigger.at) <= now;
}

export const SCHEDULING_MCP_SERVER = "eco_scheduling";
export const SCHEDULING_PROMPT = `Eco has two distinct scheduling capabilities. Use schedule_message to wake THIS conversation later with its latest context and settings; messages wait until the current turn finishes and never interrupt it. Agent wakeups are one-shot (minimum 60 seconds, maximum 24 hours, at most 24 per conversation per rolling 24 hours). Use create_scheduled_task for an independent, self-contained task; EVERY occurrence creates a NEW conversation and has no source conversation history. The host saves this conversation's effective AgentCore and model at creation. Users can change that task's Core/model in the scheduling panel; update_scheduled_task never changes them. Use five-field cron with an explicit IANA timezone, fixed intervals, or an ISO timestamp including timezone. Execution requires Eco running on an awake local computer. Do not claim a schedule exists until the tool succeeds. Use list_schedules to inspect and cancel_schedule to cancel. Do not create recurring tasks to continue this conversation; use schedule_message. If a task needs context, include it in its instructions.`;
