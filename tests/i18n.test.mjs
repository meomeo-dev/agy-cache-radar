import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { CacheRadarEngine } from '../src/index.mjs';
import { REASON_META } from '../src/diagnostics.mjs';
import { startStandaloneServer } from '../sidecars/cache_radar/main.mjs';
import { REASON_LABELS } from '../scripts/cache-stats.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const I18N_PATH = join(REPO_ROOT, 'sidecars', 'cache_radar', 'web', 'i18n.js');
const CLI_PATH = join(REPO_ROOT, 'scripts', 'cache-stats.mjs');
const CJK_RE = /[\u4e00-\u9fff]/;
const PLACEHOLDER_RE = /\{[a-zA-Z0-9_]+\}/g;

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

function createElement(tag, attrs = {}, text = '') {
  const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
  const listeners = new Map();
  const attrMap = new Map(Object.entries(attrs));
  const dataset = {};
  for (const [k, v] of attrMap) {
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      dataset[camel] = v;
    }
  }
  const el = {
    tagName: tag.toUpperCase(),
    id: attrs.id || '',
    title: attrs.title || '',
    value: attrs.value || '',
    textContent: text,
    innerHTML: '',
    dataset,
    style: {},
    classList: {
      toggle: (cls, force) => {
        if (force === undefined) return classes.has(cls) ? (classes.delete(cls), false) : (classes.add(cls), true);
        if (force) classes.add(cls); else classes.delete(cls);
        return Boolean(force);
      },
      contains: (cls) => classes.has(cls),
    },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    getAttribute: (k) => (attrMap.has(k) ? attrMap.get(k) : null),
    setAttribute: (k, v) => { attrMap.set(k, String(v)); if (k === 'title') el.title = String(v); },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch: (type, event = {}) => {
      for (const fn of listeners.get(type) || []) fn({ target: el, preventDefault() {}, ...event });
    },
    appendChild: () => {},
    remove: () => {},
  };
  return el;
}

function parseHtmlElements(html) {
  const elements = [];
  const tagRe = /<([a-zA-Z0-9]+)([^>]*)>([^<]*)/g;
  for (const match of html.matchAll(tagRe)) {
    const [, tag, rawAttrs, rawText] = match;
    const attrs = {};
    for (const a of rawAttrs.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)) {
      attrs[a[1]] = a[2];
    }
    if (attrs.id || attrs['data-i18n'] || attrs['data-i18n-title'] || attrs['data-i18n-aria'] || attrs['data-tab']) {
      elements.push(createElement(tag, attrs, rawText.trim()));
    }
  }
  return elements;
}

function loadI18nOnly({ search = '', stored = {}, navLang = 'en-US' } = {}) {
  const storage = createStorage(stored);
  const docEl = { lang: 'zh-CN', dataset: {} };
  const ctx = {
    window: {},
    location: { search },
    localStorage: storage,
    navigator: { language: navLang },
    document: { documentElement: docEl, querySelectorAll: () => [] },
    URLSearchParams,
  };
  ctx.window = ctx;
  vm.runInNewContext(readFileSync(I18N_PATH, 'utf-8'), ctx, { filename: 'i18n.js' });
  return { i18n: ctx.CacheRadar.i18n, storage, docEl };
}

function createFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cache-radar-i18n-'));
  const appDir = join(root, '.gemini', 'antigravity');
  const mainId = '11111111-1111-1111-1111-111111111111';
  const subId = '22222222-2222-2222-2222-222222222222';
  const now = Date.now();

  const mainRows = [
    { step_index: 1, type: 'PLANNER_RESPONSE', created_at: new Date(now - 900_000).toISOString(), model: 'gemini-2.5-pro', input_tokens: 10000, cache_read_tokens: 0, output_tokens: 120 },
    { step_index: 2, type: 'PLANNER_RESPONSE', created_at: new Date(now - 880_000).toISOString(), model: 'gemini-2.5-pro', input_tokens: 2000, cache_read_tokens: 10000, output_tokens: 100 },
    { step_index: 3, type: 'PLANNER_RESPONSE', created_at: new Date(now - 850_000).toISOString(), model: 'gemini-2.5-pro', input_tokens: 13000, cache_read_tokens: 0, output_tokens: 100 },
    { step_index: 4, type: 'PLANNER_RESPONSE', created_at: new Date(now - 450_000).toISOString(), model: 'gemini-2.5-pro', input_tokens: 14000, cache_read_tokens: 0, output_tokens: 100 },
    { step_index: 5, type: 'PLANNER_RESPONSE', created_at: new Date(now - 430_000).toISOString(), model: 'gemini-2.5-flash', input_tokens: 15000, cache_read_tokens: 0, output_tokens: 100 },
    { step_index: 6, type: 'PLANNER_RESPONSE', created_at: new Date(now - 410_000).toISOString(), model: 'gemini-2.5-flash', input_tokens: 9000, cache_read_tokens: 8000, output_tokens: 100 },
  ];
  const subRows = [
    { step_index: 1, type: 'PLANNER_RESPONSE', created_at: new Date(now - 380_000).toISOString(), model: 'gemini-2.5-flash', input_tokens: 4000, cache_read_tokens: 0, output_tokens: 80 },
    { step_index: 2, type: 'PLANNER_RESPONSE', created_at: new Date(now - 360_000).toISOString(), model: 'gemini-2.5-flash', input_tokens: 1000, cache_read_tokens: 4000, output_tokens: 80 },
  ];

  for (const [cid, rows] of [[mainId, mainRows], [subId, subRows]]) {
    const txDir = join(appDir, 'brain', cid, '.system_generated', 'logs');
    mkdirSync(txDir, { recursive: true });
    writeFileSync(join(txDir, 'transcript.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }

  const db = new DatabaseSync(join(appDir, 'conversation_summaries.db'));
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id text PRIMARY KEY, title text NOT NULL DEFAULT "",
      parent_conversation_id text NOT NULL DEFAULT "", nesting_depth integer NOT NULL DEFAULT 0,
      agent_name text NOT NULL DEFAULT "", status text NOT NULL DEFAULT "",
      not_fully_idle numeric NOT NULL DEFAULT 0, killed numeric NOT NULL DEFAULT 0,
      last_modified_time datetime NOT NULL DEFAULT "", last_user_input_time datetime NOT NULL DEFAULT "",
      workspace_uris text NOT NULL DEFAULT ""
    );
  `);
  const ins = db.prepare(
    'INSERT INTO conversation_summaries (conversation_id, title, parent_conversation_id, nesting_depth, agent_name, status, not_fully_idle) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  ins.run(mainId, 'Demo Session', '', 0, '', 'CASCADE_RUN_STATUS_RUNNING', 1);
  ins.run(subId, 'Worker Task', mainId, 1, 'worker-1', 'CASCADE_RUN_STATUS_IDLE', 0);
  db.close();
  return { root, appDir, mainId };
}

async function bootFrontendInVm(baseUrl, search, { stored = {}, navLang = 'en-US' } = {}) {
  const html = await (await fetch(`${baseUrl}/`)).text();
  const scriptPaths = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  const elements = parseHtmlElements(html);
  const byId = new Map(elements.filter((e) => e.id).map((e) => [e.id, e]));
  const docEl = { lang: 'zh-CN', dataset: {}, appendChild: () => {} };
  const storage = createStorage(stored);
  const pendingFetches = [];
  let fetchCount = 0;

  const vmFetch = (url, init) => {
    fetchCount += 1;
    const target = String(url).startsWith('http') ? url : `${baseUrl}${url}`;
    const p = fetch(target, init);
    pendingFetches.push(p);
    return p;
  };
  const document = {
    documentElement: docEl,
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => createElement(tag),
    querySelectorAll: (sel) => {
      if (sel === '.tab') return elements.filter((e) => e.classList.contains('tab'));
      const attrMatch = sel.match(/^\[([a-zA-Z0-9_-]+)\]$/);
      if (attrMatch) return elements.filter((e) => e.getAttribute(attrMatch[1]) !== null);
      return [];
    },
  };
  const ctx = {
    window: null,
    location: { search },
    localStorage: storage,
    navigator: { language: navLang },
    document,
    fetch: vmFetch,
    URLSearchParams,
    AbortController,
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ color: 'rgb(247, 247, 248)' }),
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    console,
  };
  ctx.window = ctx;
  const vmCtx = vm.createContext(ctx);
  for (const src of scriptPaths) {
    const code = await (await fetch(`${baseUrl}${src}`)).text();
    vm.runInContext(code, vmCtx, { filename: src });
  }
  await Promise.all(pendingFetches);
  await new Promise((r) => setTimeout(r, 20));
  return {
    ctx,
    elements,
    byId,
    docEl,
    storage,
    scriptPaths,
    getFetchCount: () => fetchCount,
    clickDrill: (drillKey) => {
      byId.get('content').dispatch('click', {
        target: { closest: (sel) => (sel === '[data-drill]' ? { dataset: { drill: drillKey } } : null) },
      });
    },
    clickTab: (tabKey) => {
      const btn = elements.find((e) => e.classList.contains('tab') && e.dataset.tab === tabKey);
      btn.dispatch('click');
    },
  };
}

function collectChromeText(elements) {
  return elements
    .flatMap((e) => [e.textContent, e.title, e.getAttribute('aria-label') || ''])
    .filter(Boolean)
    .join('\n');
}

test('i18n dictionary has exact zh-CN/en parity, placeholder parity, and covers all 8 REASON_META keys', () => {
  const { i18n } = loadI18nOnly({ search: '?lang=en' });
  assert.deepEqual([...i18n.SUPPORTED_LANGS], ['zh-CN', 'en']);

  const zhKeys = Object.keys(i18n.DICT['zh-CN']).sort();
  const enKeys = Object.keys(i18n.DICT.en).sort();
  assert.ok(zhKeys.length > 0, 'Dictionary must not be empty');
  assert.deepEqual(zhKeys, enKeys, 'zh-CN and en dictionaries must have identical keys');

  for (const key of enKeys) {
    const zh = i18n.DICT['zh-CN'][key];
    const en = i18n.DICT.en[key];
    assert.equal(typeof zh, 'string', `zh-CN.${key} must be string`);
    assert.equal(typeof en, 'string', `en.${key} must be string`);
    assert.ok(zh.trim().length > 0, `zh-CN.${key} must be non-empty`);
    assert.ok(en.trim().length > 0, `en.${key} must be non-empty`);
    assert.doesNotMatch(en, CJK_RE, `en.${key} must not contain CJK characters: ${en}`);
    const zhVars = (zh.match(PLACEHOLDER_RE) || []).sort();
    const enVars = (en.match(PLACEHOLDER_RE) || []).sort();
    assert.deepEqual(enVars, zhVars, `Placeholder mismatch for key ${key}`);
  }

  const reasonKeys = Object.keys(REASON_META);
  assert.equal(reasonKeys.length, 8);
  for (const lang of ['en', 'zh-CN']) {
    i18n.setLang(lang);
    for (const rKey of reasonKeys) {
      const full = i18n.reasonLabel(rKey, false);
      const short = i18n.reasonLabel(rKey, true);
      const hint = i18n.reasonHint(rKey);
      assert.ok(full && full !== rKey, `${lang} full reasonLabel missing for ${rKey}`);
      assert.ok(short && short !== rKey, `${lang} short reasonLabel missing for ${rKey}`);
      assert.ok(hint.trim().length > 0, `${lang} reasonHint missing for ${rKey}`);
      if (lang === 'en') {
        assert.doesNotMatch(`${full} ${short} ${hint}`, CJK_RE, `en reason ${rKey} leaked CJK`);
      } else {
        assert.match(full, CJK_RE, `zh-CN reason ${rKey} should use Chinese`);
        assert.match(hint, CJK_RE, `zh-CN hint ${rKey} should use Chinese`);
      }
    }
  }

  assert.equal(i18n.normalizeLang('zh'), 'zh-CN');
  assert.equal(i18n.normalizeLang('ZH-tw'), 'zh-CN');
  assert.equal(i18n.normalizeLang('en-US'), 'en');
  assert.equal(i18n.normalizeLang('fr-FR'), null);
  assert.equal(i18n.t('missing.key.fallback'), 'missing.key.fallback');

  assert.equal(loadI18nOnly({ search: '?lang=en', stored: { cr_lang: 'zh-CN' }, navLang: 'zh-CN' }).i18n.getLang(), 'en');
  assert.equal(loadI18nOnly({ search: '', stored: { cr_lang: 'zh-CN' }, navLang: 'en-US' }).i18n.getLang(), 'zh-CN');
  assert.equal(loadI18nOnly({ search: '', stored: {}, navLang: 'zh-CN' }).i18n.getLang(), 'zh-CN');
  assert.equal(loadI18nOnly({ search: '', stored: {}, navLang: 'fr-FR' }).i18n.getLang(), 'en');
});

test('standalone server + node:vm renders complete UI in ?lang=en (0 CJK) and ?lang=zh-CN', async () => {
  const { root, appDir } = createFixtureRoot();
  const engine = new CacheRadarEngine({
    discoveryOptions: { homes: [root], env: { HOME: root }, currentDir: appDir },
  });
  const { server, host, port } = await startStandaloneServer(engine, { port: 0 });
  const base = `http://${host}:${port}`;

  try {
    const en = await bootFrontendInVm(base, '?lang=en&theme=light');
    assert.ok(en.scriptPaths.some((s) => s.startsWith('/i18n.js')), 'index.html must load /i18n.js');
    assert.ok(
      en.scriptPaths.findIndex((s) => s.startsWith('/i18n.js')) < en.scriptPaths.findIndex((s) => s.startsWith('/format.js')),
      '/i18n.js must load before /format.js'
    );
    assert.equal(en.docEl.lang, 'en');
    assert.equal(en.byId.get('lang-btn').textContent, 'ZH');

    const enSnapshots = [
      collectChromeText(en.elements),
      en.byId.get('source-select').innerHTML,
      en.byId.get('panel-session').innerHTML,
      en.byId.get('panel-24h').innerHTML,
      en.byId.get('panel-30d').innerHTML,
      en.byId.get('footer-meta').textContent,
      en.byId.get('footer-updated').textContent,
    ];
    for (const drill of ['matrices', 'models', 'agents']) {
      en.clickDrill(drill);
      enSnapshots.push(en.byId.get('panel-session').innerHTML);
    }
    en.clickTab('24h');
    for (const drill of ['matrices', 'sources_models', 'sessions']) {
      en.clickDrill(drill);
      enSnapshots.push(en.byId.get('panel-24h').innerHTML);
    }
    en.clickTab('30d');
    for (const drill of ['matrices', 'sources_models', 'sessions']) {
      en.clickDrill(drill);
      enSnapshots.push(en.byId.get('panel-30d').innerHTML);
    }

    const enAll = enSnapshots.join('\n');
    assert.doesNotMatch(enAll, CJK_RE, 'Rendered ?lang=en DOM must contain zero Chinese characters');
    assert.doesNotMatch(enAll, PLACEHOLDER_RE, 'Rendered ?lang=en DOM must have no unresolved placeholders');
    assert.match(enAll, /Session/);
    assert.match(enAll, /Last 24h/);
    assert.match(enAll, /Last 30d/);
    assert.match(enAll, /All clients/);
    assert.match(enAll, /Cache Miss Causes/);
    assert.match(en.byId.get('footer-meta').textContent, /sources/);
    assert.match(en.byId.get('footer-updated').textContent, /Updated/);

    const zh = await bootFrontendInVm(base, '?lang=zh-CN&theme=light');
    assert.equal(zh.docEl.lang, 'zh-CN');
    assert.equal(zh.byId.get('lang-btn').textContent, 'EN');
    const zhAll = [
      collectChromeText(zh.elements),
      zh.byId.get('source-select').innerHTML,
      zh.byId.get('panel-session').innerHTML,
      zh.byId.get('panel-24h').innerHTML,
      zh.byId.get('panel-30d').innerHTML,
      zh.byId.get('footer-meta').textContent,
      zh.byId.get('footer-updated').textContent,
    ].join('\n');
    assert.doesNotMatch(zhAll, PLACEHOLDER_RE, 'Rendered ?lang=zh-CN DOM must have no unresolved placeholders');
    assert.match(zhAll, /当前会话/);
    assert.match(zhAll, /近 24 小时/);
    assert.match(zhAll, /近 30 天/);
    assert.match(zhAll, /全部客户端/);
    assert.match(zhAll, /丢缓存主因/);
    assert.match(zh.byId.get('footer-meta').textContent, /数据源/);
    assert.match(zh.byId.get('footer-updated').textContent, /更新/);
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(root, { recursive: true, force: true });
  }
});

test('clicking #lang-btn and calling toggleLang() flips zh-CN <-> en, persists localStorage, updates lang, and re-renders without refetch', async () => {
  const { root, appDir } = createFixtureRoot();
  const engine = new CacheRadarEngine({
    discoveryOptions: { homes: [root], env: { HOME: root }, currentDir: appDir },
  });
  const { server, host, port } = await startStandaloneServer(engine, { port: 0 });
  const base = `http://${host}:${port}`;

  try {
    const app = await bootFrontendInVm(base, '?lang=zh-CN&theme=light');
    const initialFetches = app.getFetchCount();
    assert.equal(app.ctx.CacheRadar.i18n.getLang(), 'zh-CN');
    assert.equal(app.docEl.lang, 'zh-CN');

    app.byId.get('lang-btn').dispatch('click');
    assert.equal(app.ctx.CacheRadar.i18n.getLang(), 'en');
    assert.equal(app.storage.getItem('cr_lang'), 'en');
    assert.equal(app.docEl.lang, 'en');
    assert.equal(app.byId.get('lang-btn').textContent, 'ZH');
    assert.equal(app.getFetchCount(), initialFetches, 'Switching language must not trigger extra network fetches');
    const afterEn = [
      collectChromeText(app.elements),
      app.byId.get('source-select').innerHTML,
      app.byId.get('panel-session').innerHTML,
      app.byId.get('panel-24h').innerHTML,
      app.byId.get('panel-30d').innerHTML,
      app.byId.get('footer-meta').textContent,
      app.byId.get('footer-updated').textContent,
    ].join('\n');
    assert.doesNotMatch(afterEn, CJK_RE, 'Re-rendered DOM after switching to en must contain 0 CJK chars');

    app.byId.get('lang-btn').dispatch('click');
    assert.equal(app.ctx.CacheRadar.i18n.getLang(), 'zh-CN');
    assert.equal(app.storage.getItem('cr_lang'), 'zh-CN');
    assert.equal(app.docEl.lang, 'zh-CN');
    assert.equal(app.byId.get('lang-btn').textContent, 'EN');
    assert.equal(app.getFetchCount(), initialFetches);
    assert.match(app.byId.get('panel-session').innerHTML, /丢缓存主因/);
    assert.match(app.byId.get('footer-meta').textContent, /数据源/);

    assert.equal(app.ctx.CacheRadar.i18n.toggleLang(), 'en');
    assert.equal(app.storage.getItem('cr_lang'), 'en');
    assert.equal(app.docEl.lang, 'en');
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(root, { recursive: true, force: true });
  }
});

test('scripts/cache-stats.mjs supports --lang en, --lang zh-CN, env auto-detection, and preserves --json', () => {
  const reasonKeys = Object.keys(REASON_META).sort();
  assert.deepEqual(Object.keys(REASON_LABELS.en).sort(), reasonKeys);
  assert.deepEqual(Object.keys(REASON_LABELS['zh-CN']).sort(), reasonKeys);
  for (const k of reasonKeys) {
    assert.doesNotMatch(REASON_LABELS.en[k], CJK_RE, `CLI en reason ${k} must not contain CJK`);
    assert.match(REASON_LABELS['zh-CN'][k], CJK_RE, `CLI zh-CN reason ${k} should be Chinese`);
  }

  const { root } = createFixtureRoot();
  try {
    const runCli = (args, envOverrides = {}) =>
      execFileSync(process.execPath, [CLI_PATH, '--home', root, ...args], {
        encoding: 'utf-8',
        env: { PATH: process.env.PATH, ...envOverrides },
      });

    const outEn = runCli(['--lang', 'en'], { LC_ALL: 'zh_CN.UTF-8' });
    assert.doesNotMatch(outEn, CJK_RE, '--lang en output must contain zero Chinese characters');
    assert.match(outEn, /Data sources:/);
    assert.match(outEn, /\[1\] Active Session: Demo Session/);
    assert.match(outEn, /Hit Rate:/);
    assert.match(outEn, /Uncached Attribution \(Session\)/);
    assert.match(outEn, /\[miss\]/);
    assert.match(outEn, /\[normal\]/);
    assert.match(outEn, /\[2\] Last 24 Hours:/);
    assert.match(outEn, /\[3\] Last 30 Days:/);

    const outZh = runCli(['--lang', 'zh-CN'], { LC_ALL: 'en_US.UTF-8' });
    assert.match(outZh, /数据源:/);
    assert.match(outZh, /\[1\] 当前会话: Demo Session/);
    assert.match(outZh, /命中率:/);
    assert.match(outZh, /未命中归因（当前会话）/);
    assert.match(outZh, /\[丢缓存\]/);
    assert.match(outZh, /\[正常新增\]/);
    assert.match(outZh, /\[2\] 最近 24 小时:/);
    assert.match(outZh, /\[3\] 最近 30 天:/);
    assert.doesNotMatch(outZh, /Data sources:|Active Session:|Hit Rate:|Uncached Attribution|Last 24 Hours|Last 30 Days/);

    const envZh = runCli([], { LC_ALL: 'zh_CN.UTF-8' });
    assert.match(envZh, /数据源:/);

    const envEn = runCli([], { LC_ALL: '', LANG: 'C' });
    assert.doesNotMatch(envEn, CJK_RE);
    assert.match(envEn, /Data sources:/);

    const jsonEn = JSON.parse(runCli(['--json', '--lang', 'en']));
    const jsonZh = JSON.parse(runCli(['--json', '--lang', 'zh-CN']));
    assert.equal(jsonEn.activeSession.found, true);
    assert.equal(jsonEn.activeSession.title, 'Demo Session');
    assert.equal(jsonEn.etag, jsonZh.etag);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
