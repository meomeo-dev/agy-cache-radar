import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MetadataCache } from '../src/metadata.mjs';
import { TranscriptCache } from '../src/transcript.mjs';
import { buildConversationGraph } from '../src/hierarchy.mjs';
import { buildFullSnapshot } from '../src/aggregator.mjs';

function writeTx(dir, cid, rows) {
  const p = join(dir, 'brain', cid, '.system_generated', 'logs');
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'transcript.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function writeDb(dir, rows) {
  const db = new DatabaseSync(join(dir, 'conversation_summaries.db'));
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id text PRIMARY KEY,
      title text NOT NULL DEFAULT "",
      parent_conversation_id text NOT NULL DEFAULT "",
      nesting_depth integer NOT NULL DEFAULT 0,
      agent_name text NOT NULL DEFAULT "",
      status text NOT NULL DEFAULT "",
      not_fully_idle numeric NOT NULL DEFAULT 0,
      killed numeric NOT NULL DEFAULT 0,
      last_modified_time datetime NOT NULL DEFAULT "",
      last_user_input_time datetime NOT NULL DEFAULT "",
      workspace_uris text NOT NULL DEFAULT ""
    );
  `);
  const ins = db.prepare(
    'INSERT INTO conversation_summaries (conversation_id, title, parent_conversation_id, nesting_depth, agent_name, status, not_fully_idle) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const r of rows) {
    ins.run(r.id, r.title || '', r.parentId || '', r.depth || 0, r.agentName || '', r.status || '', r.active ? 1 : 0);
  }
  db.close();
}

test('aggregates active session tree vs self and enforces exact event-window and role-partition invariants', () => {
  const root = mkdtempSync(join(tmpdir(), 'cache-radar-agg-'));
  try {
    const appDir = join(root, 'profile-a');
    const cliDir = join(root, 'cli-default');
    const nowMs = Date.parse('2026-11-23T12:00:00Z');

    const mainId = '11111111-1111-1111-1111-111111111111';
    const subId = '22222222-2222-2222-2222-222222222222';
    const cliId = '33333333-3333-3333-3333-333333333333';

    // Main session: 1 turn 5 days ago (in 30d only), 1 turn 1 hour ago (in 24h & 30d).
    writeTx(appDir, mainId, [
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-18T12:00:00Z', // 5 days ago
        model: 'gemini-2.5-pro',
        input_tokens: 1000,
        cache_read_tokens: 0,
        output_tokens: 100,
      },
      {
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T11:00:00Z', // 1 hour ago
        model: 'gemini-2.5-pro',
        input_tokens: 200,
        cache_read_tokens: 800,
        output_tokens: 50,
      },
    ]);

    // Subagent under mainId: 1 turn 30 min ago (in 24h & 30d).
    writeTx(appDir, subId, [
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T11:30:00Z',
        model: 'gemini-2.5-flash',
        input_tokens: 100,
        cache_read_tokens: 900,
        output_tokens: 40,
      },
    ]);

    // CLI session: 1 turn 45 days ago (outside 30d) + 1 turn 10 days ago (in 30d only).
    writeTx(cliDir, cliId, [
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-10-09T10:00:00Z', // 45 days ago -> excluded!
        model: 'gemini-2.5-flash-lite',
        input_tokens: 5000,
        cache_read_tokens: 5000,
        output_tokens: 100,
      },
      {
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-13T12:00:00Z', // 10 days ago -> 30d only
        model: 'gemini-2.5-flash-lite',
        input_tokens: 400,
        cache_read_tokens: 600,
        output_tokens: 60,
      },
    ]);

    writeDb(appDir, [
      { id: mainId, title: 'Active Feature', depth: 0, status: 'CASCADE_RUN_STATUS_RUNNING', active: true },
      { id: subId, parentId: mainId, depth: 1, agentName: 'researcher' },
    ]);
    writeDb(cliDir, [{ id: cliId, title: 'CLI Refactor', depth: 0 }]);

    const sources = [
      { id: 'app:profile-a', label: 'App · profile-a', surface: 'app', profile: 'profile-a', path: appDir, isCurrent: true },
      { id: 'cli:default', label: 'CLI · default', surface: 'cli', profile: 'default', path: cliDir, isCurrent: false },
    ];
    const graph = buildConversationGraph(sources, new TranscriptCache(), new MetadataCache(), nowMs);
    const snap = buildFullSnapshot(graph, { nowMs, conversationId: mainId, sourceFilter: 'all', tzOffsetMinutes: 0 });

    // 1. Active session tree invariant: tree = self + subagents, zero double-count.
    assert.equal(snap.activeSession.self.cacheReadTokens, 800);
    assert.equal(snap.activeSession.self.uncachedInputTokens, 1200);
    assert.equal(snap.activeSession.self.totalPromptTokens, 2000);
    assert.equal(snap.activeSession.self.cacheHitRate, 800 / 2000);

    assert.equal(snap.activeSession.subagents.cacheReadTokens, 900);
    assert.equal(snap.activeSession.subagents.totalPromptTokens, 1000);
    assert.equal(snap.activeSession.subagents.cacheHitRate, 0.9);

    assert.equal(
      snap.activeSession.tree.totalPromptTokens,
      snap.activeSession.self.totalPromptTokens + snap.activeSession.subagents.totalPromptTokens
    );
    assert.equal(snap.activeSession.tree.cacheReadTokens, 1700);
    assert.equal(snap.activeSession.tree.cacheHitRate, 1700 / 3000);

    // 2. Last 24h event-level exactness: only the 1h-ago main turn (1000) + 30m-ago sub turn (1000).
    assert.equal(snap.last24h.all.totalPromptTokens, 2000);
    assert.equal(snap.last24h.all.cacheReadTokens, 1700);
    assert.equal(snap.last24h.all.cacheHitRate, 1700 / 2000);
    assert.equal(
      snap.last24h.all.totalPromptTokens,
      snap.last24h.mainOnly.totalPromptTokens + snap.last24h.subagentsOnly.totalPromptTokens
    );

    // 3. Last 30d event-level exactness: 2000 (main) + 1000 (sub) + 1000 (cli 10d ago); excludes 45d-ago turn!
    assert.equal(snap.last30d.all.totalPromptTokens, 4000);
    assert.equal(snap.last30d.all.cacheReadTokens, 2300);
    assert.equal(snap.last30d.all.cacheHitRate, 2300 / 4000);
    assert.equal(
      snap.last30d.all.totalPromptTokens,
      snap.last30d.mainOnly.totalPromptTokens + snap.last30d.subagentsOnly.totalPromptTokens
    );
    assert.equal(snap.last30d.all.sources.length, 2);

    // 4. Scoped to current source only: excludes CLI turns.
    const currentOnly = buildFullSnapshot(graph, { nowMs, conversationId: mainId, sourceFilter: 'current', tzOffsetMinutes: 0 });
    assert.equal(currentOnly.last30d.all.totalPromptTokens, 3000);
    assert.equal(currentOnly.last30d.all.sources.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('filters multi-day active session by sessionFrom/sessionTo while preserving full timeline and pre-window transition history', () => {
  const root = mkdtempSync(join(tmpdir(), 'cache-radar-range-'));
  try {
    const appDir = join(root, 'profile-a');
    const nowMs = Date.parse('2026-11-23T12:00:00Z');
    const mainId = 'aaaaaaaa-1111-1111-1111-111111111111';
    const subDay1 = 'bbbbbbbb-1111-1111-1111-111111111111';
    const subDay2 = 'cccccccc-1111-1111-1111-111111111111';

    // Day 1 turn 1 + Day 2 turn 2 (warm turn after 24h idle gap -> 0% cache = idle_ttl_expired) + Day 2 turn 3 (warm hit).
    writeTx(appDir, mainId, [
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-21T10:00:00Z',
        model: 'gemini-2.5-pro',
        input_tokens: 10000,
        cache_read_tokens: 0,
        output_tokens: 200,
      },
      {
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T10:00:00Z',
        model: 'gemini-2.5-pro',
        input_tokens: 12000,
        cache_read_tokens: 0,
        output_tokens: 200,
      },
      {
        step_index: 3,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T10:01:00Z',
        model: 'gemini-2.5-pro',
        input_tokens: 1000,
        cache_read_tokens: 12000,
        output_tokens: 100,
      },
    ]);

    writeTx(appDir, subDay1, [
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-21T10:05:00Z',
        model: 'gemini-2.5-flash',
        input_tokens: 5000,
        cache_read_tokens: 0,
        output_tokens: 100,
      },
    ]);

    writeTx(appDir, subDay2, [
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T10:02:00Z',
        model: 'gemini-2.5-flash',
        input_tokens: 1000,
        cache_read_tokens: 9000,
        output_tokens: 100,
      },
    ]);

    writeDb(appDir, [
      { id: mainId, title: 'Multi-day Task', depth: 0, status: 'CASCADE_RUN_STATUS_RUNNING', active: true },
      { id: subDay1, parentId: mainId, depth: 1, agentName: 'day1-sub' },
      { id: subDay2, parentId: mainId, depth: 1, agentName: 'day2-sub' },
    ]);

    const sources = [
      { id: 'app:profile-a', label: 'App · profile-a', surface: 'app', profile: 'profile-a', path: appDir, isCurrent: true },
    ];
    const graph = buildConversationGraph(sources, new TranscriptCache(), new MetadataCache(), nowMs);

    const day2From = Date.parse('2026-11-23T00:00:00Z');
    const day2To = Date.parse('2026-11-23T23:59:59Z');
    const filtered = buildFullSnapshot(graph, {
      nowMs,
      conversationId: mainId,
      sourceFilter: 'all',
      sessionFrom: day2From,
      sessionTo: day2To,
      tzOffsetMinutes: 0,
    });

    const s = filtered.activeSession;
    assert.equal(s.timeRange.isFiltered, true);
    assert.equal(s.timeRange.from, day2From);
    assert.equal(s.timeRange.to, day2To);

    // Full timeline keeps ALL Day 1 + Day 2 ticks so scrubber stays anchored to full session history.
    assert.equal(s.timeline.ticksSelf.length, 3);
    assert.equal(s.timeline.ticksTree.length, 5);

    // Filtered metrics include ONLY Day 2 turns and Day 2 subagents.
    assert.equal(s.descendantCount, 2);
    assert.equal(s.activeDescendantCount, 1);
    assert.equal(s.descendants.length, 1);
    assert.equal(s.descendants[0].conversationId, subDay2);

    assert.equal(s.self.turns, 2);
    assert.equal(s.self.cacheReadTokens, 12000);
    assert.equal(s.self.uncachedInputTokens, 13000);
    assert.equal(s.tree.turns, 3);
    assert.equal(s.tree.cacheReadTokens, 21000);
    assert.equal(s.tree.totalPromptTokens, 35000);

    // Day 2 turn 2 must retain its true idle_ttl_expired attribution (NOT misclassified as cold_start!).
    assert.equal(s.self.diagnostics.warmMissTurns, 1);
    assert.equal(s.self.diagnostics.missEvents[0].reason, 'idle_ttl_expired');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
