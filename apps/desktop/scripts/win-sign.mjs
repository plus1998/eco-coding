#!/usr/bin/env node
/**
 * Optional Authenticode signing hook (Cherry Studio style).
 * When WIN_SIGN is unset, this is a no-op so unsigned CI/local builds still
 * get electron-builder's default exe icon embedding without signtool failures.
 */
import { execSync } from "node:child_process";

export default async function winSign(configuration) {
  if (!process.env.WIN_SIGN?.trim() || !configuration.path) {
    return;
  }

  const certPath = process.env.ECO_WIN_CERT_PATH?.trim();
  const keyContainer = process.env.ECO_WIN_CERT_KEY?.trim();
  const csp = process.env.ECO_WIN_CERT_CSP?.trim();
  if (!certPath || !keyContainer || !csp) {
    throw new Error(
      "WIN_SIGN is set but ECO_WIN_CERT_PATH, ECO_WIN_CERT_KEY, or ECO_WIN_CERT_CSP is missing.",
    );
  }

  const timestampUrl = process.env.WIN_SIGN_TIMESTAMP_URL?.trim() || "http://timestamp.digicert.com";
  const signCommand =
    `signtool sign /tr "${timestampUrl}" /td sha256 /fd sha256 /v ` +
    `/f "${certPath}" /csp "${csp}" /k "${keyContainer}" "${configuration.path}"`;
  execSync(signCommand, { stdio: "inherit" });
}
