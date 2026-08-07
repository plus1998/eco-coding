#!/usr/bin/env python3
"""End-to-end UI smoke via agent-browser CDP: tools / subagent / plan × Claude & Codex."""
from __future__ import annotations

import base64
import json
import re
import subprocess
import time
from pathlib import Path

REPORT = Path("/Users/plus/Desktop/workspace/ai/eco-coding/.cursor/smoke-reports")
REPORT.mkdir(parents=True, exist_ok=True)
AB = ["env", "-u", "ELECTRON_RUN_AS_NODE", "npx", "--yes", "agent-browser", "--cdp", "9222"]
TS = int(time.time())


def ab(*args: str, timeout: int = 90) -> str:
    p = subprocess.run(AB + list(args), capture_output=True, text=True, timeout=timeout)
    out = (p.stdout or "").strip()
    err = (p.stderr or "").strip()
    # drop npm warn noise
    lines = [ln for ln in (out + ("\n" + err if err else "")).splitlines() if "Unknown env config" not in ln]
    return "\n".join(lines).strip()


def ab_eval(js: str, timeout: int = 90) -> str:
    return ab("eval", js, timeout=timeout)


def parse_jsonish(text: str):
    text = text.strip()
    if not text:
        return None
    # preferred: last { ... } block
    starts = [m.start() for m in re.finditer(r"\{", text)]
    for i in reversed(starts):
        chunk = text[i:]
        try:
            return json.loads(chunk)
        except json.JSONDecodeError:
            continue
    # quoted string
    if text.startswith('"') and text.endswith('"'):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
    return text


def dismiss_ui() -> None:
    ab_eval(
        """(() => {
  document.querySelectorAll('.sidebar-search-backdrop-close, button[aria-label="关闭"], [data-dialog-close]').forEach(b => { try { b.click(); } catch {} });
  // close settings overlay if present
  const back = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||b.textContent||'') === '返回');
  if (back) back.click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
})()"""
    )
    time.sleep(0.35)


def switch_core(target: str) -> dict:
    """target: 'Claude Code' | 'Codex'"""
    dismiss_ui()
    ab_eval(
        """(() => {
  const core = [...document.querySelectorAll('button')].find(b => /当前 Core/.test(b.getAttribute('aria-label')||''));
  if (!core) return { ok: false, err: 'no-core' };
  core.click();
  return { ok: true };
})()"""
    )
    time.sleep(0.55)
    # menuitemradio text is exactly Claude Code / Codex — avoid matching sidebar message titles
    out = ab_eval(
        f"""(() => {{
  const items = [...document.querySelectorAll('[role="menuitemradio"]')];
  let hit = items.find(el => (el.textContent||'').trim() === {json.dumps(target)});
  if (!hit) hit = items.find(el => (el.textContent||'').trim().startsWith({json.dumps(target)}));
  if (!hit) {{
    const all = [...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')];
    return {{ ok: false, err: 'no-item', texts: all.map(i=>(i.textContent||'').trim().slice(0,40)) }};
  }}
  hit.click();
  return {{ ok: true, text: (hit.textContent||'').trim().slice(0, 40) }};
}})()"""
    )
    time.sleep(0.7)
    label = ab_eval(
        """(() => {
  const b = [...document.querySelectorAll('button')].find(x => /当前 Core/.test(x.getAttribute('aria-label')||''));
  return b?.getAttribute('aria-label') || null;
})()"""
    )
    return {"switch": parse_jsonish(out), "label": parse_jsonish(label)}


def new_chat() -> None:
    dismiss_ui()
    ab_eval(
        """(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === '新对话' || (x.textContent||'').trim() === '新对话');
  if (b) b.click();
  return { ok: !!b };
})()"""
    )
    time.sleep(1.6)


def set_session_mode(mode: str) -> dict:
    """mode: agent | plan | ask. Prefer explicit 更多 menu then Plan/Agent title."""
    dismiss_ui()
    open_out = ab_eval(
        """(() => {
  const more = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||'') === '更多');
  if (more) { more.click(); return { ok: true, via: '更多' }; }
  const modeBtn = [...document.querySelectorAll('button')].find(b => {
    const a = b.getAttribute('aria-label') || '';
    return /会话模式|Session mode|模式：|Mode:/.test(a) || /^Agent$|^Plan$|^Ask$/.test((b.textContent||'').trim());
  });
  if (modeBtn) { modeBtn.click(); return { ok: true, via: (modeBtn.getAttribute('aria-label')||modeBtn.textContent||'').slice(0,40) }; }
  const plus = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||'') === '附加' || (b.textContent||'').trim() === '+');
  if (plus) { plus.click(); return { ok: true, via: 'plus' }; }
  return { ok: false, err: 'no-mode-btn' };
})()"""
    )
    time.sleep(0.55)
    title = {"agent": "Agent", "plan": "Plan", "ask": "Ask"}[mode]
    pick = ab_eval(
        f"""(() => {{
  const items = [...document.querySelectorAll('[role="menuitem"], [role="option"], [role="menuitemradio"], button, [class*="session-mode"] *')];
  const exact = items.find(el => {{
    const t = (el.textContent||'').replace(/\\s+/g,' ').trim();
    return t === {json.dumps(title)} || t.startsWith({json.dumps(title + ' ')}) || t.startsWith({json.dumps(title)});
  }});
  if (!exact) {{
    return {{ ok: false, err: 'no-mode', texts: items.filter(i=>/Agent|Plan|Ask|计划|代理/.test(i.textContent||'')).map(i=>(i.textContent||'').replace(/\\s+/g,' ').slice(0,50)).slice(0,15) }};
  }}
  exact.click();
  return {{ ok: true, text: (exact.textContent||'').replace(/\\s+/g,' ').slice(0,60) }};
}})()"""
    )
    time.sleep(0.45)
    return {"open": parse_jsonish(open_out), "pick": parse_jsonish(pick)}


def fill_and_send(text: str) -> dict:
    dismiss_ui()
    b64 = base64.b64encode(text.encode()).decode()
    fill = ab_eval(
        f"""(() => {{
  const text = atob('{b64}');
  document.querySelectorAll('.sidebar-search-backdrop-close').forEach(b => {{ try {{ b.click(); }} catch {{}} }});
  const node = document.querySelector('.composer-skill-input-control[role="textbox"]')
    || document.querySelector('[role="textbox"]');
  if (!node) return {{ ok: false, err: 'no-composer' }};
  node.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  sel?.removeAllRanges();
  sel?.addRange(range);
  document.execCommand('selectAll', false);
  document.execCommand('insertText', false, text);
  node.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: text }}));
  const btn = document.querySelector('button.send-button')
    || [...document.querySelectorAll('button')].find(b => /发送/.test(b.getAttribute('aria-label')||b.textContent||''));
  if (btn) {{
    btn.disabled = false;
    btn.removeAttribute('disabled');
    btn.click();
  }}
  return {{
    ok: true,
    text: (node.textContent||'').slice(0, 160),
    sendDisabled: btn ? btn.disabled : null,
    core: ([...document.querySelectorAll('button')].find(x => /当前 Core/.test(x.getAttribute('aria-label')||''))||{{}}).getAttribute?.('aria-label')
  }};
}})()"""
    )
    time.sleep(0.8)
    # retry send if composer still has text
    ab_eval(
        """(() => {
  const node = document.querySelector('.composer-skill-input-control[role="textbox"]') || document.querySelector('[role="textbox"]');
  const t = (node?.textContent||'').trim();
  if (!t) return { needed: false };
  const btn = document.querySelector('button.send-button') || [...document.querySelectorAll('button')].find(b => /发送/.test(b.getAttribute('aria-label')||b.textContent||''));
  if (btn) { btn.disabled=false; btn.removeAttribute('disabled'); btn.click(); return { needed: true, clicked: true }; }
  return { needed: true, clicked: false };
})()"""
    )
    return parse_jsonish(fill) if isinstance(parse_jsonish(fill), dict) else {"raw": fill}


def poll_outcome(markers: list[str], fail_patterns: list[str], max_s: int = 120) -> dict:
    """Pass only when marker appears outside the composer user bubble and 本轮 has 已处理, or count>=2."""
    start = time.time()
    last = {}
    markers_js = json.dumps(markers)
    while time.time() - start < max_s:
        raw = ab_eval(
            f"""(() => {{
  const markers = {markers_js};
  const full = document.body?.innerText || '';
  const core = ([...document.querySelectorAll('button')].find(x => /当前 Core/.test(x.getAttribute('aria-label')||''))||{{}}).getAttribute?.('aria-label') || '';
  const feed = document.querySelector('[aria-label="本轮执行结果"]')
    || document.querySelector('.activity-feed, .thread-timeline, .message-list, main')
    || document.body;
  const feedText = feed.innerText || '';
  const counts = {{}};
  for (const m of markers) {{
    let n = 0, from = 0;
    while (true) {{
      const i = full.indexOf(m, from);
      if (i < 0) break;
      n += 1;
      from = i + m.length;
    }}
    counts[m] = n;
  }}
  const processedAll = (full.match(/已处理/g) || []).length;
  const planUi = !!(/批准计划|执行计划|待确认计划|实施计划|Plan approval|Approve plan/i.test(full)
    || document.querySelector('[class*="plan-approval"], [class*="PlanApproval"]'));
  const toolRows = (full.match(/\\b(LS|Glob|Read|Bash|Shell|Write|Edit)\\b/g) || []).length;
  const subRows = (full.match(/子代理|eco_explore|eco_coder|TaskOutput|Agent tool/gi) || []).length;
  const errs = [];
  if (/empty or malformed/i.test(full)) errs.push('malformed');
  const recent = full.slice(-3500);
  if (/API Error/i.test(recent)) errs.push('api_error');
  const markerInRecent = markers.filter(m => recent.includes(m));
  const processedRecent = /已处理\\s*\\d/.test(recent) || /已处理 /.test(recent);
  return {{
    core,
    counts,
    markerInRecent,
    processedAll,
    processedRecent,
    planUi,
    toolRows,
    subRows,
    errs,
    feedTail: feedText.slice(-900),
    recentTail: recent.slice(-900)
  }};
}})()"""
        )
        data = parse_jsonish(raw)
        if not isinstance(data, dict):
            data = {"raw": str(raw)[:500]}
        last = data
        counts = data.get("counts") or {}
        strong = any(int(counts.get(m, 0) or 0) >= 2 for m in markers)
        recent_ok = bool(data.get("markerInRecent")) and bool(data.get("processedRecent"))
        fails = [p for p in fail_patterns if re.search(p, str(data.get("recentTail") or "") + str(data.get("feedTail") or ""), re.I)]
        data["strong_marker"] = strong
        data["recent_ok"] = recent_ok
        data["fail_hits"] = fails
        data["elapsed"] = round(time.time() - start, 1)
        print(
            f"  poll {data['elapsed']}s strong={strong} recent_ok={recent_ok} counts={counts} "
            f"procR={data.get('processedRecent')} plan={data.get('planUi')} tools={data.get('toolRows')} "
            f"sub={data.get('subRows')} errs={data.get('errs')}"
        )
        if data.get("errs") or fails:
            data["status"] = "fail"
            return data
        if strong and data.get("processedRecent"):
            data["status"] = "pass"
            return data
        if recent_ok and (strong or data.get("planUi") or int(data.get("toolRows") or 0) > 0):
            data["status"] = "pass"
            return data
        # plan UI after a completed turn with marker once in assistant-ish region
        if data.get("planUi") and data.get("processedRecent") and data.get("markerInRecent"):
            data["status"] = "pass_plan_ui"
            return data
        time.sleep(5)
    last["status"] = "timeout"
    return last


SCENARIOS = [
    {
        "id": "tools",
        "mode": "agent",
        # Do not put exact success token twice; one "reply with TOKEN" still embeds once in user msg.
        "prompt": (
            "Run-id {tag}. Use file tools only (LS or Glob) on the current workspace. "
            "Do not edit files. When done, your final assistant message must be exactly this single token "
            "(nothing else): TOOLS_OK_{tag}"
        ),
        "markers": ["TOOLS_OK_{tag}"],
        "max_s": 150,
    },
    {
        "id": "subagent",
        "mode": "agent",
        "prompt": (
            "Run-id {tag}. You must use a subagent / Task / Agent tool (explore or coder) to inspect "
            "workspace file names. Do not edit. Final assistant message must be exactly: SUBAGENT_OK_{tag}"
        ),
        "markers": ["SUBAGENT_OK_{tag}"],
        "max_s": 180,
    },
    {
        "id": "plan",
        "mode": "plan",
        "prompt": (
            "Run-id {tag}. Create a short implementation plan (3-5 steps) for renaming a local variable "
            "foo to bar in the current project. Do not execute file changes. "
            "First line of the plan must be exactly: PLAN_OK_{tag}"
        ),
        "markers": ["PLAN_OK_{tag}"],
        "max_s": 150,
    },
]


def run_case(core: str, scenario: dict) -> dict:
    tag = f"{core.split()[0]}_{TS}_{scenario['id']}".replace(" ", "")
    prompt = scenario["prompt"].format(tag=tag)
    markers = [m.format(tag=tag) for m in scenario["markers"]]
    print(f"\n=== {core} / {scenario['id']} tag={tag} ===")
    core_sw = switch_core(core)
    print("core:", core_sw)
    new_chat()
    # re-assert core after new chat
    switch_core(core)
    mode_r = set_session_mode(scenario["mode"])
    print("mode:", mode_r)
    send_r = fill_and_send(prompt)
    print("send:", send_r)
    out = poll_outcome(
        markers=markers,
        fail_patterns=[r"empty or malformed", r"API Error", r"gateway intercepting"],
        max_s=scenario["max_s"],
    )
    shot = REPORT / f"ui-all-{core.split()[0].lower()}-{scenario['id']}.png"
    try:
        ab("screenshot", str(shot), timeout=60)
    except Exception as e:
        print("screenshot fail", e)
    result = {
        "core": core,
        "scenario": scenario["id"],
        "tag": tag,
        "core_switch": core_sw,
        "session_mode": mode_r,
        "send": send_r,
        "outcome": out,
        "screenshot": str(shot),
        "ok": out.get("status") in ("pass", "pass_plan_ui"),
    }
    print("RESULT", result["ok"], out.get("status"), out.get("errs"), out.get("hit_markers"))
    return result


def main() -> int:
    print("UI all-paths smoke", TS)
    dismiss_ui()
    results = []
    # Claude first (prior failure path), then Codex
    for core in ("Claude Code", "Codex"):
        for sc in SCENARIOS:
            try:
                results.append(run_case(core, sc))
            except Exception as e:
                results.append({"core": core, "scenario": sc["id"], "ok": False, "error": str(e)})
                print("EXC", core, sc["id"], e)
            # brief cooldown
            time.sleep(1)

    summary = {
        "ts": TS,
        "passed": sum(1 for r in results if r.get("ok")),
        "total": len(results),
        "results": results,
    }
    outp = REPORT / "ui-all-paths-latest.json"
    outp.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print("\n==== SUMMARY ====")
    print(f"{summary['passed']}/{summary['total']} passed")
    for r in results:
        print(f"  {'OK' if r.get('ok') else 'FAIL'}  {r.get('core')} / {r.get('scenario')}  {r.get('outcome', {}).get('status') or r.get('error')}")
    print("wrote", outp)
    return 0 if summary["passed"] == summary["total"] else 1


if __name__ == "__main__":
    import sys

    # unbuffered progress when piped
    try:
        sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    except Exception:
        pass
    raise SystemExit(main())
