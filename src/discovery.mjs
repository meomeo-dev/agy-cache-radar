import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { ANTIGRAVITY_DIR_RE, BACKUP_DIR_RE, CONFIG_FILENAME } from './constants.mjs';

function safeRealpath(target) {
  try {
    return realpathSync(target);
  } catch {
    return resolve(target);
  }
}

function isDir(target) {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function expandHome(rawPath, homeDir) {
  if (typeof rawPath !== 'string') return '';
  const trimmed = rawPath.trim();
  if (!trimmed) return '';
  if (trimmed === '~') return homeDir;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homeDir, trimmed.slice(2));
  }
  return trimmed;
}

export function resolveCurrentAppDataDir(env = process.env) {
  const anchors = [
    [env.ANTIGRAVITY_EXECUTABLE_DATA_DIR, 'sidecar_data'],
    [env.PLUGIN_DATA, 'plugin_data'],
  ];
  for (const [startDir, marker] of anchors) {
    if (!startDir) continue;
    for (let cur = resolve(startDir); cur !== dirname(cur); cur = dirname(cur)) {
      if (basename(cur) === marker) {
        const appData = dirname(cur);
        if (isDir(appData)) return safeRealpath(appData);
      }
    }
  }
  return null;
}

export function resolveCandidateHomes(env = process.env, explicitHomes = null) {
  const raw = [];
  if (Array.isArray(explicitHomes) && explicitHomes.length > 0) {
    raw.push(...explicitHomes);
  } else {
    if (env.HOME) raw.push(env.HOME);
    try {
      const osHome = userInfo().homedir;
      if (osHome) raw.push(osHome);
    } catch {
      // Fallback to homedir() when userInfo() is unavailable.
    }
    try {
      const fallback = homedir();
      if (fallback) raw.push(fallback);
    } catch {
      // Ignore if homedir() cannot be resolved.
    }
  }

  // If HOME points inside <realHome>/.agy-profiles/<profile>, include <realHome>.
  for (const entry of [...raw]) {
    if (!entry) continue;
    const parent = dirname(resolve(entry));
    if (basename(parent) === '.agy-profiles') {
      raw.push(dirname(parent));
    }
  }

  const seen = new Set();
  const homes = [];
  for (const entry of raw) {
    if (!entry || !isDir(entry)) continue;
    const canon = safeRealpath(entry);
    if (seen.has(canon)) continue;
    seen.add(canon);
    homes.push(canon);
  }
  return homes;
}

export function loadUserConfig(homes, env = process.env) {
  const candidates = [];
  if (env.AGY_CACHE_CONFIG) candidates.push(env.AGY_CACHE_CONFIG);
  for (const h of homes) {
    candidates.push(join(h, '.gemini', 'config', CONFIG_FILENAME));
  }
  for (const file of candidates) {
    if (!file || !existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf-8'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Ignore malformed optional user config.
    }
  }
  return {};
}

function isExcludedName(name, includeBackups, excludeRegexes) {
  if (!includeBackups && BACKUP_DIR_RE.test(name)) return true;
  return excludeRegexes.some((re) => re.test(name));
}

function scanGeminiDir(geminiDir, profileName, includeBackups, excludeRegexes, out) {
  if (!isDir(geminiDir)) return;
  let entries;
  try {
    entries = readdirSync(geminiDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!ANTIGRAVITY_DIR_RE.test(entry.name)) continue;
    if (isExcludedName(entry.name, includeBackups, excludeRegexes)) continue;
    const full = join(geminiDir, entry.name);
    if (isDir(full)) out.push({ path: full, profileHint: profileName, explicit: false });
  }
}

export function classifyDataDir(dirPath, profileHint = '') {
  const name = basename(dirPath);
  const parent = dirname(dirPath);
  const grandParent = dirname(parent);
  const profileDir =
    profileHint ||
    (basename(parent) === '.gemini' && basename(dirname(grandParent)) === '.agy-profiles'
      ? basename(grandParent)
      : '');

  let surface = 'custom';
  let suffix = '';
  if (name === 'antigravity') {
    surface = 'app';
  } else if (name === 'antigravity-ide' || name.startsWith('antigravity-ide-')) {
    surface = 'ide';
    suffix = name.slice('antigravity-ide'.length).replace(/^[-_.]/, '');
  } else if (name === 'antigravity-cli' || name.startsWith('antigravity-cli-')) {
    surface = 'cli';
    suffix = name.slice('antigravity-cli'.length).replace(/^[-_.]/, '');
  } else if (ANTIGRAVITY_DIR_RE.test(name)) {
    surface = 'app';
    suffix = name.slice('antigravity'.length).replace(/^[-_.]/, '');
  } else {
    suffix = name;
  }

  const profileParts = [profileDir, suffix].filter(Boolean);
  const profile = profileParts.length > 0 ? profileParts.join('/') : 'default';
  const surfaceLabel = surface === 'app' ? 'App' : surface === 'cli' ? 'CLI' : surface === 'ide' ? 'IDE' : 'Custom';
  const label = `${surfaceLabel} · ${profile}`;
  return { surface, profile, label };
}

function hasAntigravityStore(dirPath) {
  return isDir(join(dirPath, 'brain')) || existsSync(join(dirPath, 'conversation_summaries.db'));
}

function collectExplicitCandidates(env, config, primaryHome) {
  const raw = [];
  if (env.AGY_CACHE_DATA_DIRS) {
    for (const part of env.AGY_CACHE_DATA_DIRS.split(delimiter)) {
      if (part.trim()) raw.push(part.trim());
    }
  }
  if (Array.isArray(config.extraDataDirs)) {
    raw.push(...config.extraDataDirs);
  }
  const out = [];
  for (const entry of raw) {
    const expanded = expandHome(entry, primaryHome);
    if (!expanded) continue;
    const full = isAbsolute(expanded) ? expanded : resolve(expanded);
    if (isDir(full)) out.push({ path: full, profileHint: '', explicit: true });
  }
  return out;
}

function scanProfilesRoot(profilesRoot, includeBackups, excludeRegexes, out) {
  if (!isDir(profilesRoot)) return;
  let profiles;
  try {
    profiles = readdirSync(profilesRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const prof of profiles) {
    if (!prof.isDirectory() && !prof.isSymbolicLink()) continue;
    if (prof.name === 'bin' || prof.name.startsWith('.')) continue;
    if (isExcludedName(prof.name, includeBackups, excludeRegexes)) continue;
    scanGeminiDir(join(profilesRoot, prof.name, '.gemini'), prof.name, includeBackups, excludeRegexes, out);
  }
}

export function discoverDataDirs(options = {}) {
  const env = options.env || process.env;
  const homes = resolveCandidateHomes(env, options.homes || null);
  const primaryHome = homes[0] || process.cwd();
  const config = options.config || loadUserConfig(homes, env);
  const includeBackups = Boolean(
    options.includeBackups ?? (env.AGY_CACHE_INCLUDE_BACKUPS === '1' || config.includeBackups)
  );
  const excludeRegexes = (Array.isArray(config.excludePatterns) ? config.excludePatterns : [])
    .map((p) => {
      try {
        return new RegExp(p, 'i');
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const currentDir = options.currentDir !== undefined ? options.currentDir : resolveCurrentAppDataDir(env);
  const candidates = [];
  if (currentDir && isDir(currentDir)) {
    candidates.push({ path: currentDir, profileHint: '', explicit: true });
  }
  candidates.push(...collectExplicitCandidates(env, config, primaryHome));

  if (env.GEMINI_HOME && isDir(env.GEMINI_HOME)) {
    scanGeminiDir(env.GEMINI_HOME, '', includeBackups, excludeRegexes, candidates);
  }
  for (const h of homes) {
    scanGeminiDir(join(h, '.gemini'), '', includeBackups, excludeRegexes, candidates);
    scanProfilesRoot(join(h, '.agy-profiles'), includeBackups, excludeRegexes, candidates);
  }

  const extraProfileRoots = [
    ...(env.AGY_CACHE_EXTRA_PROFILES_DIRS ? env.AGY_CACHE_EXTRA_PROFILES_DIRS.split(delimiter) : []),
    ...(Array.isArray(config.extraProfileRoots) ? config.extraProfileRoots : []),
  ];
  for (const rawRoot of extraProfileRoots) {
    const expanded = expandHome(rawRoot, primaryHome);
    if (expanded) scanProfilesRoot(expanded, includeBackups, excludeRegexes, candidates);
  }

  const seenPaths = new Set();
  const usedIds = new Map();
  const sources = [];
  for (const cand of candidates) {
    const canon = safeRealpath(cand.path);
    if (seenPaths.has(canon)) continue;
    if (!hasAntigravityStore(canon)) continue;
    seenPaths.add(canon);

    const { surface, profile, label } = classifyDataDir(canon, cand.profileHint);
    const baseId = `${surface}:${profile}`;
    const count = (usedIds.get(baseId) || 0) + 1;
    usedIds.set(baseId, count);
    const id = count === 1 ? baseId : `${baseId}#${count}`;

    sources.push({
      id,
      label: count === 1 ? label : `${label} (${count})`,
      surface,
      profile,
      path: canon,
      isCurrent: Boolean(currentDir && canon === currentDir),
    });
  }

  sources.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    const order = { app: 0, ide: 1, cli: 2, custom: 3 };
    const diff = (order[a.surface] ?? 9) - (order[b.surface] ?? 9);
    return diff !== 0 ? diff : a.label.localeCompare(b.label);
  });

  return sources;
}
