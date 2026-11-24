#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CacheRadarEngine } from '../src/index.mjs';

const PRESET_MS = {
  '1h': 3600_000,
  '24h': 24 * 3600_000,
  '7d': 7 * 86400_000,
  '30d': 30 * 86400_000,
};

export const REASON_LABELS = {
  en: {
    hot_prefix_bust: 'Short-gap miss (<1m)',
    idle_ttl_expired: 'Idle TTL expired (≥5m)',
    idle_warm_decay: 'Early eviction (1-5m)',
    model_switch: 'Model/config switch',
    stream_interrupt: 'Interrupt retry',
    partial_truncation: 'Partial prefix miss',
    cold_start: 'First-turn cold start',
    incremental_append: 'New turn content',
  },
  'zh-CN': {
    hot_prefix_bust: '短间隔失效 (<1m)',
    idle_ttl_expired: '超时过期 (≥5m)',
    idle_warm_decay: '提前回收 (1-5m)',
    model_switch: '切换模型/配置',
    stream_interrupt: '中断重试',
    partial_truncation: '前缀部分失效',
    cold_start: '首轮发送',
    incremental_append: '每轮新内容',
  },
};

const CLI_COPY = {
  en: {
    sources: (d) =>
      `Data sources: ${d.nonEmptySources}/${d.totalSources} active, ` +
      `${d.totalConversations} unique conversations ` +
      `(deduped: ${d.dedupedConversations} convs, ${d.dedupedForkSteps} fork steps)`,
    rangeTag: (fromIso, toIso) => ` [range: ${fromIso} .. ${toIso}]`,
    activeSession: (title, source, range) => `[1] Active Session: ${title} (${source})${range}`,
    activeNone: '[1] Active Session: none found',
    hitSummary: (rate, read, prompt, turns) =>
      `    Hit Rate: ${rate} | read ${read} / prompt ${prompt} | ${turns}`,
    mainSubSummary: (mainRate, mainTurns, descCount, subRate, subTurns) =>
      `    Main only: ${mainRate} (${mainTurns}) | Subagents/Swarm(${descCount}): ${subRate} (${subTurns})`,
    windowLine: (idx, label, rate, mainRate, subRate, read, prompt, turns) =>
      `[${idx}] ${label}: ${rate} (main ${mainRate} / subagents ${subRate}) ` +
      `| read ${read} / prompt ${prompt} | ${turns}`,
    last24h: 'Last 24 Hours',
    last30d: 'Last 30 Days',
    attrTitleSession: 'Uncached Attribution (Session)',
    attrTitle24h: 'Uncached Attribution (24h)',
    attrTitle30d: 'Uncached Attribution (30d)',
    attrHeader: (title, retention, anomalyTok, dropPct) =>
      `  ${title} (prefix retention ${retention}, cache miss resend ${anomalyTok} / hit rate impact -${dropPct}):`,
    tagAnomaly: '[miss]',
    tagStructural: '[normal]',
    tagWidth: 8,
    impactAnomaly: (pct) => `hit rate impact -${pct}`,
    impactStructural: (pct) => `share of prompt ${pct}`,
    attrRow: (tag, label, tok, impact, turns) => `    ${tag} ${label} ${tok} (${impact}, ${turns})`,
    turns: (n) => `${n} ${n === 1 ? 'turn' : 'turns'}`,
  },
  'zh-CN': {
    sources: (d) =>
      `数据源: ${d.nonEmptySources}/${d.totalSources} 活跃，` +
      `${d.totalConversations} 个唯一会话` +
      `（已去重: ${d.dedupedConversations} 个会话，${d.dedupedForkSteps} 个分支步骤）`,
    rangeTag: (fromIso, toIso) => ` [范围: ${fromIso} .. ${toIso}]`,
    activeSession: (title, source, range) => `[1] 当前会话: ${title} (${source})${range}`,
    activeNone: '[1] 当前会话: 未找到',
    hitSummary: (rate, read, prompt, turns) =>
      `    命中率: ${rate} | 缓存读取 ${read} / 总输入 ${prompt} | ${turns}`,
    mainSubSummary: (mainRate, mainTurns, descCount, subRate, subTurns) =>
      `    仅主会话: ${mainRate} (${mainTurns}) | 子代理/协作组(${descCount}): ${subRate} (${subTurns})`,
    windowLine: (idx, label, rate, mainRate, subRate, read, prompt, turns) =>
      `[${idx}] ${label}: ${rate}（主会话 ${mainRate} / 子代理 ${subRate}）` +
      `| 缓存读取 ${read} / 总输入 ${prompt} | ${turns}`,
    last24h: '最近 24 小时',
    last30d: '最近 30 天',
    attrTitleSession: '未命中归因（当前会话）',
    attrTitle24h: '未命中归因（24 小时）',
    attrTitle30d: '未命中归因（30 天）',
    attrHeader: (title, retention, anomalyTok, dropPct) =>
      `  ${title}（旧上下文复用率 ${retention}，异常丢缓存重发 ${anomalyTok} / 命中率影响 -${dropPct}）:`,
    tagAnomaly: '[丢缓存]',
    tagStructural: '[正常新增]',
    tagWidth: 10,
    impactAnomaly: (pct) => `命中率影响 -${pct}`,
    impactStructural: (pct) => `占总输入 ${pct}`,
    attrRow: (tag, label, tok, impact, turns) => `    ${tag} ${label} ${tok}（${impact}，${turns}）`,
    turns: (n) => `${n} 轮`,
  },
};

export function normalizeLang(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith('zh')) return 'zh-CN';
  if (v.startsWith('en')) return 'en';
  return null;
}

export function resolveLang(explicitLang, env = process.env) {
  const explicit = normalizeLang(explicitLang);
  if (explicit) return explicit;
  const envLocale = String(env.LC_ALL || env.LANG || '').trim();
  return /^zh/i.test(envLocale) ? 'zh-CN' : 'en';
}

function parseTimestampArg(raw) {
  if (!raw) return null;
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) return Math.trunc(num);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readArgValue(argv, index, flag) {
  const arg = argv[index];
  if (arg === flag && index + 1 < argv.length) return { value: argv[index + 1], nextIndex: index + 1 };
  if (arg.startsWith(`${flag}=`)) return { value: arg.slice(flag.length + 1), nextIndex: index };
  return null;
}

export function parseArgs(argv) {
  const opts = { json: false, source: 'all', conversationId: '', sessionFrom: null, sessionTo: null, lang: '', home: '' };
  const handlers = [
    ['--source', (v) => { opts.source = v; }],
    ['--conversation', (v) => { opts.conversationId = v; }],
    ['--from', (v) => { opts.sessionFrom = parseTimestampArg(v); }],
    ['--to', (v) => { opts.sessionTo = parseTimestampArg(v); }],
    ['--lang', (v) => { opts.lang = v; }],
    ['--home', (v) => { opts.home = v; }],
    ['--last', (v) => {
      const ms = PRESET_MS[v];
      if (ms) {
        opts.sessionTo = Date.now();
        opts.sessionFrom = opts.sessionTo - ms;
      }
    }],
  ];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') { opts.json = true; continue; }
    for (const [flag, apply] of handlers) {
      const matched = readArgValue(argv, i, flag);
      if (matched) { apply(matched.value); i = matched.nextIndex; break; }
    }
  }
  return opts;
}

function fmtPct(rate) {
  return rate === null || rate === undefined ? '--' : `${(rate * 100).toFixed(1)}%`;
}

function fmtTok(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

function padDisplay(str, width) {
  let cols = 0;
  for (const ch of str) {
    cols += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  }
  return cols >= width ? str : str + ' '.repeat(width - cols);
}

function formatAttributionLines(title, diag, lang) {
  if (!diag?.attribution?.length) return [];
  const copy = CLI_COPY[lang] || CLI_COPY.en;
  const reasons = REASON_LABELS[lang] || REASON_LABELS.en;
  const lines = [
    copy.attrHeader(
      title,
      fmtPct(diag.prefixRetentionRate),
      fmtTok(diag.anomalyTokens),
      fmtPct(diag.anomalyShareOfPrompt)
    ),
  ];
  for (const a of diag.attribution.slice(0, 6)) {
    const rawTag = a.category === 'anomaly' ? copy.tagAnomaly : copy.tagStructural;
    const tag = padDisplay(rawTag, copy.tagWidth);
    const labelText = reasons[a.key] || (lang === 'zh-CN' ? a.label : a.key);
    const impact =
      a.category === 'anomaly'
        ? copy.impactAnomaly(fmtPct(a.shareOfPrompt))
        : copy.impactStructural(fmtPct(a.shareOfPrompt));
    lines.push(
      copy.attrRow(tag, padDisplay(labelText, 24), fmtTok(a.tokens).padStart(7), impact, copy.turns(a.turns))
    );
  }
  return lines;
}

function formatSessionLines(s, copy, lang) {
  if (!s.found) return [copy.activeNone];
  const activeSlice = s.descendantCount > 0 ? s.tree : s.self;
  const rangeTag = s.timeRange?.isFiltered
    ? copy.rangeTag(
        s.timeRange.from ? new Date(s.timeRange.from).toISOString() : '*',
        s.timeRange.to ? new Date(s.timeRange.to).toISOString() : '*'
      )
    : '';
  const lines = [
    copy.activeSession(s.title, s.sourceLabel, rangeTag),
    copy.hitSummary(
      fmtPct(activeSlice.cacheHitRate),
      fmtTok(activeSlice.cacheReadTokens),
      fmtTok(activeSlice.totalPromptTokens),
      copy.turns(activeSlice.turns)
    ),
  ];
  if (s.descendantCount > 0) {
    lines.push(
      copy.mainSubSummary(
        fmtPct(s.self.cacheHitRate),
        copy.turns(s.self.turns),
        s.descendantCount,
        fmtPct(s.subagents.cacheHitRate),
        copy.turns(s.subagents.turns)
      )
    );
  }
  lines.push(...formatAttributionLines(copy.attrTitleSession, activeSlice.diagnostics, lang));
  return lines;
}

function formatWindowLines(index, label, attrTitle, win, copy, lang) {
  return [
    copy.windowLine(
      index,
      label,
      fmtPct(win.all.cacheHitRate),
      fmtPct(win.mainOnly.cacheHitRate),
      fmtPct(win.subagentsOnly.cacheHitRate),
      fmtTok(win.all.cacheReadTokens),
      fmtTok(win.all.totalPromptTokens),
      copy.turns(win.all.turns)
    ),
    ...formatAttributionLines(attrTitle, win.all.diagnostics, lang),
  ];
}

export function formatTextReport(snap, lang = 'en') {
  const locale = normalizeLang(lang) || 'en';
  const copy = CLI_COPY[locale] || CLI_COPY.en;
  const lines = [
    '=== Cache Radar v0.1.0 ===',
    copy.sources(snap.diagnostics),
    '',
    ...formatSessionLines(snap.activeSession, copy, locale),
    '',
    ...formatWindowLines(2, copy.last24h, copy.attrTitle24h, snap.last24h, copy, locale),
    '',
    ...formatWindowLines(3, copy.last30d, copy.attrTitle30d, snap.last30d, copy, locale),
  ];
  return lines.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const lang = resolveLang(opts.lang, process.env);
  const discoveryOptions = opts.home
    ? { homes: [opts.home], env: { HOME: opts.home }, currentDir: null }
    : {};
  const engine = new CacheRadarEngine({ discoveryOptions });
  const snapshot = engine.getSnapshot({
    conversationId: opts.conversationId,
    sourceFilter: opts.source,
    sessionFrom: opts.sessionFrom,
    sessionTo: opts.sessionTo,
    forceRefresh: true,
  });

  if (opts.json) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log(formatTextReport(snapshot, lang));
  }
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isEntrypoint()) {
  main();
}
