(() => {
  const CR = (window.CacheRadar = window.CacheRadar || {});
  const { esc, fmtPct, fmtTokens, rateTone, toneColor } = CR.fmt;
  const tr = (key, vars) => (CR.i18n ? CR.i18n.t(key, vars) : key);

  function reasonDotColor(reason) {
    if (reason === 'model_switch') return 'var(--cr-purple)';
    if (reason === 'idle_ttl_expired' || reason === 'idle_warm_decay' || reason === 'partial_truncation') return 'var(--cr-warn)';
    if (reason === 'cold_start') return 'var(--cr-info)';
    return 'var(--cr-bad)';
  }

  function renderTriBar(metrics, diag) {
    const total = metrics.totalPromptTokens || 0;
    if (total <= 0) return '<div class="tri-bar"></div>';

    const hitPct = ((metrics.cacheReadTokens || 0) / total) * 100;
    const anomPct = (diag.anomalyShareOfPrompt || 0) * 100;
    const structPct = (diag.structuralShareOfPrompt || 0) * 100;

    const segs = [];
    if (hitPct > 0) segs.push({ pct: hitPct, color: 'var(--cr-good)', tip: tr('chart.triHit', { tokens: fmtTokens(metrics.cacheReadTokens) }) });
    if (anomPct > 0) segs.push({ pct: anomPct, color: 'var(--cr-bad)', tip: tr('chart.triAnomaly', { tokens: fmtTokens(diag.anomalyTokens) }) });
    if (structPct > 0) segs.push({ pct: structPct, color: 'var(--cr-struct)', tip: tr('chart.triStructural', { tokens: fmtTokens(diag.structuralTokens) }) });

    return `<div class="tri-bar">${segs
      .map((s) => `<div class="tri-seg" style="width:${Math.max(1.5, s.pct).toFixed(2)}%;background:${s.color}" title="${esc(s.tip)}"></div>`)
      .join('')}</div>`;
  }

  function renderBarChart(items, options = {}) {
    const width = 320;
    const height = 64;
    const padTop = 4;
    const padBottom = 4;
    const usableH = height - padTop - padBottom;

    if (!items || items.length === 0) {
      return `<div class="empty-box" style="padding:10px 0">${esc(tr('empty.noData'))}</div>`;
    }

    const slotW = width / items.length;
    const barW = Math.max(2, slotW * 0.68);
    const gap = (slotW - barW) / 2;

    const bars = items
      .map((item, idx) => {
        const x = idx * slotW + gap;
        const rate = item.cacheHitRate;
        const hasData = item.turns > 0 || item.totalPromptTokens > 0;
        const tone = hasData ? rateTone(rate) : 'none';
        const fill = hasData ? toneColor(tone) : 'var(--cr-fill)';
        const barH = hasData ? Math.max(3, (rate ?? 0) * usableH) : 2;
        const y = height - padBottom - barH;
        const title = options.tooltip ? options.tooltip(item, idx) : `${fmtPct(rate)} · ${fmtTokens(item.totalPromptTokens)}`;

        const missDot =
          hasData && rate === 0
            ? `<circle cx="${(x + barW / 2).toFixed(1)}" cy="${(height - padBottom - 3.5).toFixed(1)}" r="2.3" fill="${reasonDotColor(item.reason)}"/>`
            : '';

        return `<g>
          <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}"
            rx="1.6" fill="${fill}" fill-opacity="${hasData ? '0.88' : '0.45'}">
            <title>${esc(title)}</title>
          </rect>
          ${missDot}
        </g>`;
      })
      .join('');

    const guide50 = (padTop + usableH * 0.5).toFixed(1);
    const axisHtml =
      options.axisLabels && options.axisLabels.length
        ? `<div class="chart-axis">${options.axisLabels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>`
        : '';

    return `
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(options.ariaLabel || tr('chart.trendAria'))}">
        <line x1="0" y1="${guide50}" x2="${width}" y2="${guide50}" stroke="var(--cr-border)" stroke-dasharray="3 3"/>
        ${bars}
      </svg>
      ${axisHtml}
    `;
  }

  CR.charts = { renderTriBar, renderBarChart };
})();
