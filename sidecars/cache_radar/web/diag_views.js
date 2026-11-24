(() => {
  const CR = (window.CacheRadar = window.CacheRadar || {});
  const { esc, fmtGap, fmtPct, fmtRelTime, fmtTokens, rateTone, shortModel, toneColor } = CR.fmt;
  const { renderTriBar } = CR.charts;

  function statusPill(rate, anomShare) {
    if (rate === null || rate === undefined) return { text: '无数据', cls: 'st-none' };
    if (anomShare <= 0.03 || rate >= 0.85) return { text: '良好', cls: 'st-good' };
    if (rate >= 0.6) return { text: '一般', cls: 'st-warn' };
    return { text: '偏低', cls: 'st-bad' };
  }

  function renderHeroCard(metrics, diag, options = {}) {
    const rate = metrics.cacheHitRate;
    const tone = rateTone(rate);
    const st = statusPill(rate, diag.anomalyShareOfPrompt || 0);
    const primaryBadge = diag.primaryCause
      ? `<span class="cause-pill" title="${esc(diag.primaryCause.label)}">主因：${esc(diag.primaryCause.label)}</span>`
      : '';

    const footerHtml = options.footerHtml ? `<div class="split-strip">${options.footerHtml}</div>` : '';

    return `
      <div class="card hero-card">
        <div class="hero-top">
          <div class="hero-left">
            <span class="hero-num rate-${tone}">${esc(fmtPct(rate))}</span>
            <span class="status-pill ${st.cls}">${st.text}</span>
            ${primaryBadge}
          </div>
          <div class="hero-right">
            <span>${esc(fmtTokens(metrics.cacheReadTokens))} / ${esc(fmtTokens(metrics.totalPromptTokens))}</span>
            <span>${metrics.turns}轮</span>
          </div>
        </div>

        ${renderTriBar(metrics, diag)}

        <div class="tri-summary">
          <div class="tri-col">
            <span class="tri-label"><i class="dot" style="background:var(--cr-good)"></i>命中</span>
            <span class="tri-val rate-good">${esc(fmtTokens(metrics.cacheReadTokens))}</span>
          </div>
          <div class="tri-col">
            <span class="tri-label"><i class="dot" style="background:var(--cr-bad)"></i>丢缓存</span>
            <span class="tri-val ${diag.anomalyTokens > 0 ? 'rate-bad' : ''}">${esc(fmtTokens(diag.anomalyTokens || 0))} <small>-${esc(fmtPct(diag.anomalyShareOfPrompt || 0))}</small></span>
          </div>
          <div class="tri-col">
            <span class="tri-label"><i class="dot" style="background:var(--cr-struct)"></i>正常新增</span>
            <span class="tri-val">${esc(fmtTokens(diag.structuralTokens || 0))} <small>${esc(fmtPct(diag.structuralShareOfPrompt || 0))}</small></span>
          </div>
        </div>
        ${footerHtml}
      </div>
    `;
  }

  function renderLossCard(diag) {
    const anomalies = (diag?.attribution || []).filter((a) => a.category === 'anomaly');
    const structurals = (diag?.attribution || []).filter((a) => a.category === 'structural');
    const structTooltip = structurals.map((s) => `${s.label} ${fmtTokens(s.tokens)} (${s.turns}轮)`).join(' + ');

    if (anomalies.length === 0) {
      return `
        <div class="card compact-ok">
          <span class="rate-good">● 缓存正常，无异常丢缓存</span>
          <span class="section-sub" title="${esc(structTooltip)}">正常新增 ${esc(fmtTokens(diag?.structuralTokens || 0))}</span>
        </div>
      `;
    }

    const maxTok = Math.max(...anomalies.map((a) => a.tokens), 1);
    const rows = anomalies
      .slice(0, 5)
      .map((a) => {
        const barW = Math.max(6, Math.round((a.tokens / maxTok) * 100));
        return `<div class="loss-row" title="${esc(a.hint)}">
          <span class="loss-name"><i class="dot" style="background:${toneColor(a.color)}"></i>${esc(a.label)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${barW}%;background:${toneColor(a.color)}"></div></div>
          <span class="loss-tok">${esc(fmtTokens(a.tokens))} <small>${a.turns}次</small></span>
          <span class="loss-drop rate-bad">-${esc(fmtPct(a.shareOfPrompt))}</span>
        </div>`;
      })
      .join('');

    return `
      <div class="card">
        <div class="section-head">
          <span>丢缓存主因</span>
          <span class="section-sub">负值 = 拉低命中率</span>
        </div>
        <div class="loss-list">${rows}</div>
        <div class="struct-foot" title="${esc(structTooltip)}">
          <span>正常新增（首轮+新消息，非故障）</span>
          <span>${esc(fmtTokens(diag.structuralTokens || 0))} · 占输入 ${esc(fmtPct(diag.structuralShareOfPrompt || 0))}</span>
        </div>
      </div>
    `;
  }

  function renderTileMatrix(diag) {
    const gaps = (diag?.gapBuckets || []).filter((g) => g.total > 0);
    const ctxs = (diag?.contextBuckets || []).filter((c) => c.turns > 0);

    const gapTiles = gaps
      .map((g) => `<div class="tile" title="${g.hits}中 / ${g.misses}丢 · 丢缓存 ${esc(fmtTokens(g.wastedTokens || 0))}">
        <span class="tile-k">${esc(g.label)}</span>
        <span class="tile-v rate-${rateTone(g.hitRate)}">${esc(fmtPct(g.hitRate))}</span>
        <span class="tile-s">${g.misses}丢/${g.total}</span>
      </div>`)
      .join('');

    const ctxTiles = ctxs
      .map((c) => `<div class="tile" title="${c.turns}轮 · 输入 ${esc(fmtTokens(c.totalPromptTokens))}">
        <span class="tile-k">${esc(c.label)}</span>
        <span class="tile-v rate-${rateTone(c.cacheHitRate)}">${esc(fmtPct(c.cacheHitRate))}</span>
        <span class="tile-s">${esc(fmtTokens(c.totalPromptTokens))}</span>
      </div>`)
      .join('');

    return `
      <div class="tiles-block">
        <div class="sub-label">两轮间隔 → 命中率</div>
        <div class="tile-grid">${gapTiles || '<span class="section-sub">暂无后续轮次</span>'}</div>
        <div class="sub-label" style="margin-top:8px">上下文长度 → 命中率</div>
        <div class="tile-grid">${ctxTiles || '<span class="section-sub">暂无数据</span>'}</div>
      </div>
    `;
  }

  function reasonTone(reason) {
    if (reason === 'model_switch') return 'purple';
    if (reason === 'idle_ttl_expired' || reason === 'idle_warm_decay' || reason === 'partial_truncation') return 'warn';
    return 'bad';
  }

  function renderMissEventsBody(diag) {
    const events = diag?.missEvents || [];
    if (events.length === 0) return '<div class="empty-box" style="padding:10px 0">无异常丢缓存</div>';

    return `<div class="list">${events
      .slice(0, 6)
      .map((ev) => {
        const tone = reasonTone(ev.reason);
        const stepTag = ev.stepIndex >= 0 ? `#${ev.stepIndex}` : `T${ev.turnNumber}`;
        const who = ev.agent ? ` ${ev.agent}` : '';
        const modelInfo =
          ev.reason === 'model_switch' && ev.prevModel && ev.prevModel !== ev.model
            ? `${shortModel(ev.prevModel)}→${shortModel(ev.model)}`
            : shortModel(ev.model);
        const clickAttr = ev.conversationId ? ` data-focus-conv="${esc(ev.conversationId)}"` : '';
        const cls = ev.conversationId ? 'list-row miss-row clickable' : 'list-row miss-row';
        return `<div class="${cls}"${clickAttr}>
          <div class="row-main">
            <div class="row-title"><span class="badge badge-${tone}">${esc(ev.reasonLabel)}</span><span>${esc(stepTag + who)}</span></div>
            <div class="row-meta">${esc(fmtGap(ev.gapSec))} · ${esc(modelInfo)} · ${esc(fmtRelTime(ev.ts))}</div>
          </div>
          <span class="miss-tok rate-bad">-${esc(fmtTokens(ev.wastedPrefixTokens))}</span>
        </div>`;
      })
      .join('')}</div>`;
  }

  CR.diag = { renderHeroCard, renderLossCard, renderTileMatrix, renderMissEventsBody };
})();
