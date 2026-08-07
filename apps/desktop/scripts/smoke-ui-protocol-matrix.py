#!/usr/bin/env python3
"""UI × DeepSeek 三协议：经 window.eco.saveProvider 热切兼容层（无需杀 Electron）。

In-process Gateway 会在 emitSettingsUpdated → scheduleCodexGlobalRuntimeRefresh 后 setProviders。
"""
from __future__ import annotations

import base64
import json
import os
import signal
import subprocess
import time
import urllib.request
from pathlib import Path

REPO = Path("/Users/plus/Desktop/workspace/ai/eco-coding")
DESKTOP = REPO / "apps/desktop"
REPORT = REPO / ".cursor/smoke-reports"
REPORT.mkdir(parents=True, exist_ok=True)
PROVIDER_ID = "deepseek-1z2ogb"
PROFILE_ID = "deepseek-bean1o"
MODEL = "deepseek-v4-flash"
ELECTRON = REPO / "node_modules/.bun/electron@37.10.3/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
VITE = DESKTOP / "node_modules/.bin/vite"
TS = int(time.time())

PROTOCOLS = [
    {
        "id": "anthropic",
        "apiCompat": "anthropic",
        "requestPath": "/anthropic",
        "tokenCountMode": "anthropic_messages",
        "upstreamKind": "anthropic-messages",
    },
    {
        "id": "openai_responses",
        "apiCompat": "openai_responses",
        "requestPath": "",
        "tokenCountMode": "local_heuristic",
        "upstreamKind": "responses",
    },
    {
        "id": "openai_chat_completions",
        "apiCompat": "openai_chat_completions",
        "requestPath": "",
        "tokenCountMode": "local_heuristic",
        "upstreamKind": "openai-chat",
    },
]
CORES = ["Claude Code", "Codex"]


def log(*a):
    print(*a, flush=True)


def up(url: str) -> bool:
    try:
        urllib.request.urlopen(url, timeout=1.5)
        return True
    except Exception:
        return False


def http_json(url: str, timeout: float = 2.0):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"_error": str(e)}


def ab(*args: str, timeout: int = 120) -> str:
    p = subprocess.run(
        ["env", "-u", "ELECTRON_RUN_AS_NODE", "npx", "--yes", "agent-browser", "--cdp", "9222", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    lines = [
        ln
        for ln in ((p.stdout or "") + "\n" + (p.stderr or "")).splitlines()
        if "Unknown env config" not in ln
    ]
    return "\n".join(lines).strip()


def ab_eval(js: str, timeout: int = 120) -> str:
    return ab("eval", js, timeout=timeout)


def parse_jsonish(text: str):
    text = (text or "").strip()
    if not text:
        return None
    # find last complete JSON object
    starts = [i for i, ch in enumerate(text) if ch == "{"]
    for i in reversed(starts):
        try:
            return json.loads(text[i:])
        except json.JSONDecodeError:
            continue
    if text.startswith("[") or text.startswith('"'):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
    return text


def ensure_stack() -> None:
    env = os.environ.copy()
    env.pop("ELECTRON_RUN_AS_NODE", None)
    if not up("http://127.0.0.1:5173/"):
        log("start vite")
        subprocess.Popen(
            [str(VITE), "--host", "127.0.0.1", "--strictPort", "--port", "5173"],
            cwd=str(DESKTOP),
            env=env,
            stdout=open("/tmp/eco-vite.log", "a"),
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        for _ in range(40):
            if up("http://127.0.0.1:5173/"):
                break
            time.sleep(0.5)
    if up("http://127.0.0.1:9222/json/version") and up("http://127.0.0.1:18765/health"):
        h = http_json("http://127.0.0.1:18765/health")
        if h.get("ok") and h.get("providers"):
            log("stack already up, providers=", len(h.get("providers") or []))
            return
    # soft start electron without killing existing unless CDP dead
    if not up("http://127.0.0.1:9222/json/version"):
        log("start electron CDP")
        env["VITE_DEV_SERVER_URL"] = "http://127.0.0.1:5173/"
        env["ELECTRON_ENABLE_LOGGING"] = "1"
        subprocess.Popen(
            [
                str(ELECTRON),
                ".",
                "--remote-debugging-port=9222",
                "--remote-allow-origins=*",
                "--enable-logging",
            ],
            cwd=str(DESKTOP),
            env=env,
            stdout=open("/tmp/eco-electron-cdp.log", "a"),
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    for i in range(120):
        if up("http://127.0.0.1:9222/json/version") and up("http://127.0.0.1:18765/health"):
            h = http_json("http://127.0.0.1:18765/health")
            if h.get("ok") and h.get("providers"):
                log("stack ready t=", (i + 1) * 0.5)
                return
        time.sleep(0.5)
    raise RuntimeError(f"stack not ready: cdp={up('http://127.0.0.1:9222/json/version')} health={http_json('http://127.0.0.1:18765/health')}")


def ipc_eval(async_body: str, timeout: int = 90):
    """Run async IIFE in renderer; expects JSON-serializable return."""
    js = f"(async () => {{ try {{ {async_body} }} catch (e) {{ return {{ ok:false, error:String(e && e.message || e) }}; }} }})()"
    return parse_jsonish(ab_eval(js, timeout=timeout))


def snapshot_settings():
    return ipc_eval(
        """
const s = await window.eco.getModelSettings();
const providers = s.providers || [];
const deepseek = providers.find(p => p.id === 'deepseek-1z2ogb');
const profiles = s.routeProfiles || s.profiles || [];
const deepProfile = profiles.find(p => p.id === 'deepseek-bean1o');
// also dump keys for debugging first time
return {
  ok: true,
  topKeys: Object.keys(s||{}),
  deepseek: deepseek ? {
    id: deepseek.id,
    name: deepseek.name,
    baseUrl: deepseek.baseUrl,
    requestPath: deepseek.requestPath ?? '',
    apiCompat: deepseek.apiCompat,
    tokenCountMode: deepseek.tokenCountMode,
    defaultModel: deepseek.defaultModel,
    enabled: deepseek.enabled,
    // keep secret token placeholder: omit raw; saveProvider keeps existing if empty
    hasKey: !!(deepseek.apiKey && deepseek.apiKey.length),
  } : null,
  profile: deepProfile ? {
    id: deepProfile.id,
    name: deepProfile.name,
    routes: (deepProfile.routes||[]).map(r => ({
      role: r.role,
      providerId: r.providerId,
      modelId: r.modelId,
      apiCompat: r.apiCompat,
      thinkingEffort: r.thinkingEffort,
    })),
  } : null,
  activeProfileId: s.activeRouteProfileId || s.activeProfileId || null,
};
"""
    )


def apply_protocol_ipc(proto: dict):
    body = f"""
const proto = {json.dumps(proto)};
const s = await window.eco.getModelSettings();
const providers = s.providers || [];
const deepseek = providers.find(p => p.id === 'deepseek-1z2ogb');
if (!deepseek) return {{ ok:false, error:'no-deepseek-provider' }};
const saved = await window.eco.saveProvider({{
  id: deepseek.id,
  name: deepseek.name,
  baseUrl: 'https://api.deepseek.com',
  requestPath: proto.requestPath,
  apiCompat: proto.apiCompat,
  tokenCountMode: proto.tokenCountMode,
  defaultModel: '{MODEL}',
  enabled: true,
  // empty key preserves existing secret
  apiKey: '',
}});
const profiles = s.routeProfiles || s.profiles || [];
const deepProfile = profiles.find(p => p.id === 'deepseek-bean1o');
let profileSaved = null;
if (deepProfile) {{
  const routes = (deepProfile.routes||[]).map(r => ({{
    ...r,
    providerId: 'deepseek-1z2ogb',
    modelId: '{MODEL}',
    apiCompat: proto.apiCompat,
  }}));
  profileSaved = await window.eco.saveRouteProfile({{
    id: deepProfile.id,
    name: deepProfile.name,
    routes,
  }});
}}
// wait a bit for gateway setProviders
await new Promise(r => setTimeout(r, 1500));
return {{
  ok: true,
  provider: {{ id: saved.id, apiCompat: saved.apiCompat, requestPath: saved.requestPath }},
  profile: profileSaved ? {{ id: profileSaved.id, routes: (profileSaved.routes||[]).length }} : null,
}};
"""
    return ipc_eval(body, timeout=60)


def wait_kind(expected: str, timeout: float = 45) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        h = http_json("http://127.0.0.1:18765/health")
        for p in h.get("providers") or []:
            if p.get("id") == PROVIDER_ID and p.get("upstreamKind") == expected:
                log("upstreamKind OK", expected)
                return True
        time.sleep(0.6)
    h = http_json("http://127.0.0.1:18765/health")
    kinds = [(p.get("id"), p.get("upstreamKind")) for p in h.get("providers") or [] if p.get("id") == PROVIDER_ID]
    log("upstreamKind wait fail expected", expected, "got", kinds)
    return False


def dismiss_ui():
    ab_eval(
        """(() => {
  document.querySelectorAll('.sidebar-search-backdrop-close').forEach(b=>{try{b.click()}catch{}});
  const back=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||'')==='返回');
  if (back) back.click();
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  return true;
})()"""
    )
    time.sleep(0.3)


def switch_core(target: str) -> dict:
    dismiss_ui()
    ab_eval(
        """(() => {
  const core=[...document.querySelectorAll('button')].find(b=>/当前 Core/.test(b.getAttribute('aria-label')||''));
  if (core) core.click();
  return !!core;
})()"""
    )
    time.sleep(0.45)
    out = ab_eval(
        f"""(() => {{
  const items=[...document.querySelectorAll('[role="menuitemradio"]')];
  let hit=items.find(el=>(el.textContent||'').trim()==={json.dumps(target)});
  if (!hit) hit=items.find(el=>(el.textContent||'').trim().startsWith({json.dumps(target)}));
  if (!hit) return {{ok:false, texts:items.map(i=>(i.textContent||'').trim().slice(0,40))}};
  hit.click();
  return {{ok:true, text:(hit.textContent||'').trim()}};
}})()"""
    )
    time.sleep(0.6)
    return parse_jsonish(out) if isinstance(parse_jsonish(out), dict) else {"raw": out}


def new_chat():
    dismiss_ui()
    ab_eval(
        """(() => {
  const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='新对话');
  if (b) b.click();
  return !!b;
})()"""
    )
    time.sleep(1.4)


def fill_send(text: str) -> dict:
    b64 = base64.b64encode(text.encode()).decode()
    out = ab_eval(
        f"""(() => {{
  const text=atob('{b64}');
  const node=document.querySelector('.composer-skill-input-control[role="textbox"]')||document.querySelector('[role="textbox"]');
  if (!node) return {{ok:false, err:'no-composer'}};
  node.focus();
  const sel=window.getSelection(); const range=document.createRange();
  range.selectNodeContents(node); sel?.removeAllRanges(); sel?.addRange(range);
  document.execCommand('insertText', false, text);
  node.dispatchEvent(new InputEvent('input',{{bubbles:true,inputType:'insertText',data:text}}));
  const btn=document.querySelector('button.send-button')||[...document.querySelectorAll('button')].find(b=>/发送/.test(b.getAttribute('aria-label')||b.textContent||''));
  if (btn) {{ btn.disabled=false; btn.removeAttribute('disabled'); btn.click(); }}
  return {{ok:true, text:(node.textContent||'').slice(0,120), core:([...document.querySelectorAll('button')].find(x=>/当前 Core/.test(x.getAttribute('aria-label')||''))||{{}}).getAttribute?.('aria-label')}};
}})()"""
    )
    time.sleep(0.7)
    ab_eval(
        """(() => {
  const node=document.querySelector('.composer-skill-input-control[role="textbox"]')||document.querySelector('[role="textbox"]');
  if ((node?.textContent||'').trim()) {
    const btn=document.querySelector('button.send-button');
    if (btn) {{ btn.disabled=false; btn.removeAttribute('disabled'); btn.click(); }}
  }
  return true;
})()"""
    )
    return parse_jsonish(out) if isinstance(parse_jsonish(out), dict) else {"raw": out}


def poll_marker(marker: str, max_s: int = 100) -> dict:
    start = time.time()
    last = {}
    while time.time() - start < max_s:
        raw = ab_eval(
            f"""(() => {{
  const m={json.dumps(marker)};
  const full=document.body?.innerText||'';
  let count=0, from=0;
  while (true) {{ const i=full.indexOf(m, from); if (i<0) break; count++; from=i+m.length; }}
  const recent=full.slice(-3500);
  const processedRecent=/已处理\\s*\\d/.test(recent)||/已处理 /.test(recent);
  const errs=[];
  if (/empty or malformed/i.test(full)) errs.push('malformed');
  if (/API Error/i.test(recent) || /upstream_error/i.test(recent)) errs.push('api_error');
  if (/status.:400/.test(recent) || /HTTP 400/.test(recent)) errs.push('http_400');
  return {{ count, processedRecent, errs, recent: recent.slice(-800) }};
}})()"""
        )
        data = parse_jsonish(raw)
        if not isinstance(data, dict):
            data = {"raw": str(raw)[:400]}
        last = data
        data["elapsed"] = round(time.time() - start, 1)
        strong = int(data.get("count") or 0) >= 2
        log(
            f"  poll {data['elapsed']}s count={data.get('count')} proc={data.get('processedRecent')} errs={data.get('errs')}"
        )
        if data.get("errs"):
            data["status"] = "fail"
            return data
        if strong and data.get("processedRecent"):
            data["status"] = "pass"
            return data
        time.sleep(4)
    last["status"] = "timeout"
    return last


def ui_case(protocol_id: str, core: str) -> dict:
    marker = f"PONG_UIP_{protocol_id[:6]}_{core.split()[0]}_{TS}"
    prompt = f"Reply with exactly one word: {marker}. No tools."
    log(f"\n=== UI {protocol_id} / {core} ===")
    switch_core(core)
    new_chat()
    switch_core(core)
    send = fill_send(prompt)
    log("send", send)
    out = poll_marker(marker)
    shot = REPORT / f"ui-proto-ipc-{protocol_id}-{core.split()[0].lower()}.png"
    try:
        ab("screenshot", str(shot), timeout=60)
    except Exception as e:
        log("shot", e)
    ok = out.get("status") == "pass"
    log("RESULT", ok, out.get("status"))
    return {
        "protocol": protocol_id,
        "core": core,
        "marker": marker,
        "send": send,
        "outcome": out,
        "screenshot": str(shot),
        "ok": ok,
    }


def restore_snap(snap: dict):
    if not snap or not snap.get("deepseek"):
        return {"ok": False, "error": "no-snap"}
    d = snap["deepseek"]
    p = snap.get("profile")
    body = f"""
const d = {json.dumps(d)};
const p = {json.dumps(p)};
const saved = await window.eco.saveProvider({{
  id: d.id,
  name: d.name,
  baseUrl: d.baseUrl,
  requestPath: d.requestPath || '',
  apiCompat: d.apiCompat,
  tokenCountMode: d.tokenCountMode,
  defaultModel: d.defaultModel,
  enabled: d.enabled !== false,
  apiKey: '',
}});
let profileSaved = null;
if (p) {{
  profileSaved = await window.eco.saveRouteProfile({{
    id: p.id,
    name: p.name,
    routes: p.routes || [],
  }});
}}
await new Promise(r => setTimeout(r, 1200));
return {{ ok:true, provider: {{ apiCompat: saved.apiCompat, requestPath: saved.requestPath }}, profile: profileSaved?.id }};
"""
    return ipc_eval(body, timeout=60)


def main() -> int:
    log("UI×protocol (IPC hot switch)", TS)
    ensure_stack()
    snap = snapshot_settings()
    log("snapshot", json.dumps(snap, ensure_ascii=False)[:800] if snap else None)
    if not isinstance(snap, dict) or not snap.get("deepseek"):
        log("FATAL cannot read deepseek via getModelSettings", snap)
        return 2

    results = []
    try:
        for proto in PROTOCOLS:
            log(f"\n######## {proto['id']} ########")
            applied = apply_protocol_ipc(proto)
            log("apply", applied)
            kind_ok = wait_kind(proto["upstreamKind"], timeout=50)
            # sometimes refresh lags; one more save/wait
            if not kind_ok:
                time.sleep(2)
                kind_ok = wait_kind(proto["upstreamKind"], timeout=30)
            health = http_json("http://127.0.0.1:18765/health")
            row = next((x for x in health.get("providers") or [] if x.get("id") == PROVIDER_ID), None)
            log("health", row)
            if not kind_ok:
                for core in CORES:
                    results.append(
                        {
                            "protocol": proto["id"],
                            "core": core,
                            "ok": False,
                            "error": "upstream_kind_not_ready",
                            "applied": applied,
                            "health": row,
                        }
                    )
                continue
            for core in CORES:
                try:
                    r = ui_case(proto["id"], core)
                    r["upstream_kind_ok"] = kind_ok
                    r["health"] = row
                    r["applied"] = applied
                    results.append(r)
                except Exception as e:
                    log("EXC", e)
                    results.append({"protocol": proto["id"], "core": core, "ok": False, "error": str(e)})
    finally:
        log("\nrestore…")
        rest = restore_snap(snap)
        log("restore", rest)
        wait_kind(
            {
                "anthropic": "anthropic-messages",
                "openai_responses": "responses",
                "openai_chat_completions": "openai-chat",
            }.get((snap.get("deepseek") or {}).get("apiCompat"), "openai-chat"),
            timeout=20,
        )

    summary = {
        "ts": TS,
        "mode": "ipc-hot-switch",
        "passed": sum(1 for r in results if r.get("ok")),
        "total": len(results),
        "results": results,
        "snapshot_before": snap,
    }
    outp = REPORT / "ui-protocol-matrix-latest.json"
    outp.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    log("\n==== SUMMARY ====")
    log(f"{summary['passed']}/{summary['total']}")
    for r in results:
        log(
            f"  {'OK' if r.get('ok') else 'FAIL'} {r.get('protocol')} / {r.get('core')} "
            f"{(r.get('outcome') or {}).get('status') or r.get('error')}"
        )
    log("wrote", outp)
    return 0 if summary["passed"] == summary["total"] and summary["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
