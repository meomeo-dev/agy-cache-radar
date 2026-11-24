---
name: cache-radar
description: >-
  Inspect prompt cache hit rates for the active session (including subagent and
  swarm worker trees), last 24 hours, and last 30 days across all local
  Antigravity desktop profiles and CLI data directories, or open the Cache Radar
  side panel widget.
---

# Cache Radar

Use this skill when the user asks about prompt cache hit rates, cache misses,
token savings, or wants to open the Cache Radar widget.

## Instructions

1. In the Antigravity desktop app, if the `cache-radar/cache_radar` UI sidecar
   is enabled and running, include a clickable sidecar pill so the user can open
   or toggle the 3-tab widget in the auxiliary side pane:

   ```markdown
   [Cache Radar](sidecar://cache-radar/cache_radar/)
   ```

2. When the user asks for a direct text summary (or when running in Antigravity
   CLI), run the bundled zero-dependency stats script from the plugin root:

   ```bash
   node scripts/cache-stats.mjs
   ```

   Optional flags:
   - `--conversation <conversation_id>`: inspect a specific session and its
     subagent/swarm tree.
   - `--last <1h|24h|7d|30d>`: filter active session stats to a recent window.
   - `--from <ms|iso>` / `--to <ms|iso>`: filter active session stats to an
     explicit timestamp range.
   - `--source <all|current|source_id>`: scope 24h and 30d metrics to all
     discovered data directories, the current profile, or a specific client.
   - `--json`: emit structured JSON metrics.

3. Always report:
   - Active session hit rate (clearly distinguishing session tree total with
     subagents/swarm vs main conversation only when descendants exist).
   - Rolling 24-hour and 30-day hit rates (both combined and split across main
     sessions vs subagents/swarm).
   - Active client/profile breakdown when multiple local Antigravity data
     directories are discovered.
