export function createAccumulator() {
  return {
    turns: 0,
    cacheHitTurns: 0,
    cacheMissTurns: 0,
    cacheReadTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    byModel: new Map(),
  };
}

export function addEventToAccumulator(acc, ev) {
  acc.turns += 1;
  acc.cacheReadTokens += ev.cacheReadTokens;
  acc.uncachedInputTokens += ev.inputTokens;
  acc.outputTokens += ev.outputTokens;
  if (ev.cacheReadTokens > 0) acc.cacheHitTurns += 1;
  else if (ev.inputTokens > 0) acc.cacheMissTurns += 1;

  let m = acc.byModel.get(ev.model);
  if (!m) {
    m = {
      model: ev.model,
      turns: 0,
      warmTurns: 0,
      warmMissTurns: 0,
      cacheReadTokens: 0,
      uncachedInputTokens: 0,
      wastedPrefixTokens: 0,
      outputTokens: 0,
    };
    acc.byModel.set(ev.model, m);
  }
  m.turns += 1;
  m.cacheReadTokens += ev.cacheReadTokens;
  m.uncachedInputTokens += ev.inputTokens;
  m.outputTokens += ev.outputTokens;
  if (ev.isWarmTurn) {
    m.warmTurns += 1;
    if (ev.cacheReadTokens === 0 && ev.inputTokens > 0) m.warmMissTurns += 1;
    m.wastedPrefixTokens += ev.wastedPrefixTokens || 0;
  }
}

export function computeHitRate(cacheReadTokens, uncachedInputTokens) {
  const total = cacheReadTokens + uncachedInputTokens;
  return total > 0 ? cacheReadTokens / total : null;
}

export function finalizeAccumulator(acc) {
  const totalPromptTokens = acc.cacheReadTokens + acc.uncachedInputTokens;
  const models = [...acc.byModel.values()]
    .map((m) => ({
      model: m.model,
      turns: m.turns,
      warmTurns: m.warmTurns,
      warmMissTurns: m.warmMissTurns,
      warmMissRate: m.warmTurns > 0 ? m.warmMissTurns / m.warmTurns : null,
      cacheReadTokens: m.cacheReadTokens,
      uncachedInputTokens: m.uncachedInputTokens,
      totalPromptTokens: m.cacheReadTokens + m.uncachedInputTokens,
      wastedPrefixTokens: m.wastedPrefixTokens,
      outputTokens: m.outputTokens,
      cacheHitRate: computeHitRate(m.cacheReadTokens, m.uncachedInputTokens),
    }))
    .sort((a, b) => b.totalPromptTokens - a.totalPromptTokens);

  return {
    turns: acc.turns,
    cacheHitTurns: acc.cacheHitTurns,
    cacheMissTurns: acc.cacheMissTurns,
    cacheReadTokens: acc.cacheReadTokens,
    uncachedInputTokens: acc.uncachedInputTokens,
    totalPromptTokens,
    outputTokens: acc.outputTokens,
    cacheHitRate: computeHitRate(acc.cacheReadTokens, acc.uncachedInputTokens),
    models,
  };
}

export function matchesSourceFilter(node, sourceFilter) {
  if (!sourceFilter || sourceFilter === 'all') return true;
  if (sourceFilter === 'current') return Boolean(node.source.isCurrent);
  return node.sourceId === sourceFilter;
}
