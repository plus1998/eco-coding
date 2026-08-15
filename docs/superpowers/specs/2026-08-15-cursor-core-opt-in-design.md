# Cursor Core Opt-in Gate Design

Date: 2026-08-15  
Status: Approved for planning

## Problem

Cursor is integrated as a fourth agent core via the local Cursor Agent CLI (`agent`). Its model/provider mechanism is incompatible with Eco’s built-in provider → orchestration → role-route stack. Showing Cursor as a always-on peer of Claude / Codex / π misleads users and skips the environment prerequisites (CLI installed, logged in, models listable).

## Goals

1. Visually distinguish Cursor from the three built-in cores with a trailing label **外置** / **External**.
2. Keep Cursor out of selectable cores by default.
3. Require an independent opt-in switch before Cursor appears in core pickers.
4. Allow the switch to turn **on** only after an environment probe succeeds (CLI present + models listable).
5. If a previously enabled environment later fails, auto-disable the switch and fall default core back from Cursor → Claude when needed.
6. Existing Cursor threads remain openable; continue/run re-checks switch + probe and surfaces a clear error until fixed.

## Non-goals (this prerequisite)

- Replacing the composer Eco model selector with Cursor models.
- Injecting Eco skills/MCP/providers into Cursor.
- A dedicated “Cursor integration” settings page.
- Changing the Cursor CLI stream-mapping / resume session behavior beyond gate checks.

## Approach

Persist `cursorCoreEnabled` in workflow settings. Strengthen Cursor availability probing beyond “executable exists”. Gate UI and main-process create/continue on:

```
showCursorCore = cursorCoreEnabled && cursor.available
```

## Data model

### Workflow settings (`workflow_settings`)

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `cursor_core_enabled` | boolean | `false` | User opt-in for Cursor core |
| `cursor_model_id` | string (existing) | unset | Optional Cursor CLI model id |
| `default_core_kind` | CoreKind (existing) | `claude` | Default for new threads |

### Availability snapshot

Extend `coreAvailability.cursor` so `available` means the full probe passed, not only that `agent` exists:

1. Resolve executable (`CURSOR_AGENT_EXECUTABLE` or default paths / PATH).
2. Run `listCursorAgentModels()` successfully with ≥ 1 model.

On failure, set `available: false` and an i18n `reason` covering: missing CLI, models command failed, empty model list (includes auth/login failures surfaced by the CLI).

## Switch write rules

- **Enable (`true`)**: run probe first; on failure reject the write and return the probe reason; do not persist `true`.
- **Disable (`false`)**: persist immediately. If `defaultCoreKind === "cursor"`, also set `defaultCoreKind` to `"claude"`.
- **Reconciliation**: on app load / workflow load / opening Default Agent settings (and when refreshing core availability), if stored `cursorCoreEnabled === true` but probe fails → force `cursorCoreEnabled` to `false` and apply the same default-core fallback.

## UI

### Label

- Display name for Cursor: `Cursor` + label `外置` (zh-CN) / `External` (en-US).
- Apply consistently in sidebar menu, locked thread heading, and Default Agent option list.
- Built-in cores (Claude Code, Codex, π) have no suffix label.

### Default Agent settings

- Primary radio list defaults to Claude / Codex / π only.
- Separate control: “Enable Cursor core (External)” toggle.
  - Probing: toggle disabled + loading affordance.
  - Probe failed: toggle off and not openable; show reason + refresh/re-detect action.
  - Probe succeeded: toggle openable; when on, Cursor (External) appears in the default-core list and existing Cursor model dropdown remains available when Cursor is the default.
- Turning the toggle off removes Cursor from the list and falls default back to Claude if needed.

### Sidebar core selector

- Render the Cursor option only when `showCursorCore` is true.
- New-thread draft selection cannot choose Cursor unless shown.
- Threads already bound to `coreKind: "cursor"` still show `Cursor · 外置` / `Cursor · External` in the heading even if the switch is later off.

## Main-process gates

- **Create thread** with `coreKind === "cursor"`: require `cursorCoreEnabled && cursor.available`; otherwise throw a clear error (not silently coerced).
- **Continue / start Cursor run**: same gate; on failure, interrupt/mark with an explicit message (switch off vs CLI missing vs models unavailable). After the user re-enables and probe passes, continue works again.
- **Read-only history / projection**: not blocked by the switch.

## Error / i18n surface (minimum)

- Cursor unavailable (CLI missing) — existing `native.cursorUnavailable` may remain for missing binary.
- Models probe failed / empty — new strings as needed.
- Cursor core not enabled — new string for create/continue when switch is off.
- Settings toggle helper copy explaining External / opt-in.

Exact catalog keys are left to implementation; strings must exist in both zh-CN and en-US.

## Testing

1. Default: switch off → sidebar and default-agent list have no Cursor.
2. Probe failure → cannot enable switch; reason visible.
3. Probe success → can enable → Cursor · 外置 appears in sidebar and settings.
4. After enable, break env (or mock probe fail) → auto disable + defaultCoreKind Cursor→Claude.
5. Historical Cursor thread opens for viewing; continue fails with clear error while gated; succeeds after re-enable + healthy probe.
6. Display name / label coverage in zh-CN and en-US for selector tests.

## Implementation touchpoints (expected)

- `apps/desktop/src/main/workflow-settings-store.ts` — persist `cursorCoreEnabled`
- `apps/desktop/src/shared/ipc.ts` (+ preload) — settings field + availability semantics
- `apps/desktop/src/main/index.ts` — probe, reconciliation, create/continue gates
- `packages/runtime` — reuse `listCursorAgentModels` (no new driver protocol required for this gate)
- `DefaultAgentSettingsPanel.tsx`, `SidebarCoreSelector.tsx`, `App.tsx`, i18n catalogs, related tests

## Open decisions resolved in brainstorming

- Gate model: **A** — probe must pass before switch can turn on; only then appears in pickers.
- Label: **外置** / **External**.
- Env regression: **auto-disable** switch + fallback default core.
- Existing threads: **openable**; continue re-checks gate (option B).
)
