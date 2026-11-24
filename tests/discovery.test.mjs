import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { discoverDataDirs } from '../src/discovery.mjs';

function makeStore(dirPath) {
  mkdirSync(join(dirPath, 'brain'), { recursive: true });
}

test('discovers multi-client, multi-CLI, and .agy-profiles roots while excluding backups and symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'cache-radar-disc-'));
  try {
    const appDefault = join(root, '.gemini', 'antigravity');
    const appBackup = join(root, '.gemini', 'antigravity-backup');
    const cliDefault = join(root, '.gemini', 'antigravity-cli');
    const cliAlt = join(root, '.gemini', 'antigravity-cli-alt');
    const ideDefault = join(root, '.gemini', 'antigravity-ide');
    const profA = join(root, '.agy-profiles', 'profile-a', '.gemini', 'antigravity');
    const profB = join(root, '.agy-profiles', 'profile-b', '.gemini', 'antigravity');
    const customExtra = join(root, 'custom-agy-data');

    for (const d of [appDefault, appBackup, cliDefault, cliAlt, ideDefault, profA, profB, customExtra]) {
      makeStore(d);
    }

    // Create a symlink alias pointing to cliAlt to verify realpath deduplication.
    symlinkSync(cliAlt, join(root, '.gemini', 'antigravity-cli-alias'));

    const sidecarDataDir = join(profA, 'sidecar_data', 'cache-radar', 'cache_radar', 'data');
    mkdirSync(sidecarDataDir, { recursive: true });

    // Simulate desktop launcher overriding HOME to ~/.agy-profiles/profile-a.
    const env = {
      HOME: join(root, '.agy-profiles', 'profile-a'),
      ANTIGRAVITY_EXECUTABLE_DATA_DIR: sidecarDataDir,
      AGY_CACHE_DATA_DIRS: customExtra,
    };

    const sources = discoverDataDirs({ env, homes: [env.HOME] });
    const ids = sources.map((s) => s.id);

    assert.equal(sources[0].id, 'app:profile-a');
    assert.equal(sources[0].isCurrent, true);
    assert.ok(ids.includes('app:profile-b'));
    assert.ok(ids.includes('app:default'));
    assert.ok(ids.includes('cli:default'));
    assert.ok(ids.includes('cli:alt'));
    assert.ok(ids.includes('ide:default'));
    assert.ok(ids.includes('custom:custom-agy-data'));

    // Backup excluded by default; symlink not duplicated.
    assert.equal(sources.some((s) => s.path.includes('antigravity-backup')), false);
    assert.equal(sources.filter((s) => s.path.endsWith('antigravity-cli-alt')).length, 1);

    // Explicit includeBackups=true surfaces backup dir.
    const withBackups = discoverDataDirs({ env, homes: [env.HOME], includeBackups: true });
    assert.equal(withBackups.some((s) => s.path.includes('antigravity-backup')), true);

    // Exclude pattern filters matching profiles.
    const filtered = discoverDataDirs({
      env: { HOME: root, AGY_CACHE_DATA_DIRS: [customExtra].join(delimiter) },
      homes: [root],
      config: { excludePatterns: ['profile-b'] },
    });
    assert.equal(filtered.some((s) => s.id === 'app:profile-b'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
