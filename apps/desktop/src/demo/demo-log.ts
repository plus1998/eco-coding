/** Demo main process logging — stderr may be closed (EPIPE) when Electron is not attached to a TTY. */
export function installDemoStdioGuard(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream?.on?.("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") {
        return;
      }
      throw error;
    });
  }
}

export function demoLog(...args: unknown[]): void {
  try {
    console.error(...args);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPIPE") {
      throw error;
    }
  }
}
