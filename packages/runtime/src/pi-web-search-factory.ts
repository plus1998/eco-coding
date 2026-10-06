import { pinPiWebSearchToSessionModel } from "./pi-web-search-config.js";
import piWebSearch from "./pi-web-search-loader.js";

export const PI_WEB_SEARCH_EXTENSION_NAME = "pi-web-search" as const;

export async function createPiWebSearchExtensionFactory(): Promise<(pi: unknown) => void | Promise<void>> {
  // Native search must run on the session's Eco model over the Eco gateway, so
  // pin the upstream model override before the extension can read it. Only this
  // backend uses pi-web-search, and upstream resolves the path per call, so the
  // pin is in place well before the first `web_search` invocation.
  pinPiWebSearchToSessionModel();
  // The upstream extension publishes TypeScript source as its package entrypoint.
  // Bundle it into the desktop main process so Electron/Node never has to resolve
  // a workspace-only package from `dist/main` at runtime.
  const factory = piWebSearch;
  if (typeof factory !== "function") {
    throw new Error("pi-web-search default export is not an extension factory.");
  }
  return factory as (pi: unknown) => void | Promise<void>;
}
