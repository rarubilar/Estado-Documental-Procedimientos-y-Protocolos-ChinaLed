// Exports the dashboard as one static HTML page with the current data of the two .xlsx matrices baked in.
// It needs no Drive connector and no dashboard runtime, so anyone with the link can open it on any device.
// It runs the dashboard's own loaders and calcs in Node and replaces the runtime with a small `dash` shim.
//
// Usage:
//   node dashboard/export-static.mjs --proc <procedimientos.xlsx> --prot <protocolos.xlsx> --out <file.html> --fecha 27.10.26 [--standalone]
// --standalone writes a complete web page (doctype, head) for GitHub Pages; without it the page is
// a fragment for a claude.ai artifact, which adds its own skeleton.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : fallback; };
const PROC = opt('proc');
const PROT = opt('prot');
const OUT = opt('out');
const FECHA = opt('fecha', '');
const STANDALONE = argv.includes('--standalone');
if (!PROC || !PROT || !OUT) throw new Error('Faltan --proc, --prot o --out');

// 1) Page source with the logo and the shared .xlsx reader filled in (same as build.py).
const reader = readFileSync(join(here, 'xlsx-reader.js'), 'utf8');
const logo = readFileSync(join(here, '..', 'assets', 'chinaled-logo.png')).toString('base64');
const page = readFileSync(join(here, 'index.src.html'), 'utf8')
  .split('%%LOGO%%').join('data:image/png;base64,' + logo)
  .split('/*%%XLSX_READER%%*/').join(reader.trim());

// 2) Data: the dashboard's own loaders + calcs.
const loaders = {};
const calcs = {};
new Function('dash', page.match(/<script>([\s\S]*?)<\/script>/)[1])({ loader: (id, d) => { loaders[id] = d; }, calc: (id, d) => { calcs[id] = d; } });
const results = {};
const metas = {};
for (const [id, file] of [['matriz_proc', PROC], ['matriz_prot', PROT]]) {
  const r = await loaders[id].fn({ answer: { content: readFileSync(file).toString('base64'), title: file.split(/[\\/]/).pop() } });
  results[id] = r.data;
  metas[id] = r.meta;
}
for (const [id, def] of Object.entries(calcs)) results[id] = def.fn(...def.inputs.map((i) => results[i]));
if (!results.procedimientos?.length || !results.pt_protocolos?.length) throw new Error('Las matrices no entregaron filas: revisa los archivos');

// 3) The page keeps its loader/calc script; the shim and tokens stand in for the runtime. The shim keeps the
// loader/calc definitions so the standalone page can rerun them in the browser on the live files (step 4).
const title = STANDALONE ? 'Estado Documental Procedimientos y Protocolos - ChinaLed' : 'Avance QA/QC PFV CSO';
const head = `<title>${title}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script>
window.dash = {
  _data: ${JSON.stringify(results)},
  _meta: ${JSON.stringify(metas)},
  _loaders: {}, _calcs: {}, _subs: [],
  loader(id, d) { this._loaders[id] = d; }, calc(id, d) { this._calcs[id] = d; }, refresh() {},
  setLink(name) { try { history.replaceState(null, '', '#' + name); } catch (e) {} },
  params() { return {}; }, setParams() {}, resetParams() {},
  data(id) { return { status: 'ok', data: this._data[id] || [], meta: this._meta[id] || [], refreshing: false }; },
  onData(fn) { this._subs.push(fn); fn(); },
};
</script>
<style>
  :root {
    --font-anthropic-sans: "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif;
    --font-anthropic-serif: Georgia, serif;
    --font-anthropic-mono: ui-monospace, Consolas, "Courier New", monospace;
    --cds-font-size-caption: 12px; --cds-font-size-body: 14px; --cds-font-size-heading: 16px; --cds-font-size-title: 20px;
    --cds-font-weight-medium: 600;
    --cds-gap-xs: 4px; --cds-gap-sm: 8px; --cds-gap-md: 12px; --cds-gap-lg: 16px; --cds-gap-xl: 24px;
    --cds-pad-xs: 4px; --cds-pad-sm: 8px; --cds-pad-md: 12px; --cds-pad-lg: 16px; --cds-pad-xl: 24px;
    --cds-radius: 8px; --cds-chart-muted: #C9CED6; --cds-dur-slow: .2s;
    color-scheme: light;
  }
  /* Fixed light look (white page) whatever the viewer's theme, as in the live dashboard. */
  body { margin: 0; background: #FFFFFF; color: #1B2430; }
  img { max-width: 100%; }
  .cso-static-meta { font-size: calc(var(--cds-font-size-body) * 1.15); color: #5F6B7A; margin-top: 4px; }
  .cso-static-meta b { color: #1B2430; font-weight: 600; }
  .cso-live { color: #006100; font-size: .85em; margin-left: 6px; white-space: nowrap; }
  .cso-saved { color: #9C5700; font-size: .85em; }
</style>`;
// 4) Standalone only: on open (and when the tab comes back after a minute) the page downloads both matrices
// through the Drive API, reruns the loaders and calcs and redraws. Drive's plain download link refuses cross-site
// browser requests, so it uses config.driveApiKey (read-only, limited to the Drive API and the GitHub Pages site).
// The baked data stays as the first paint and as the fallback when Drive can't be read.
const config = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
const live = `
  const SOURCES = ${JSON.stringify([['matriz_proc', config.procedimientos.fileId, config.procedimientos.fileName], ['matriz_prot', config.protocolos.fileId, config.protocolos.fileName]])};
  const API = (fileId, q) => 'https://www.googleapis.com/drive/v3/files/' + fileId + '?' + q + '&key=' + ${JSON.stringify(config.driveApiKey.key)};
  const download = async (fileId) => {
    const r = await fetch(API(fileId, 'alt=media'), { cache: 'no-store' });
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!r.ok || bytes[0] !== 0x50 || bytes[1] !== 0x4B) throw new Error('Drive no entregó el .xlsx ' + fileId + ' (' + r.status + ')');
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const modified = async (fileId) => (await (await fetch(API(fileId, 'fields=modifiedTime'), { cache: 'no-store' })).json()).modifiedTime;
  const fmt = (d) => new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Punta_Arenas', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(d).replace(/-/g, '.').replace(',', '');
  let lastLoad = 0;
  const loadLive = async () => {
    lastLoad = Date.now();
    try {
      const [files, times] = await Promise.all([
        Promise.all(SOURCES.map(([, fileId]) => download(fileId))),
        Promise.all(SOURCES.map(([, fileId]) => modified(fileId).catch(() => null))),
      ]);
      const saved = times.filter(Boolean).map((t) => new Date(t)).sort((a, b) => b - a)[0];
      const data = {}, metas = {};
      for (let i = 0; i < SOURCES.length; i++) {
        const r = await dash._loaders[SOURCES[i][0]].fn({ answer: { content: files[i], title: SOURCES[i][2] } });
        data[SOURCES[i][0]] = r.data;
        metas[SOURCES[i][0]] = r.meta;
      }
      for (const [id, def] of Object.entries(dash._calcs)) data[id] = def.fn(...def.inputs.map((x) => data[x]));
      if (!data.procedimientos?.length || !data.pt_protocolos?.length) throw new Error('Las matrices no entregaron filas');
      dash._data = data;
      dash._meta = metas;
      dash._subs.forEach((fn) => fn());
      meta.innerHTML = '<b>Estado documental al:</b> ' + (saved ? fmt(saved) : fmt(new Date())) + ' <span class="cso-live">● en vivo</span>';
      meta.title = 'Fecha y hora del último cambio guardado en las matrices de Google Drive (hora de Magallanes).';
    } catch (e) {
      console.error(e);
      meta.innerHTML = '<b>Estado documental al:</b> ' + ${JSON.stringify(FECHA)} + ' <span class="cso-saved">(copia guardada: no se pudo leer Google Drive)</span>';
    }
  };
  loadLive();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastLoad > 60000) loadLive(); });`;
const finish = `
<script>
  const meta = document.createElement('div');
  meta.className = 'cso-static-meta';
  meta.innerHTML = '<b>Estado documental al:</b> ' + ${JSON.stringify(FECHA)};
  document.querySelector('.cso-titles').append(meta);${STANDALONE ? live : ''}
</script>`;
const html = STANDALONE
  ? '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    head + '\n</head>\n<body>\n' + page + finish + '\n</body>\n</html>\n'
  : head + '\n' + page + finish;
writeFileSync(OUT, html, 'utf8');
console.log('HTML:', OUT, Buffer.byteLength(html), 'bytes');
console.log('Resumen:', JSON.stringify({ procedimientos: results.kpis[0], protocolos: results.pt_kpis[0] }));
