export const PI_WEB_SEARCH_EXTENSION_NAME = "pi-web-search" as const;

export async function createPiWebSearchExtensionFactory(): Promise<(pi: unknown) => void | Promise<void>> {
  const mod = await import("pi-web-search");
  const factory = mod.default;
  if (typeof factory !== "function") {
    throw new Error("pi-web-search default export is not an extension factory.");
  }
  return factory as (pi: unknown) => void | Promise<void>;
}
