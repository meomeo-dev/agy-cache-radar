(() => {
  const CR = (window.CacheRadar = window.CacheRadar || {});
  const { esc, fmtGap, fmtPct, fmtRelTime, fmtTokens, rateTone, shortModel, toneColor } = CR.fmt;
  const { reasonHint, reasonLabel, t } = CR.i18n;
  const { renderTriBar } = CR.charts;

  function statusPill(rate, anomShare) {
    if (rate === null || rate === undefined) return { text: t('status.none'), cls: 'st-none' };
    if (anomShare <= 0.03 || rate >= 0.85) return { text: t('status.good'), cls: 'st-good' };
    if (rate >= 0.6) return { text: t('status.warn'), cls: 'st-warn' };
    return { text: t('status.bad'), cls: 'st-bad' };
  }

  function renderHeroCard(metrics, diag, options = {}) {
    const rate = metrics.cacheHitRate;
    const tone = rateTone(rate);
    const st = statusPill(rate, diag.anomalyShareOfPrompt || 0);
    const causeShort = diag.primaryCause
      ? reasonLabel(diag.primaryCause.key, true) || diag.primaryCause.label
      : '';
    const causeTip = diag.primaryCause
      ? reasonHint(diag.primaryCause.key) || reasonLabel(diag.primaryCause.key) || diag.primaryCause.label
      : '';
    const primaryBadge = diag.primaryCause
      ? `<span class="cause-pill" title="${esc(causeTip)}">${esc(t('hero.primaryCause', { label: causeShort }))}</span>`
      : '';

    const footerHtml = options.footerHtml ? `<div class="split-strip">${options.footerHtml}</div>` : '';

    return `
      <div class="card hero-card">
        <div class="hero-top">
          <div class="hero-left">
            <span class="hero-num rate-${tone}">${esc(fmtPct(rate))}</span>
            <span class="status-pill ${st.cls}">${esc(st.text)}</span>
            ${primaryBadge}
          </div>
          <div class="hero-right">
            <span>${esc(fmtTokens(metrics.cacheReadTokens))} / ${esc(fmtTokens(metrics.totalPromptTokens))}</span>
            <span>${esc(t('hero.turns', { n: metrics.turns }))}</span>
          </div>
        </div>

        ${renderTriBar(metrics, diag)}

        <div class="tri-summary">
          <div class="tri-col">
            <span class="tri-label"><i class="dot" style="background:var(--cr-good)"></i>${esc(t('hero.hit'))}</span>
            <span class="tri-val rate-good">${esc(fmtTokens(metrics.cacheReadTokens))}</span>
          </div>
          <div class="tri-col">
            <span class="tri-label"><i class="dot" style="background:var(--cr-bad)"></i>${esc(t('hero.miss'))}</span>
            <span class="tri-val ${diag.anomalyTokens > 0 ? 'rate-bad' : ''}">${esc(fmtTokens(diag.anomalyTokens || 0))} <small>-${esc(fmtPct(diag.anomalyShareOfPrompt || 0))}</small></span>
          </div>
          <div class="tri-col">
            <span class="tri-label"><i class="dot" style="background:var(--cr-struct)"></i>${esc(t('hero.structural'))}</span>
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
    const structTooltip = structurals
      .map((s) => t('loss.structItem', { label: reasonLabel(s.key) || s.label, tokens: fmtTokens(s.tokens), turns: s.turns }))
      .join(' + ');

    if (anomalies.length === 0) {
      return `
        <div class="card compact-ok">
          <span class="rate-good">${esc(t('loss.ok'))}</span>
          <span class="section-sub" title="${esc(structTooltip)}">${esc(t('loss.okStruct', { tokens: fmtTokens(diag?.structuralTokens || 0) }))}</span>
        </div>
      `;
    }

    const maxTok = Math.max(...anomalies.map((a) => a.tokens), 1);
    const rows = anomalies
      .slice(0, 5)
      .map((a) => {
        const barW = Math.max(6, Math.round((a.tokens / maxTok) * 100));
        const label = reasonLabel(a.key) || a.label;
        const hint = reasonHint(a.key) || a.hint;
        return `<div class="loss-row" title="${esc(hint)}">
          <span class="loss-name"><i class="dot" style="background:${toneColor(a.color)}"></i>${esc(label)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${barW}%;background:${toneColor(a.color)}"></div></div>
          <span class="loss-tok">${esc(fmtTokens(a.tokens))} <small>${esc(t('loss.times', { n: a.turns }))}</small></span>
          <span class="loss-drop rate-bad">-${esc(fmtPct(a.shareOfPrompt))}</span>
        </div>`;
      })
      .join('');

    return `
      <div class="card">
        <div class="section-head">
          <span>${esc(t('loss.title'))}</span>
          <span class="section-sub">${esc(t('loss.sub'))}</span>
        </div>
        <div class="loss-list">${rows}</div>
        <div class="struct-foot" title="${esc(structTooltip)}">
          <span>${esc(t('loss.structLabel'))}</span>
          <span>${esc(t('loss.structValue', { tokens: fmtTokens(diag.structuralTokens || 0), pct: fmtPct(diag.structuralShareOfPrompt || 0) }))}</span>
        </div>
      </div>
    `;
  }

  function renderTileMatrix(diag) {
    const gaps = (diag?.gapBuckets || []).filter((g) => g.total > 0);
    const ctxs = (diag?.contextBuckets || []).filter((c) => c.turns > 0);

    const gapTiles = gaps
      .map((g) => {
        const tip = t('matrix.gapTip', { hits: g.hits, misses: g.misses, tokens: fmtTokens(g.wastedTokens || 0) });
        return `<div class="tile" title="${esc(tip)}">
          <span class="tile-k">${esc(g.label)}</span>
          <span class="tile-v rate-${rateTone(g.hitRate)}">${esc(fmtPct(g.hitRate))}</span>
          <span class="tile-s">${esc(t('matrix.gapSub', { misses: g.misses, total: g.total }))}</span>
        </div>`;
      })
      .join('');

    const ctxTiles = ctxs
      .map((c) => {
        const tip = t('matrix.ctxTip', { turns: c.turns, tokens: fmtTokens(c.totalPromptTokens) });
        return `<div class="tile" title="${esc(tip)}">
          <span class="tile-k">${esc(c.label)}</span>
          <span class="tile-v rate-${rateTone(c.cacheHitRate)}">${esc(fmtPct(c.cacheHitRate))}</span>
          <span class="tile-s">${esc(fmtTokens(c.totalPromptTokens))}</span>
        </div>`;
      })
      .join('');

    return `
      <div class="tiles-block">
        <div class="sub-label">${esc(t('matrix.gapTitle'))}</div>
        <div class="tile-grid">${gapTiles || `<span class="section-sub">${esc(t('matrix.gapEmpty'))}</span>`}</div>
        <div class="sub-label" style="margin-top:8px">${esc(t('matrix.ctxTitle'))}</div>
        <div class="tile-grid">${ctxTiles || `<span class="section-sub">${esc(t('empty.noData'))}</span>`}</div>
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
    if (events.length === 0) return `<div class="empty-box" style="padding:10px 0">${esc(t('miss.empty'))}</div>`;

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
            <div class="row-title"><span class="badge badge-${tone}">${esc(reasonLabel(ev.reason, true) || ev.reasonLabel)}</span><span>${esc(stepTag + who)}</span></div>
            <div class="row-meta">${esc(fmtGap(ev.gapSec))} · ${esc(modelInfo)} · ${esc(fmtRelTime(ev.ts))}</div>
          </div>
          <span class="miss-tok rate-bad">-${esc(fmtTokens(ev.wastedPrefixTokens))}</span>
        </div>`;
      })
      .join('')}</div>`;
  }

  CR.diag = { renderHeroCard, renderLossCard, renderTileMatrix, renderMissEventsBody };
})();
