import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import {
  devRemoteDebuggingElectronArgs,
  resolveDevRemoteDebuggingPort,
} from "../../scripts/dev-remote-debugging-port.mjs";
import { waitForEcoReady } from "../helpers/eco-page";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envFile = path.join(desktopRoot, ".e2e-env.json");

type E2eEnv = {
  rendererUrl: string;
};

function readE2eEnv(): E2eEnv {
  if (!existsSync(envFile)) {
    throw new Error(`Missing ${envFile}. Run Playwright globalSetup first.`);
  }
  return JSON.parse(readFileSync(envFile, "utf8")) as E2eEnv;
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  ecoPage: Page;
}>({
  electronApp: async ({}, use) => {
    const { rendererUrl } = readE2eEnv();
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ),
      VITE_DEV_SERVER_URL: rendererUrl,
      ELECTRON_ENABLE_LOGGING: "1",
      ECO_E2E: "1",
      ECO_DEV_USER_DATA_SUFFIX: process.env.ECO_DEV_USER_DATA_SUFFIX ?? "E2E",
      ECO_DEV_CDP: process.env.ECO_DEV_CDP ?? "1",
      ECO_DEV_CDP_PORT: process.env.ECO_DEV_CDP_PORT ?? "9333",
    };

    const devCdpPort = resolveDevRemoteDebuggingPort(env);
    if (devCdpPort !== undefined) {
      env.ECO_DEV_CDP_PORT = String(devCdpPort);
    }

    const electronApp = await electron.launch({
      cwd: desktopRoot,
      args: [".", "--enable-logging", ...devRemoteDebuggingElectronArgs(devCdpPort)],
      env,
    });
    await use(electronApp);
    await electronApp.close();
  },
  ecoPage: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow({ timeout: 60_000 });
    await page.waitForLoadState("domcontentloaded");
    await waitForEcoReady(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";
