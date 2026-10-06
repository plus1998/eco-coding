import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const desktopRoot = path.resolve(path.dirname(scriptPath), "..");
const require = createRequire(path.join(desktopRoot, "package.json"));

if (process.argv.includes("--probe")) {
  await probeTerminal();
} else {
  // Success also requires the probe host to exit, including its native workers.
  const result = spawnSync(process.execPath, [scriptPath, "--probe"], {
    cwd: desktopRoot,
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Terminal runtime probe failed: exit=${result.status}, signal=${result.signal}`);
  if (result.stderr.trim()) throw new Error("Terminal runtime emitted errors during startup or cleanup");
  console.log("[PASS] native terminal loaded, spawned, returned output and closed; probe host exited");
}

async function probeTerminal() {
  const pty = require("node-pty");
  const marker = "ECO_TERMINAL_RUNTIME_OK";
  const isWindows = process.platform === "win32";
  const executable = isWindows ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
  const args = isWindows ? ["/d", "/s", "/c", `echo ${marker}`] : ["-c", `printf '${marker}\\n'`];
  const terminal = pty.spawn(executable, args, { cwd: desktopRoot, cols: 80, rows: 24 });

  await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      terminal.kill();
      reject(new Error("Terminal runtime did not exit within 10 seconds"));
    }, 10_000);
    terminal.onData((data) => { output += data; });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (exitCode !== 0 || !output.includes(marker)) {
        reject(new Error(`Terminal runtime failed: exit=${exitCode}, output=${JSON.stringify(output)}`));
      } else {
        resolve();
      }
    });
  });
}
