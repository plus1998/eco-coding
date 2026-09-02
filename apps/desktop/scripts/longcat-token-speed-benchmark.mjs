/**
 * Ground-truth LongCat streaming benchmark (no Eco). Requires LONGCAT_API_KEY.
 *
 *   LONGCAT_API_KEY=... node scripts/longcat-token-speed-benchmark.mjs
 */
const apiKey = process.env.LONGCAT_API_KEY?.trim();
if (!apiKey) {
  console.error("Missing LONGCAT_API_KEY");
  process.exit(2);
}

const url = "https://api.longcat.chat/openai/v1/chat/completions";
const prompt =
  process.env.LONGCAT_BENCH_PROMPT?.trim() ||
  "Write a 300-word essay about token streaming speed measurement. Use varied vocabulary.";

function estTokens(text) {
  let ascii = 0;
  let nonAscii = 0;
  for (const c of text) {
    if ((c.codePointAt(0) ?? 0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4) + nonAscii;
}

const t0 = performance.now();
let tHeaders = null;
let tFirstReason = null;
let tFirstContent = null;
let tLastContent = null;
let tDone = null;
let content = "";
let reasoning = "";
let contentChunks = 0;
let usage = null;

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "LongCat-2.0",
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "user", content: prompt }],
  }),
});

if (!res.ok) {
  console.error("HTTP", res.status, await res.text());
  process.exit(1);
}

tHeaders = performance.now();
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const now = performance.now();
  buf += dec.decode(value, { stream: true });
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      tDone = now;
      continue;
    }
    try {
      const j = JSON.parse(data);
      if (j.usage) usage = j.usage;
      const delta = j.choices?.[0]?.delta ?? {};
      const rc = delta.reasoning_content ?? delta.reasoning ?? "";
      const ct = delta.content ?? "";
      if (rc && tFirstReason === null) tFirstReason = now;
      if (ct) {
        contentChunks += 1;
        if (tFirstContent === null) tFirstContent = now;
        tLastContent = now;
        content += ct;
      }
      if (rc) reasoning += rc;
    } catch {
      /* skip malformed chunks */
    }
  }
}
tDone ??= performance.now();

const completion = usage?.completion_tokens ?? 0;
const reasoningTok = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
const visibleTok = Math.max(0, completion - reasoningTok);
const estContent = estTokens(content);
const streamMs = tFirstContent && tLastContent ? tLastContent - tFirstContent : null;

const rate = (tokens, ms) => (ms && ms > 0 ? ((tokens * 1000) / ms).toFixed(1) : null);

console.log(
  JSON.stringify(
    {
      prompt: prompt.slice(0, 80),
      ttfbMs: Math.round(tHeaders - t0),
      ttftReasonMs: tFirstReason ? Math.round(tFirstReason - t0) : null,
      ttftContentMs: tFirstContent ? Math.round(tFirstContent - t0) : null,
      contentStreamMs: streamMs ? Math.round(streamMs) : null,
      totalMs: Math.round(tDone - t0),
      contentChunks,
      contentChars: content.length,
      reasoningChars: reasoning.length,
      usage: { completion, reasoningTok, visibleTok, estContent },
      rates: {
        visibleTok_per_contentStream: rate(visibleTok, streamMs),
        estContent_per_contentStream: rate(estContent, streamMs),
        allCompletion_per_contentStream: rate(completion, streamMs),
        allCompletion_per_wallAfterContent: rate(completion, tDone - (tFirstContent ?? tDone)),
      },
      ecoPitfalls: {
        tooFast_ifAllUsage_shortWindow: "completion_tokens / contentStreamMs when reasoning included",
        tooSlow_ifAllUsage_includesToolIdle:
          "completion_tokens / (lastMessage - firstMessage) across tool gaps",
      },
    },
    null,
    2,
  ),
);
