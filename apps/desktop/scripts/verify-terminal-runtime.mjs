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
    stdio: "inherit",
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Terminal runtime probe failed: exit=${result.status}, signal=${result.signal}`);
  console.log("[PASS] native terminal loaded, spawned, returned output and closed; probe host exited");
}

async function probeTerminal() {
  const pty = require("node-pty");
  const marker = "ECO_TERMINAL_RUNTIME_OK";
  const isWindows = process.platform === "win32";
  const executable = isWindows ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
  // node-pty 1.1.0 does not dispose its ConPTY worker on a natural shell exit.
  // Exercise public kill() while the interactive shell is alive, then await onExit.
  // https://github.com/microsoft/node-pty/issues/965
  const args = isWindows ? ["/d", "/q"] : ["-c", `printf '${marker}\\n'`];
  const terminal = pty.spawn(executable, args, { cwd: desktopRoot, cols: 80, rows: 24 });

  await new Promise((resolve, reject) => {
    let output = "";
    let closeRequested = false;
    const timeout = setTimeout(() => {
      terminal.kill();
      reject(new Error("Terminal runtime did not exit within 10 seconds"));
    }, 10_000);
    terminal.onData((data) => {
      output += data;
      if (isWindows && output.includes(marker) && !closeRequested) {
        closeRequested = true;
        terminal.kill();
      }
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (!output.includes(marker) || (isWindows ? !closeRequested : exitCode !== 0)) {
        reject(new Error(`Terminal runtime failed: exit=${exitCode}, output=${JSON.stringify(output)}`));
      } else {
        resolve();
      }
    });
    if (isWindows) terminal.write(`echo ${marker}\r`);
  });
}
