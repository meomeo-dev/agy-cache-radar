(() => {
  const CR = (window.CacheRadar = window.CacheRadar || {});
  const { countInRange, fmtRangeLabel, zoomTimeline } = CR.timeline;

  const OVERLAY_HTML =
    '<div class="tl-shade tl-shade-l"></div><div class="tl-shade tl-shade-r"></div>' +
    '<div class="tl-window" data-tl-drag="move">' +
    '<div class="tl-handle tl-handle-l" data-tl-drag="left"></div>' +
    '<div class="tl-handle tl-handle-r" data-tl-drag="right"></div></div>';

  function syncVisualSelection(track, viewStart, viewEnd, fromMs, toMs, ticks) {
    const span = Math.max(1, viewEnd - viewStart);
    const l = Math.max(0, Math.min(100, ((fromMs - viewStart) / span) * 100));
    const r = Math.max(l, Math.min(100, ((toMs - viewStart) / span) * 100));
    let win = track.querySelector('.tl-window');
    if (!win) {
      track.insertAdjacentHTML('beforeend', OVERLAY_HTML);
      win = track.querySelector('.tl-window');
    }
    const shadeL = track.querySelector('.tl-shade-l');
    const shadeR = track.querySelector('.tl-shade-r');
    shadeL.style.width = `${l.toFixed(2)}%`;
    shadeR.style.left = `${r.toFixed(2)}%`;
    shadeR.style.width = `${(100 - r).toFixed(2)}%`;
    win.style.left = `${l.toFixed(2)}%`;
    win.style.width = `${Math.max(1.2, r - l).toFixed(2)}%`;
    const readout = document.getElementById('tl-readout');
    if (readout) readout.textContent = fmtRangeLabel(fromMs, toMs, countInRange(ticks, fromMs, toMs), ticks.length);
  }

  function computeDraggedRange(drag, ts) {
    if (drag.mode === 'brush') return [Math.min(drag.anchorTs, ts), Math.max(drag.anchorTs, ts)];
    if (drag.mode === 'left') return [Math.min(ts, drag.origTo - 1000), drag.origTo];
    if (drag.mode === 'right') return [drag.origFrom, Math.max(ts, drag.origFrom + 1000)];

    const winSpan = drag.origTo - drag.origFrom;
    let nextFrom = drag.origFrom + (ts - drag.anchorTs);
    let nextTo = nextFrom + winSpan;
    if (nextFrom < drag.viewStart) {
      nextFrom = drag.viewStart;
      nextTo = nextFrom + winSpan;
    }
    if (nextTo > drag.viewEnd) {
      nextTo = drag.viewEnd;
      nextFrom = nextTo - winSpan;
    }
    return [Math.round(nextFrom), Math.round(nextTo)];
  }

  function bindTimelineInteractions(container, getContext, onUpdate) {
    let drag = null;

    container.addEventListener('pointerdown', (e) => {
      const track = e.target.closest('#tl-track');
      if (!track || e.button !== 0) return;
      const card = track.closest('#tl-card');
      const { ticks, tlState } = getContext();
      if (!card || !ticks.length) return;

      const rect = track.getBoundingClientRect();
      const viewStart = Number(card.dataset.viewStart);
      const viewEnd = Number(card.dataset.viewEnd);
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const anchorTs = Math.round(viewStart + ratio * (viewEnd - viewStart));

      drag = {
        track,
        rect,
        startX: e.clientX,
        viewStart,
        viewEnd,
        mode: e.target.closest('[data-tl-drag]')?.dataset.tlDrag || 'brush',
        anchorTs,
        origFrom: tlState.from ?? viewStart,
        origTo: tlState.to ?? viewEnd,
        moved: false,
        curFrom: tlState.from ?? anchorTs,
        curTo: tlState.to ?? anchorTs,
      };
      tlState.isDragging = true;
      track.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });

    container.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.startX) < 3) return;
      drag.moved = true;
      const { ticks } = getContext();
      const ratio = Math.max(0, Math.min(1, (e.clientX - drag.rect.left) / Math.max(1, drag.rect.width)));
      const ts = Math.round(drag.viewStart + ratio * (drag.viewEnd - drag.viewStart));
      const [fromMs, toMs] = computeDraggedRange(drag, ts);
      drag.curFrom = fromMs;
      drag.curTo = toMs;
      syncVisualSelection(drag.track, drag.viewStart, drag.viewEnd, fromMs, toMs, ticks);
    });

    const finishDrag = () => {
      if (!drag) return;
      const { tlState } = getContext();
      const finished = drag;
      drag = null;
      tlState.isDragging = false;
      if (!finished.moved || finished.curTo - finished.curFrom < 2000) return;
      tlState.preset = 'custom';
      tlState.from = finished.curFrom;
      tlState.to = finished.curTo;
      onUpdate(true);
    };

    container.addEventListener('pointerup', finishDrag);
    container.addEventListener('pointercancel', finishDrag);

    container.addEventListener('dblclick', (e) => {
      if (!e.target.closest('#tl-track')) return;
      const { ticks, tlState } = getContext();
      zoomTimeline('reset', ticks, tlState);
      onUpdate(true);
    });

    container.addEventListener(
      'wheel',
      (e) => {
        const track = e.target.closest('#tl-track');
        if (!track) return;
        const { ticks, tlState } = getContext();
        if (!ticks.length) return;
        e.preventDefault();
        const rect = track.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
        zoomTimeline(e.deltaY < 0 ? 'in' : 'out', ticks, tlState, ratio);
        onUpdate(false);
      },
      { passive: false }
    );
  }

  CR.timeline.bindTimelineInteractions = bindTimelineInteractions;
})();
