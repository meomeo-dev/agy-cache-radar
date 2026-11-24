import { DAY_MS, HOUR_MS, WINDOW_24H_MS } from './constants.mjs';
import { addTurnToDiagnostics, createDiagnosticsCollector, finalizeDiagnostics } from './diagnostics.mjs';
import { addEventToAccumulator, computeHitRate, createAccumulator, finalizeAccumulator, matchesSourceFilter } from './metrics_core.mjs';

function createBuckets(bucketCount, bucketMs, windowEndMs, tzOffsetMinutes, mode) {
  const offsetMs = tzOffsetMinutes * 60_000;
  const shiftedEnd = windowEndMs - offsetMs;
  const alignedShiftedEnd = Math.floor(shiftedEnd / bucketMs) * bucketMs + bucketMs;
  const endMs = alignedShiftedEnd + offsetMs;
  const startMs = endMs - bucketCount * bucketMs;

  const buckets = [];
  for (let i = 0; i < bucketCount; i += 1) {
    const bStart = startMs + i * bucketMs;
    const localDate = new Date(bStart - offsetMs);
    const label =
      mode === 'hourly'
        ? `${String(localDate.getUTCHours()).padStart(2, '0')}:00`
        : `${String(localDate.getUTCMonth() + 1).padStart(2, '0')}/${String(localDate.getUTCDate()).padStart(2, '0')}`;
    buckets.push({
      label,
      startMs: bStart,
      endMs: bStart + bucketMs,
      turns: 0,
      missTurns: 0,
      wastedTokens: 0,
      cacheReadTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
    });
  }
  return { buckets, startMs };
}

function recordSourceEvent(bySource, node, ev) {
  let entry = bySource.get(node.sourceId);
  if (!entry) {
    entry = {
      sourceId: node.sourceId,
      label: node.sourceLabel,
      surface: node.surface,
      isCurrent: node.source.isCurrent,
      turns: 0,
      warmTurns: 0,
      warmMissTurns: 0,
      wastedPrefixTokens: 0,
      cacheReadTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      convIds: new Set(),
    };
    bySource.set(node.sourceId, entry);
  }
  entry.turns += 1;
  entry.cacheReadTokens += ev.cacheReadTokens;
  entry.uncachedInputTokens += ev.inputTokens;
  entry.outputTokens += ev.outputTokens;
  if (ev.isWarmTurn) {
    entry.warmTurns += 1;
    if (ev.cacheReadTokens === 0 && ev.inputTokens > 0) entry.warmMissTurns += 1;
    entry.wastedPrefixTokens += ev.wastedPrefixTokens || 0;
  }
  entry.convIds.add(node.conversationId);
}

function recordRootSessionEvent(byRoot, conversations, node, ev, ts) {
  const rootNode = conversations.get(node.rootId) || node;
  let entry = byRoot.get(node.rootId);
  if (!entry) {
    entry = {
      conversationId: node.rootId,
      title: rootNode.title,
      sourceLabel: rootNode.sourceLabel,
      isLive: rootNode.isLive,
      turns: 0,
      warmMissTurns: 0,
      wastedPrefixTokens: 0,
      cacheReadTokens: 0,
      uncachedInputTokens: 0,
      lastTs: 0,
      childConvIds: new Set(),
    };
    byRoot.set(node.rootId, entry);
  }
  if (node.isLive) entry.isLive = true;
  if (node.conversationId !== node.rootId) entry.childConvIds.add(node.conversationId);
  entry.turns += 1;
  entry.cacheReadTokens += ev.cacheReadTokens;
  entry.uncachedInputTokens += ev.inputTokens;
  if (ev.isWarmTurn && ev.cacheReadTokens === 0 && ev.inputTokens > 0) entry.warmMissTurns += 1;
  entry.wastedPrefixTokens += ev.wastedPrefixTokens || 0;
  if (ts > entry.lastTs) entry.lastTs = ts;
}

function finalizeWindowSlice(acc, diag, buckets, bySource, byRoot, activeConvIds, activeRootIds) {
  const sources = [...bySource.values()]
    .map((s) => ({
      sourceId: s.sourceId,
      label: s.label,
      surface: s.surface,
      isCurrent: s.isCurrent,
      sessions: s.convIds.size,
      turns: s.turns,
      warmMissTurns: s.warmMissTurns,
      warmMissRate: s.warmTurns > 0 ? s.warmMissTurns / s.warmTurns : null,
      wastedPrefixTokens: s.wastedPrefixTokens,
      cacheReadTokens: s.cacheReadTokens,
      uncachedInputTokens: s.uncachedInputTokens,
      totalPromptTokens: s.cacheReadTokens + s.uncachedInputTokens,
      outputTokens: s.outputTokens,
      cacheHitRate: computeHitRate(s.cacheReadTokens, s.uncachedInputTokens),
    }))
    .sort((a, b) => b.totalPromptTokens - a.totalPromptTokens);

  const topSessions = [...byRoot.values()]
    .map((r) => ({
      conversationId: r.conversationId,
      title: r.title,
      sourceLabel: r.sourceLabel,
      isLive: r.isLive,
      subagentCount: r.childConvIds.size,
      turns: r.turns,
      warmMissTurns: r.warmMissTurns,
      wastedPrefixTokens: r.wastedPrefixTokens,
      cacheReadTokens: r.cacheReadTokens,
      uncachedInputTokens: r.uncachedInputTokens,
      totalPromptTokens: r.cacheReadTokens + r.uncachedInputTokens,
      cacheHitRate: computeHitRate(r.cacheReadTokens, r.uncachedInputTokens),
      lastTs: r.lastTs,
    }))
    .sort((a, b) => b.totalPromptTokens - a.totalPromptTokens)
    .slice(0, 8);

  return {
    ...finalizeAccumulator(acc),
    diagnostics: finalizeDiagnostics(diag, 10),
    conversationCount: activeConvIds.size,
    rootSessionCount: activeRootIds.size,
    buckets: buckets.map((b) => ({
      ...b,
      totalPromptTokens: b.cacheReadTokens + b.uncachedInputTokens,
      cacheHitRate: computeHitRate(b.cacheReadTokens, b.uncachedInputTokens),
    })),
    sources,
    topSessions,
  };
}

function buildWindowScopeData(conversations, windowStartMs, nowMs, sourceFilter, roleFilter, bucketSpec) {
  const acc = createAccumulator();
  const diag = createDiagnosticsCollector();
  const bySource = new Map();
  const byRoot = new Map();
  const activeConvIds = new Set();
  const activeRootIds = new Set();
  const { buckets, startMs: bucketOriginMs } = createBuckets(
    bucketSpec.count,
    bucketSpec.bucketMs,
    nowMs,
    bucketSpec.tzOffsetMinutes,
    bucketSpec.mode
  );

  for (const node of conversations.values()) {
    if (!matchesSourceFilter(node, sourceFilter)) continue;
    const isSub = node.kind !== 'root';
    if ((roleFilter === 'main' && isSub) || (roleFilter === 'subagents' && !isSub)) continue;

    for (const ev of node.annotatedEvents || node.events) {
      const ts = ev.ts || node.transcriptMtimeMs;
      if (ts < windowStartMs || ts > nowMs) continue;

      addEventToAccumulator(acc, ev);
      addTurnToDiagnostics(diag, ev, node.conversationId);
      activeConvIds.add(node.conversationId);
      activeRootIds.add(node.rootId);

      const idx = Math.floor((ts - bucketOriginMs) / bucketSpec.bucketMs);
      if (idx >= 0 && idx < buckets.length) {
        buckets[idx].turns += 1;
        if (ev.isWarmTurn && ev.cacheReadTokens === 0 && ev.inputTokens > 0) buckets[idx].missTurns += 1;
        buckets[idx].wastedTokens += ev.wastedPrefixTokens || 0;
        buckets[idx].cacheReadTokens += ev.cacheReadTokens;
        buckets[idx].uncachedInputTokens += ev.inputTokens;
        buckets[idx].outputTokens += ev.outputTokens;
      }

      recordSourceEvent(bySource, node, ev);
      recordRootSessionEvent(byRoot, conversations, node, ev, ts);
    }
  }

  return finalizeWindowSlice(acc, diag, buckets, bySource, byRoot, activeConvIds, activeRootIds);
}

export function buildWindowSummary(graph, options) {
  const nowMs = options.nowMs ?? Date.now();
  const windowMs = options.windowMs;
  const windowStartMs = nowMs - windowMs;
  const sourceFilter = options.sourceFilter || 'all';
  const tzOffsetMinutes = Number.isFinite(Number(options.tzOffsetMinutes))
    ? Number(options.tzOffsetMinutes)
    : new Date(nowMs).getTimezoneOffset();
  const bucketSpec =
    windowMs <= WINDOW_24H_MS
      ? { count: 24, bucketMs: HOUR_MS, tzOffsetMinutes, mode: 'hourly' }
      : { count: 30, bucketMs: DAY_MS, tzOffsetMinutes, mode: 'daily' };

  return {
    windowMs,
    windowStartMs,
    windowEndMs: nowMs,
    all: buildWindowScopeData(graph.conversations, windowStartMs, nowMs, sourceFilter, 'all', bucketSpec),
    mainOnly: buildWindowScopeData(graph.conversations, windowStartMs, nowMs, sourceFilter, 'main', bucketSpec),
    subagentsOnly: buildWindowScopeData(graph.conversations, windowStartMs, nowMs, sourceFilter, 'subagents', bucketSpec),
  };
}
