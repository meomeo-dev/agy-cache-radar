# Changelog

All notable changes to `agy-cache-radar` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-24

Initial public release of **Cache Radar** (`agy-cache-radar`).

### Added
- **3-Tab Side Panel Widget** (`sidecars/cache_radar/`):
  - **Active Session (`当前会话`)**: Cumulative hit rate, 3-segment prompt breakdown (`命中` / `丢缓存` / `正常新增`), subagent/swarm roll-up toggle (`含子代理` / `仅主`), per-turn hit-rate bar chart, and drilldown tabs for miss events, gap/context matrices, models, and subagents.
  - **Zoomable Session Timeline Scrubber**: Chrome DevTools–style 72-bin activity overview for multi-day sessions with drag-to-brush range selection, edge-handle resizing, window panning, mouse-wheel and `+`/`−`/`↺` zoom controls, double-click reset, and `全部` / `1h` / `24h` / `7d` / `30d` presets.
  - **Last 24 Hours (`近 24 小时`) & Last 30 Days (`近 30 天`)**: Event-timestamp rolling windows, hourly and daily trend charts, role split (`全部` / `仅主` / `仅子代理`), client/profile breakdown, model breakdown, and clickable top session trees.
  - Automatic light/dark host theme synchronization with optional standalone `?theme=light|dark` query override.
- **Cache-Miss Classification & Diagnostics (`src/diagnostics.mjs`)**:
  - Classifies uncached prompt tokens into explicit anomaly causes (`hot_prefix_bust`, `idle_warm_decay`, `idle_ttl_expired`, `model_switch`, `stream_interrupt`, `partial_truncation`) and expected structural additions (`cold_start`, `incremental_append`).
  - Uses total prompt tokens as the unified denominator (`hit + anomaly + structural = 100%`) and reports each miss cause's negative impact (`-X.X%`) on overall hit rate.
  - Preserves pre-window turn transition history when slicing multi-day sessions by `sessionFrom` / `sessionTo`.
- **Subagent & Swarm Graph Deduplication (`src/hierarchy.mjs`, `src/metadata.mjs`)**:
  - Merges parent-child links from read-only `conversation_summaries.db`, `conversation_parents`, and `swarm/members.json`.
  - Deduplicates cross-directory conversation copies and identical forked leading prefixes while guarding cycles and preserving orphaned children in rolling windows.
- **Multi-Client & Multi-CLI Discovery (`src/discovery.mjs`)**:
  - Auto-discovers Antigravity Desktop profiles (`~/.agy-profiles/*`), default App/IDE directories (`~/.gemini/antigravity*`), and CLI directories (`~/.gemini/antigravity-cli*`), resolving symlinks and excluding backup directories by default.
  - Supports custom directories and exclusions via environment variables and `~/.gemini/config/cache-radar.json`.
- **CLI Reporter & Skill (`scripts/cache-stats.mjs`, `skills/cache-radar/SKILL.md`)**:
  - Zero-dependency terminal reporter supporting `--source`, `--conversation`, `--last 1h|24h|7d|30d`, `--from`, `--to`, and `--json`.
- **Automated Test Suite (`tests/`)**:
  - Unit and integration tests covering discovery, hierarchy/fork deduplication, incremental JSONL tailing, multi-day time-range filtering, prompt-token partition accounting, and the standalone HTTP server.
