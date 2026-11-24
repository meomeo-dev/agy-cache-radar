(() => {
  const CR = (window.CacheRadar = window.CacheRadar || {});
  const STORAGE_KEY = 'cr_lang';
  const SUPPORTED_LANGS = ['zh-CN', 'en'];

  const ENTRIES = {
    'lang.btn': ['EN', 'ZH'],
    'lang.title': ['切换为英文', 'Switch to Chinese (zh-CN)'],
    'lang.aria': ['切换界面语言', 'Switch interface language'],
    'source.aria': ['数据源范围', 'Data source scope'],
    'source.title': ['切换客户端 / Profile 数据源', 'Switch client / profile data source'],
    'source.allDefault': ['全部客户端', 'All clients'],
    'source.all': ['全部客户端 ({count})', 'All clients ({count})'],
    'source.currentOnly': ['仅当前客户端', 'Current client only'],
    'refresh.title': ['立即刷新', 'Refresh now'],
    'refresh.aria': ['刷新数据', 'Refresh data'],
    'tabs.aria': ['缓存命中率视图', 'Cache hit rate views'],
    'tab.session': ['当前会话', 'Session'],
    'tab.24h': ['近 24 小时', 'Last 24h'],
    'tab.30d': ['近 30 天', 'Last 30d'],
    'loading.initial': ['正在加载缓存命中率数据…', 'Loading cache hit rate data…'],
    'error.load': ['加载失败：{msg}', 'Failed to load: {msg}'],
    'error.script': ['界面脚本错误：{msg}', 'UI script error: {msg}'],
    'empty.noData': ['暂无数据', 'No data'],
    'time.justNow': ['刚刚', 'just now'],
    'time.secAgo': ['{n}s 前', '{n}s ago'],
    'time.minAgo': ['{n}m 前', '{n}m ago'],
    'time.hourAgo': ['{n}h 前', '{n}h ago'],
    'time.dayAgo': ['{n}d 前', '{n}d ago'],
    'status.none': ['无数据', 'No data'],
    'status.good': ['良好', 'Good'],
    'status.warn': ['一般', 'Fair'],
    'status.bad': ['偏低', 'Low'],
    'hero.primaryCause': ['主因：{label}', 'Cause: {label}'],
    'hero.turns': ['{n}轮', '{n} turns'],
    'hero.hit': ['命中', 'Hit'],
    'hero.miss': ['丢缓存', 'Miss loss'],
    'hero.structural': ['正常新增', 'New input'],
    'loss.ok': ['● 缓存正常，无异常丢缓存', '● Healthy — no abnormal misses'],
    'loss.okStruct': ['正常新增 {tokens}', 'New input {tokens}'],
    'loss.title': ['丢缓存主因', 'Cache Miss Causes'],
    'loss.sub': ['负值 = 拉低命中率', 'Negative = hit rate drop'],
    'loss.times': ['{n}次', '{n}x'],
    'loss.structItem': ['{label} {tokens} ({turns}轮)', '{label} {tokens} ({turns} turns)'],
    'loss.structLabel': ['正常新增（首轮+新消息，非故障）', 'New input (cold + new msgs)'],
    'loss.structValue': ['{tokens} · 占输入 {pct}', '{tokens} · {pct} prompt'],
    'chart.triHit': ['命中缓存 {tokens}', 'Cache hit {tokens}'],
    'chart.triAnomaly': ['异常丢缓存 {tokens}', 'Abnormal miss {tokens}'],
    'chart.triStructural': ['正常新增 {tokens}', 'New input {tokens}'],
    'chart.trendAria': ['命中率趋势', 'Hit rate trend'],
    'tl.all': ['全部', 'All'],
    'tl.rangeAll': ['全部 · {total}轮', 'All · {total} turns'],
    'tl.rangeSlice': ['{from}–{to} · {count}/{total}轮', '{from}–{to} · {count}/{total} turns'],
    'tl.zoomIn': ['放大时间轴', 'Zoom in timeline'],
    'tl.zoomOut': ['缩小时间轴', 'Zoom out timeline'],
    'tl.reset': ['重置范围与缩放', 'Reset range and zoom'],
    'tl.trackTip': ['拖拽框选时间段 · 滚轮缩放 · 双击重置', 'Drag to select · Scroll to zoom · Double-click to reset'],
    'matrix.gapTitle': ['两轮间隔 → 命中率', 'Turn Gap → Hit Rate'],
    'matrix.gapEmpty': ['暂无后续轮次', 'No follow-up turns'],
    'matrix.gapTip': ['{hits}中 / {misses}丢 · 丢缓存 {tokens}', '{hits} hit / {misses} miss · lost {tokens}'],
    'matrix.gapSub': ['{misses}丢/{total}', '{misses} miss/{total}'],
    'matrix.ctxTitle': ['上下文长度 → 命中率', 'Context Size → Hit Rate'],
    'matrix.ctxTip': ['{turns}轮 · 输入 {tokens}', '{turns} turns · prompt {tokens}'],
    'miss.empty': ['无异常丢缓存', 'No abnormal cache misses'],
    'session.empty': ['暂无活跃会话记录', 'No active session found'],
    'session.selectAria': ['切换会话', 'Select session'],
    'session.parentChip': ['主会话 ↗', 'Parent ↗'],
    'session.withSub': ['含子代理({count})', 'With sub ({count})'],
    'session.mainOnly': ['仅主', 'Main'],
    'session.emptyRange': ['该时间段无调用', 'No turns in selected range'],
    'session.resetRange': ['重置为全部', 'Reset to all'],
    'session.latestTurn': ['最新轮', 'Latest'],
    'session.main': ['主会话', 'Main'],
    'session.subCount': ['子代理({count})', 'Sub ({count})'],
    'session.peak': ['峰值 {tokens}', 'Peak {tokens}'],
    'session.sparkAria': ['逐轮命中率', 'Per-turn hit rate'],
    'session.sparkLeft': ['近 {count} 轮', 'Last {count} turns'],
    'session.sparkMid': ['圆点 = 0% 丢缓存', 'Dot = 0% miss'],
    'session.sparkRight': ['最新', 'Latest'],
    'session.trendTitle': ['逐轮趋势', 'Per-Turn Trend'],
    'session.trendAvg': ['均值 +{tokens}/轮', 'Avg +{tokens}/turn'],
    'session.noSubInRange': ['该时段无活跃子代理', 'No active subagents in range'],
    'window.roleSub': ['仅子代理', 'Subagents'],
    'window.avgTurns': ['均 {avg}轮/对话', 'Avg {avg} turns/chat'],
    'window.subagents': ['子代理', 'Subagents'],
    'window.footerCounts': ['{sessions}会话 / {agents}代理', '{sessions} chats / {agents} agents'],
    'window.chartAria': ['{mode}趋势', '{mode} trend'],
    'window.bucketTip': ['{label} · {rate} · {turns}轮(丢{misses}) · {tokens}', '{label} · {rate} · {turns} turns ({misses} miss) · {tokens}'],
    'window.clients': ['客户端', 'Clients'],
    'window.trend24h': ['24h 趋势', '24h Trend'],
    'window.trend30d': ['30d 趋势', '30d Trend'],
    'window.hoverHint': ['悬浮看明细', 'Hover for details'],
    'window.noSessions': ['无会话', 'No sessions'],
    'drill.events': ['丢缓存({count})', 'Misses ({count})'],
    'drill.matrices': ['分布', 'Breakdown'],
    'drill.models': ['模型', 'Models'],
    'drill.agents': ['子代理({count})', 'Subagents ({count})'],
    'drill.sourcesModels': ['来源/模型', 'Sources/Models'],
    'drill.sessions': ['会话', 'Sessions'],
    'row.turnsMiss': ['{turns}轮 · 丢{misses}次', '{turns} turns · {misses} miss'],
    'row.modelMeta': ['{turns}轮 · 丢{misses}次 · {tokens}', '{turns} turns · {misses} miss · {tokens}'],
    'row.sourceMeta': ['{sessions}会话 · 丢{misses}次', '{sessions} chats · {misses} miss'],
    'row.sessionMeta': ['{source} · {turns}轮(丢{misses})', '{source} · {turns} turns ({misses} miss)'],
    'badge.current': ['当前', 'Current'],
    'footer.init': ['初始化中…', 'Initializing…'],
    'footer.dedup': [' · 去重 {convs}会话/{steps}步', ' · dedup {convs} conv/{steps} steps'],
    'footer.meta': ['{nonEmpty}/{total} 数据源 · {convs} 对话{dedup}', '{nonEmpty}/{total} sources · {convs} chats{dedup}'],
    'footer.updated': ['更新 {time}', 'Updated {time}'],
  };

  const DICT = { 'zh-CN': {}, en: {} };
  for (const [k, [zh, en]] of Object.entries(ENTRIES)) {
    DICT['zh-CN'][k] = zh;
    DICT.en[k] = en;
  }

  const REASONS = {
    'zh-CN': {
      hot_prefix_bust: ['短间隔失效 (<1m)', '短间隔失效', '间隔 <1 分钟且同模型却 0 命中（工具/权限前缀变动或后端副本未命中）'],
      idle_ttl_expired: ['超时过期 (≥5m)', '超时过期', '两轮停顿超过约 5 分钟缓存有效期'],
      idle_warm_decay: ['提前回收 (1-5m)', '提前回收', '间隔 1–5 分钟期间缓存被服务端提前回收'],
      model_switch: ['切换模型/配置', '模型/配置', '中途切换模型或会话配置，原缓存无法复用'],
      stream_interrupt: ['中断重试', '中断重试', '连接报错中断或步骤回滚重发，导致已有缓存前缀失效'],
      partial_truncation: ['前缀部分失效', '部分失效', '仅命中部分旧前缀（可能由 /compact、上下文截断或前缀局部变动引起）'],
      cold_start: ['首轮发送', '首轮发送', '新会话或新子代理第 1 轮尚无历史缓存'],
      incremental_append: ['每轮新内容', '每轮新内容', '旧上下文已命中，本轮新发的消息与工具输出首次发送，不在缓存中'],
    },
    en: {
      hot_prefix_bust: ['Short-gap (<1m)', 'Short-gap', '0% hit within <1m on the same model (tool/permission prefix change or replica miss)'],
      idle_ttl_expired: ['TTL expired (≥5m)', 'TTL expired', 'Idle gap exceeded the ~5-minute cache TTL'],
      idle_warm_decay: ['Early evict (1-5m)', 'Early evict', 'Cache evicted by the server during a 1–5m idle gap'],
      model_switch: ['Model switch', 'Model switch', 'Model or session settings changed mid-session; prior cache cannot be reused'],
      stream_interrupt: ['Interrupt/retry', 'Interrupt/retry', 'Connection error or step rollback invalidated the cached prefix'],
      partial_truncation: ['Partial miss', 'Partial miss', 'Only part of the prior prefix hit (e.g. /compact, truncation, or mid-prefix edit)'],
      cold_start: ['First turn', 'First turn', 'Initial turn of a new session or subagent has no prior cache'],
      incremental_append: ['New turn input', 'New input', 'Prior context hit; new messages and tool outputs in this turn are uncached'],
    },
  };

  let activeLang = null;

  function normalizeLang(raw) {
    if (typeof raw !== 'string') return null;
    const s = raw.trim().toLowerCase();
    if (!s) return null;
    if (s.startsWith('zh')) return 'zh-CN';
    if (s.startsWith('en')) return 'en';
    return null;
  }

  function readQueryLang() {
    try {
      if (typeof location !== 'undefined' && location.search) {
        return normalizeLang(new URLSearchParams(location.search).get('lang'));
      }
    } catch {
      // Ignore malformed location search params.
    }
    return null;
  }

  function readStoredLang() {
    try {
      if (typeof localStorage !== 'undefined') {
        return normalizeLang(localStorage.getItem(STORAGE_KEY));
      }
    } catch {
      // Ignore storage access errors in restricted iframes.
    }
    return null;
  }

  function getLang() {
    if (activeLang) return activeLang;
    const fromUrl = readQueryLang();
    if (fromUrl) return fromUrl;
    const fromStorage = readStoredLang();
    if (fromStorage) return fromStorage;
    const navLang = typeof navigator !== 'undefined' && navigator.language ? String(navigator.language) : '';
    return /^zh/i.test(navLang) ? 'zh-CN' : 'en';
  }

  function syncDocumentLang(lang) {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = lang;
    }
  }

  function setLang(lang) {
    const next = normalizeLang(lang) || 'en';
    activeLang = next;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage write errors in restricted iframes.
    }
    syncDocumentLang(next);
    return next;
  }

  function toggleLang() {
    return setLang(getLang() === 'zh-CN' ? 'en' : 'zh-CN');
  }

  function t(key, vars) {
    const table = DICT[getLang()] || DICT.en;
    let str = Object.prototype.hasOwnProperty.call(table, key)
      ? table[key]
      : Object.prototype.hasOwnProperty.call(DICT.en, key)
        ? DICT.en[key]
        : String(key);
    if (vars && typeof vars === 'object') {
      str = str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
    }
    return str;
  }

  function reasonEntry(reasonKey) {
    const table = REASONS[getLang()] || REASONS.en;
    return table[reasonKey] || REASONS.en[reasonKey] || null;
  }

  function reasonLabel(reasonKey, short = false) {
    const entry = reasonEntry(reasonKey);
    if (!entry) return String(reasonKey || '');
    return short ? entry[1] : entry[0];
  }

  function reasonHint(reasonKey) {
    const entry = reasonEntry(reasonKey);
    return entry ? entry[2] : '';
  }

  function applyStaticTranslations(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    syncDocumentLang(getLang());
    if (!scope || typeof scope.querySelectorAll !== 'function') return;
    for (const el of scope.querySelectorAll('[data-i18n]')) {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    }
    for (const el of scope.querySelectorAll('[data-i18n-title]')) {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        const val = t(key);
        el.title = val;
        if (typeof el.setAttribute === 'function') el.setAttribute('title', val);
      }
    }
    for (const el of scope.querySelectorAll('[data-i18n-aria]')) {
      const key = el.getAttribute('data-i18n-aria');
      if (key && typeof el.setAttribute === 'function') el.setAttribute('aria-label', t(key));
    }
  }

  syncDocumentLang(getLang());

  CR.i18n = {
    SUPPORTED_LANGS,
    DICT,
    normalizeLang,
    getLang,
    setLang,
    toggleLang,
    t,
    reasonLabel,
    reasonHint,
    applyStaticTranslations,
  };
})();
