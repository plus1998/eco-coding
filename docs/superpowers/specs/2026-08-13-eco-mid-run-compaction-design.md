# Superseded: Eco Mid-Run Compaction

**Status:** superseded 2026-08-13.

Eco no longer owns semantic compaction. Each Core auto-compacts locally:

- Claude: Agent SDK `autoCompactEnabled`
- Codex: app-server local compact (unchanged)
- PI: native `compaction.enabled` (not `pi-smart-compact`)

Eco keeps occupancy projection and blocks upstream cloud compact APIs (`compact_20260112`, Bridge `/v1/responses/compact`).

See `docs/TECHNICAL.md` §7.2–7.3.
