(() => {
  const CR = (window.CacheRadar = window.CacheRadar || {});
  const { esc, fmtPct, fmtRelTime, rateTone, syncHostTheme } = CR.fmt;
  const { applyStaticTranslations, t, toggleLang } = CR.i18n;
  const { renderSessionTab, renderWindowTab } = CR.views;
  const { applyPreset, bindTimelineInteractions, resetTimelineState, zoomTimeline } = CR.timeline;

  const POLL_MS = 2500;
  const REQUEST_TIMEOUT_MS = 10000;
  const params = new URLSearchParams(location.search);

  const state = {
    tab: ['session', '24h', '30d'].includes(params.get('tab')) ? params.get('tab') : 'session',
    sourceFilter: params.get('source') || 'all',
    selectedConvId: params.get('conversationId') || '',
    lastHostConvId: '',
    includeSubagents: true,
    windowRole: 'all',
    drillSession: 'events',
    drill24h: 'models',
    drill30d: 'models',
    tl: { preset: 'all', from: null, to: null, viewStart: null, viewEnd: null, isDragging: false },
    etag: '',
    snapshot: null,
    lastError: '',
    timer: null,
  };

  const $ = (id) => document.getElementById(id);
  window.__CR_BOOTED = true;

  function currentTicks() {
    const s = state.snapshot?.activeSession;
    if (!s || !s.found || !s.timeline) return [];
    return s.descendantCount > 0 && state.includeSubagents ? s.timeline.ticksTree || [] : s.timeline.ticksSelf || [];
  }

  function hostConversationId() {
    return window.sidecar?.conversationId || params.get('conversationId') || '';
  }

  async function fetchWithTimeout(fetcher, url) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const tid = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const res = await fetcher(url, { method: 'GET', signal: ctrl?.signal });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return await res.json();
    } finally {
      if (tid) clearTimeout(tid);
    }
  }

  async function fetchJson(url) {
    if (window.sidecar?.fetch) {
      try {
        return await fetchWithTimeout(window.sidecar.fetch.bind(window.sidecar), url);
      } catch (primaryErr) {
        try {
          return await fetchWithTimeout(fetch, url);
        } catch {
          throw primaryErr;
        }
      }
    }
    return fetchWithTimeout(fetch, url);
  }

  function syncSourceSelector(sources) {
    const select = $('source-select');
    const nonEmpty = sources.filter((s) => s.transcriptCount > 0);
    const hasCurrent = sources.some((s) => s.isCurrent);
    const options = [`<option value="all">${esc(t('source.all', { count: nonEmpty.length }))}</option>`];
    if (hasCurrent) options.push(`<option value="current">${esc(t('source.currentOnly'))}</option>`);
    for (const src of nonEmpty) {
      const tag = src.isCurrent ? ' ★' : '';
      options.push(`<option value="${esc(src.id)}">${esc(src.label + tag)} (${src.transcriptCount})</option>`);
    }
    const html = options.join('');
    if (select.dataset.rendered !== html) {
      select.innerHTML = html;
      select.dataset.rendered = html;
    }
    select.value = state.sourceFilter;
    if (select.value !== state.sourceFilter) {
      state.sourceFilter = 'all';
      select.value = 'all';
    }
  }

  function updateTabChrome(snap) {
    const sessionRate =
      snap.activeSession?.found
        ? snap.activeSession.descendantCount > 0 && state.includeSubagents
          ? snap.activeSession.tree.cacheHitRate
          : snap.activeSession.self.cacheHitRate
        : null;

    const setBadge = (id, rate) => {
      const el = $(id);
      el.textContent = fmtPct(rate);
      el.className = `tab-rate rate-${rateTone(rate)}`;
    };
    setBadge('tab-rate-session', sessionRate);
    setBadge('tab-rate-24h', snap.last24h?.all?.cacheHitRate ?? null);
    setBadge('tab-rate-30d', snap.last30d?.all?.cacheHitRate ?? null);

    for (const btn of document.querySelectorAll('.tab')) {
      const active = btn.dataset.tab === state.tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    for (const id of ['session', '24h', '30d']) {
      $(`panel-${id}`).classList.toggle('active', state.tab === id);
    }
    $('live-dot').classList.toggle('live', Boolean(snap.activeSession?.isLive));
  }

  function render() {
    const snap = state.snapshot;
    if (!snap) return;

    state.lastError = '';
    $('loading-box').style.display = 'none';
    syncSourceSelector(snap.sources || []);
    updateTabChrome(snap);

    $('panel-session').innerHTML = renderSessionTab(snap, state);
    $('panel-24h').innerHTML = renderWindowTab(snap.last24h, t('tab.24h'), true, state, state.drill24h);
    $('panel-30d').innerHTML = renderWindowTab(snap.last30d, t('tab.30d'), false, state, state.drill30d);

    const d = snap.diagnostics || {};
    const dedupInfo =
      d.dedupedConversations || d.dedupedForkSteps
        ? t('footer.dedup', { convs: d.dedupedConversations, steps: d.dedupedForkSteps })
        : '';
    $('footer-meta').textContent = t('footer.meta', {
      nonEmpty: d.nonEmptySources ?? 0,
      total: d.totalSources ?? 0,
      convs: d.totalConversations ?? 0,
      dedup: dedupInfo,
    });
    $('footer-updated').textContent = t('footer.updated', { time: fmtRelTime(snap.generatedAt) });
  }

  async function poll(force = false) {
    const hostConv = hostConversationId();
    if (hostConv && hostConv !== state.lastHostConvId) {
      state.lastHostConvId = hostConv;
      if (!state.selectedConvId) resetTimelineState(state.tl);
      state.etag = '';
    }
    const convId = state.selectedConvId || hostConv;
    const qs = new URLSearchParams({
      source: state.sourceFilter,
      tzOffset: String(new Date().getTimezoneOffset()),
    });
    if (convId) qs.set('conversationId', convId);
    if (state.tl.from !== null) qs.set('sessionFrom', String(state.tl.from));
    if (state.tl.to !== null) qs.set('sessionTo', String(state.tl.to));
    if (!force && state.etag) qs.set('etag', state.etag);
    if (force) qs.set('force', '1');

    try {
      const data = await fetchJson(`/api/stats?${qs.toString()}`);
      if (data.unchanged) {
        if (state.snapshot) {
          state.snapshot.generatedAt = data.generatedAt || Date.now();
          $('footer-updated').textContent = t('footer.updated', { time: fmtRelTime(state.snapshot.generatedAt) });
        }
        return;
      }
      state.etag = data.etag || '';
      state.snapshot = data;
      if (!state.tl.isDragging) render();
    } catch (err) {
      state.lastError = err?.message || String(err);
      $('loading-box').textContent = t('error.load', { msg: state.lastError });
      $('loading-box').style.display = 'block';
    }
  }

  function bindEvents() {
    for (const btn of document.querySelectorAll('.tab')) {
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab;
        render();
      });
    }

    $('source-select').addEventListener('change', (e) => {
      state.sourceFilter = e.target.value;
      resetTimelineState(state.tl);
      state.etag = '';
      poll(true);
    });

    $('lang-btn')?.addEventListener('click', () => {
      toggleLang();
      applyStaticTranslations();
      if (state.snapshot) render();
      else if (state.lastError) $('loading-box').textContent = t('error.load', { msg: state.lastError });
    });

    $('refresh-btn').addEventListener('click', () => {
      state.etag = '';
      poll(true);
    });

    $('content').addEventListener('click', (e) => {
      const presetBtn = e.target.closest('[data-tl-preset]');
      if (presetBtn) {
        applyPreset(presetBtn.dataset.tlPreset, currentTicks(), state.tl);
        state.etag = '';
        poll(true);
        return;
      }
      const zoomBtn = e.target.closest('[data-tl-zoom]');
      if (zoomBtn) {
        const mode = zoomBtn.dataset.tlZoom;
        zoomTimeline(mode, currentTicks(), state.tl);
        if (mode === 'reset') {
          state.etag = '';
          poll(true);
        } else {
          render();
        }
        return;
      }
      const drillBtn = e.target.closest('[data-drill]');
      if (drillBtn) {
        const key = drillBtn.dataset.drill;
        if (state.tab === 'session') state.drillSession = key;
        else if (state.tab === '24h') state.drill24h = key;
        else state.drill30d = key;
        render();
        return;
      }
      const subBtn = e.target.closest('[data-sub-mode]');
      if (subBtn) {
        state.includeSubagents = subBtn.dataset.subMode === 'tree';
        render();
        return;
      }
      const roleBtn = e.target.closest('[data-win-role]');
      if (roleBtn) {
        state.windowRole = roleBtn.dataset.winRole;
        render();
        return;
      }
      const focusEl = e.target.closest('[data-focus-conv]');
      if (focusEl) {
        state.selectedConvId = focusEl.dataset.focusConv;
        resetTimelineState(state.tl);
        state.tab = 'session';
        state.etag = '';
        poll(true);
      }
    });

    $('content').addEventListener('change', (e) => {
      if (e.target.id === 'session-select') {
        state.selectedConvId = e.target.value;
        resetTimelineState(state.tl);
        state.etag = '';
        poll(true);
      }
    });

    bindTimelineInteractions(
      $('content'),
      () => ({ ticks: currentTicks(), tlState: state.tl }),
      (refetch) => {
        if (refetch) {
          state.etag = '';
          poll(true);
        } else {
          render();
        }
      }
    );
  }

  applyStaticTranslations();
  syncHostTheme();
  new MutationObserver(syncHostTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
  });

  bindEvents();
  poll(true);
  state.timer = setInterval(() => poll(false), POLL_MS);
})();
