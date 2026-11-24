import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CacheRadarEngine } from '../src/index.mjs';
import { startStandaloneServer } from '../sidecars/cache_radar/main.mjs';

test('standalone sidecar HTTP server serves widget assets, stats, sources, and ETag unchanged responses', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cache-radar-srv-'));
  const appDir = join(root, '.gemini', 'antigravity');
  const cid = '12345678-1234-1234-1234-123456789abc';
  const txDir = join(appDir, 'brain', cid, '.system_generated', 'logs');
  mkdirSync(txDir, { recursive: true });
  writeFileSync(
    join(txDir, 'transcript.jsonl'),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      created_at: new Date().toISOString(),
      model: 'gemini-2.5-pro',
      input_tokens: 250,
      cache_read_tokens: 750,
      output_tokens: 50,
    }) + '\n'
  );

  const engine = new CacheRadarEngine({
    discoveryOptions: { homes: [root], env: { HOME: root }, currentDir: appDir },
  });
  const { server, host, port } = await startStandaloneServer(engine, { port: 0 });
  const base = `http://${host}:${port}`;

  try {
    for (const path of [
      '/',
      '/styles.css',
      '/format.js',
      '/charts.js',
      '/timeline.js',
      '/timeline_drag.js',
      '/diag_views.js',
      '/views.js',
      '/app.js',
      '/preload.js',
    ]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, `Expected 200 for ${path}`);
    }

    const srcRes = await fetch(`${base}/api/sources`);
    assert.equal(srcRes.status, 200);
    const srcJson = await srcRes.json();
    assert.equal(srcJson.sources.length, 1);

    const statsRes = await fetch(`${base}/api/stats`);
    assert.equal(statsRes.status, 200);
    const stats = await statsRes.json();
    assert.equal(stats.activeSession.found, true);
    assert.equal(stats.activeSession.self.cacheHitRate, 0.75);
    assert.equal(stats.activeSession.timeline.ticksSelf.length, 1);
    assert.ok(stats.etag);

    // Time-filtered query produces distinct ETag and respects sessionFrom/sessionTo.
    const futureFrom = Date.now() + 3600_000;
    const rangedRes = await fetch(`${base}/api/stats?sessionFrom=${futureFrom}`);
    assert.equal(rangedRes.status, 200);
    const ranged = await rangedRes.json();
    assert.equal(ranged.activeSession.timeRange.isFiltered, true);
    assert.equal(ranged.activeSession.self.turns, 0);
    assert.equal(ranged.activeSession.timeline.ticksSelf.length, 1);
    assert.notEqual(ranged.etag, stats.etag);

    // ETag unchanged shortcut.
    const unchangedRes = await fetch(`${base}/api/stats?etag=${encodeURIComponent(stats.etag)}`);
    const unchanged = await unchangedRes.json();
    assert.equal(unchanged.unchanged, true);
    assert.equal(unchanged.etag, stats.etag);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
