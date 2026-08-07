---
name: eco-agent-browser
description: >
  Eco built-in browser via agent-browser MCP (mcp__eco_agent_browser__agent_browser_*). Use when browsing,
  clicking, filling forms, extracting page data, taking screenshots, or verifying local web UIs
  against the in-app browser shared with the user. Prefer this over macOS open / separate Chrome.
---

# Eco agent-browser (built-in)

You and the user share **one in-app browser session** (right task panel). MCP tools from server `eco_agent_browser` attach to that same guest via CDP — not a second Chrome.

Tool names look like:

- `mcp__eco_agent_browser__agent_browser_open`
- `mcp__eco_agent_browser__agent_browser_snapshot`
- `mcp__eco_agent_browser__agent_browser_click`
- `mcp__eco_agent_browser__agent_browser_fill`
- `mcp__eco_agent_browser__agent_browser_screenshot`
- `mcp__eco_agent_browser__agent_browser_get_url`

Do **not** start a separate headless Chrome, and do **not** shell out to macOS `open` for normal web work when these tools are present.

## Shared session rules

1. If the user already opened a page in the panel, `snapshot` / act there first — same cookies, URL, and history.
2. When you navigate, the UI should show the same panel so the user can watch and click.
3. Prefer continuing the current page over opening a second browser.

## Core loop

1. `agent_browser_open` the target URL (or stay on the current shared page).
2. Take an accessibility **snapshot** (`agent_browser_snapshot`; prefer interactive-only when available).
3. Act with **refs** from that snapshot (`@e1`, `@e2`, …) via click/fill/type tools.
4. After any navigation, submit, dialog, or dynamic re-render: **snapshot again** before the next ref action. Refs go stale after DOM changes.

## Prefer

- Snapshot-and-ref over raw CSS selectors when the tools expose refs.
- Short tool sequences; re-check the page after meaningful clicks.
- Screenshots when you need visual confirmation beyond the a11y tree.
- The shared Eco browser when the user is also looking at or will open that panel.

## Avoid

- Launching a second browser session for the same task (`open`, system browser, separate headless Chrome).
- Assuming refs survive a page change.
- Claiming the tools are unavailable without attempting a tool call when this skill is loaded.

## When tools fail

Report the tool error text. If CDP/binary is unavailable, say so — do not fake success with shell workarounds unless the user explicitly asks for an external browser.
