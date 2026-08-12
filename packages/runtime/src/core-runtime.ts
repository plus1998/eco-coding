export const CORE_KINDS = ["claude", "codex", "pi"] as const;

export type CoreKind = (typeof CORE_KINDS)[number];
export type CoreSessionMode = "agent" | "plan" | "ask";
export type CoreCapabilitySupport = "native" | "eco" | "unsupported";

export interface CoreDescriptor {
  kind: CoreKind;
  displayName: string;
  version: string;
}

export interface CoreCapabilities {
  sessionModes: readonly CoreSessionMode[];
  compact: CoreCapabilitySupport;
  rewindFiles: CoreCapabilitySupport;
  toolApproval: CoreCapabilitySupport;
  planApproval: CoreCapabilitySupport;
  mcp: CoreCapabilitySupport;
  skills: CoreCapabilitySupport;
  subagents: CoreCapabilitySupport;
}

/**
 * v1 PI Core capabilities — Eco injects Skills visibility; MCP / subagents / approvals unsupported.
 */
export const PI_CORE_CAPABILITIES = {
  sessionModes: ["agent"],
  compact: "unsupported",
  rewindFiles: "unsupported",
  toolApproval: "unsupported",
  planApproval: "unsupported",
  mcp: "unsupported",
  skills: "eco",
  subagents: "unsupported",
} as const satisfies CoreCapabilities;

export interface CoreProbeResult {
  available: boolean;
  version?: string;
  reason?: string;
}

export interface CoreAdapter {
  readonly descriptor: CoreDescriptor;
  probe(): Promise<CoreProbeResult>;
  getCapabilities(): Promise<CoreCapabilities>;
}

export function isCoreKind(value: unknown): value is CoreKind {
  return typeof value === "string" && (CORE_KINDS as readonly string[]).includes(value);
}

export class CoreRegistry {
  private readonly adapters = new Map<CoreKind, CoreAdapter>();

  register(adapter: CoreAdapter): void {
    const kind = adapter.descriptor.kind;
    if (this.adapters.has(kind)) {
      throw new Error(`Core adapter is already registered: ${kind}`);
    }
    this.adapters.set(kind, adapter);
  }

  has(kind: CoreKind): boolean {
    return this.adapters.has(kind);
  }

  get(kind: CoreKind): CoreAdapter | undefined {
    return this.adapters.get(kind);
  }

  require(kind: CoreKind): CoreAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new Error(`Core adapter is not registered: ${kind}`);
    }
    return adapter;
  }

  list(): readonly CoreAdapter[] {
    return CORE_KINDS.flatMap((kind) => {
      const adapter = this.adapters.get(kind);
      return adapter ? [adapter] : [];
    });
  }
}
