import fs from "node:fs/promises";

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
