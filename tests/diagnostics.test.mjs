import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTurnToDiagnostics,
  annotateConversationTurns,
  createDiagnosticsCollector,
  finalizeDiagnostics,
} from '../src/diagnostics.mjs';

test('classifies all cache-miss causes accurately and accounts for 100% of uncached tokens', () => {
  const baseTs = Date.parse('2026-11-23T12:00:00Z');
  const rawEvents = [
    // Turn 1: cold start (10,000 uncached)
    {
      stepIndex: 1,
      ts: baseTs,
      model: 'gemini-2.5-pro',
      inputTokens: 10_000,
      cacheReadTokens: 0,
      outputTokens: 200,
      hadErrorBefore: false,
      hadSettingsChangeBefore: false,
    },
    // Turn 2 (+20s): normal hit (10,000 cached + 2,000 incremental) -> total 12,000
    {
      stepIndex: 2,
      ts: baseTs + 20_000,
      model: 'gemini-2.5-pro',
      inputTokens: 2_000,
      cacheReadTokens: 10_000,
      outputTokens: 150,
      hadErrorBefore: false,
      hadSettingsChangeBefore: false,
    },
    // Turn 3 (+30s, same model, no error, 0 cached): hot_prefix_bust (12,000 lost + 1,000 incremental = 13,000)
    {
      stepIndex: 3,
      ts: baseTs + 50_000,
      model: 'gemini-2.5-pro',
      inputTokens: 13_000,
      cacheReadTokens: 0,
      outputTokens: 100,
      hadErrorBefore: false,
      hadSettingsChangeBefore: false,
    },
    // Turn 4 (+120s = 2m, 0 cached): idle_warm_decay (13,000 lost + 500 incremental = 13,500)
    {
      stepIndex: 4,
      ts: baseTs + 170_000,
      model: 'gemini-2.5-pro',
      inputTokens: 13_500,
      cacheReadTokens: 0,
      outputTokens: 100,
      hadErrorBefore: false,
      hadSettingsChangeBefore: false,
    },
    // Turn 5 (+600s = 10m, 0 cached): idle_ttl_expired (13,500 lost + 500 incremental = 14,000)
    {
      stepIndex: 5,
      ts: baseTs + 770_000,
      model: 'gemini-2.5-pro',
      inputTokens: 14_000,
      cacheReadTokens: 0,
      outputTokens: 100,
      hadErrorBefore: false,
      hadSettingsChangeBefore: false,
    },
    // Turn 6 (+25s, model switched to gemini-2.5-flash, 0 cached): model_switch (14,000 lost + 1,000 incremental = 15,000)
    {
      stepIndex: 6,
      ts: baseTs + 795_000,
      model: 'gemini-2.5-flash',
      inputTokens: 15_000,
      cacheReadTokens: 0,
      outputTokens: 100,
      hadErrorBefore: false,
      hadSettingsChangeBefore: true,
    },
    // Turn 7 (+15s, stream error before, 0 cached): stream_interrupt (15,000 lost + 500 incremental = 15,500)
    {
      stepIndex: 7,
      ts: baseTs + 810_000,
      model: 'gemini-2.5-flash',
      inputTokens: 15_500,
      cacheReadTokens: 0,
      outputTokens: 100,
      hadErrorBefore: true,
      hadSettingsChangeBefore: false,
    },
    // Turn 8 (+20s, partial truncation: only 8,000 of 15,500 cached, 9,000 input -> 7,500 partial_truncation + 1,500 incremental)
    {
      stepIndex: 8,
      ts: baseTs + 830_000,
      model: 'gemini-2.5-flash',
      inputTokens: 9_000,
      cacheReadTokens: 8_000,
      outputTokens: 100,
      hadErrorBefore: false,
      hadSettingsChangeBefore: false,
    },
  ];

  const annotated = annotateConversationTurns(rawEvents, 'main');
  assert.equal(annotated[0].primaryReason, 'cold_start');
  assert.equal(annotated[1].primaryReason, 'incremental_append');
  assert.equal(annotated[2].primaryReason, 'hot_prefix_bust');
  assert.equal(annotated[3].primaryReason, 'idle_warm_decay');
  assert.equal(annotated[4].primaryReason, 'idle_ttl_expired');
  assert.equal(annotated[5].primaryReason, 'model_switch');
  assert.equal(annotated[6].primaryReason, 'stream_interrupt');
  assert.equal(annotated[7].primaryReason, 'partial_truncation');

  const collector = createDiagnosticsCollector();
  for (const t of annotated) addTurnToDiagnostics(collector, t, 'conv-1');
  const diag = finalizeDiagnostics(collector);

  const expectedUncached = rawEvents.reduce((s, e) => s + e.inputTokens, 0);
  const attributedSum = diag.attribution.reduce((s, a) => s + a.tokens, 0);
  assert.equal(attributedSum, expectedUncached, '100% of uncached tokens must be accounted for');

  const byKey = Object.fromEntries(diag.attribution.map((a) => [a.key, a.tokens]));
  assert.equal(byKey.cold_start, 10_000);
  assert.equal(byKey.hot_prefix_bust, 12_000);
  assert.equal(byKey.idle_warm_decay, 13_000);
  assert.equal(byKey.idle_ttl_expired, 13_500);
  assert.equal(byKey.model_switch, 14_000);
  assert.equal(byKey.stream_interrupt, 15_000);
  assert.equal(byKey.partial_truncation, 7_500);
  assert.equal(byKey.incremental_append, 2_000 + 1_000 + 500 + 500 + 1_000 + 500 + 1_500);

  assert.equal(diag.warmTurns, 7);
  assert.equal(diag.warmHitTurns, 2);
  assert.equal(diag.warmMissTurns, 5);
  assert.equal(diag.missEvents.length, 6);

  // Total-prompt partition check: hitRate + anomalyShareOfPrompt + structuralShareOfPrompt === 1
  const totalPrompt = rawEvents.reduce((s, e) => s + e.inputTokens + e.cacheReadTokens, 0);
  const totalCached = rawEvents.reduce((s, e) => s + e.cacheReadTokens, 0);
  const hitRate = totalCached / totalPrompt;
  assert.ok(Math.abs(hitRate + diag.anomalyShareOfPrompt + diag.structuralShareOfPrompt - 1) < 1e-12);
});
