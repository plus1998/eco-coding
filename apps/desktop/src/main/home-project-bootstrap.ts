import fs from "node:fs/promises";
import os from "node:os";
import {
  buildHomeProjectPath,
  HOME_PROJECT_DISPLAY_NAME,
} from "../shared/home-project";
import type { WorkspaceInfo } from "../shared/ipc";
import { inspectWorkspace } from "./workspace-inspect";

let homeProjectPath: string | undefined;

export function getHomeProjectPath(): string {
  if (!homeProjectPath) {
    homeProjectPath = buildHomeProjectPath(os.homedir());
  }
  return homeProjectPath;
}

export async function ensureHomeProject(): Promise<WorkspaceInfo> {
  const resolvedPath = getHomeProjectPath();
  await fs.mkdir(resolvedPath, { recursive: true });
  const workspace = await inspectWorkspace(resolvedPath);
  return { ...workspace, name: HOME_PROJECT_DISPLAY_NAME };
}
