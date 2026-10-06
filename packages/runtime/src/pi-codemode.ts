/**
 * Codemode tool naming.
 *
 * Renderer-safe on purpose (no PI runtime import): the desktop renderer reads
 * the name to classify feed rows. The extension factory itself lives in
 * pi-codemode-extension.ts.
 */

/** The registered name of the codemode tool in the official extension. */
export const PI_CODEMODE_TOOL_NAME = "codemode";

/**
 * Eco never sets PI's `codemode.mode` setting, so the extension always reads
 * its own default (`on`). Tool exposure is decided by the session allowlist:
 * Agent names `codemode`, Ask/Plan never do.
 */
export const PI_CODEMODE_MODE = "on" as const;
