(() => {
  const CR = (window.CacheRadar = window.CacheRadar || {});
  const { esc, rateTone, toneColor } = CR.fmt;

  const PRESETS = [
    { key: 'all', label: '全部', ms: 0 },
    { key: '1h', label: '1h', ms: 3600_000 },
    { key: '24h', label: '24h', ms: 24 * 3600_000 },
    { key: '7d', label: '7d', ms: 7 * 86400_000 },
    { key: '30d', label: '30d', ms: 30 * 86400_000 },
  ];

  const BINS = 72;
  const MIN_VIEW_MS = 60_000;
  const pad2 = (n) => String(n).padStart(2, '0');

  function fmtAxisTime(ts, spanMs) {
    if (!ts) return '';
    const d = new Date(ts);
    const md = `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (spanMs <= 20 * 3600_000) return hm;
    if (spanMs <= 10 * 86400_000) return `${md} ${hm}`;
    return md;
  }

  function fmtRangeLabel(fromMs, toMs, count, total) {
    if (fromMs === null && toMs === null) return `全部 · ${total}轮`;
    const span = Math.max(0, (toMs || 0) - (fromMs || 0));
    const a = fmtAxisTime(fromMs, Math.max(span, 25 * 3600_000));
    const b = fmtAxisTime(toMs, span <= 20 * 3600_000 ? span : 25 * 3600_000);
    return `${a}–${b} · ${count}/${total}轮`;
  }

  function computeBounds(ticks) {
    if (!ticks || ticks.length === 0) return { minTs: 0, maxTs: 0 };
    const rawMin = ticks[0][0];
    const rawMax = ticks[ticks.length - 1][0];
    if (rawMax - rawMin < MIN_VIEW_MS) {
      return { minTs: rawMin - 30_000, maxTs: rawMin + 30_000 };
    }
    const pad = Math.min(300_000, Math.round((rawMax - rawMin) * 0.02));
    return { minTs: rawMin - pad, maxTs: rawMax + pad };
  }

  function countInRange(ticks, fromMs, toMs) {
    if (!ticks || ticks.length === 0) return 0;
    if (fromMs === null && toMs === null) return ticks.length;
    let count = 0;
    for (let i = 0; i < ticks.length; i += 1) {
      const t = ticks[i][0];
      if ((fromMs === null || t >= fromMs) && (toMs === null || t <= toMs)) count += 1;
    }
    return count;
  }

  function clampViewport(start, end, minTs, maxTs) {
    const fullSpan = Math.max(MIN_VIEW_MS, maxTs - minTs);
    const span = Math.max(MIN_VIEW_MS, Math.min(fullSpan, end - start));
    let s = start;
    let e = s + span;
    if (s < minTs) {
      s = minTs;
      e = Math.min(maxTs, s + span);
    }
    if (e > maxTs) {
      e = maxTs;
      s = Math.max(minTs, e - span);
    }
    return [s, e];
  }

  function bucketizeTicks(ticks, viewStart, viewEnd) {
    const span = Math.max(1, viewEnd - viewStart);
    const buckets = Array.from({ length: BINS }, () => ({ turns: 0, pctSum: 0, misses: 0 }));
    for (let i = 0; i < ticks.length; i += 1) {
      const [ts, pct, , isMiss] = ticks[i];
      if (ts < viewStart || ts > viewEnd) continue;
      const idx = Math.min(BINS - 1, Math.max(0, Math.floor(((ts - viewStart) / span) * BINS)));
      buckets[idx].turns += 1;
      buckets[idx].pctSum += pct;
      if (isMiss) buckets[idx].misses += 1;
    }
    return buckets;
  }

  function renderActivitySvg(ticks, viewStart, viewEnd) {
    const buckets = bucketizeTicks(ticks, viewStart, viewEnd);
    const maxTurns = Math.max(...buckets.map((b) => b.turns), 1);
    const w = 320;
    const h = 36;
    const slotW = w / BINS;
    const barW = Math.max(1.8, slotW * 0.78);
    const gap = (slotW - barW) / 2;

    const rects = buckets
      .map((b, i) => {
        if (b.turns === 0) return '';
        const barH = Math.max(7, Math.round(Math.sqrt(b.turns / maxTurns) * (h - 6)));
        const x = (i * slotW + gap).toFixed(1);
        const y = (h - 2 - barH).toFixed(1);
        const fill = toneColor(rateTone(b.pctSum / b.turns / 100));
        const cap = b.misses > 0 ? `<rect x="${x}" y="${y}" width="${barW.toFixed(1)}" height="2" rx="0.8" fill="var(--cr-bad)"/>` : '';
        return `<rect x="${x}" y="${y}" width="${barW.toFixed(1)}" height="${barH}" rx="1.2" fill="${fill}" fill-opacity="0.82"/>${cap}`;
      })
      .join('');
    return `<svg class="tl-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>`;
  }

  function renderSelectionOverlay(tlState, viewStart, viewEnd) {
    if (tlState.from === null && tlState.to === null) return '';
    const span = Math.max(1, viewEnd - viewStart);
    const selStart = tlState.from !== null ? tlState.from : viewStart;
    const selEnd = tlState.to !== null ? tlState.to : viewEnd;
    const l = Math.max(0, Math.min(100, ((selStart - viewStart) / span) * 100));
    const r = Math.max(l, Math.min(100, ((selEnd - viewStart) / span) * 100));
    return `<div class="tl-shade tl-shade-l" style="width:${l.toFixed(2)}%"></div>
      <div class="tl-shade tl-shade-r" style="left:${r.toFixed(2)}%;width:${(100 - r).toFixed(2)}%"></div>
      <div class="tl-window" data-tl-drag="move" style="left:${l.toFixed(2)}%;width:${Math.max(1.2, r - l).toFixed(2)}%">
        <div class="tl-handle tl-handle-l" data-tl-drag="left"></div>
        <div class="tl-handle tl-handle-r" data-tl-drag="right"></div>
      </div>`;
  }

  function renderTimelineCard(ticks, tlState) {
    if (!ticks || ticks.length === 0) return '';
    const { minTs, maxTs } = computeBounds(ticks);
    const [viewStart, viewEnd] =
      tlState.viewStart !== null && tlState.viewEnd !== null
        ? clampViewport(tlState.viewStart, tlState.viewEnd, minTs, maxTs)
        : [minTs, maxTs];
    const span = Math.max(1, viewEnd - viewStart);
    const isZoomed = viewEnd - viewStart < (maxTs - minTs) * 0.98;
    const isFiltered = tlState.from !== null || tlState.to !== null;
    const selectedCount = countInRange(ticks, tlState.from, tlState.to);
    const presetsHtml = PRESETS.map(
      (p) => `<button type="button" class="tl-preset${tlState.preset === p.key ? ' active' : ''}" data-tl-preset="${p.key}">${p.label}</button>`
    ).join('');
    const midTs = Math.round((viewStart + viewEnd) / 2);

    return `<div class="card tl-card" id="tl-card" data-min-ts="${minTs}" data-max-ts="${maxTs}" data-view-start="${viewStart}" data-view-end="${viewEnd}">
      <div class="tl-head">
        <div class="tl-presets">${presetsHtml}</div>
        <div class="tl-tools">
          <button type="button" class="tl-btn" data-tl-zoom="in" title="放大时间轴">+</button>
          <button type="button" class="tl-btn" data-tl-zoom="out" title="缩小时间轴"${isZoomed ? '' : ' disabled'}>−</button>
          <button type="button" class="tl-btn" data-tl-zoom="reset" title="重置范围与缩放"${isZoomed || isFiltered ? '' : ' disabled'}>↺</button>
        </div>
      </div>
      <div class="tl-track" id="tl-track" title="拖拽框选时间段 · 滚轮缩放 · 双击重置">
        ${renderActivitySvg(ticks, viewStart, viewEnd)}
        ${renderSelectionOverlay(tlState, viewStart, viewEnd)}
      </div>
      <div class="tl-foot">
        <span class="tl-ticks">${esc(fmtAxisTime(viewStart, span))} · ${esc(fmtAxisTime(midTs, span))} · ${esc(fmtAxisTime(viewEnd, span))}</span>
        <span class="tl-readout" id="tl-readout">${esc(fmtRangeLabel(tlState.from, tlState.to, selectedCount, ticks.length))}</span>
      </div>
    </div>`;
  }

  function resetTimelineState(tlState) {
    tlState.preset = 'all';
    tlState.from = null;
    tlState.to = null;
    tlState.viewStart = null;
    tlState.viewEnd = null;
  }

  function applyPreset(presetKey, ticks, tlState) {
    if (presetKey === 'all' || !ticks || ticks.length === 0) {
      resetTimelineState(tlState);
      return;
    }
    const spec = PRESETS.find((p) => p.key === presetKey);
    if (!spec) return;
    const { minTs, maxTs } = computeBounds(ticks);
    const now = Date.now();
    const lastTick = ticks[ticks.length - 1][0];
    const to = now - lastTick < spec.ms ? now : lastTick;
    const from = to - spec.ms;

    tlState.preset = presetKey;
    tlState.from = from;
    tlState.to = to;

    const fullSpan = Math.max(MIN_VIEW_MS, maxTs - minTs);
    if (spec.ms < fullSpan * 0.25) {
      const upper = Math.max(maxTs, to);
      const targetSpan = Math.min(fullSpan, Math.max(spec.ms * 2.5, MIN_VIEW_MS));
      const [vs, ve] = clampViewport(to - targetSpan, upper, minTs, upper);
      tlState.viewStart = vs;
      tlState.viewEnd = ve;
    } else {
      tlState.viewStart = null;
      tlState.viewEnd = null;
    }
  }

  function zoomTimeline(mode, ticks, tlState, anchorRatio = 0.5) {
    if (!ticks || ticks.length === 0) return;
    if (mode === 'reset') {
      resetTimelineState(tlState);
      return;
    }
    const { minTs, maxTs } = computeBounds(ticks);
    const curStart = tlState.viewStart ?? minTs;
    const curEnd = tlState.viewEnd ?? maxTs;
    const curSpan = Math.max(MIN_VIEW_MS, curEnd - curStart);

    if (mode === 'in' && tlState.from !== null && tlState.to !== null && tlState.to - tlState.from < curSpan * 0.85) {
      const selSpan = Math.max(MIN_VIEW_MS, tlState.to - tlState.from);
      const pad = Math.round(selSpan * 0.15);
      const [vs, ve] = clampViewport(tlState.from - pad, tlState.to + pad, minTs, maxTs);
      tlState.viewStart = vs;
      tlState.viewEnd = ve;
      return;
    }

    const factor = mode === 'in' ? 0.55 : 1.75;
    const nextSpan = Math.max(MIN_VIEW_MS, Math.min(maxTs - minTs, Math.round(curSpan * factor)));
    const anchorTs = curStart + curSpan * anchorRatio;
    const [vs, ve] = clampViewport(anchorTs - nextSpan * anchorRatio, anchorTs + nextSpan * (1 - anchorRatio), minTs, maxTs);
    if (ve - vs >= (maxTs - minTs) * 0.98) {
      tlState.viewStart = null;
      tlState.viewEnd = null;
    } else {
      tlState.viewStart = vs;
      tlState.viewEnd = ve;
    }
  }

  CR.timeline = {
    countInRange,
    fmtRangeLabel,
    renderTimelineCard,
    resetTimelineState,
    applyPreset,
    zoomTimeline,
  };
})();
