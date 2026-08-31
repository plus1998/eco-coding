import { app } from "electron";
import path from "node:path";
import {
  DEFAULT_DEV_USER_DATA_SUFFIX,
  resolveDevUserDataSuffix,
} from "./desktop-dev-user-data-suffix";

/** Packaged desktop identity ({@link electron-builder.yml}). */
export const DESKTOP_PACKAGED_APP_ID = "com.eco.coding";

export const DESKTOP_DEV_APP_NAME = "Eco Coding Dev";

/**
 * Unpackaged dev userData path: default Electron userData + suffix.
 * Electron scopes {@link app.requestSingleInstanceLock} to this directory.
 */
export function resolveDevUserDataPath(configuredSuffix?: string): string {
  return app.getPath("userData") + resolveDevUserDataSuffix(configuredSuffix);
}

function divertDevLogs(suffix: string): void {
  if (process.platform === "darwin") {
    app.setAppLogsPath(app.getPath("logs") + suffix);
    return;
  }
  app.setAppLogsPath(path.join(app.getPath("userData") + suffix, "logs"));
}

/**
 * Isolate unpackaged dev from the installed app via userData suffix (single-instance
 * lock), optional multi-instance suffix, dock/menu name, and log paths.
 *
 * Must run before {@link app.requestSingleInstanceLock} and any other
 * `app.getPath("userData")` reads that should see the dev directory.
 */
export function configureDesktopDevIdentity(): void {
  if (app.isPackaged) {
    return;
  }

  const suffix = resolveDevUserDataSuffix(process.env.ECO_DEV_USER_DATA_SUFFIX);
  divertDevLogs(suffix);
  app.setPath("userData", app.getPath("userData") + suffix);
  app.setName(DESKTOP_DEV_APP_NAME);
}

export { DEFAULT_DEV_USER_DATA_SUFFIX, resolveDevUserDataSuffix };
