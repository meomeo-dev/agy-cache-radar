(() => {
  const CR = (window.CacheRadar = window.CacheRadar || {});

  const tr = (key, vars) => (CR.i18n ? CR.i18n.t(key, vars) : key);

  function showFatalError(msg) {
    const box = document.getElementById('loading-box');
    if (box) {
      box.textContent = CR.i18n ? tr('error.script', { msg }) : `UI script error: ${msg}`;
      box.style.display = 'block';
    }
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('error', (e) => showFatalError(e?.message || 'script error'));
    window.addEventListener('unhandledrejection', (e) =>
      showFatalError(e?.reason?.message || String(e?.reason || 'promise rejected'))
    );
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);
  }

  function fmtPct(rate) {
    if (rate === null || rate === undefined || Number.isNaN(rate)) return '--';
    return `${(rate * 100).toFixed(1)}%`;
  }

  function fmtTokens(n) {
    const num = Number(n) || 0;
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return String(Math.round(num));
  }

  function fmtGap(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${(s / 60).toFixed(1)}m`;
    return `${(s / 3600).toFixed(1)}h`;
  }

  function fmtRelTime(ts) {
    if (!ts) return '--';
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 10) return tr('time.justNow');
    if (diffSec < 60) return tr('time.secAgo', { n: diffSec });
    if (diffSec < 3600) return tr('time.minAgo', { n: Math.floor(diffSec / 60) });
    if (diffSec < 86400) return tr('time.hourAgo', { n: Math.floor(diffSec / 3600) });
    return tr('time.dayAgo', { n: Math.floor(diffSec / 86400) });
  }

  function rateTone(rate) {
    if (rate === null || rate === undefined || Number.isNaN(rate)) return 'none';
    if (rate >= 0.75) return 'good';
    if (rate >= 0.45) return 'warn';
    return 'bad';
  }

  function toneColor(tone) {
    if (tone === 'good') return 'var(--cr-good)';
    if (tone === 'warn') return 'var(--cr-warn)';
    if (tone === 'bad') return 'var(--cr-bad)';
    if (tone === 'purple') return 'var(--cr-purple)';
    if (tone === 'info') return 'var(--cr-info)';
    return 'var(--cr-fg-muted)';
  }

  function shortModel(model) {
    return String(model || 'legacy-cli').replace(/^gemini-/, 'g-');
  }

  function syncHostTheme() {
    const qTheme = new URLSearchParams(location.search).get('theme');
    if (qTheme === 'dark' || qTheme === 'light') {
      document.documentElement.dataset.theme = qTheme;
      return;
    }
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, #f7f7f8)';
    document.documentElement.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();

    const nums = (computed.match(/[\d.]+/g) || []).map(Number);
    if (nums.length < 3) return;
    const scale = computed.startsWith('color(') ? 1 : 255;
    const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const theme = lum < 0.5 ? 'dark' : 'light';
    if (document.documentElement.dataset.theme !== theme) {
      document.documentElement.dataset.theme = theme;
    }
  }

  CR.fmt = { esc, fmtPct, fmtTokens, fmtGap, fmtRelTime, rateTone, toneColor, shortModel, syncHostTheme };
})();
