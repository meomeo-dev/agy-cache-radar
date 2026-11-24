(() => {
  const CR = (window.CacheRadar = window.CacheRadar || {});
  const { esc, fmtGap, fmtPct, fmtTokens, rateTone, shortModel, toneColor } = CR.fmt;
  const { reasonLabel, t } = CR.i18n;
  const { renderBarChart } = CR.charts;
  const { renderTimelineCard } = CR.timeline;
  const { renderHeroCard, renderLossCard, renderMissEventsBody, renderTileMatrix } = CR.diag;

  function renderProgressRows(rows, emptyText) {
    if (!rows || rows.length === 0) {
      return `<div class="empty-box" style="padding:10px 0">${esc(emptyText)}</div>`;
    }
    return `<div class="list">${rows
      .map((r) => {
        const tone = rateTone(r.rate);
        const pctWidth = r.rate === null ? 0 : Math.max(2, Math.round(r.rate * 100));
        const attrs = r.clickConvId ? ` data-focus-conv="${esc(r.clickConvId)}"` : '';
        const cls = r.clickConvId ? 'list-row clickable' : 'list-row';
        const badge = r.badge ? `<span class="badge${r.badgeLive ? ' live' : ''}">${esc(r.badge)}</span>` : '';
        return `<div class="${cls}"${attrs}>
          <div class="row-main">
            <div class="row-title">${badge}<span>${esc(r.title)}</span></div>
            <div class="row-meta">${esc(r.meta)}</div>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${pctWidth}%;background:${toneColor(tone)}"></div></div>
          <div class="row-rate rate-${tone}">${esc(fmtPct(r.rate))}</div>
        </div>`;
      })
      .join('')}</div>`;
  }

  function renderDrilldownCard(activeDrill, tabs) {
    const validKey = tabs.some((tab) => tab.key === activeDrill) ? activeDrill : tabs[0].key;
    const current = tabs.find((tab) => tab.key === validKey) || tabs[0];
    const nav = tabs
      .map((tab) => `<button type="button" class="subtab${tab.key === validKey ? ' active' : ''}" data-drill="${esc(tab.key)}">${esc(tab.label)}</button>`)
      .join('');
    return `
      <div class="card">
        <div class="subtabs" role="tablist">${nav}</div>
        <div class="drill-body">${current.html}</div>
      </div>
    `;
  }

  function renderSessionTab(snap, uiState) {
    const s = snap.activeSession;
    if (!s || !s.found) {
      return `<div class="empty-box">${esc(t('session.empty'))}</div>`;
    }

    const hasDesc = s.descendantCount > 0;
    const useTree = hasDesc && uiState.includeSubagents;
    const metrics = useTree ? s.tree : s.self;
    const diag = metrics.diagnostics || {};
    const latest = useTree ? s.latestTurnTree : s.latestTurnSelf;
    const series = useTree ? s.turnSeriesTree : s.turnSeriesSelf;
    const ticks = useTree ? s.timeline?.ticksTree || [] : s.timeline?.ticksSelf || [];
    const isRangeFiltered = Boolean(s.timeRange?.isFiltered);
    const activeDesc = isRangeFiltered ? s.activeDescendantCount ?? s.descendants.length : s.descendantCount;
    const descBadge = isRangeFiltered ? `${activeDesc}/${s.descendantCount}` : String(s.descendantCount);

    const sessionOptions = (s.recentSessions || [])
      .map((item) => {
        const liveMark = item.isLive ? '● ' : '';
        const subTag = item.descendantCount > 0 ? ` (+${item.descendantCount})` : '';
        const selected = item.conversationId === s.conversationId ? ' selected' : '';
        return `<option value="${esc(item.conversationId)}"${selected}>${esc(liveMark + item.title + subTag)} · ${esc(fmtPct(item.cacheHitRate))}</option>`;
      })
      .join('');

    const missingInDropdown = !(s.recentSessions || []).some((r) => r.conversationId === s.conversationId);
    const currentOpt = missingInDropdown
      ? `<option value="${esc(s.conversationId)}" selected>${esc(s.title)}</option>`
      : '';

    const parentChip = s.parentRoot
      ? `<button type="button" class="link-chip" data-focus-conv="${esc(s.parentRoot.conversationId)}">${esc(t('session.parentChip'))}</button>`
      : '';

    const subToggle = hasDesc
      ? `<div class="pill-group">
          <button type="button" class="pill${useTree ? ' active' : ''}" data-sub-mode="tree">${esc(t('session.withSub', { count: descBadge }))}</button>
          <button type="button" class="pill${!useTree ? ' active' : ''}" data-sub-mode="self">${esc(t('session.mainOnly'))}</button>
        </div>`
      : '';

    const toolbarHtml = `<div class="toolbar-row">
      <select class="session-select" id="session-select" aria-label="${esc(t('session.selectAria'))}">${currentOpt}${sessionOptions}</select>
      ${parentChip}${subToggle}
    </div>`;
    const timelineHtml = renderTimelineCard(ticks, uiState.tl);

    if (isRangeFiltered && metrics.turns === 0) {
      return `${toolbarHtml}${timelineHtml}
        <div class="card empty-range">
          <span>${esc(t('session.emptyRange'))}</span>
          <button type="button" class="link-chip" data-tl-zoom="reset">${esc(t('session.resetRange'))}</button>
        </div>`;
    }

    const latestPart = latest
      ? `${esc(t('session.latestTurn'))} <strong class="rate-${rateTone(latest.cacheHitRate)}">${esc(fmtPct(latest.cacheHitRate))}</strong>`
      : '';
    const footerHtml = hasDesc
      ? `<span>${esc(t('session.main'))} <strong>${esc(fmtPct(s.self.cacheHitRate))}</strong> · ${esc(t('session.subCount', { count: activeDesc }))} <strong>${esc(fmtPct(s.subagents.cacheHitRate))}</strong></span><span>${latestPart}</span>`
      : `<span>${esc(s.sourceLabel)} · ${esc(t('session.peak', { tokens: fmtTokens(diag.maxPromptTokens) }))}</span><span>${latestPart}</span>`;

    const sparkline = renderBarChart(series, {
      ariaLabel: t('session.sparkAria'),
      axisLabels: [t('session.sparkLeft', { count: series.length }), t('session.sparkMid'), t('session.sparkRight')],
      tooltip: (pt, i) => {
        const rTag = pt.reason && pt.cacheHitRate === 0 ? ` [${reasonLabel(pt.reason, true)}]` : '';
        return `#${pt.stepIndex >= 0 ? pt.stepIndex : i + 1}${pt.agent ? ` [${pt.agent}]` : ''} · ${fmtPct(pt.cacheHitRate)}${rTag} · ${fmtGap(pt.gapSec)} · ${shortModel(pt.model)}`;
      },
    });

    const childRows = s.descendants.slice(0, 10).map((d) => ({
      title: d.title,
      badge: d.kind === 'swarm_worker' ? 'Swarm' : 'Sub',
      badgeLive: d.isLive,
      meta: t('row.turnsMiss', { turns: d.turns, misses: d.warmMissTurns || 0 }),
      rate: d.cacheHitRate,
      clickConvId: d.conversationId,
    }));

    const modelRows = metrics.models.map((m) => ({
      title: shortModel(m.model),
      meta: t('row.modelMeta', { turns: m.turns, misses: m.warmMissTurns || 0, tokens: fmtTokens(m.totalPromptTokens) }),
      rate: m.cacheHitRate,
    }));

    const drillTabs = [
      { key: 'events', label: t('drill.events', { count: diag.missEvents?.length || 0 }), html: renderMissEventsBody(diag) },
      { key: 'matrices', label: t('drill.matrices'), html: renderTileMatrix(diag) },
      { key: 'models', label: t('drill.models'), html: renderProgressRows(modelRows, t('empty.noData')) },
    ];
    if (hasDesc) {
      drillTabs.push({ key: 'agents', label: t('drill.agents', { count: activeDesc }), html: renderProgressRows(childRows, t('session.noSubInRange')) });
    }

    return `
      ${toolbarHtml}
      ${timelineHtml}
      ${renderHeroCard(metrics, diag, { footerHtml })}
      ${renderLossCard(diag)}
      <div class="card">
        <div class="section-head"><span>${esc(t('session.trendTitle'))}</span><span class="section-sub">${esc(t('session.trendAvg', { tokens: fmtTokens(diag.avgNewDeltaTokens) }))}</span></div>
        ${sparkline}
      </div>
      ${renderDrilldownCard(uiState.drillSession, drillTabs)}
    `;
  }

  function renderWindowTab(windowData, modeLabel, isHourly, uiState, drillKey) {
    const windowRole = uiState.windowRole;
    const slice =
      windowRole === 'main'
        ? windowData.mainOnly
        : windowRole === 'subagents'
          ? windowData.subagentsOnly
          : windowData.all;

    const diag = slice.diagnostics || {};
    const buckets = slice.buckets || [];
    const axisLabels =
      buckets.length > 0
        ? [buckets[0].label, buckets[Math.floor(buckets.length / 2)].label, buckets[buckets.length - 1].label]
        : [];

    const chart = renderBarChart(buckets, {
      ariaLabel: t('window.chartAria', { mode: modeLabel }),
      axisLabels,
      tooltip: (b) => t('window.bucketTip', {
        label: b.label,
        rate: fmtPct(b.cacheHitRate),
        turns: b.turns,
        misses: b.missTurns || 0,
        tokens: fmtTokens(b.totalPromptTokens),
      }),
    });

    const sourceRows = (slice.sources || []).map((src) => ({
      title: src.label,
      badge: src.isCurrent ? t('badge.current') : src.surface.toUpperCase(),
      badgeLive: src.isCurrent,
      meta: t('row.sourceMeta', { sessions: src.sessions, misses: src.warmMissTurns || 0 }),
      rate: src.cacheHitRate,
    }));

    const modelRows = (slice.models || []).slice(0, 6).map((m) => ({
      title: shortModel(m.model),
      meta: t('row.modelMeta', { turns: m.turns, misses: m.warmMissTurns || 0, tokens: fmtTokens(m.totalPromptTokens) }),
      rate: m.cacheHitRate,
    }));

    const topRows = (slice.topSessions || []).slice(0, 6).map((s) => ({
      title: s.subagentCount > 0 ? `${s.title} (+${s.subagentCount})` : s.title,
      badge: s.isLive ? 'LIVE' : '',
      badgeLive: s.isLive,
      meta: t('row.sessionMeta', { source: s.sourceLabel, turns: s.turns, misses: s.warmMissTurns || 0 }),
      rate: s.cacheHitRate,
      clickConvId: s.conversationId,
    }));

    const modelsAndSourcesHtml =
      (sourceRows.length > 1
        ? `<div class="sub-label">${esc(t('window.clients'))}</div>${renderProgressRows(sourceRows, t('empty.noData'))}<div class="sub-label" style="margin-top:8px">${esc(t('drill.models'))}</div>`
        : '') + renderProgressRows(modelRows, t('empty.noData'));

    const footerHtml = `<span>${esc(t('session.main'))} <strong>${esc(fmtPct(windowData.mainOnly.cacheHitRate))}</strong> · ${esc(t('window.subagents'))} <strong>${esc(fmtPct(windowData.subagentsOnly.cacheHitRate))}</strong></span><span>${esc(t('window.footerCounts', { sessions: slice.rootSessionCount, agents: slice.conversationCount }))}</span>`;

    const drillTabs = [
      { key: 'models', label: t('drill.sourcesModels'), html: modelsAndSourcesHtml },
      { key: 'matrices', label: t('drill.matrices'), html: renderTileMatrix(diag) },
      { key: 'events', label: t('drill.events', { count: diag.missEvents?.length || 0 }), html: renderMissEventsBody(diag) },
      { key: 'sessions', label: t('drill.sessions'), html: renderProgressRows(topRows, t('window.noSessions')) },
    ];

    return `
      <div class="toolbar-row">
        <div class="pill-group">
          <button type="button" class="pill${windowRole === 'all' ? ' active' : ''}" data-win-role="all">${esc(t('tl.all'))}</button>
          <button type="button" class="pill${windowRole === 'main' ? ' active' : ''}" data-win-role="main">${esc(t('session.mainOnly'))}</button>
          <button type="button" class="pill${windowRole === 'subagents' ? ' active' : ''}" data-win-role="subagents">${esc(t('window.roleSub'))}</button>
        </div>
        <span class="section-sub">${esc(t('window.avgTurns', { avg: diag.avgTurnsPerAgent || 0 }))}</span>
      </div>
      ${renderHeroCard(slice, diag, { footerHtml })}
      ${renderLossCard(diag)}
      <div class="card">
        <div class="section-head"><span>${esc(isHourly ? t('window.trend24h') : t('window.trend30d'))}</span><span class="section-sub">${esc(t('window.hoverHint'))}</span></div>
        ${chart}
      </div>
      ${renderDrilldownCard(drillKey, drillTabs)}
    `;
  }

  CR.views = { renderProgressRows, renderSessionTab, renderWindowTab };
})();
