import { createHash } from 'node:crypto';
import { SNAPSHOT_TTL_MS } from './constants.mjs';
import { discoverDataDirs } from './discovery.mjs';
import { MetadataCache } from './metadata.mjs';
import { TranscriptCache } from './transcript.mjs';
import { buildConversationGraph } from './hierarchy.mjs';
import { buildFullSnapshot } from './aggregator.mjs';

export class CacheRadarEngine {
  constructor(options = {}) {
    this.discoveryOptions = options.discoveryOptions || {};
    this.ttlMs = options.ttlMs ?? SNAPSHOT_TTL_MS;
    this.transcriptCache = new TranscriptCache();
    this.metadataCache = new MetadataCache();
    this.cachedGraph = null;
    this.cachedGraphAt = 0;
  }

  getGraph(nowMs = Date.now(), forceRefresh = false) {
    if (!forceRefresh && this.cachedGraph && nowMs - this.cachedGraphAt < this.ttlMs) {
      return this.cachedGraph;
    }
    const sources = discoverDataDirs(this.discoveryOptions);
    this.cachedGraph = buildConversationGraph(sources, this.transcriptCache, this.metadataCache, nowMs);
    this.cachedGraphAt = nowMs;
    return this.cachedGraph;
  }

  getSnapshot(options = {}) {
    const nowMs = options.nowMs ?? Date.now();
    const graph = this.getGraph(nowMs, Boolean(options.forceRefresh));
    const snapshot = buildFullSnapshot(graph, {
      nowMs,
      conversationId: options.conversationId || '',
      sourceFilter: options.sourceFilter || 'all',
      tzOffsetMinutes: options.tzOffsetMinutes,
      sessionFrom: options.sessionFrom,
      sessionTo: options.sessionTo,
    });

    // Deterministic ETag based on content (excluding generatedAt timestamp).
    const fingerprint = JSON.stringify({
      sourceFilter: snapshot.sourceFilter,
      diagnostics: snapshot.diagnostics,
      activeId: snapshot.activeSession.conversationId,
      sessionFrom: snapshot.activeSession.timeRange?.from || null,
      sessionTo: snapshot.activeSession.timeRange?.to || null,
      activeSelf: snapshot.activeSession.self?.totalPromptTokens,
      activeTree: snapshot.activeSession.tree?.totalPromptTokens,
      activeTurns: snapshot.activeSession.tree?.turns,
      w24: snapshot.last24h.all.totalPromptTokens,
      w24c: snapshot.last24h.all.cacheReadTokens,
      w30: snapshot.last30d.all.totalPromptTokens,
      w30c: snapshot.last30d.all.cacheReadTokens,
    });
    const etag = createHash('sha1').update(fingerprint).digest('hex').slice(0, 16);
    return { ...snapshot, etag };
  }
}

export { discoverDataDirs, buildConversationGraph, buildFullSnapshot };
