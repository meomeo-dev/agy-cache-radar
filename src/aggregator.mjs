import { WINDOW_24H_MS, WINDOW_30D_MS } from './constants.mjs';
import { buildActiveSessionSummary } from './session_metrics.mjs';
import { buildWindowSummary } from './window_metrics.mjs';

export { computeHitRate } from './metrics_core.mjs';
export { buildActiveSessionSummary } from './session_metrics.mjs';
export { buildWindowSummary } from './window_metrics.mjs';

export function buildFullSnapshot(graph, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const sourceFilter = options.sourceFilter || 'all';
  const tzOffsetMinutes = options.tzOffsetMinutes;

  return {
    generatedAt: nowMs,
    sourceFilter,
    sources: graph.sources,
    diagnostics: graph.diagnostics,
    activeSession: buildActiveSessionSummary(graph, {
      conversationId: options.conversationId || '',
      sourceFilter,
      sessionFrom: options.sessionFrom,
      sessionTo: options.sessionTo,
    }),
    last24h: buildWindowSummary(graph, {
      nowMs,
      windowMs: WINDOW_24H_MS,
      sourceFilter,
      tzOffsetMinutes,
    }),
    last30d: buildWindowSummary(graph, {
      nowMs,
      windowMs: WINDOW_30D_MS,
      sourceFilter,
      tzOffsetMinutes,
    }),
  };
}
