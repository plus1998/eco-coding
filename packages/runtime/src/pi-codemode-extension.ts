/**
 * Build the official PI codemode extension.
 *
 * The tool registers for every session but stays inactive unless its name is in
 * the session's tool allowlist (`defaultActive: false` upstream), so the
 * allowlist built in pi-session-mode.ts / pi-subagent.ts is what enables it.
 *
 * `models: false` keeps the session's model catalog out of scripts: Eco routes
 * every model call through its own gateway billing, and a script calling models
 * directly would bypass it.
 */

import { createCodemodeExtension, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { PI_CODEMODE_MODE } from "./pi-codemode.js";

export const PI_CODEMODE_EXTENSION_NAME = "eco-pi-codemode" as const;

export function createPiCodemodeExtensionFactory(): ExtensionFactory {
  return createCodemodeExtension({ mode: PI_CODEMODE_MODE, models: false });
}
