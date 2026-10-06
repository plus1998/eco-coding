import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(desktopRoot, "package.json"));
const pty = require("node-pty");
const marker = "ECO_TERMINAL_RUNTIME_OK";
const executable = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
const args = process.platform === "win32" ? ["/d", "/s", "/c", `echo ${marker}`] : ["-c", `printf '${marker}\\n'`];
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
console.log("[PASS] native terminal loaded, spawned, returned output and exited");
