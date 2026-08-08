---
name: eco-agent-browser
description: >
  Eco built-in browser via agent-browser MCP (mcp__eco_agent_browser__agent_browser_*). Use when browsing,
  clicking, filling forms, extracting page data, taking screenshots, or verifying local web UIs
  against this conversation's in-app browsers. Prefer this over macOS open / separate Chrome.
  Only available when the session has enabled eco_agent_browser MCP.
---

# Eco agent-browser (built-in)

The **current Eco conversation thread** may own **multiple** independent in-app browser surfaces
(task-panel Tabs). MCP server name is always **`eco_agent_browser`**. Eco binds the connection to
**this conversation** via auth token / tool claims and a **thread-scoped CDP** — not a second
Chrome, and not another conversation's open pages. **Cookies / localStorage are shared** with
other conversations in the same workspace (login once across threads).

Tool names look like:

- `mcp__eco_agent_browser__agent_browser_open`
- `mcp__eco_agent_browser__agent_browser_snapshot`
- `mcp__eco_agent_browser__agent_browser_click`
- `mcp__eco_agent_browser__agent_browser_fill`
- `mcp__eco_agent_browser__agent_browser_screenshot`
- `mcp__eco_agent_browser__agent_browser_get_url`
- `mcp__eco_agent_browser__agent_browser_tab_list` / `tab_new` / `tab_switch` (when listed)

Do **not** start a separate headless Chrome, and do **not** shell out to macOS `open` for normal web work when these tools are present.

## Session isolation rules

1. You only ever see **open pages** for **this** thread (another chat's tabs are invisible). Site login state is workspace-shared.
2. Within this thread, list targets/tabs before assuming a single page; open or create additional browsers with open / tab_new when needed.
3. Prefer reusing an existing tab when the user already opened the same site; otherwise open a new tab so both stay available.
4. When you switch tabs (activate), the human task panel should follow that browser Tab if it is already open.
5. **Never pass a custom `session` argument** on tools. Eco binds a short per-thread session automatically. Inventing names like `web` / `chat` desyncs Agent tab_list from the human sidebar.

## Core loop

1. `agent_browser_open` the target URL (or stay on an existing page for this thread).
2. Take an accessibility **snapshot** (`agent_browser_snapshot`; prefer interactive-only when available).
3. Act with **refs** from that snapshot (`@e1`, `@e2`, …) via click/fill/type tools.
4. After any navigation, submit, dialog, or dynamic re-render: **snapshot again** before the next ref action. Refs go stale after DOM changes.

## Prefer

- Snapshot-and-ref over raw CSS selectors when the tools expose refs.
- Short tool sequences; re-check the page after meaningful clicks.
- Screenshots when you need visual confirmation beyond the a11y tree.
- Thread-scoped Eco browsers when the user is also watching the task panel.

## Avoid

- Shelling `agent-browser` CLI / `Bash(agent-browser …)` when `mcp__eco_agent_browser__*` tools exist.
- Passing a custom `session` argument (causes parallel daemon sessions and tab-count mismatches).
- Reading `~/.agents/skills/agent-browser` or launching a second browser product for the same task.
- Launching macOS `open`, separate Chrome, or headed CLI for normal web work in Eco.
- Assuming refs survive a page change.
- Claiming tools are available when the session has not enabled `eco_agent_browser`.

## When tools fail

Report the tool error text. If CDP/binary is unavailable, say so — do not fake success with shell workarounds unless the user explicitly asks for an external browser.
Do not fall back to the standalone agent-browser CLI unless the user explicitly requests it.
If a tool fails with "session name too long", omit `session` and retry (Eco already binds the correct session).
If a tool fails with binding/auth errors about claims or Authorization, report it — Eco routes tools to thread CDPs via auth; do not invent another browser server.
