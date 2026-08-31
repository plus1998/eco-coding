import {
  approveBashIfPresent,
  clickSend,
  fillComposer,
  readFeedLoadingState,
} from "./helpers/eco-page";
import { expect, test } from "./fixtures/electron-app";

test("feed loading indicator appears and clears during bash run", async ({ ecoPage: page }) => {
  const marker = process.env.ECO_SMOKE_MARKER ?? `ECO_FEED_LOADING_${Date.now()}`;
  const sleepSeconds = Number.parseInt(process.env.ECO_SMOKE_SLEEP_SECONDS ?? "8", 10);
  const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "60000", 10);
  const prompt =
    process.env.ECO_SMOKE_PROMPT ??
    [
      `Run this safe Bash command with the Bash tool: sleep ${sleepSeconds} && echo ${marker}.`,
      "Do not modify files.",
      `After the command completes, reply only with ${marker}.`,
    ].join(" ");

  if (process.env.ECO_SMOKE_CONNECT_ONLY === "1") {
    console.log(
      `[feed-loading] connected title=${JSON.stringify(await page.title())} url=${page.url()}`,
    );
    return;
  }

  await fillComposer(page, prompt);
  await clickSend(page);

  const samples: Awaited<ReturnType<typeof readFeedLoadingState>>[] = [];
  let approvals = 0;
  let sawInlineLoading = false;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    approvals += await approveBashIfPresent(page);
    const state = await readFeedLoadingState(page);
    samples.push(state);
    if (state.inlineLoading > 0) {
      sawInlineLoading = true;
      break;
    }
    await page.waitForTimeout(500);
  }

  expect(sawInlineLoading, formatFailure("Timed out waiting for .run-log-inline-loading to appear.", samples, marker)).toBe(
    true,
  );

  while (Date.now() - startedAt < timeoutMs) {
    approvals += await approveBashIfPresent(page);
    const state = await readFeedLoadingState(page);
    samples.push(state);
    if (state.inlineLoading === 0) {
      console.log(`[feed-loading] ok marker=${marker} approvals=${approvals}`);
      console.log(
        JSON.stringify(
          {
            ok: true,
            marker,
            approvals,
            sawInlineLoading,
            lastAction: state.latestActions.at(-1),
            lastState: state,
          },
          null,
          2,
        ),
      );
      return;
    }
    await page.waitForTimeout(500);
  }

  throw new Error(formatFailure("Timed out waiting for .run-log-inline-loading to disappear.", samples, marker));
});

function formatFailure(
  message: string,
  samples: Awaited<ReturnType<typeof readFeedLoadingState>>[],
  marker: string,
): string {
  return `${message}\n${JSON.stringify({ marker, samples: samples.slice(-8) }, null, 2)}`;
}
