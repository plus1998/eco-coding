import type {
  HtmlHostArtifact,
  HtmlHostPublishResult,
  HtmlHostToolInput,
  HtmlHostingCapability,
} from "../shared/html-host";
import { buildHtmlHostProbeUrl } from "../shared/html-host";

export class HtmlHostError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HtmlHostError";
    this.code = code;
  }
}

export interface HtmlHostApi {
  probeCapability(): Promise<HtmlHostingCapability>;
  publish(input: HtmlHostToolInput & { threadId?: string }): Promise<HtmlHostPublishResult>;
}

export class HtmlHostStore {
  private readonly byThread = new Map<string, HtmlHostArtifact[]>();
  private readonly byId = new Map<string, HtmlHostArtifact>();
  private readonly byToolUseId = new Map<string, string>();

  list(threadId: string): HtmlHostArtifact[] {
    return [...(this.byThread.get(threadId) ?? [])];
  }

  get(artifactId: string): HtmlHostArtifact | undefined {
    return this.byId.get(artifactId);
  }

  getArtifactByToolUseId(toolUseId: string): HtmlHostArtifact | undefined {
    const id = this.byToolUseId.get(toolUseId);
    return id ? this.byId.get(id) : undefined;
  }

  getLatestArtifact(threadId: string): HtmlHostArtifact | undefined {
    const list = this.byThread.get(threadId);
    return list?.[list.length - 1];
  }

  upsert(artifact: HtmlHostArtifact): void {
    this.byId.set(artifact.id, artifact);
    if (artifact.toolUseId) {
      this.byToolUseId.set(artifact.toolUseId, artifact.id);
    }
    const list = this.byThread.get(artifact.threadId) ?? [];
    const idx = list.findIndex((item) => item.id === artifact.id);
    if (idx >= 0) {
      list[idx] = artifact;
    } else {
      list.push(artifact);
    }
    this.byThread.set(artifact.threadId, list);
  }
}

export function normalizeHtmlHostToolInput(raw: Record<string, unknown>): HtmlHostToolInput {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const html = typeof raw.html === "string" ? raw.html : typeof raw.body === "string" ? raw.body : "";
  const pageId =
    typeof raw.pageId === "string"
      ? raw.pageId.trim()
      : typeof raw.page_id === "string"
        ? raw.page_id.trim()
        : undefined;
  if (!title) {
    throw new HtmlHostError("invalid_title", "title is required.");
  }
  if (!html.trim()) {
    throw new HtmlHostError("invalid_html", "html is required.");
  }
  if (html.length > 1_048_576) {
    throw new HtmlHostError("too_large", "html exceeds 1 MiB.");
  }
  return {
    title: title.slice(0, 200),
    html,
    ...(pageId ? { pageId } : {}),
  };
}

export async function probeHtmlHostingCapability(input: {
  supabaseUrl: string;
  anonKey: string;
  fetchImpl?: typeof fetch;
}): Promise<HtmlHostingCapability> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = buildHtmlHostProbeUrl(input.supabaseUrl);
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        apikey: input.anonKey,
        Authorization: `Bearer ${input.anonKey}`,
      },
    });
    const contentType = response.headers.get("content-type") ?? undefined;
    if (response.status === 404) {
      return {
        available: false,
        reason: "function_missing",
        checkedAt,
        detail: "html-host-probe Edge Function is not deployed.",
        ...(contentType ? { contentType } : {}),
      };
    }
    if (!response.ok) {
      return {
        available: false,
        reason: "probe_failed",
        checkedAt,
        detail: `probe HTTP ${response.status}`,
        ...(contentType ? { contentType } : {}),
      };
    }
    const normalized = (contentType ?? "").toLowerCase();
    const probeHeader = response.headers.get("x-eco-html-host-probe");
    if (normalized.includes("text/html") || probeHeader === "1") {
      const rewritten = !normalized.includes("text/html");
      return {
        available: true,
        reason: rewritten ? "content_type_rewritten" : "ok",
        ...(rewritten ? { renderRisk: true } : {}),
        checkedAt,
        ...(rewritten
          ? {
              detail:
                "Probe OK, but Content-Type is not text/html (often Cloud shared domain). Pages may not render in external browsers until Custom Domain is configured.",
            }
          : {}),
        ...(contentType ? { contentType } : {}),
      };
    }
    if (normalized.includes("text/plain")) {
      // Shared-domain rewrite still returns the HTML body as text/plain — allow publish with a warning.
      return {
        available: true,
        reason: "content_type_rewritten",
        renderRisk: true,
        checkedAt,
        detail:
          "Probe OK, but Content-Type is text/plain (Cloud shared domain rewrite). External links may show source; configure Custom Domain for reliable rendering.",
        ...(contentType ? { contentType } : {}),
      };
    }
    return {
      available: false,
      reason: "probe_failed",
      checkedAt,
      detail: `Unexpected Content-Type: ${contentType ?? "(missing)"}`,
      ...(contentType ? { contentType } : {}),
    };
  } catch (error) {
    return {
      available: false,
      reason: "probe_failed",
      checkedAt,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
