#!/usr/bin/env node
import { CacheRadarEngine } from '../src/index.mjs';

const PRESET_MS = {
  '1h': 3600_000,
  '24h': 24 * 3600_000,
  '7d': 7 * 86400_000,
  '30d': 30 * 86400_000,
};

function parseTimestampArg(raw) {
  if (!raw) return null;
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) return Math.trunc(num);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseArgs(argv) {
  const opts = { json: false, source: 'all', conversationId: '', sessionFrom: null, sessionTo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--source' && argv[i + 1]) opts.source = argv[++i];
    else if (arg === '--conversation' && argv[i + 1]) opts.conversationId = argv[++i];
    else if (arg === '--from' && argv[i + 1]) opts.sessionFrom = parseTimestampArg(argv[++i]);
    else if (arg === '--to' && argv[i + 1]) opts.sessionTo = parseTimestampArg(argv[++i]);
    else if (arg === '--last' && argv[i + 1]) {
      const ms = PRESET_MS[argv[++i]];
      if (ms) {
        opts.sessionTo = Date.now();
        opts.sessionFrom = opts.sessionTo - ms;
      }
    }
  }
  return opts;
}

function fmtPct(rate) {
  return rate === null || rate === undefined ? '--' : `${(rate * 100).toFixed(1)}%`;
}

function fmtTok(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

function printAttribution(title, diag) {
  if (!diag?.attribution?.length) return;
  console.log(
    `  ${title} (旧上下文复用率 ${fmtPct(diag.prefixRetentionRate)}, 异常丢缓存重发 ${fmtTok(diag.anomalyTokens)} / 命中率影响 -${fmtPct(diag.anomalyShareOfPrompt)}):`
  );
  for (const a of diag.attribution.slice(0, 6)) {
    const tag = a.category === 'anomaly' ? '[丢缓存]' : '[正常新增]';
    const impact = a.category === 'anomaly' ? `命中率影响 -${fmtPct(a.shareOfPrompt)}` : `占总输入 ${fmtPct(a.shareOfPrompt)}`;
    console.log(
      `    ${tag} ${a.label.padEnd(22)} ${fmtTok(a.tokens).padStart(7)} (${impact}, ${a.turns}轮)`
    );
  }
}

function printTextReport(snap) {
  const s = snap.activeSession;
  const w24 = snap.last24h;
  const w30 = snap.last30d;

  console.log('=== Cache Radar v0.1.0 ===');
  console.log(
    `Data sources: ${snap.diagnostics.nonEmptySources}/${snap.diagnostics.totalSources} active, ` +
      `${snap.diagnostics.totalConversations} unique conversations ` +
      `(deduped: ${snap.diagnostics.dedupedConversations} convs, ${snap.diagnostics.dedupedForkSteps} fork steps)`
  );
  console.log('');

  if (s.found) {
    const activeSlice = s.descendantCount > 0 ? s.tree : s.self;
    const rangeTag = s.timeRange?.isFiltered
      ? ` [range: ${s.timeRange.from ? new Date(s.timeRange.from).toISOString() : '*'} .. ${s.timeRange.to ? new Date(s.timeRange.to).toISOString() : '*'}]`
      : '';
    console.log(`[1] Active Session: ${s.title} (${s.sourceLabel})${rangeTag}`);
    console.log(
      `    Hit Rate: ${fmtPct(activeSlice.cacheHitRate)} ` +
        `| read ${fmtTok(activeSlice.cacheReadTokens)} / prompt ${fmtTok(activeSlice.totalPromptTokens)} | ${activeSlice.turns} turns`
    );
    if (s.descendantCount > 0) {
      console.log(
        `    Main only: ${fmtPct(s.self.cacheHitRate)} (${s.self.turns} turns) | ` +
          `Subagents/Swarm(${s.descendantCount}): ${fmtPct(s.subagents.cacheHitRate)} (${s.subagents.turns} turns)`
      );
    }
    printAttribution('Uncached Attribution (Session)', activeSlice.diagnostics);
  } else {
    console.log('[1] Active Session: none found');
  }

  console.log('');
  console.log(
    `[2] Last 24 Hours: ${fmtPct(w24.all.cacheHitRate)} ` +
      `(main ${fmtPct(w24.mainOnly.cacheHitRate)} / subagents ${fmtPct(w24.subagentsOnly.cacheHitRate)}) ` +
      `| read ${fmtTok(w24.all.cacheReadTokens)} / prompt ${fmtTok(w24.all.totalPromptTokens)} | ${w24.all.turns} turns`
  );
  printAttribution('Uncached Attribution (24h)', w24.all.diagnostics);

  console.log('');
  console.log(
    `[3] Last 30 Days:  ${fmtPct(w30.all.cacheHitRate)} ` +
      `(main ${fmtPct(w30.mainOnly.cacheHitRate)} / subagents ${fmtPct(w30.subagentsOnly.cacheHitRate)}) ` +
      `| read ${fmtTok(w30.all.cacheReadTokens)} / prompt ${fmtTok(w30.all.totalPromptTokens)} | ${w30.all.turns} turns`
  );
  printAttribution('Uncached Attribution (30d)', w30.all.diagnostics);
}

const opts = parseArgs(process.argv.slice(2));
const engine = new CacheRadarEngine();
const snapshot = engine.getSnapshot({
  conversationId: opts.conversationId,
  sourceFilter: opts.source,
  sessionFrom: opts.sessionFrom,
  sessionTo: opts.sessionTo,
  forceRefresh: true,
});

if (opts.json) {
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  printTextReport(snapshot);
}
