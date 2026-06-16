import fs from "node:fs";
import path from "node:path";

const PACKAGE_JSON_NAME = "package.json";
const DEBOUNCE_MS = 200;

export type PackageJsonChangeListener = (workspacePath: string) => void;

export class PackageJsonWatcher {
  private watcher: fs.FSWatcher | undefined;
  private watchedWorkspacePath: string | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly onChange: PackageJsonChangeListener) {}

  watch(workspacePath: string): void {
    const resolvedPath = path.resolve(workspacePath);
    if (this.watchedWorkspacePath === resolvedPath) {
      return;
    }

    this.stop();
    this.watchedWorkspacePath = resolvedPath;

    const packageJsonPath = path.join(resolvedPath, PACKAGE_JSON_NAME);
    try {
      this.watcher = fs.watch(packageJsonPath, (eventType) => {
        if (eventType !== "change" && eventType !== "rename") {
          return;
        }
        this.scheduleChange(resolvedPath);
      });
    } catch {
      try {
        this.watcher = fs.watch(resolvedPath, (eventType, filename) => {
          if (filename !== null && filename !== PACKAGE_JSON_NAME) {
            return;
          }
          if (eventType !== "change" && eventType !== "rename") {
            return;
          }
          this.scheduleChange(resolvedPath);
        });
      } catch {
        this.watchedWorkspacePath = undefined;
      }
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.watcher?.close();
    this.watcher = undefined;
    this.watchedWorkspacePath = undefined;
  }

  private scheduleChange(workspacePath: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      if (this.watchedWorkspacePath === workspacePath) {
        this.onChange(workspacePath);
      }
    }, DEBOUNCE_MS);
  }
}
