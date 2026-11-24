(() => {
  const CR = (window.CacheRadar = window.CacheRadar || {});
  const { esc, fmtGap, fmtPct, fmtTokens, rateTone, shortModel, toneColor } = CR.fmt;
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
    const validKey = tabs.some((t) => t.key === activeDrill) ? activeDrill : tabs[0].key;
    const current = tabs.find((t) => t.key === validKey) || tabs[0];
    const nav = tabs
      .map((t) => `<button type="button" class="subtab${t.key === validKey ? ' active' : ''}" data-drill="${esc(t.key)}">${esc(t.label)}</button>`)
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
      return '<div class="empty-box">暂无活跃会话记录</div>';
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
      ? `<button type="button" class="link-chip" data-focus-conv="${esc(s.parentRoot.conversationId)}">主会话 ↗</button>`
      : '';

    const subToggle = hasDesc
      ? `<div class="pill-group">
          <button type="button" class="pill${useTree ? ' active' : ''}" data-sub-mode="tree">含子代理(${descBadge})</button>
          <button type="button" class="pill${!useTree ? ' active' : ''}" data-sub-mode="self">仅主</button>
        </div>`
      : '';

    const toolbarHtml = `<div class="toolbar-row">
      <select class="session-select" id="session-select" aria-label="切换会话">${currentOpt}${sessionOptions}</select>
      ${parentChip}${subToggle}
    </div>`;
    const timelineHtml = renderTimelineCard(ticks, uiState.tl);

    if (isRangeFiltered && metrics.turns === 0) {
      return `${toolbarHtml}${timelineHtml}
        <div class="card empty-range">
          <span>该时间段无调用</span>
          <button type="button" class="link-chip" data-tl-zoom="reset">重置为全部</button>
        </div>`;
    }

    const latestPart = latest
      ? `最新轮 <strong class="rate-${rateTone(latest.cacheHitRate)}">${esc(fmtPct(latest.cacheHitRate))}</strong>`
      : '';
    const footerHtml = hasDesc
      ? `<span>主会话 <strong>${esc(fmtPct(s.self.cacheHitRate))}</strong> · 子代理(${activeDesc}) <strong>${esc(fmtPct(s.subagents.cacheHitRate))}</strong></span><span>${latestPart}</span>`
      : `<span>${esc(s.sourceLabel)} · 峰值 ${esc(fmtTokens(diag.maxPromptTokens))}</span><span>${latestPart}</span>`;

    const sparkline = renderBarChart(series, {
      ariaLabel: '逐轮命中率',
      axisLabels: [`近 ${series.length} 轮`, '圆点 = 0% 丢缓存', '最新'],
      tooltip: (t, i) =>
        `#${t.stepIndex >= 0 ? t.stepIndex : i + 1}${t.agent ? ` [${t.agent}]` : ''} · ${fmtPct(t.cacheHitRate)}${t.reasonLabel && t.cacheHitRate === 0 ? ` [${t.reasonLabel}]` : ''} · ${fmtGap(t.gapSec)} · ${shortModel(t.model)}`,
    });

    const childRows = s.descendants.slice(0, 10).map((d) => ({
      title: d.title,
      badge: d.kind === 'swarm_worker' ? 'Swarm' : 'Sub',
      badgeLive: d.isLive,
      meta: `${d.turns}轮 · 丢${d.warmMissTurns || 0}次`,
      rate: d.cacheHitRate,
      clickConvId: d.conversationId,
    }));

    const modelRows = metrics.models.map((m) => ({
      title: shortModel(m.model),
      meta: `${m.turns}轮 · 丢${m.warmMissTurns || 0}次 · ${fmtTokens(m.totalPromptTokens)}`,
      rate: m.cacheHitRate,
    }));

    const drillTabs = [
      { key: 'events', label: `丢缓存(${diag.missEvents?.length || 0})`, html: renderMissEventsBody(diag) },
      { key: 'matrices', label: '分布', html: renderTileMatrix(diag) },
      { key: 'models', label: '模型', html: renderProgressRows(modelRows, '无数据') },
    ];
    if (hasDesc) {
      drillTabs.push({ key: 'agents', label: `子代理(${activeDesc})`, html: renderProgressRows(childRows, '该时段无活跃子代理') });
    }

    return `
      ${toolbarHtml}
      ${timelineHtml}
      ${renderHeroCard(metrics, diag, { footerHtml })}
      ${renderLossCard(diag)}
      <div class="card">
        <div class="section-head"><span>逐轮趋势</span><span class="section-sub">均值 +${esc(fmtTokens(diag.avgNewDeltaTokens))}/轮</span></div>
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
      ariaLabel: `${modeLabel}趋势`,
      axisLabels,
      tooltip: (b) => `${b.label} · ${fmtPct(b.cacheHitRate)} · ${b.turns}轮(丢${b.missTurns || 0}) · ${fmtTokens(b.totalPromptTokens)}`,
    });

    const sourceRows = (slice.sources || []).map((src) => ({
      title: src.label,
      badge: src.isCurrent ? '当前' : src.surface.toUpperCase(),
      badgeLive: src.isCurrent,
      meta: `${src.sessions}会话 · 丢${src.warmMissTurns || 0}次`,
      rate: src.cacheHitRate,
    }));

    const modelRows = (slice.models || []).slice(0, 6).map((m) => ({
      title: shortModel(m.model),
      meta: `${m.turns}轮 · 丢${m.warmMissTurns || 0}次 · ${fmtTokens(m.totalPromptTokens)}`,
      rate: m.cacheHitRate,
    }));

    const topRows = (slice.topSessions || []).slice(0, 6).map((s) => ({
      title: s.subagentCount > 0 ? `${s.title} (+${s.subagentCount})` : s.title,
      badge: s.isLive ? 'LIVE' : '',
      badgeLive: s.isLive,
      meta: `${s.sourceLabel} · ${s.turns}轮(丢${s.warmMissTurns || 0})`,
      rate: s.cacheHitRate,
      clickConvId: s.conversationId,
    }));

    const modelsAndSourcesHtml =
      (sourceRows.length > 1
        ? `<div class="sub-label">客户端</div>${renderProgressRows(sourceRows, '无数据')}<div class="sub-label" style="margin-top:8px">模型</div>`
        : '') + renderProgressRows(modelRows, '无数据');

    const footerHtml = `<span>主会话 <strong>${esc(fmtPct(windowData.mainOnly.cacheHitRate))}</strong> · 子代理 <strong>${esc(fmtPct(windowData.subagentsOnly.cacheHitRate))}</strong></span><span>${slice.rootSessionCount}会话 / ${slice.conversationCount}代理</span>`;

    const drillTabs = [
      { key: 'models', label: '来源/模型', html: modelsAndSourcesHtml },
      { key: 'matrices', label: '分布', html: renderTileMatrix(diag) },
      { key: 'events', label: `丢缓存(${diag.missEvents?.length || 0})`, html: renderMissEventsBody(diag) },
      { key: 'sessions', label: '会话', html: renderProgressRows(topRows, '无会话') },
    ];

    return `
      <div class="toolbar-row">
        <div class="pill-group">
          <button type="button" class="pill${windowRole === 'all' ? ' active' : ''}" data-win-role="all">全部</button>
          <button type="button" class="pill${windowRole === 'main' ? ' active' : ''}" data-win-role="main">仅主</button>
          <button type="button" class="pill${windowRole === 'subagents' ? ' active' : ''}" data-win-role="subagents">仅子代理</button>
        </div>
        <span class="section-sub">均 ${diag.avgTurnsPerAgent || 0}轮/对话</span>
      </div>
      ${renderHeroCard(slice, diag, { footerHtml })}
      ${renderLossCard(diag)}
      <div class="card">
        <div class="section-head"><span>${isHourly ? '24h 趋势' : '30d 趋势'}</span><span class="section-sub">悬浮看明细</span></div>
        ${chart}
      </div>
      ${renderDrilldownCard(drillKey, drillTabs)}
    `;
  }

  CR.views = { renderProgressRows, renderSessionTab, renderWindowTab };
})();
