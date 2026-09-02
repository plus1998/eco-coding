import { createPiIntegratedWebSearchExtensionFactory } from "./pi-integrated-web-search-factory.js";
import { createPiWebSearchExtensionFactory, PI_WEB_SEARCH_EXTENSION_NAME } from "./pi-web-search-factory.js";
import { PI_INTEGRATED_WEB_SEARCH_EXTENSION_NAME } from "./pi-integrated-web-search-factory.js";
import { PI_WEB_SEARCH_TOOL_NAME, type PiWebSearchBackend } from "./pi-web-search-plan.js";

export interface PiWebSearchSessionPartsInput {
  backend: PiWebSearchBackend;
  integratedProvider?: import("./pi-integrated-web-search.js").IntegratedWebSearchProvider;
  integratedApiKey?: string;
  extensionFactories: Array<{
    name: string;
    factory: (pi: unknown) => void | Promise<void>;
  }>;
  toolsAllowlist: string[];
}

export async function appendPiWebSearchSessionParts(input: PiWebSearchSessionPartsInput): Promise<void> {
  if (input.backend === "none") {
    return;
  }
  if (!input.toolsAllowlist.includes(PI_WEB_SEARCH_TOOL_NAME)) {
    input.toolsAllowlist.push(PI_WEB_SEARCH_TOOL_NAME);
  }
  const hasWebSearchExtension = input.extensionFactories.some(
    (entry) =>
      entry.name === PI_WEB_SEARCH_EXTENSION_NAME || entry.name === PI_INTEGRATED_WEB_SEARCH_EXTENSION_NAME,
  );
  if (hasWebSearchExtension) {
    return;
  }
  if (input.backend === "native") {
    const factory = await createPiWebSearchExtensionFactory();
    input.extensionFactories.push({ name: PI_WEB_SEARCH_EXTENSION_NAME, factory });
    return;
  }
  const apiKey = input.integratedApiKey?.trim();
  if (!apiKey) {
    throw new Error("Integrated web search is enabled but the API key is missing.");
  }
  const provider = input.integratedProvider ?? "tavily";
  input.extensionFactories.push({
    name: PI_INTEGRATED_WEB_SEARCH_EXTENSION_NAME,
    factory: createPiIntegratedWebSearchExtensionFactory({ provider, apiKey }) as (pi: unknown) => void,
  });
}
