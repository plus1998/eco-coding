#!/usr/bin/env bash
# Drive Eco desktop via agent-browser CDP (port 9222).
# Requires: Electron + Vite already running without ELECTRON_RUN_AS_NODE.
set -euo pipefail
AB=(env -u ELECTRON_RUN_AS_NODE npx --yes agent-browser --cdp 9222)
run() { "${AB[@]}" "$@"; }

MARKER="UIAB_$(date +%s)"
REPORT_DIR="/Users/plus/Desktop/workspace/ai/eco-coding/.cursor/smoke-reports"
mkdir -p "$REPORT_DIR"
DEBUG_LOG="/Users/plus/Desktop/workspace/ai/eco-coding/.cursor/debug-bf26bf.log"
HIT_FILE="$REPORT_DIR/last-hit.txt"
: >"$HIT_FILE"

echo "=== switch Claude ==="
run click @e6
sleep 0.6
S=$(run snapshot -i)
REF=$(echo "$S" | sed -n 's/.*menuitemradio "Claude Code".*ref=\(e[0-9]*\).*/\1/p' | head -1)
echo "Claude ref=$REF"
[ -n "$REF" ] && run click "@$REF"
sleep 0.8
run snapshot -i | head -8

echo "=== new conversation ==="
run click @e2
sleep 2

echo "=== fill composer via eval ==="
PAYLOAD_B64=$(printf '%s' "Reply with exactly one word: PONG_${MARKER}. No tools." | base64)
run eval "
(() => {
  const text = atob('${PAYLOAD_B64}');
  const node = document.querySelector('.composer-skill-input-control[role=\"textbox\"]')
    || document.querySelector('[role=\"textbox\"]');
  if (!node) return { ok: false, err: 'no-composer' };
  node.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  sel && sel.removeAllRanges();
  sel && sel.addRange(range);
  document.execCommand('insertText', false, text);
  node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  const btn = document.querySelector('button.send-button');
  return {
    ok: true,
    text: (node.textContent || '').slice(0, 120),
    sendDisabled: btn ? btn.disabled : null,
  };
})()
"

S=$(run snapshot -i)
echo "$S" | rg '发送|textbox' | head -10 || true
SEND=$(echo "$S" | sed -n 's/.*button "发送".*ref=\(e[0-9]*\).*/\1/p' | head -1)
LINE=$(echo "$S" | rg 'button "发送"' | head -1 || true)
echo "send ref=$SEND line=$LINE"

if echo "${LINE:-}" | rg -q disabled; then
  echo "send disabled, try Enter"
  run press Enter || true
elif [ -n "${SEND:-}" ]; then
  run click "@$SEND"
else
  run eval "document.querySelector('button.send-button')?.click(); 'clicked'"
fi

echo "=== wait outcome ==="
for i in $(seq 1 40); do
  sleep 3
  BODY=$(run eval "document.body?.innerText?.slice(0, 4000)" || true)
  if echo "$BODY" | rg -qi "empty or malformed|API Error|api_error|PONG_${MARKER}|Missing x-gateway|connection refused|Failed to fetch|gateway intercepting"; then
    printf '%s\n' "$BODY" >"$HIT_FILE"
    echo "hit on poll $i"
    break
  fi
  if [ "$i" -gt 4 ] && echo "$BODY" | rg -q "PONG_"; then
    printf '%s\n' "$BODY" >"$HIT_FILE"
    echo "pong visible poll $i"
    break
  fi
  echo "poll $i..."
done

run screenshot "$REPORT_DIR/ui-claude-send.png" || true
BRIDGE=$(run eval "fetch('http://127.0.0.1:18765/health').then(async r=>({status:r.status,body:(await r.text()).slice(0,200)})).catch(e=>({error:String(e)}))" || true)
printf '%s\n' "$BRIDGE" >"$REPORT_DIR/bridge-health.txt"

python3 - <<PY
import json, time
from pathlib import Path
report_dir = Path("$REPORT_DIR")
hit = (report_dir / "last-hit.txt").read_text(errors="replace") if (report_dir / "last-hit.txt").exists() else ""
bridge = (report_dir / "bridge-health.txt").read_text(errors="replace")
payload = {
  "sessionId": "bf26bf",
  "hypothesisId": "H-ui-ab",
  "location": "smoke-ui-agent-browser.sh",
  "message": "claude ui result",
  "data": {
    "marker": "$MARKER",
    "hitPreview": hit[:1200],
    "bridge": bridge[:400],
    "hitOk": bool(hit.strip()),
  },
  "timestamp": int(time.time() * 1000),
  "runId": "ui-agent-browser",
}
Path("$DEBUG_LOG").parent.mkdir(parents=True, exist_ok=True)
Path("$DEBUG_LOG").open("a").write(json.dumps(payload, ensure_ascii=False) + "\n")
(report_dir / "ui-agent-browser-latest.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2))
print(json.dumps(payload, ensure_ascii=False, indent=2)[:2500])
PY

echo "MARKER=$MARKER"
tail -40 "/Users/plus/.eco-coding/logs/upstream-$(date +%Y-%m-%d).log" 2>/dev/null | rg -i "sdk\.|api_error|malformed|query_" | tail -20 || true
