import { REASON_META, addTurnToDiagnostics, createDiagnosticsCollector, finalizeDiagnostics } from './diagnostics.mjs';
import { collectSubtreeIds } from './hierarchy.mjs';
import { addEventToAccumulator, computeHitRate, createAccumulator, finalizeAccumulator, matchesSourceFilter } from './metrics_core.mjs';

function scoreActiveCandidate(node, subtreeSize, hasLiveDescendant) {
  let score = 0;
  if (node.source.isCurrent) score += 1_000_000_000_000;
  if (node.isLive || hasLiveDescendant) score += 100_000_000_000;
  if (node.kind === 'root') score += 10_000_000_000;
  if (node.events.length > 0 || subtreeSize > 1) score += 1_000_000_000;
  return score + (node.lastActivityMs || 0);
}

function resolveActiveConversationId(requestedId, conversations, sourceFilter) {
  if (requestedId && conversations.has(requestedId)) return requestedId;
  let bestId = null;
  let bestScore = -1;
  for (const node of conversations.values()) {
    if (!matchesSourceFilter(node, sourceFilter)) continue;
    const subtree = collectSubtreeIds(node.conversationId, conversations);
    const hasLiveDesc = subtree.some((id) => id !== node.conversationId && conversations.get(id)?.isLive);
    const score = scoreActiveCandidate(node, subtree.length, hasLiveDesc);
    if (score > bestScore) {
      bestScore = score;
      bestId = node.conversationId;
    }
  }
  return bestId;
}

function parseOptionalMs(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function inTimeRange(ev, fallbackTs, fromMs, toMs) {
  if (fromMs === null && toMs === null) return true;
  const ts = ev.ts || fallbackTs || 0;
  if (fromMs !== null && ts < fromMs) return false;
  if (toMs !== null && ts > toMs) return false;
  return true;
}

function toCompactTicks(events, fallbackTs) {
  const ticks = [];
  for (const ev of events) {
    const ts = ev.ts || fallbackTs || 0;
    if (!ts) continue;
    const prompt = ev.cacheReadTokens + ev.inputTokens;
    const pct = prompt > 0 ? Math.round((ev.cacheReadTokens / prompt) * 100) : 0;
    const isWarmMiss = ev.isWarmTurn && ev.cacheReadTokens === 0 && ev.inputTokens > 0 ? 1 : 0;
    ticks.push([ts, pct, prompt, isWarmMiss]);
  }
  ticks.sort((a, b) => a[0] - b[0]);
  return ticks;
}

function buildTurnSeries(events, limit = 36) {
  return events.slice(-limit).map((ev) => ({
    stepIndex: ev.stepIndex,
    turnNumber: ev.turnNumber || 0,
    ts: ev.ts,
    model: ev.model,
    gapSec: Math.round(ev.gapSec || 0),
    reason: ev.primaryReason || 'incremental_append',
    reasonLabel: REASON_META[ev.primaryReason]?.shortLabel || '',
    wastedPrefixTokens: ev.wastedPrefixTokens || 0,
    cacheReadTokens: ev.cacheReadTokens,
    uncachedInputTokens: ev.inputTokens,
    totalPromptTokens: ev.cacheReadTokens + ev.inputTokens,
    cacheHitRate: computeHitRate(ev.cacheReadTokens, ev.inputTokens),
    agent: ev.agent || '',
  }));
}

function summarizeLatestTurn(ev, includeAgent = false) {
  if (!ev) return null;
  const out = {
    ts: ev.ts,
    model: ev.model,
    gapSec: Math.round(ev.gapSec || 0),
    reason: ev.primaryReason || 'incremental_append',
    reasonLabel: REASON_META[ev.primaryReason]?.shortLabel || '',
    wastedPrefixTokens: ev.wastedPrefixTokens || 0,
    cacheReadTokens: ev.cacheReadTokens,
    uncachedInputTokens: ev.inputTokens,
    totalPromptTokens: ev.cacheReadTokens + ev.inputTokens,
    cacheHitRate: computeHitRate(ev.cacheReadTokens, ev.inputTokens),
  };
  if (includeAgent) out.agent = ev.agent;
  return out;
}

function buildRecentSessions(conversations, sourceFilter) {
  const roots = [];
  for (const node of conversations.values()) {
    if (!matchesSourceFilter(node, sourceFilter) || node.kind !== 'root') continue;

    const subtreeIds = collectSubtreeIds(node.conversationId, conversations);
    const treeAcc = createAccumulator();
    let lastActivityMs = node.lastActivityMs;
    let isLive = node.isLive;

    for (const id of subtreeIds) {
      const member = conversations.get(id);
      if (!member) continue;
      if (member.isLive) isLive = true;
      if (member.lastActivityMs > lastActivityMs) lastActivityMs = member.lastActivityMs;
      for (const ev of member.annotatedEvents || member.events) addEventToAccumulator(treeAcc, ev);
    }

    if (treeAcc.turns === 0 && !isLive) continue;
    roots.push({
      conversationId: node.conversationId,
      title: node.title,
      sourceId: node.sourceId,
      sourceLabel: node.sourceLabel,
      isCurrentSource: node.source.isCurrent,
      isLive,
      isSwarm: node.isSwarmCoordinator,
      descendantCount: Math.max(0, subtreeIds.length - 1),
      turns: treeAcc.turns,
      totalPromptTokens: treeAcc.cacheReadTokens + treeAcc.uncachedInputTokens,
      cacheHitRate: computeHitRate(treeAcc.cacheReadTokens, treeAcc.uncachedInputTokens),
      lastActivityMs,
    });
  }

  roots.sort((a, b) => (a.isLive !== b.isLive ? (a.isLive ? -1 : 1) : b.lastActivityMs - a.lastActivityMs));
  return roots.slice(0, 15);
}

export function buildActiveSessionSummary(graph, options = {}) {
  const { conversations } = graph;
  const sourceFilter = options.sourceFilter || 'all';
  const requestedId = options.conversationId || '';
  const fromMs = parseOptionalMs(options.sessionFrom);
  const toMs = parseOptionalMs(options.sessionTo);
  const isFiltered = fromMs !== null || toMs !== null;

  const activeId = resolveActiveConversationId(requestedId, conversations, sourceFilter);
  const recentSessions = buildRecentSessions(conversations, sourceFilter);
  if (!activeId) return { found: false, conversationId: requestedId || null, recentSessions };

  const node = conversations.get(activeId);
  const allSelfEvents = node.annotatedEvents || [];
  const filteredSelfEvents = allSelfEvents.filter((ev) => inTimeRange(ev, node.transcriptMtimeMs, fromMs, toMs));
  const subtreeIds = collectSubtreeIds(activeId, conversations);

  const selfAcc = createAccumulator();
  const subAcc = createAccumulator();
  const treeAcc = createAccumulator();
  const selfDiag = createDiagnosticsCollector();
  const subDiag = createDiagnosticsCollector();
  const treeDiag = createDiagnosticsCollector();

  for (const ev of filteredSelfEvents) {
    addEventToAccumulator(selfAcc, ev);
    addEventToAccumulator(treeAcc, ev);
    addTurnToDiagnostics(selfDiag, ev, node.conversationId);
    addTurnToDiagnostics(treeDiag, ev, node.conversationId);
  }

  const allTreeEvents = [...allSelfEvents];
  const filteredTreeEvents = [...filteredSelfEvents];
  const descendants = [];
  let totalDescendantCount = 0;
  let anyLiveDescendant = false;
  let anySwarmDescendant = false;
  let maxLastActivityMs = node.lastActivityMs;
  let totalDedupedForkSteps = node.dedupedForkSteps;

  for (const id of subtreeIds) {
    if (id === activeId) continue;
    const child = conversations.get(id);
    if (!child) continue;
    totalDescendantCount += 1;
    if (child.isLive) anyLiveDescendant = true;
    if (child.kind === 'swarm_worker') anySwarmDescendant = true;
    if (child.lastActivityMs > maxLastActivityMs) maxLastActivityMs = child.lastActivityMs;
    totalDedupedForkSteps += child.dedupedForkSteps;
    const childAllEvents = child.annotatedEvents || [];
    for (const ev of childAllEvents) allTreeEvents.push(ev);

    const childEvents = childAllEvents.filter((ev) => inTimeRange(ev, child.transcriptMtimeMs, fromMs, toMs));
    const childAcc = createAccumulator();
    const childDiag = createDiagnosticsCollector();

    for (const ev of childEvents) {
      addEventToAccumulator(childAcc, ev);
      addEventToAccumulator(subAcc, ev);
      addEventToAccumulator(treeAcc, ev);
      addTurnToDiagnostics(childDiag, ev, child.conversationId);
      addTurnToDiagnostics(subDiag, ev, child.conversationId);
      addTurnToDiagnostics(treeDiag, ev, child.conversationId);
      filteredTreeEvents.push(ev);
    }

    if (isFiltered && childEvents.length === 0) continue;
    const childFinal = finalizeAccumulator(childAcc);
    const childDiagFinal = finalizeDiagnostics(childDiag, 3);
    descendants.push({
      conversationId: child.conversationId,
      title: child.title,
      kind: child.kind,
      role: child.role,
      depth: child.depth - node.depth,
      isLive: child.isLive,
      turns: childFinal.turns,
      warmMissTurns: childDiagFinal.warmMissTurns,
      wastedPrefixTokens: childDiagFinal.wastedPrefixTokens,
      prefixRetentionRate: childDiagFinal.prefixRetentionRate,
      cacheReadTokens: childFinal.cacheReadTokens,
      uncachedInputTokens: childFinal.uncachedInputTokens,
      totalPromptTokens: childFinal.totalPromptTokens,
      outputTokens: childFinal.outputTokens,
      cacheHitRate: childFinal.cacheHitRate,
      lastActivityMs: child.lastActivityMs,
      dedupedForkSteps: child.dedupedForkSteps,
    });
  }

  descendants.sort((a, b) => b.totalPromptTokens - a.totalPromptTokens);
  filteredTreeEvents.sort((a, b) => a.ts - b.ts || a.stepIndex - b.stepIndex);

  const ticksSelf = toCompactTicks(allSelfEvents, node.transcriptMtimeMs);
  const ticksTree = toCompactTicks(allTreeEvents, node.transcriptMtimeMs);
  const minTs = ticksTree.length > 0 ? ticksTree[0][0] : 0;
  const maxTs = ticksTree.length > 0 ? ticksTree[ticksTree.length - 1][0] : 0;
  const parentNode = node.rootId !== node.conversationId ? conversations.get(node.rootId) : null;

  return {
    found: true,
    conversationId: node.conversationId,
    matchedRequested: !requestedId || activeId === requestedId,
    title: node.title,
    kind: node.kind,
    role: node.role,
    isSwarm: node.isSwarmCoordinator || anySwarmDescendant,
    isLive: node.isLive || anyLiveDescendant,
    sourceId: node.sourceId,
    sourceLabel: node.sourceLabel,
    lastActivityMs: maxLastActivityMs,
    dedupedForkSteps: totalDedupedForkSteps,
    parentRoot: parentNode
      ? { conversationId: parentNode.conversationId, title: parentNode.title, isSwarm: parentNode.isSwarmCoordinator }
      : null,
    descendantCount: totalDescendantCount,
    activeDescendantCount: descendants.length,
    swarmWorkerCount: descendants.filter((d) => d.kind === 'swarm_worker').length,
    subagentCount: descendants.filter((d) => d.kind === 'subagent').length,
    timeRange: {
      from: fromMs,
      to: toMs,
      isFiltered,
      minTs,
      maxTs,
      totalTurnsSelf: ticksSelf.length,
      totalTurnsTree: ticksTree.length,
    },
    timeline: { minTs, maxTs, ticksSelf, ticksTree },
    self: { ...finalizeAccumulator(selfAcc), diagnostics: finalizeDiagnostics(selfDiag, 12) },
    subagents: { ...finalizeAccumulator(subAcc), diagnostics: finalizeDiagnostics(subDiag, 12) },
    tree: { ...finalizeAccumulator(treeAcc), diagnostics: finalizeDiagnostics(treeDiag, 12) },
    latestTurnSelf: summarizeLatestTurn(filteredSelfEvents[filteredSelfEvents.length - 1], false),
    latestTurnTree: summarizeLatestTurn(filteredTreeEvents[filteredTreeEvents.length - 1], true),
    turnSeriesSelf: buildTurnSeries(filteredSelfEvents, 36),
    turnSeriesTree: buildTurnSeries(filteredTreeEvents, 40),
    descendants,
    recentSessions,
  };
}
