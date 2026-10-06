import fs from "node:fs/promises";

/**
 * 写一个假的 codex 可执行文件（`#!/usr/bin/env node` 的 POSIX 脚本）。
 *
 * 文件没有扩展名，只能由 shebang 交给内核执行，Windows 的进程创建语义无法启动它（真实的 Windows
 * codex 是 `node_modules/.bin/codex.exe`）。所以依赖这个 fixture 的用例只在 POSIX 上运行，
 * 不假装覆盖 Windows 的进程启动语义；Windows 侧改由产品自身的可执行文件解析逻辑保证。
 */
export async function writeFakeCodexLogin(executable: string, authJson?: string): Promise<void> {
  await fs.writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
if (process.argv[2] !== 'app-server') process.exit(9);
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') send({ id: request.id, result: {} });
  else if (request.method === 'account/login/start') {
    send({ id: request.id, result: { type: 'chatgpt', loginId: 'fake-login', authUrl: 'https://auth.openai.com/oauth/authorize?client_id=test' } });
    const auth = ${JSON.stringify(authJson ?? null)};
    if (auth !== null) setTimeout(() => {
      fs.writeFileSync(path.join(process.env.CODEX_HOME, 'auth.json'), auth);
      send({ method: 'account/login/completed', params: { loginId: 'fake-login', success: true, error: null } });
    }, 200);
  }
});
`, { encoding: "utf8", mode: 0o755 });
}
