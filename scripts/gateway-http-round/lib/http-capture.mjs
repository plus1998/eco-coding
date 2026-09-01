import {
  appendJsonl,
  bodyKind,
  redactSecrets,
  snapshotHeaders,
  writeBodyArtifact,
} from "./fixture-io.mjs";

export async function captureHttpExchange(input) {
  const started = Date.now();
  const {
    fetchImpl = fetch,
    method,
    url,
    headers,
    body,
    secrets = [],
    scenarioId,
    layer,
    profileId,
    artifactDir,
    seq,
  } = input;

  const response = await fetchImpl(url, { method, headers, body });
  const contentType = response.headers.get("content-type") ?? "";
  const responseText = await response.text();
  const durationMs = Date.now() - started;

  const requestRow = {
    seq,
    ts: new Date().toISOString(),
    layer,
    profileId,
    scenarioId,
    request: redactSecrets(
      {
        method,
        url,
        headers: redactHeaderSecrets(snapshotHeaders(new Headers(headers)), secrets),
        body: body ?? null,
      },
      secrets,
    ),
    response: redactSecrets(
      {
        status: response.status,
        statusText: response.statusText,
        headers: snapshotHeaders(response.headers),
        contentType,
        bodyKind: bodyKind(contentType),
      },
      secrets,
    ),
    durationMs,
    ok: response.ok,
  };

  const bodyArtifact = writeBodyArtifact(
    artifactDir,
    `${String(seq).padStart(3, "0")}-${layer}-${scenarioId}-response`,
    responseText,
    contentType,
  );
  requestRow.response.bodyArtifact = bodyArtifact;

  return {
    exchange: requestRow,
    responseText,
    response: new Response(responseText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
  };
}

function redactHeaderSecrets(headers, secrets) {
  const next = { ...headers };
  for (const key of ["authorization", "x-api-key", "api-key"]) {
    if (next[key]) {
      next[key] = "***REDACTED***";
    }
  }
  for (const secret of secrets) {
    for (const [key, value] of Object.entries(next)) {
      if (typeof value === "string" && value.includes(secret)) {
        next[key] = value.split(secret).join("***REDACTED***");
      }
    }
  }
  return next;
}

export function logExchange(logPath, exchange) {
  appendJsonl(logPath, exchange);
}
