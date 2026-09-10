/**
 * Smoke-test account-owner device-disable (no deviceSecret) via REST.
 * Env: ECO_ANON_KEY, ECO_SERVICE_ROLE_KEY, optional ECO_DISABLE_NAME, ECO_DRY_RUN=1
 */
const url = "https://ajlczxfuzmkaheakjjpz.supabase.co";
const anon = process.env.ECO_ANON_KEY;
const service = process.env.ECO_SERVICE_ROLE_KEY;
if (!anon || !service) {
  console.error("Missing ECO_ANON_KEY / ECO_SERVICE_ROLE_KEY");
  process.exit(1);
}

const email = "plus.1998@qq.com";
const userId = "4df6710d-93fc-4e5f-bad1-67d68b7760c6";
const targetName = process.env.ECO_DISABLE_NAME || "MacNeo";
const targetId = process.env.ECO_DISABLE_ID || "";
const dry = process.env.ECO_DRY_RUN === "1";

async function admin(path, init = {}) {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${service}`,
      apikey: service,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${text}`);
  }
  return json;
}

const devices = await admin(
  `/rest/v1/devices?user_id=eq.${userId}&kind=eq.desktop&disabled_at=is.null&select=id,name,kind,disabled_at&order=name`,
);
console.log(
  "active desktops:",
  devices.map((d) => ({ id: d.id, name: d.name })),
);

const target = targetId ? devices.find((d) => d.id === targetId) : devices.find((d) => d.name === targetName);
if (!target) {
  console.error(targetId ? `No active desktop id ${targetId}` : `No active desktop named ${targetName}`);
  process.exit(1);
}

const link = await admin("/auth/v1/admin/generate_link", {
  method: "POST",
  body: JSON.stringify({ type: "magiclink", email }),
});
const tokenHash = link?.hashed_token || link?.properties?.hashed_token;
if (!tokenHash) {
  console.error("no hashed_token", link);
  process.exit(1);
}

const verifyRes = await fetch(`${url}/auth/v1/verify`, {
  method: "POST",
  headers: {
    apikey: anon,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    type: "magiclink",
    token_hash: tokenHash,
  }),
});
const verifyBody = await verifyRes.json();
if (!verifyRes.ok || !verifyBody.access_token) {
  console.error("verify failed", verifyRes.status, verifyBody);
  process.exit(1);
}
console.log("got user access token");

if (dry) {
  console.log("dry-run: would disable", target.id, target.name);
  process.exit(0);
}

const disableRes = await fetch(`${url}/functions/v1/device-disable`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${verifyBody.access_token}`,
    apikey: anon,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ deviceId: target.id, kind: "desktop" }),
});
const disableText = await disableRes.text();
console.log("device-disable status", disableRes.status, disableText);
if (!disableRes.ok) process.exit(1);

const after = await admin(`/rest/v1/devices?id=eq.${target.id}&select=id,name,disabled_at`);
console.log("after disable:", after);
