# AGENTS.md

Project guidelines for coding agents and contributors working on `agy-cache-radar` (`Cache Radar`).

## Project Scope

`agy-cache-radar` is a zero-runtime-dependency Antigravity (`agy`) sidecar UI plugin and CLI reporter that computes prompt cache hit rates and cache-miss attribution from local Antigravity transcripts and metadata databases.

- Runtime: Node.js `>=22.5.0` (uses built-in `node:sqlite`, `node:http`, `node:test`).
- Production dependencies: **none**. Keep `package.json` dependency-free so the plugin runs directly under Antigravity's bundled Node runtime without `npm install`.

## Safety & Compatibility Constraints

1. **Read-Only Access to Local Antigravity Data**:
   - Never write to, modify, vacuum, or delete files inside any Antigravity data directory (`~/.gemini/antigravity*`, `~/.agy-profiles/*`).
   - Open `conversation_summaries.db` strictly with `{ readOnly: true }`, falling back to `file:<uri>?immutable=1` when WAL shm creation is blocked.
2. **No External Network Requests or Extra Model Calls**:
   - All metrics are derived strictly from local disk artifacts. Never add telemetry uploads, remote CDNs, or model invocations.
3. **Antigravity Sidecar Iframe Compatibility**:
   - Frontend scripts under `sidecars/cache_radar/web/` **must** be loaded as classic `<script src="/...">` IIFEs attached to `window.CacheRadar` (do **not** use `<script type="module">`, which fails CORS checks inside Antigravity's sidecar iframe).
   - Do **not** put inline `<script>` blocks in `sidecars/cache_radar/web/index.html`.
   - Bump the `?v=N` query string in `index.html` whenever frontend CSS/JS changes.
4. **Temporary Files**:
   - Never create temporary fixtures or scratch files inside the repository. Always use `os.tmpdir()` (`mkdtempSync`) and clean up in `finally`.

## Accounting & Diagnostic Invariants

- **Prompt Cache Hit Rate**: `cache_read_tokens / (input_tokens + cache_read_tokens)` across `PLANNER_RESPONSE` rows.
- **Deduplication & Completeness**: Every `conversation_id` enters the conversation graph at most once; forked leading prefix steps identical to an ancestor are deduplicated; rolling 24h/30d windows preserve `all = mainOnly + subagentsOnly`.
- **Prompt-Token Partition Invariant**: For every evaluated turn slice, `hitRate + anomalyShareOfPrompt + structuralShareOfPrompt === 1`.
- **Pre-Window Transition Preservation**: When filtering a session by `sessionFrom`/`sessionTo`, annotate turn gaps and cache-miss reasons on the full conversation sequence *before* slicing by time range so resumed turns are never misclassified as first-turn cold starts.

## File Length Thresholds

Split or refactor modules before adding new behavior when crossing these limits:

- Backend `.mjs` module: 500 lines; function: 40 lines.
- Frontend UI `.js` or `.css` file: 300 lines; function: 30 lines.
- Shell script (if any): 200 lines; function: 20 lines.

## Internationalization (i18n)

- Keep `sidecars/cache_radar/web/i18n.js` dictionaries (`zh-CN` and `en`) in 100% key and `{placeholder}` parity, covering all 8 `REASON_META` keys.
- Switching language via `#lang-btn` must re-render client-side without issuing extra `/api/stats` requests.
- Keep `README.md` strictly in English (only the top language link may reference `简体中文`) and `README.zh-CN.md` strictly in Simplified Chinese; keep English and Chinese screenshots separated under `docs/screenshots/`.
- Keep `scripts/cache-stats.mjs` text output single-language per `--lang <en|zh-CN>` (never mix English and Chinese labels in one output).

## Communication & Writing Style

- Use plain, direct engineering terminology across code, UI copy, comments, and documentation.
- Avoid fabricated jargon, pseudo-scientific metaphors, sensational phrasing, and marketing hype.
- Keep UI labels concise and visual-first (avoid multi-sentence prose blocks inside the sidecar widget).

## Verification Checklist Before Committing

```bash
npm test
agy plugin validate .
node scripts/cache-stats.mjs --last 24h
```

Note: `agy plugin validate .` reports a warning that root `AGENTS.md` is not loaded as a runtime plugin rule. That is intentional—`AGENTS.md` documents repository contributor rules and should not be moved into `rules/` (which would inject contributor rules into end users' sessions). Exclude `AGENTS.md` when syncing to `~/.gemini/config/plugins/cache-radar` so the installed directory passes `agy plugin validate --strict`.
