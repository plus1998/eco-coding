import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Pin pi-web-search to the session's own Eco model.
 *
 * Upstream resolves its model override as
 * `process.env.PI_WEB_SEARCH_CONFIG || join(getAgentDir(), "web-search.json")`,
 * and `getAgentDir()` is `process.env.PI_CODING_AGENT_DIR || ~/.pi/agent`.
 *
 * Eco hands the PI agent dir to the SDK per thread but never exports
 * PI_CODING_AGENT_DIR, so the fallback lands on the user's *global*
 * `~/.pi/agent/web-search.json`: a file Eco neither owns nor validates. When it
 * exists, native search silently runs on whatever model it names (see
 * `getWebSearchModel` → `modelRegistry.find(provider, model)`) instead of the
 * Eco model — bypassing the Eco gateway, its credentials and its billing, or
 * failing outright when the configured provider is absent from the session
 * registry. When it is malformed, the tool fails every call.
 *
 * Eco instead relies on upstream's own "no config file" path, where
 * `getWebSearchModel` returns `getModel(ctx)` → `ctx.model`. Under Eco that is
 * the session model from `ModelRuntime` bound to the Gateway base URL and the
 * attempt credential, so search is pinned to the current Eco model, gateway and
 * credentials per thread, with no shared mutable state.
 *
 * The env var is process-global while the model is per thread, so pointing it at
 * a per-thread file would race. It points at a constant path instead, and the
 * file is never written: the lookup always reports "missing".
 */
export const PI_WEB_SEARCH_CONFIG_ENV = "PI_WEB_SEARCH_CONFIG";

/** Constant, Eco-owned, never written — see {@link pinPiWebSearchToSessionModel}. */
export function pinnedPiWebSearchConfigPath(): string {
  return join(tmpdir(), "eco-pi-web-search-no-override.json");
}

/**
 * Force `PI_WEB_SEARCH_CONFIG` at a path that does not exist.
 *
 * Assigns unconditionally rather than defaulting: a `PI_WEB_SEARCH_CONFIG`
 * exported into the desktop process would reintroduce exactly the global-file
 * override this pin removes. Returns the pinned path so callers and tests can
 * assert on it.
 */
export function pinPiWebSearchToSessionModel(): string {
  const path = pinnedPiWebSearchConfigPath();
  // Upstream reads the file on every call. A leftover file (from an older build
  // or a hand-created one) would reintroduce the override, so the pinned state
  // must not depend on whatever happens to sit at this path.
  rmSync(path, { force: true });
  process.env[PI_WEB_SEARCH_CONFIG_ENV] = path;
  return path;
}
