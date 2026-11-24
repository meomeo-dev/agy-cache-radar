# Cache Radar Architecture

## 1. Overview

Cache Radar is a zero-runtime-dependency Antigravity plugin providing a compact
3-tab auxiliary side pane widget (`Active Session`, `Last 24 Hours`, `Last 30 Days`)
and a companion CLI/skill reporter.

All metrics are computed strictly from local Antigravity disk artifacts without
issuing extra model requests or transmitting data externally.

## 2. Prompt Cache Hit Rate Formula

Antigravity records each model turn as a `PLANNER_RESPONSE` JSONL entry inside:

```text
<appDataDir>/brain/<conversation_id>/.system_generated/logs/transcript.jsonl
```

Each entry reports:

- `input_tokens`: uncached prompt tokens sent on that turn.
- `cache_read_tokens`: prompt tokens served from prompt cache on that turn.
- `output_tokens`: completion tokens generated on that turn.
- `created_at`: ISO-8601 UTC timestamp of the turn.
- `model`: model identifier.

Therefore, for any set of deduplicated turns $E$:

$$\text{total\_prompt\_tokens} = \sum_{e \in E} (\text{input\_tokens}_e + \text{cache\_read\_tokens}_e)$$

$$\text{cache\_hit\_rate} = \frac{\sum_{e \in E} \text{cache\_read\_tokens}_e}{\text{total\_prompt\_tokens}}$$

## 3. Subagent & Swarm Inclusion Model (Deduplicated & Complete Accounting)

### 3.1 Storage Isolation

In Antigravity, regular subagents (`invoke_subagent`) and swarm workers
(`swarm add`) each write their own `PLANNER_RESPONSE` rows into their own
`brain/<child_conversation_id>/.system_generated/logs/transcript.jsonl`.
The parent conversation's transcript only logs the tool invocation and result
summary—it does **not** include the child's model token counts.

As a result:

- Excluding child transcripts causes severe **undercounting** (in swarm-heavy
  sessions, subagents and swarm workers commonly account for 80–90% of turns).
- Summing a parent's rolled-up tree alongside scanning child transcripts again
  causes **double-counting**.

### 3.2 Conversation Graph & Deduplication Pipeline

`src/hierarchy.mjs` enforces four invariants:

1. **Unique `conversation_id` index**: Every `conversation_id` enters the
   in-memory graph at most once across all data directories. If the same ID
   appears in two directories (e.g., copied profile data), the canonical copy is
   chosen deterministically (most `PLANNER_RESPONSE` events -> newest transcript
   `mtimeMs` -> current active runtime directory).
2. **Multi-source parent-child resolution**: Parent links are merged from:
   - `conversation_summaries.db` (`conversation_summaries.parent_conversation_id`
     and `nesting_depth`)
   - `conversation_parents` table (fallback when present)
   - `<appDataDir>/brain/<coord>/.system_generated/swarm/members.json`
     (identifies swarm coordinator, roster member names, and worker roles even
     when SQLite metadata is lagging or absent).
3. **Cycle & orphan protection**: Walking parent links uses a `visited` set and
   `MAX_TREE_DEPTH = 16`. Subtree traversal (`collectSubtreeIds`) uses BFS with
   a `visited` set so multi-level descendants (e.g., workers spawning helpers)
   are visited exactly once. Orphaned children whose parent directory was pruned
   remain in 24h/30d window totals instead of being dropped.
4. **Fork-prefix step deduplication**: When a child conversation is forked from
   an ancestor (`swarm add` with `fork`), if its leading `PLANNER_RESPONSE`
   entries match ancestor entries identically on
   `(step_index, created_at, model, input_tokens, cache_read_tokens, output_tokens)`,
   that verbatim leading prefix is stripped from the child while keeping all
   post-fork turns intact.

### 3.3 Aggregation Semantics Across the 3 Tabs

| Tab | Unit of Aggregation | Subagent / Swarm Handling |
| --- | --- | --- |
| **Active Session** | Selected conversation + BFS subtree | Defaults to **Include Subagents/Swarm (tree total)** when descendants exist, with a 1-click toggle to **Main Only**, a side-by-side split bar (`Main` vs `Subagents/Swarm`), and a clickable per-agent breakdown. |
| **Last 24 Hours** | Flat unique events where `ts ∈ [now - 24h, now]` | Aggregates every unique conversation's deduplicated events once. Role filter switches between **All (incl. subagents)**, **Main Only**, and **Subagents/Swarm Only**, guaranteeing `All = Main + Subagents`. Top Sessions roll up by `rootId` without double-counting. |
| **Last 30 Days** | Flat unique events where `ts ∈ [now - 30d, now]` | Same flat event-level aggregation aligned to 30 local calendar-day buckets. |

Filtering by each turn's `created_at` timestamp (rather than conversation file
`mtime`) guarantees that a multi-day conversation resumed today only contributes
its last-24h turns to the 24h tab and its last-30d turns to the 30d tab.

## 4. Multi-Client & Multi-CLI Data Directory Discovery

Users frequently run multiple Antigravity surfaces and account profiles
concurrently (e.g., Desktop App profiles under `~/.agy-profiles/<profile>` that
override `HOME`, standard `~/.gemini/antigravity`, `~/.gemini/antigravity-ide`,
and multiple CLI profiles like `~/.gemini/antigravity-cli` and
`~/.gemini/antigravity-cli-<profile>`).

`src/discovery.mjs` handles this automatically:

1. **Current runtime data directory**: Detects the active profile's `<appDataDir>` from
   `ANTIGRAVITY_EXECUTABLE_DATA_DIR` (sidecar) or `PLUGIN_DATA` (plugin) and
   marks it `isCurrent: true`.
2. **Real OS home + overridden `HOME`**: Combines `process.env.HOME`, the parent
   of `.agy-profiles/<profile>` when `HOME` points inside a profile directory,
   and `os.userInfo().homedir` (`getpwuid`), so isolated desktop profiles still
   discover sibling desktop profiles and CLI data directories.
3. **Explicit overrides & config**: Supports `AGY_CACHE_DATA_DIRS`,
   `AGY_CACHE_EXTRA_PROFILES_DIRS`, `GEMINI_HOME`, and optional
   `~/.gemini/config/cache-radar.json`:
   ```json
   {
     "extraDataDirs": ["/custom/path/to/antigravity-data"],
     "extraProfileRoots": ["~/my-agy-profiles"],
     "excludePatterns": ["scratch"],
     "includeBackups": false
   }
   ```
4. **Canonical deduplication & backup exclusion**: Every candidate path is
   resolved via `fs.realpathSync()` to eliminate symlink duplicates, and backup
   directories (`*-backup`, `*.bak`, `*.old`, `*-archive`, `*-tmp`) are skipped
   unless `includeBackups: true` or `AGY_CACHE_INCLUDE_BACKUPS=1` is set.

## 5. Performance

- **Incremental transcript tailing (`src/transcript.mjs`)**: Tracks `mtimeMs`,
  `size`, and newline-aligned byte `offset` per transcript file. Unchanged files
  are O(1) cache hits; active conversations read only newly appended bytes.
- **SQLite & Swarm metadata caching (`src/metadata.mjs`)**: Uses read-only
  `node:sqlite` (`{ readOnly: true }`, with `?immutable=1` fallback) keyed by
  both `conversation_summaries.db` and `conversation_summaries.db-wal` stats.
- **ETag polling (`src/index.mjs`, `sidecars/cache_radar/main.mjs`)**: The side
  pane polls `/api/stats` every 2.5s and skips DOM re-renders when the snapshot
  ETag is unchanged.
