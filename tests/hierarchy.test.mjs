import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MetadataCache } from '../src/metadata.mjs';
import { TranscriptCache } from '../src/transcript.mjs';
import { buildConversationGraph, collectSubtreeIds } from '../src/hierarchy.mjs';

function writeTranscript(appDataDir, cid, rows, trailingNewline = true) {
  const logDir = join(appDataDir, 'brain', cid, '.system_generated', 'logs');
  mkdirSync(logDir, { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join('\n') + (trailingNewline ? '\n' : '');
  const filePath = join(logDir, 'transcript.jsonl');
  writeFileSync(filePath, body, 'utf-8');
  return filePath;
}

function writeSummariesDb(appDataDir, rows) {
  const dbPath = join(appDataDir, 'conversation_summaries.db');
  const db = new DatabaseSync(dbPath);
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
    CREATE TABLE conversation_parents (
      conversation_id text PRIMARY KEY,
      parent_id text NOT NULL
    );
  `);
  const stmt = db.prepare(`
    INSERT INTO conversation_summaries (
      conversation_id, title, parent_conversation_id, nesting_depth, agent_name, status, not_fully_idle
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of rows) {
    stmt.run(r.id, r.title || '', r.parentId || '', r.depth || 0, r.agentName || '', r.status || '', r.active ? 1 : 0);
  }
  db.close();
}

test('resolves multi-level subagent/swarm trees, deduplicates cross-dir copies and fork prefixes, and guards cycles/orphans', () => {
  const root = mkdtempSync(join(tmpdir(), 'cache-radar-hier-'));
  try {
    const dirA = join(root, 'source-a');
    const dirB = join(root, 'source-b');
    mkdirSync(join(dirA, 'brain'), { recursive: true });
    mkdirSync(join(dirB, 'brain'), { recursive: true });

    const rootId = '11111111-1111-1111-1111-111111111111';
    const workerId = '22222222-2222-2222-2222-222222222222';
    const helperId = '33333333-3333-3333-3333-333333333333';
    const orphanId = '44444444-4444-4444-4444-444444444444';
    const cycA = '55555555-5555-5555-5555-555555555555';
    const cycB = '66666666-6666-6666-6666-666666666666';

    const sharedStep1 = {
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      created_at: '2026-11-23T10:00:00Z',
      model: 'gemini-2.5-pro',
      input_tokens: 10000,
      cache_read_tokens: 0,
      output_tokens: 200,
    };
    const sharedStep2 = {
      step_index: 3,
      type: 'PLANNER_RESPONSE',
      created_at: '2026-11-23T10:01:00Z',
      model: 'gemini-2.5-pro',
      input_tokens: 2000,
      cache_read_tokens: 10000,
      output_tokens: 300,
    };

    writeTranscript(dirA, rootId, [sharedStep1, sharedStep2]);
    // Forked worker contains inherited prefix [sharedStep1, sharedStep2] + 1 new post-fork step.
    writeTranscript(dirA, workerId, [
      sharedStep1,
      sharedStep2,
      {
        step_index: 5,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T10:02:00Z',
        model: 'gemini-2.5-pro',
        input_tokens: 1000,
        cache_read_tokens: 12000,
        output_tokens: 150,
      },
    ]);
    // Helper spawned by worker (depth 2).
    writeTranscript(dirA, helperId, [
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T10:03:00Z',
        model: 'gemini-2.5-flash',
        input_tokens: 500,
        cache_read_tokens: 4500,
        output_tokens: 100,
      },
    ]);
    // Orphan child whose parent does not exist on disk.
    writeTranscript(dirA, orphanId, [
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-23T10:04:00Z',
        model: 'gemini-2.5-flash-lite',
        input_tokens: 300,
        cache_read_tokens: 700,
        output_tokens: 50,
      },
    ]);
    // Cycle pair.
    writeTranscript(dirA, cycA, [sharedStep1]);
    writeTranscript(dirA, cycB, [sharedStep2]);

    // Duplicate rootId in dirB with fewer steps (must be deduped in favor of dirA).
    writeTranscript(dirB, rootId, [sharedStep1]);

    writeSummariesDb(dirA, [
      { id: rootId, title: 'Main Swarm Task', depth: 0, status: 'CASCADE_RUN_STATUS_RUNNING', active: true },
      { id: workerId, parentId: rootId, depth: 1, agentName: 'backend-a' },
      { id: helperId, parentId: workerId, depth: 2, agentName: 'helper-1' },
      { id: orphanId, parentId: '99999999-9999-9999-9999-999999999999', depth: 1, agentName: 'orphan-sub' },
      { id: cycA, parentId: cycB, depth: 1 },
      { id: cycB, parentId: cycA, depth: 1 },
    ]);

    const swarmDir = join(dirA, 'brain', rootId, '.system_generated', 'swarm');
    mkdirSync(swarmDir, { recursive: true });
    writeFileSync(
      join(swarmDir, 'members.json'),
      JSON.stringify({
        title: 'Swarm Board',
        members: {
          coordinator: { conversation_id: rootId, role: 'coordinator' },
          'backend-a': { conversation_id: workerId, role: 'worker' },
        },
      }),
      'utf-8'
    );

    const sources = [
      { id: 'app:a', label: 'App · a', surface: 'app', profile: 'a', path: dirA, isCurrent: true },
      { id: 'app:b', label: 'App · b', surface: 'app', profile: 'b', path: dirB, isCurrent: false },
    ];
    const graph = buildConversationGraph(sources, new TranscriptCache(), new MetadataCache(), Date.parse('2026-11-23T10:05:00Z'));

    assert.equal(graph.diagnostics.dedupedConversations, 1);
    assert.equal(graph.diagnostics.dedupedForkSteps, 2);

    const rootNode = graph.conversations.get(rootId);
    const workerNode = graph.conversations.get(workerId);
    const helperNode = graph.conversations.get(helperId);
    const orphanNode = graph.conversations.get(orphanId);

    assert.equal(rootNode.events.length, 2);
    assert.equal(workerNode.kind, 'swarm_worker');
    assert.equal(workerNode.events.length, 1); // 2 inherited fork steps stripped!
    assert.equal(workerNode.dedupedForkSteps, 2);
    assert.equal(helperNode.kind, 'subagent');
    assert.equal(helperNode.rootId, rootId);
    assert.equal(helperNode.depth, 2);
    assert.equal(orphanNode.rootId, orphanId);
    assert.equal(orphanNode.orphanParentId, '99999999-9999-9999-9999-999999999999');

    const subtree = collectSubtreeIds(rootId, graph.conversations);
    assert.deepEqual(subtree, [rootId, workerId, helperId]);

    // Cycle traversal terminates cleanly without duplicates.
    const cycTree = collectSubtreeIds(cycA, graph.conversations);
    assert.equal(cycTree.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('incremental transcript tailing reads appended lines and handles trailing line without newline', () => {
  const root = mkdtempSync(join(tmpdir(), 'cache-radar-tail-'));
  try {
    const cid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const txPath = writeTranscript(
      root,
      cid,
      [
        {
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          created_at: '2026-11-23T10:00:00Z',
          model: 'gemini-2.5-pro',
          input_tokens: 1000,
          cache_read_tokens: 0,
          output_tokens: 100,
        },
      ],
      false
    );

    const cache = new TranscriptCache();
    const first = cache.readTranscript(txPath);
    assert.equal(first.allEvents.length, 1);

    // Complete line 1 with newline + append line 2.
    appendFileSync(
      txPath,
      '\n' +
        JSON.stringify({
          step_index: 2,
          type: 'PLANNER_RESPONSE',
          created_at: '2026-11-23T10:01:00Z',
          model: 'gemini-2.5-pro',
          input_tokens: 200,
          cache_read_tokens: 1000,
          output_tokens: 50,
        }) +
        '\n',
      'utf-8'
    );

    const second = cache.readTranscript(txPath);
    assert.equal(second.allEvents.length, 2);
    assert.equal(second.allEvents[1].cacheReadTokens, 1000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
