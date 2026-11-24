import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONVERSATION_ID_RE } from '../../src/constants.mjs';
import { CacheRadarEngine } from '../../src/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, 'web');

const STATIC_ASSETS = {
  '/styles.css': ['styles.css', 'text/css'],
  '/i18n.js': ['i18n.js', 'application/javascript'],
  '/format.js': ['format.js', 'application/javascript'],
  '/charts.js': ['charts.js', 'application/javascript'],
  '/timeline.js': ['timeline.js', 'application/javascript'],
  '/timeline_drag.js': ['timeline_drag.js', 'application/javascript'],
  '/diag_views.js': ['diag_views.js', 'application/javascript'],
  '/views.js': ['views.js', 'application/javascript'],
  '/app.js': ['app.js', 'application/javascript'],
};

function readAsset(name) {
  return readFileSync(join(WEB_DIR, name), 'utf-8');
}

function parseCliArgs(argv) {
  const opts = { host: '127.0.0.1', port: 4318 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port' && argv[i + 1]) {
      const p = Number(argv[i + 1]);
      if (Number.isInteger(p) && p >= 0 && p <= 65535) opts.port = p;
      i += 1;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      opts.host = argv[i + 1];
      i += 1;
    }
  }
  return opts;
}

export function createHandlers(engine, getDefaultConvId = () => '') {
  const resolveDefault = typeof getDefaultConvId === 'function' ? getDefaultConvId : () => getDefaultConvId || '';
  function handleStats(params = {}) {
    const rawConv = typeof params.conversationId === 'string' ? params.conversationId.trim() : '';
    const conversationId = rawConv && CONVERSATION_ID_RE.test(rawConv) ? rawConv : resolveDefault();
    const sourceFilter = typeof params.source === 'string' && params.source ? params.source : 'all';
    const tzOffsetMinutes = params.tzOffset !== undefined && params.tzOffset !== '' ? Number(params.tzOffset) : undefined;
    const forceRefresh = params.force === '1' || params.force === 'true';

    const snapshot = engine.getSnapshot({
      conversationId,
      sourceFilter,
      tzOffsetMinutes,
      sessionFrom: params.sessionFrom,
      sessionTo: params.sessionTo,
      forceRefresh,
    });

    if (params.etag && params.etag === snapshot.etag) {
      return { unchanged: true, etag: snapshot.etag, generatedAt: snapshot.generatedAt };
    }
    return snapshot;
  }

  function handleSources(params = {}) {
    const forceRefresh = params.force === '1' || params.force === 'true';
    const graph = engine.getGraph(Date.now(), forceRefresh);
    return { sources: graph.sources, diagnostics: graph.diagnostics };
  }

  return { handleStats, handleSources };
}

export function startStandaloneServer(engine, options = {}) {
  const host = options.host || '127.0.0.1';
  const port = options.port ?? 4318;
  const { handleStats, handleSources } = createHandlers(engine, options.defaultConvId || '');

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${host}`);
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(readAsset('index.html'));
      return;
    }

    if (pathname === '/preload.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end('/* standalone mode stub */\n');
      return;
    }

    if (STATIC_ASSETS[pathname]) {
      const [file, contentType] = STATIC_ASSETS[pathname];
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
      res.end(readAsset(file));
      return;
    }

    const params = Object.fromEntries(url.searchParams.entries());
    if (pathname === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(handleStats(params)));
      return;
    }

    if (pathname === '/api/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(handleSources(params)));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolvePromise({ server, host, port: typeof addr === 'object' && addr ? addr.port : port });
    });
  });
}

async function runSidecar() {
  const engine = new CacheRadarEngine();

  let sdk = null;
  try {
    sdk = await import('sidecar_sdk');
  } catch {
    sdk = null;
  }

  if (sdk?.SidecarApp && sdk?.Response) {
    const { SidecarApp, Response } = sdk;
    const app = new SidecarApp();
    const { handleStats, handleSources } = createHandlers(engine, () => app.config?.conversationId || '');

    app.page('/', () => {
      console.error('[cache_radar] GET /');
      return readAsset('index.html');
    });
    for (const [route, [file, type]] of Object.entries(STATIC_ASSETS)) {
      app.api(route, () => new Response(readAsset(file), { contentType: type, headers: { 'Cache-Control': 'no-store' } }), 'GET');
    }
    app.api('/api/stats', (data) => handleStats(data), 'GET');
    app.api('/api/sources', (data) => handleSources(data), 'GET');
    app.run();
    return;
  }

  const cli = parseCliArgs(process.argv.slice(2));
  const { host, port } = await startStandaloneServer(engine, cli);
  console.log(`Cache Radar standalone server listening on http://${host}:${port}/`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runSidecar();
}
