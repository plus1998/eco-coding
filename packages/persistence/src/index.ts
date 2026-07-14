import type { AgentEvent, ApprovalRequest, ChangeSet, ModelProfile, UsageRecord } from "../../shared/src";

export const DATABASE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  parent_agent_id TEXT,
  role TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_events_thread_timestamp
  ON agent_events(thread_id, timestamp);

CREATE TABLE IF NOT EXISTS model_profiles (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model_id TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  context_window INTEGER,
  input_cost_per_million REAL,
  output_cost_per_million REAL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  cwd TEXT NOT NULL,
  command_json TEXT,
  file_path TEXT,
  reason TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS changesets (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  source_worktree_path TEXT NOT NULL,
  target_workspace_path TEXT NOT NULL,
  files_changed_json TEXT NOT NULL,
  diff TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE TABLE IF NOT EXISTS usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  estimated_cost_usd REAL,
  created_at TEXT NOT NULL
);
`;

export interface ThreadRecord {
  id: string;
  title: string;
  workspacePath: string;
  status: "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface EventStore {
  appendEvent(event: AgentEvent): Promise<void>;
  listEvents(threadId: string): Promise<AgentEvent[]>;
  upsertThread(thread: ThreadRecord): Promise<void>;
  getThread(threadId: string): Promise<ThreadRecord | undefined>;
  upsertModelProfile(profile: ModelProfile): Promise<void>;
  listModelProfiles(): Promise<ModelProfile[]>;
  saveApproval(request: ApprovalRequest): Promise<void>;
  saveChangeSet(changeSet: ChangeSet): Promise<void>;
  recordUsage(record: UsageRecord): Promise<void>;
}

export interface SecretStore {
  getSecret(service: string, account: string): Promise<string | undefined>;
  setSecret(service: string, account: string, value: string): Promise<void>;
  deleteSecret(service: string, account: string): Promise<void>;
}

export class InMemoryEventStore implements EventStore {
  private readonly events = new Map<string, AgentEvent[]>();
  private readonly threads = new Map<string, ThreadRecord>();
  private readonly profiles = new Map<string, ModelProfile>();
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly changesets = new Map<string, ChangeSet>();
  private readonly usageRecords: UsageRecord[] = [];

  async appendEvent(event: AgentEvent): Promise<void> {
    const threadEvents = this.events.get(event.threadId) ?? [];
    threadEvents.push(event);
    threadEvents.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    this.events.set(event.threadId, threadEvents);
  }

  async listEvents(threadId: string): Promise<AgentEvent[]> {
    return [...(this.events.get(threadId) ?? [])];
  }

  async upsertThread(thread: ThreadRecord): Promise<void> {
    this.threads.set(thread.id, thread);
  }

  async getThread(threadId: string): Promise<ThreadRecord | undefined> {
    return this.threads.get(threadId);
  }

  async upsertModelProfile(profile: ModelProfile): Promise<void> {
    this.profiles.set(profile.id, profile);
  }

  async listModelProfiles(): Promise<ModelProfile[]> {
    return [...this.profiles.values()];
  }

  async saveApproval(request: ApprovalRequest): Promise<void> {
    this.approvals.set(request.id, request);
  }

  async saveChangeSet(changeSet: ChangeSet): Promise<void> {
    this.changesets.set(changeSet.id, changeSet);
  }

  async recordUsage(record: UsageRecord): Promise<void> {
    this.usageRecords.push(record);
  }
}

export class InMemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, string>();

  async getSecret(service: string, account: string): Promise<string | undefined> {
    return this.secrets.get(secretKey(service, account));
  }

  async setSecret(service: string, account: string, value: string): Promise<void> {
    this.secrets.set(secretKey(service, account), value);
  }

  async deleteSecret(service: string, account: string): Promise<void> {
    this.secrets.delete(secretKey(service, account));
  }
}

export function redactSecrets(value: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length >= 4)
    .reduce((redacted, secret) => redacted.split(secret).join("[REDACTED]"), value);
}

function secretKey(service: string, account: string): string {
  return `${service}:${account}`;
}

export * from "./session-store.js";
