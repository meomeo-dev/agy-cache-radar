import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONVERSATION_ID_RE,
  LIVE_RECENCY_MS,
  MAX_TREE_DEPTH,
  TRANSCRIPT_REL_PATH,
} from './constants.mjs';
import { annotateConversationTurns } from './diagnostics.mjs';
import { readPresenceIds } from './metadata.mjs';

function stepSignature(ev) {
  return `${ev.stepIndex}|${ev.ts}|${ev.model}|${ev.inputTokens}|${ev.cacheReadTokens}|${ev.outputTokens}`;
}

function listBrainConversationIds(appDataDir) {
  const brainDir = join(appDataDir, 'brain');
  if (!existsSync(brainDir)) return [];
  let entries;
  try {
    entries = readdirSync(brainDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (CONVERSATION_ID_RE.test(entry.name)) ids.push(entry.name);
  }
  return ids;
}

function shouldReplaceCandidate(existing, candidate) {
  if (candidate.rawEvents.length !== existing.rawEvents.length) {
    return candidate.rawEvents.length > existing.rawEvents.length;
  }
  if (candidate.transcriptMtimeMs !== existing.transcriptMtimeMs) {
    return candidate.transcriptMtimeMs > existing.transcriptMtimeMs;
  }
  return Boolean(candidate.source.isCurrent && !existing.source.isCurrent);
}

function resolveDisplayName(cid, kind, summary, swarmMember) {
  if (kind === 'swarm_worker') {
    return swarmMember?.rosterName || summary?.agentName || summary?.title || cid.slice(0, 8);
  }
  if (kind === 'subagent') {
    return summary?.agentName || summary?.title || cid.slice(0, 8);
  }
  return summary?.title || swarmMember?.swarmTitle || cid.slice(0, 8);
}

function inferLiveState(summary, presenceIds, cid, transcriptMtimeMs, now) {
  if (summary?.killed) return false;
  if (summary?.status === 'CASCADE_RUN_STATUS_RUNNING' || summary?.notFullyIdle) return true;
  if (presenceIds.has(cid) && now - transcriptMtimeMs <= LIVE_RECENCY_MS) return true;
  return now - transcriptMtimeMs <= 30_000;
}

function buildConversationNode(cid, source, transcript, summary, swarmMember, isSwarmCoordinator, presenceIds, now) {
  const rawEvents = transcript ? transcript.allEvents : [];
  const lastEventTs = rawEvents.length > 0 ? rawEvents[rawEvents.length - 1].ts : 0;
  const transcriptMtimeMs = transcript ? transcript.mtimeMs : 0;
  const lastActivityMs = Math.max(lastEventTs, summary?.lastModifiedMs || 0, transcriptMtimeMs);

  let parentId = summary?.parentId || '';
  if (!parentId && swarmMember && swarmMember.coordinatorId !== cid) {
    parentId = swarmMember.coordinatorId;
  }
  if (parentId === cid) parentId = '';

  let kind = 'root';
  if (swarmMember && swarmMember.coordinatorId !== cid) {
    kind = 'swarm_worker';
  } else if (parentId || (summary?.nestingDepth || 0) > 0) {
    kind = 'subagent';
  }

  return {
    conversationId: cid,
    sourceId: source.id,
    sourceLabel: source.label,
    surface: source.surface,
    source,
    title: resolveDisplayName(cid, kind, summary, swarmMember),
    rawTitle: summary?.title || '',
    kind,
    role: swarmMember?.role || (isSwarmCoordinator ? 'coordinator' : kind === 'root' ? 'main' : 'subagent'),
    agentName: swarmMember?.rosterName || summary?.agentName || '',
    isSwarmCoordinator,
    parentId,
    orphanParentId: '',
    rootId: cid,
    depth: 0,
    status: summary?.status || '',
    notFullyIdle: Boolean(summary?.notFullyIdle),
    killed: Boolean(summary?.killed || swarmMember?.killed),
    isLive: inferLiveState(summary, presenceIds, cid, transcriptMtimeMs, now),
    hasPresence: presenceIds.has(cid),
    transcriptMtimeMs,
    lastActivityMs,
    rawEvents,
    events: rawEvents,
    dedupedForkSteps: 0,
    childrenIds: [],
  };
}

function resolveRootsAndChildren(conversations) {
  for (const node of conversations.values()) {
    node.childrenIds = [];
    node.orphanParentId = '';
  }

  for (const node of conversations.values()) {
    if (!node.parentId) continue;
    const parent = conversations.get(node.parentId);
    if (parent) {
      parent.childrenIds.push(node.conversationId);
    } else {
      node.orphanParentId = node.parentId;
    }
  }

  for (const node of conversations.values()) {
    const visited = new Set([node.conversationId]);
    let cur = node;
    let depth = 0;
    while (cur.parentId && depth < MAX_TREE_DEPTH) {
      const parent = conversations.get(cur.parentId);
      if (!parent || visited.has(parent.conversationId)) break;
      visited.add(parent.conversationId);
      cur = parent;
      depth += 1;
    }
    node.rootId = cur.conversationId;
    node.depth = depth;
  }
}

function deduplicateForkedPrefixes(conversations) {
  let totalDedupedSteps = 0;

  for (const node of conversations.values()) {
    if (!node.parentId || node.rawEvents.length === 0) continue;

    // Collect signatures from all ancestors in the same session tree.
    const ancestorSigs = new Set();
    const visited = new Set([node.conversationId]);
    let curId = node.parentId;
    let hops = 0;
    while (curId && hops < MAX_TREE_DEPTH) {
      if (visited.has(curId)) break;
      visited.add(curId);
      const anc = conversations.get(curId);
      if (!anc) break;
      for (const ev of anc.rawEvents) ancestorSigs.add(stepSignature(ev));
      curId = anc.parentId;
      hops += 1;
    }

    if (ancestorSigs.size === 0) continue;

    let prefixLen = 0;
    while (prefixLen < node.rawEvents.length && ancestorSigs.has(stepSignature(node.rawEvents[prefixLen]))) {
      prefixLen += 1;
    }
    if (prefixLen > 0) {
      node.events = node.rawEvents.slice(prefixLen);
      node.dedupedForkSteps = prefixLen;
      totalDedupedSteps += prefixLen;
    }
  }

  return totalDedupedSteps;
}

export function collectSubtreeIds(startId, conversations) {
  if (!conversations.has(startId)) return [];
  const ordered = [];
  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const curId = queue.shift();
    ordered.push(curId);
    const node = conversations.get(curId);
    if (!node) continue;
    for (const childId of node.childrenIds) {
      if (!visited.has(childId) && conversations.has(childId)) {
        visited.add(childId);
        queue.push(childId);
      }
    }
  }
  return ordered;
}

export function buildConversationGraph(sources, transcriptCache, metadataCache, now = Date.now()) {
  const conversations = new Map();
  const activeTranscriptPaths = new Set();
  const sourceStats = [];
  let dedupedConversations = 0;

  for (const source of sources) {
    const convIds = listBrainConversationIds(source.path);
    const summaries = metadataCache.readSummaries(source.path);
    const { swarmMembers, swarmCoordinators } = metadataCache.readSwarmInfo(source.path, convIds);
    const presenceIds = readPresenceIds(source.path);
    let sourceTranscriptCount = 0;

    for (const cid of convIds) {
      const txPath = join(source.path, 'brain', cid, ...TRANSCRIPT_REL_PATH);
      if (!existsSync(txPath)) continue;
      activeTranscriptPaths.add(txPath);
      const transcript = transcriptCache.readTranscript(txPath);
      if (!transcript) continue;
      sourceTranscriptCount += 1;

      const node = buildConversationNode(
        cid,
        source,
        transcript,
        summaries.get(cid) || null,
        swarmMembers.get(cid) || null,
        swarmCoordinators.has(cid),
        presenceIds,
        now
      );

      const existing = conversations.get(cid);
      if (!existing) {
        conversations.set(cid, node);
      } else {
        dedupedConversations += 1;
        if (shouldReplaceCandidate(existing, node)) {
          conversations.set(cid, node);
        }
      }
    }

    sourceStats.push({
      id: source.id,
      label: source.label,
      surface: source.surface,
      profile: source.profile,
      path: source.path,
      isCurrent: source.isCurrent,
      transcriptCount: sourceTranscriptCount,
    });
  }

  transcriptCache.prune(activeTranscriptPaths);
  resolveRootsAndChildren(conversations);
  const dedupedForkSteps = deduplicateForkedPrefixes(conversations);
  for (const node of conversations.values()) {
    node.annotatedEvents = annotateConversationTurns(node.events, node.title);
  }

  return {
    conversations,
    sources: sourceStats,
    diagnostics: {
      totalSources: sourceStats.length,
      nonEmptySources: sourceStats.filter((s) => s.transcriptCount > 0).length,
      totalConversations: conversations.size,
      dedupedConversations,
      dedupedForkSteps,
    },
  };
}
