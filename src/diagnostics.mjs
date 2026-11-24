import { computeHitRate } from './metrics_core.mjs';

export const REASON_META = {
  hot_prefix_bust: {
    label: '短间隔失效 (<1m)',
    shortLabel: '短间隔失效',
    category: 'anomaly',
    color: 'bad',
    hint: '间隔 <1 分钟且同模型却 0 命中（工具/权限前缀变动或后端副本未命中）',
  },
  idle_ttl_expired: {
    label: '超时过期 (≥5m)',
    shortLabel: '超时过期',
    category: 'anomaly',
    color: 'warn',
    hint: '两轮停顿超过约 5 分钟缓存有效期',
  },
  idle_warm_decay: {
    label: '提前回收 (1-5m)',
    shortLabel: '提前回收',
    category: 'anomaly',
    color: 'warn',
    hint: '间隔 1–5 分钟期间缓存被服务端提前回收',
  },
  model_switch: {
    label: '切换模型/配置',
    shortLabel: '模型/配置',
    category: 'anomaly',
    color: 'purple',
    hint: '中途切换模型或会话配置，原缓存无法复用',
  },
  stream_interrupt: {
    label: '中断重试',
    shortLabel: '中断重试',
    category: 'anomaly',
    color: 'bad',
    hint: '连接报错中断或步骤回滚重发，导致已有缓存前缀失效',
  },
  partial_truncation: {
    label: '前缀部分失效',
    shortLabel: '部分失效',
    category: 'anomaly',
    color: 'warn',
    hint: '仅命中部分旧前缀（可能由 /compact、上下文截断或前缀局部变动引起）',
  },
  cold_start: {
    label: '首轮发送',
    shortLabel: '首轮发送',
    category: 'structural',
    color: 'info',
    hint: '新会话或新子代理第 1 轮尚无历史缓存',
  },
  incremental_append: {
    label: '每轮新内容',
    shortLabel: '每轮新内容',
    category: 'structural',
    color: 'neutral',
    hint: '旧上下文已命中，本轮新发的消息与工具输出首次发送，不在缓存中',
  },
};

const GAP_DEFS = [
  { key: '<1m', label: '<1m', maxSec: 60 },
  { key: '1-5m', label: '1-5m', maxSec: 300 },
  { key: '5-15m', label: '5-15m', maxSec: 900 },
  { key: '15m+', label: '≥15m', maxSec: Infinity },
];

const CTX_DEFS = [
  { key: '<64K', label: '<64K', maxTok: 64_000 },
  { key: '64-128K', label: '64-128K', maxTok: 128_000 },
  { key: '128-200K', label: '128-200K', maxTok: 200_000 },
  { key: '200K+', label: '≥200K', maxTok: Infinity },
];

export function annotateConversationTurns(events, agentLabel = '') {
  const annotated = [];
  let prev = null;

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    const totalPromptTokens = ev.inputTokens + ev.cacheReadTokens;

    if (!prev) {
      const isColdMiss = ev.cacheReadTokens === 0;
      annotated.push({
        ...ev,
        agent: agentLabel,
        turnNumber: 1,
        isWarmTurn: false,
        gapSec: 0,
        prevPromptTokens: 0,
        prevModel: ev.model,
        retainedPrefixTokens: 0,
        wastedPrefixTokens: 0,
        newDeltaTokens: ev.inputTokens,
        primaryReason: isColdMiss ? 'cold_start' : 'incremental_append',
        lostReasonTokens: 0,
        coldStartTokens: isColdMiss ? ev.inputTokens : 0,
        incrementalTokens: isColdMiss ? 0 : ev.inputTokens,
        totalPromptTokens,
      });
      prev = ev;
      continue;
    }

    const prevPromptTokens = prev.inputTokens + prev.cacheReadTokens;
    const gapSec = ev.ts > 0 && prev.ts > 0 ? Math.max(0, (ev.ts - prev.ts) / 1000) : 0;
    const retainedPrefixTokens = Math.min(ev.cacheReadTokens, prevPromptTokens);
    const rawWasted = Math.max(0, prevPromptTokens - ev.cacheReadTokens);
    const lostTokens = Math.min(ev.inputTokens, rawWasted);

    let primaryReason = 'incremental_append';
    let lostReasonTokens = 0;

    if (ev.cacheReadTokens === 0 && prevPromptTokens > 0) {
      if (ev.model !== prev.model || ev.hadSettingsChangeBefore) {
        primaryReason = 'model_switch';
      } else if (ev.hadErrorBefore || (ev.stepIndex >= 0 && prev.stepIndex >= 0 && ev.stepIndex < prev.stepIndex)) {
        primaryReason = 'stream_interrupt';
      } else if (gapSec >= 300) {
        primaryReason = 'idle_ttl_expired';
      } else if (gapSec >= 60) {
        primaryReason = 'idle_warm_decay';
      } else {
        primaryReason = 'hot_prefix_bust';
      }
      lostReasonTokens = lostTokens > 0 ? lostTokens : ev.inputTokens;
    } else if (prevPromptTokens > 0 && ev.cacheReadTokens < prevPromptTokens * 0.75 && lostTokens > 0) {
      primaryReason = 'partial_truncation';
      lostReasonTokens = lostTokens;
    }

    const effectiveIncremental = ev.inputTokens - lostReasonTokens;

    annotated.push({
      ...ev,
      agent: agentLabel,
      turnNumber: i + 1,
      isWarmTurn: true,
      gapSec,
      prevPromptTokens,
      prevModel: prev.model,
      retainedPrefixTokens,
      wastedPrefixTokens: lostReasonTokens,
      newDeltaTokens: Math.max(0, totalPromptTokens - prevPromptTokens),
      primaryReason,
      lostReasonTokens,
      coldStartTokens: 0,
      incrementalTokens: effectiveIncremental,
      totalPromptTokens,
    });
    prev = ev;
  }

  return annotated;
}

export function createDiagnosticsCollector() {
  const reasons = new Map();
  for (const key of Object.keys(REASON_META)) {
    reasons.set(key, { turns: 0, tokens: 0 });
  }
  return {
    turns: 0,
    warmTurns: 0,
    warmHitTurns: 0,
    warmMissTurns: 0,
    totalPromptTokens: 0,
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    expectedWarmPrefixTokens: 0,
    retainedWarmPrefixTokens: 0,
    wastedPrefixTokens: 0,
    totalNewDeltaTokens: 0,
    maxPromptTokens: 0,
    agentIds: new Set(),
    reasons,
    gapBuckets: GAP_DEFS.map((g) => ({ ...g, hits: 0, misses: 0, wastedTokens: 0 })),
    ctxBuckets: CTX_DEFS.map((c) => ({ ...c, turns: 0, missTurns: 0, cacheReadTokens: 0, uncachedInputTokens: 0, wastedTokens: 0 })),
    missEvents: [],
  };
}

export function addTurnToDiagnostics(diag, turn, conversationId = '') {
  diag.turns += 1;
  diag.totalPromptTokens += turn.totalPromptTokens;
  diag.uncachedInputTokens += turn.inputTokens;
  diag.cacheReadTokens += turn.cacheReadTokens;
  diag.totalNewDeltaTokens += turn.newDeltaTokens;
  if (turn.totalPromptTokens > diag.maxPromptTokens) diag.maxPromptTokens = turn.totalPromptTokens;
  if (conversationId) diag.agentIds.add(conversationId);

  const ctxBucket = diag.ctxBuckets.find((b) => turn.totalPromptTokens < b.maxTok) || diag.ctxBuckets[diag.ctxBuckets.length - 1];
  ctxBucket.turns += 1;
  ctxBucket.cacheReadTokens += turn.cacheReadTokens;
  ctxBucket.uncachedInputTokens += turn.inputTokens;
  ctxBucket.wastedTokens += turn.wastedPrefixTokens;
  if (turn.cacheReadTokens === 0 && turn.inputTokens > 0) ctxBucket.missTurns += 1;

  if (!turn.isWarmTurn) {
    if (turn.coldStartTokens > 0) {
      const r = diag.reasons.get('cold_start');
      r.turns += 1;
      r.tokens += turn.coldStartTokens;
    }
    if (turn.incrementalTokens > 0) {
      const r = diag.reasons.get('incremental_append');
      r.turns += 1;
      r.tokens += turn.incrementalTokens;
    }
    return;
  }

  diag.warmTurns += 1;
  diag.expectedWarmPrefixTokens += turn.prevPromptTokens;
  diag.retainedWarmPrefixTokens += turn.retainedPrefixTokens;
  diag.wastedPrefixTokens += turn.wastedPrefixTokens;

  const isHit = turn.cacheReadTokens > 0;
  if (isHit) diag.warmHitTurns += 1;
  else diag.warmMissTurns += 1;

  const gapBucket = diag.gapBuckets.find((b) => turn.gapSec < b.maxSec) || diag.gapBuckets[diag.gapBuckets.length - 1];
  if (isHit) gapBucket.hits += 1;
  else gapBucket.misses += 1;
  gapBucket.wastedTokens += turn.wastedPrefixTokens;

  if (turn.lostReasonTokens > 0 && turn.primaryReason !== 'incremental_append') {
    const r = diag.reasons.get(turn.primaryReason);
    r.turns += 1;
    r.tokens += turn.lostReasonTokens;
  }
  if (turn.incrementalTokens > 0) {
    const r = diag.reasons.get('incremental_append');
    r.turns += 1;
    r.tokens += turn.incrementalTokens;
  }

  if (turn.primaryReason !== 'incremental_append' && turn.lostReasonTokens > 0) {
    diag.missEvents.push({
      conversationId,
      agent: turn.agent || '',
      stepIndex: turn.stepIndex,
      turnNumber: turn.turnNumber,
      ts: turn.ts,
      model: turn.model,
      prevModel: turn.prevModel,
      gapSec: Math.round(turn.gapSec),
      reason: turn.primaryReason,
      reasonLabel: REASON_META[turn.primaryReason]?.shortLabel || turn.primaryReason,
      prevPromptTokens: turn.prevPromptTokens,
      totalPromptTokens: turn.totalPromptTokens,
      cacheReadTokens: turn.cacheReadTokens,
      uncachedInputTokens: turn.inputTokens,
      wastedPrefixTokens: turn.wastedPrefixTokens,
    });
  }
}

export function finalizeDiagnostics(diag, maxMissEvents = 12) {
  const uncached = diag.uncachedInputTokens;
  const totalPrompt = diag.totalPromptTokens;

  const attribution = [...diag.reasons.entries()]
    .filter(([, v]) => v.tokens > 0)
    .map(([key, v]) => ({
      key,
      label: REASON_META[key].label,
      shortLabel: REASON_META[key].shortLabel,
      category: REASON_META[key].category,
      color: REASON_META[key].color,
      hint: REASON_META[key].hint,
      turns: v.turns,
      tokens: v.tokens,
      shareOfUncached: uncached > 0 ? v.tokens / uncached : 0,
      shareOfPrompt: totalPrompt > 0 ? v.tokens / totalPrompt : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  const anomalies = attribution.filter((a) => a.category === 'anomaly');
  const structurals = attribution.filter((a) => a.category === 'structural');
  const anomalyTokens = anomalies.reduce((s, a) => s + a.tokens, 0);
  const structuralTokens = structurals.reduce((s, a) => s + a.tokens, 0);
  const anomalyShareOfPrompt = totalPrompt > 0 ? anomalyTokens / totalPrompt : 0;
  const structuralShareOfPrompt = totalPrompt > 0 ? structuralTokens / totalPrompt : 0;

  const prefixRetentionRate =
    diag.expectedWarmPrefixTokens > 0 ? diag.retainedWarmPrefixTokens / diag.expectedWarmPrefixTokens : null;
  const warmTurnHitRate = diag.warmTurns > 0 ? diag.warmHitTurns / diag.warmTurns : null;
  const avgTurnsPerAgent = diag.agentIds.size > 0 ? diag.turns / diag.agentIds.size : diag.turns;
  const avgNewDeltaTokens = diag.turns > 0 ? Math.round(diag.totalNewDeltaTokens / diag.turns) : 0;

  const topAnomaly = anomalies[0] || null;
  const primaryCause = topAnomaly
    ? {
        key: topAnomaly.key,
        label: topAnomaly.shortLabel,
        turns: topAnomaly.turns,
        tokens: topAnomaly.tokens,
        dropShare: topAnomaly.shareOfPrompt,
      }
    : null;

  const topMissEvents = [...diag.missEvents]
    .sort((a, b) => b.wastedPrefixTokens - a.wastedPrefixTokens || b.ts - a.ts)
    .slice(0, maxMissEvents);

  return {
    warmTurns: diag.warmTurns,
    warmHitTurns: diag.warmHitTurns,
    warmMissTurns: diag.warmMissTurns,
    warmTurnHitRate,
    expectedWarmPrefixTokens: diag.expectedWarmPrefixTokens,
    retainedWarmPrefixTokens: diag.retainedWarmPrefixTokens,
    wastedPrefixTokens: diag.wastedPrefixTokens,
    anomalyTokens,
    structuralTokens,
    anomalyShareOfPrompt,
    structuralShareOfPrompt,
    primaryCause,
    prefixRetentionRate,
    avgTurnsPerAgent: Number(avgTurnsPerAgent.toFixed(1)),
    avgNewDeltaTokens,
    maxPromptTokens: diag.maxPromptTokens,
    attribution,
    gapBuckets: diag.gapBuckets.map(({ key, label, hits, misses, wastedTokens }) => {
      const total = hits + misses;
      return { key, label, hits, misses, total, hitRate: total > 0 ? hits / total : null, wastedTokens };
    }),
    contextBuckets: diag.ctxBuckets.map(({ key, label, turns, missTurns, cacheReadTokens, uncachedInputTokens, wastedTokens }) => ({
      key,
      label,
      turns,
      missTurns,
      cacheReadTokens,
      uncachedInputTokens,
      totalPromptTokens: cacheReadTokens + uncachedInputTokens,
      cacheHitRate: computeHitRate(cacheReadTokens, uncachedInputTokens),
      wastedTokens,
    })),
    missEvents: topMissEvents,
  };
}
