/* Panasonic Toolbox — interface of the local app
 * Talks to the cameras through the local Panasonic Toolbox server (app/panasonic_scene.py).
 */
'use strict';
const CATALOG = window.PANA_CATALOG;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FORMAT_ID = 'panasonic-ptz-scene';
// Small icon buttons for actions in table rows (the text is in the tooltip)
const SVG = d => `<svg viewBox="0 0 20 20" aria-hidden="true">${d}</svg>`;
const ICON = {
  live: SVG('<rect x="2.5" y="5" width="11" height="10" rx="2"/><path d="M13.5 9l4-2.5v7l-4-2.5"/>'),
  setup: SVG('<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>'),
  folder: SVG('<path d="M2.5 6V15a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V8a1.5 1.5 0 0 0-1.5-1.5H10L8.2 4.5H4A1.5 1.5 0 0 0 2.5 6z"/>'),
  trash: SVG('<path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6"/>'),
  compare: SVG('<rect x="2.5" y="3.5" width="6" height="13" rx="1"/><rect x="11.5" y="3.5" width="6" height="13" rx="1"/><path d="M4.5 7h2M4.5 10h2M13.5 7h2M13.5 10h2"/>'),
  edit: SVG('<path d="M13.5 3.5l3 3L7 16H4v-3z"/>'),
  save: SVG('<path d="M10 3v9M6.5 8.5L10 12l3.5-3.5"/><path d="M3.5 13v3.5h13V13"/>'),
  refresh: SVG('<path d="M16 10a6 6 0 1 1-1.8-4.3"/><path d="M16 3.5v3.5h-3.5"/>'),
};
const icoBtn = (act, icon, title, extra = '') => `<button type="button" class="ico" data-act="${act}" title="${esc(title)}" aria-label="${esc(title)}">${ICON[icon] || ''}${extra}</button>`;

/* ------------------------------------------------------------------ storage */
// Projects: cameras, shows, RP150 rows, scripts, file names and the camera login belong to a project;
// timing, page paths and the update check are for the whole app. The first project ('default') keeps the
// keys of earlier versions, so nothing is lost when updating.
const PROJECT_KEYS = /^(cameras|shows|rpRows|script|scripts|scriptEdit|scriptCams|engCams|gridCams|liveCam|login|expZip|name_.*|delayMs|sceneWait|livePath|setupPath|sceneSet|engSetup)$/;
// settings that moved into projects in 2.14: a project without its own value uses the value from before
const PROJECT_FALLBACK = /^(delayMs|sceneWait|livePath|setupPath)$/;
// The app's data lives in state.json, kept by the app itself and handed to this page when it loads (#psState).
// Changes are sent back in small batches. The window's own storage is only a fallback (page opened without the app).
const SERVER_STATE = (() => { try { const t = document.getElementById('psState')?.textContent || ''; return t && !t.startsWith('__') ? JSON.parse(t) : null; } catch { return null; } })();
const statePending = { set: {}, del: new Set() };
let stateTimer = null, stateFlushing = null;
function queueState(k, v) {
  if (v === undefined) { delete statePending.set[k]; statePending.del.add(k); } else { statePending.set[k] = v; statePending.del.delete(k); }
  clearTimeout(stateTimer); stateTimer = setTimeout(flushState, 150);
}
async function flushState() {
  if (!SERVER_STATE) return;
  if (stateFlushing) { await stateFlushing; }
  if (!Object.keys(statePending.set).length && !statePending.del.size) return;
  const body = { set: { ...statePending.set }, del: [...statePending.del] };
  statePending.set = {}; statePending.del.clear();
  stateFlushing = (async () => {
    try { await bridgeFetch('/api/state/set', body); }
    catch (e) { // put it back and try again shortly (app still starting, for example)
      for (const [k, v] of Object.entries(body.set)) if (!(k in statePending.set) && !statePending.del.has(k)) statePending.set[k] = v;
      for (const k of body.del) if (!(k in statePending.set)) statePending.del.add(k);
      clearTimeout(stateTimer); stateTimer = setTimeout(flushState, 2000);
    } finally { stateFlushing = null; }
  })();
  return stateFlushing;
}
const reloadAfterSave = () => flushState().finally(() => location.reload());
const ls = {
  get(k, d) {
    if (SERVER_STATE) return k in SERVER_STATE ? SERVER_STATE[k] : d;
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    if (SERVER_STATE) { if (v === undefined) delete SERVER_STATE[k]; else SERVER_STATE[k] = v; queueState(k, v); return; }
    try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ }
  },
  keys() {
    if (SERVER_STATE) return Object.keys(SERVER_STATE);
    const out = []; try { for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); } catch { } return out;
  },
};
// One-time move of what earlier versions kept in the window's storage into state.json.
if (SERVER_STATE && !SERVER_STATE['pscene.migrated']) {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('pscene.') && !(k in SERVER_STATE)) { try { ls.set(k, JSON.parse(localStorage.getItem(k))); } catch { } }
    }
  } catch { }
  ls.set('pscene.migrated', new Date().toISOString());
}
window.addEventListener('pagehide', () => { flushState(); });
const projectId = () => ls.get('pscene.project', 'default');
const keyFor = (k, pid = projectId()) => PROJECT_KEYS.test(k) && pid !== 'default' ? `pscene.p.${pid}.${k}` : 'pscene.' + k;
const store = {
  get(k, d) { const v = ls.get(keyFor(k), undefined); return v !== undefined ? v : PROJECT_FALLBACK.test(k) ? ls.get('pscene.' + k, d) : d; },
  set(k, v) { ls.set(keyFor(k), v); },
};

const state = {
  // De interface wordt geserveerd door de lokale app zelf: zelfde origin.
  bridgeUrl: location.protocol.startsWith('http') ? location.origin : 'http://127.0.0.1:8765',
  version: '',
  delayMs: store.get('delayMs', 20),
  sceneWait: store.get('sceneWait', 2000),
  bridgeOk: false,
  localIps: [],
  cameras: store.get('cameras', []).map(c => ({ ...c, status: '', busy: false })),
  imports: [],   // {id, fileName, data(sceneFile), sceneIdx, target, targetScene, include}
  rp: store.get('rpRows', []),
  eip: [],             // cameras found by the Easy IP network search
  netLocal: new Map(), // name edits for listed cameras the search did not find (ip -> row)
};

/* ------------------------------------------------------------------ log */
let logN = 0;
function log(msg, kind = '') {
  const t = new Date().toLocaleTimeString('nl-BE');
  const el = $('#log');
  el.textContent += `[${t}] ${kind ? kind + ' ' : ''}${msg}\n`;
  el.scrollTop = el.scrollHeight;
  $('#logCount').textContent = ++logN;
}
$('#logToggle').onclick = () => $('#logBox').classList.toggle('hidden');
$('#logClose').onclick = () => $('#logBox').classList.add('hidden');

/* ------------------------------------------------------------------ models */
function profileFor(model) {
  const m = String(model || '').toUpperCase().replace(/^AW-/, '');
  const P = (fam, col, scenes) => ({ fam, col, scenes });
  if (/^UE150A/.test(m)) return P('UE150A', 'UE150A', 4);
  if (/^(UE150|UE155|HE145|UN145)/.test(m)) return P('UE150', 'UE150/HE145', 4);
  if (/^UE160/.test(m)) return P('UE160', 'UE160', 8);
  if (/^UE100/.test(m)) return P('UE100', 'UE100', 4);
  if (/^(UE80|UE50|UE40|UE30)/.test(m)) return P('UE80', 'UE80/UE50/UE40/UE30', 4);
  if (/^(UE20|HE20)/.test(m)) return P('GENERIC', 'UE20/HE20', 4);
  if (/^UE4/.test(m)) return P('GENERIC', 'UE4', 4);
  if (/^UR100/.test(m)) return P('GENERIC', 'UR100', 4);
  if (/^HR140/.test(m)) return P('GENERIC', 'HR140', 4);
  if (/^(HE130|HN130)/.test(m)) return P('GENERIC', 'HE130', 4);
  if (/^(UE70|UN70)/.test(m)) return P('GENERIC', 'UE70series', 4);
  if (/^HE75/.test(m)) return P('GENERIC', 'HE75series', 4);
  if (/^(HE70|HE65|HE40|HN40)/.test(m)) return P('GENERIC', 'HE70series', 4);
  return P('GENERIC', null, 4);
}
const FAM_LABEL = { UE150: 'UE150 / UE155 / HE145', UE150A: 'UE150A', UE160: 'UE160', UE100: 'UE100', UE80: 'UE80 / UE50 / UE40 / UE30', GENERIC: 'Other models (generic)' };

function paramsFor(cam) {
  const p = profileFor(cam.model);
  const list = CATALOG[p.fam] || CATALOG.GENERIC;
  if (p.fam === 'GENERIC' && p.col) return list.filter(x => x.t === 'ptz' || !x.m || x.m.includes(p.col));
  return list;
}
const paramIndex = (() => { const m = new Map(); for (const fam in CATALOG) for (const p of CATALOG[fam]) if (!m.has(p.cmd)) m.set(p.cmd, p); return m; })();

/* ------------------------------------------------------------------ values */
function dataPart(cmd, raw) {
  if (!raw) return '';
  return cmd.startsWith('#') ? raw.slice(cmd.length) : raw.slice(cmd.length + 1);
}
function decode(p, raw) {
  if (!raw || !p) return '';
  const data = dataPart(p.cmd, raw);
  const fields = data.split(':');
  const x = parseInt(fields[0], 16);
  if (Number.isNaN(x)) return '';
  if (['OSI:20', 'OSJ:4A', 'OSL:2F'].includes(p.cmd)) return `${x} K`;
  if (p.cmd === 'OSJ:06') return x ? `1/${x}` : '';
  if (p.cmd === 'OSJ:09') return `${(x / 10).toFixed(1)} Hz`;
  const d = p.dec;
  if (!d) return '';
  if (d.kind === 'enum') return d.map[String(x)] ?? '';
  if (d.kind === 'lin') {
    if (x < Math.min(d.lo, d.hi) - 2 || x > Math.max(d.lo, d.hi) + 2) return '';
    const v = d.vlo + (x - d.lo) * (d.vhi - d.vlo) / (d.hi - d.lo);
    const r = Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 100) / 100;
    return (r > 0 && d.vlo < 0 ? '+' : '') + r + (d.unit && d.unit.length <= 3 ? d.unit : '');
  }
  return '';
}

/* ------------------------------------------------------------------ bridge */
const TOKEN = document.querySelector('meta[name="ps-token"]')?.content || '';
let tokenReloaded = false;
// In the app window every call goes straight to the Python side through pywebview (no network involved).
// In a normal browser (browser mode, development) the same calls go over local HTTP.
const IN_WINDOW = /[?&]app=1\b/.test(location.search);
let nativeApi = null;
const nativeReady = !IN_WINDOW ? Promise.resolve(null) : new Promise(resolve => {
  const done = () => { nativeApi = window.pywebview?.api?.call ? window.pywebview.api : null; resolve(nativeApi); };
  if (window.pywebview?.api?.call) return done();
  window.addEventListener('pywebviewready', done, { once: true });
  setTimeout(done, 6000); // fall back to HTTP if the bridge never shows up
});
async function bridgeFetch(path, body, timeoutMs = 120000) {
  const api = await nativeReady;
  if (api) {
    let to;
    const timeout = new Promise((_, rej) => { to = setTimeout(() => rej(new Error('The app did not answer in time')), Math.max(timeoutMs, 15000)); });
    try {
      const j = await Promise.race([api.call(path, body ?? {}), timeout]);
      if (!j || j.ok === false) throw new Error(j?.error || 'No answer from the app');
      return j;
    } finally { clearTimeout(to); }
  }
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const opts = { signal: ctl.signal, headers: { 'X-PS-Token': TOKEN } };
    if (body !== undefined) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await fetch(state.bridgeUrl.replace(/\/$/, '') + path, opts);
    if (r.status === 401 && !tokenReloaded) { tokenReloaded = true; location.reload(); } // app restarted: new session key
    const j = await r.json().catch(() => ({ ok: false, error: 'Invalid response from the app' }));
    if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  } finally { clearTimeout(to); }
}
async function checkBridge(quiet = false) {
  const dot = $('#bridgeDot'), txt = $('#bridgeText');
  if (!quiet) { dot.className = 'dot'; txt.textContent = 'Connecting…'; }
  // a few tries before reporting a lost connection: the app can be busy for a moment (sleep, network change)
  let j = null, err = null; const t0 = Date.now();
  for (let i = 0; i < (quiet ? 1 : 3) && !j; i++) {
    try { j = await bridgeFetch('/api/info', undefined, 8000); }
    catch (e) { err = e; if (i < 2 && !quiet) await new Promise(r => setTimeout(r, 1000)); }
    state.bridgeLastMs = Date.now() - t0;
  }
  if (j) {
    const wasDown = !state.bridgeOk; state.bridgeMiss = 0;
    state.bridgeOk = true; state.localIps = j.localIps || [];
    state.version = j.version;
    dot.className = 'dot ok'; txt.textContent = 'Connected'; txt.title = `Panasonic Toolbox ${j.version}`;
    $('#bridgeHelp').classList.add('hidden');
    if (!$('#scanRange').value && state.localIps.length) {
      const ip = state.localIps.find(i => i.startsWith('192.168.')) || state.localIps[0];
      $('#scanRange').value = ip.replace(/\.\d+$/, '.0/24');
    }
    if (wasDown) { log(`Connected to the app through ${nativeApi ? 'the window bridge' : 'local HTTP'} (${Date.now() - t0} ms)`); log(`App ${j.version} ready. This computer's IP addresses: ${state.localIps.join(', ') || '-'}`); checkUpdate(); }
  } else if (quiet && state.bridgeOk && (state.bridgeMiss = (state.bridgeMiss || 0) + 1) < 2) {
    return true; // one missed background check is not yet a lost connection
  } else {
    state.bridgeOk = false;
    dot.className = 'dot err'; txt.textContent = 'Not connected'; txt.title = err ? err.message : '';
    const detail = `Details: v${document.querySelector('meta[name="ps-version"]')?.content} · ${IN_WINDOW ? (nativeApi ? 'window bridge' : 'app window without bridge, local HTTP') : 'browser, local HTTP'} · ${err ? err.message : 'no answer'} · after ${Math.round((Date.now() - t0) / 100) / 10} s · ${new Date().toLocaleTimeString('en-GB')}`;
    $('#bridgeDetail').textContent = detail;
    log(`Connection to the app lost. ${detail}`, 'ERROR');
    $('#bridgeHelp').classList.remove('hidden');
  }
  return state.bridgeOk;
}
// keep watching: reconnect on its own when the app is back, and notice when it goes away
setInterval(() => { if (document.visibilityState === 'visible') checkBridge(true); }, 10000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !state.bridgeOk) checkBridge(true); });
function camAuth(cam) {
  return { user: cam.user ?? $('#authUser').value.trim(), pass: cam.pass ?? $('#authPass').value };
}
// Long series go in parts of 20 commands: a slow camera (refusals are retried, a lost connection costs a second)
// then never runs into the time limit of one request. A camera that does not answer stops the rest, as before.
async function batch(cam, items, opts = {}) {
  const a = camAuth(cam);
  const out = [];
  for (let i = 0; i < items.length; i += 20) {
    const part = items.slice(i, i + 20);
    const j = await bridgeFetch('/api/batch', { ip: cam.ip, port: cam.port || 80, user: a.user, pass: a.pass, delayMs: opts.delayMs ?? state.delayMs, items: part }, Math.max(120000, part.length * 8000));
    out.push(...j.results);
    if (j.results.some(r => /Errno 65|No route to host/i.test(r.error || ''))) localNetworkBlocked(cam);
    const stop = j.results.find(r => r.unreachable || r.status === 401);
    if (stop && i + 20 < items.length) { out.push(...items.slice(i + 20).map(x => ({ ok: false, status: stop.status, cmd: x.cmd, error: stop.error, unreachable: stop.unreachable }))); break; }
  }
  return out;
}
const isErr = body => /^er\d/i.test((body || '').trim());
// macOS answers "No route to host" (errno 65) to an app that may not use the local network, even when ping works.
// Say so once, with what to do, instead of only "Not reachable".
function localNetworkBlocked(cam) {
  if (state.lnWarned || !/Mac/i.test(navigator.platform || navigator.userAgent)) return;
  if (state.localIps.length && !sameRange(cam.ip)) return; // another range: a real routing problem
  state.lnWarned = true;
  info('macOS blocks the network for this app', `<p>The camera <span class="mono">${esc(cam.ip)}</span> is in your network, but macOS does not let Panasonic Toolbox reach it (“No route to host”). That happens after installing a new version.</p>
    <ol><li>Open <b>System Settings › Privacy &amp; Security › Local Network</b>.</li><li>Switch <b>Panasonic Toolbox</b> on (if it is listed twice, both).</li><li>Quit the app with ⌘Q and open it again.</li></ol>
    <p class="muted small">Is the switch already on? Switch it off and on again, then quit and reopen the app.</p>`);
}

/* ------------------------------------------------------------------ camera helpers */
async function identify(cam) {
  const r = await batch(cam, [{ cmd: 'QID' }, { cmd: 'QSF' }, { type: 'ptz', cmd: '#O' }, { cmd: 'QSJ:5C' }]);
  if (r[0].status === 401) throw new Error('Login required (enter user name and password)');
  if (!r[0].ok) throw new Error(r[0].unreachable ? 'Not reachable' : (r[0].error || 'no response'));
  if (!/^OID:/i.test(r[0].body)) throw new Error('Not a Panasonic camera response: ' + r[0].body);
  cam.model = r[0].body.slice(4);
  cam.scene = parseSceneResp(r[1], cam);
  cam.power = r[2].ok ? (r[2].body === 'p1' ? 'aan' : r[2].body === 'p0' ? 'standby' : r[2].body) : '?';
  if (r[3].ok && /^OSJ:5C:/i.test(r[3].body)) cam.title = titleFrom(r[3].body.slice(7));
  else { // older models: the title from the camera's basic settings page
    try { const [t] = await batch(cam, [{ type: 'basic' }]); if (t?.ok && t.body) cam.title = t.body.trim(); } catch { }
  }
  return cam;
}
function parseSceneResp(res, cam) {
  if (!res || !res.ok) return null;
  const m = /^OSF:(\d+)/i.exec(res.body);
  if (!m) return null;
  const n = +m[1];
  if (profileFor(cam.model).fam === 'UE160' && n >= 8) return 0; // OFF
  return n + 1;
}
// Camera title (OSJ:5C): newer models (AW-UE150 V3.x) send and want it as 40 hex digits, the ASCII bytes padded
// with zeros ("43414D38…" = "CAM8"); others use plain text.
const titleHex = t => [...t].map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('').padEnd(40, '0').slice(0, 40);
function titleFrom(v) {
  v = (v || '').trim();
  if (/^([0-9A-F]{2}){8,}$/i.test(v)) {
    const s = v.match(/../g).map(h => parseInt(h, 16)).filter(n => n !== 0).map(n => String.fromCharCode(n)).join('');
    if (/^[\x20-\x7e]*$/.test(s)) return s.trim();
  }
  return v;
}
async function getScene(cam) {
  const [r] = await batch(cam, [{ cmd: 'QSF' }]);
  return parseSceneResp(r, cam);
}
async function switchScene(cam, n) {
  log(`${cam.ip}: switching to scene ${n}`);
  const r = await batch(cam, [{ cmd: 'XSF:' + n }, { sleepMs: state.sceneWait }]);
  if (!r[0].ok || isErr(r[0].body)) throw new Error(`Switching to scene ${n} failed (${r[0].body || r[0].error})`);
}
// White balance mode: the camera answers QAW with other numbers than OAW takes (query 2 = AWB A, 3 = AWB B;
// set 1 = A, 2 = B). Scene files keep the numbers to send. Files from before 2.21.1 (no wbSet mark) hold the
// query numbers and are converted when they are imported.
const wbQueryToSet = raw => raw.replace(/^OAW:([23])$/i, (_, d) => 'OAW:' + (+d - 1));
function sceneWbFixed(sc) {
  if (sc.wbSet) return sc;
  return { ...sc, wbSet: true, params: sc.params.map(x => x.cmd === 'OAW' && x.raw ? { ...x, raw: wbQueryToSet(x.raw) } : x) };
}
function parseRead(p, res) {
  if (!res || !res.ok) return { err: res?.error || 'no response' };
  const b = (res.body || '').trim();
  if (isErr(b)) return { err: /^er1/i.test(b) ? 'not on this model or firmware (ER1)' : b.slice(0, 3).toUpperCase() };
  if (p.t === 'ptz') {
    const code = p.cmd.slice(1).toLowerCase();
    if (b.toLowerCase().startsWith(code)) return { raw: '#' + b.toUpperCase() };
  } else if (b.toUpperCase().startsWith(p.cmd + ':')) return { raw: p.cmd === 'OAW' ? wbQueryToSet(b) : b };
  return { err: 'unexpected: ' + b.slice(0, 40) };
}
async function readParams(cam, params) {
  const res = await batch(cam, params.map(p => ({ type: p.t, cmd: p.q })));
  return params.map((p, i) => ({ p, ...parseRead(p, res[i]) }));
}
async function readSceneFile(cam, sceneNo) {
  const params = paramsFor(cam);
  const read = await readParams(cam, params);
  const ok = read.filter(r => r.raw);
  return {
    scene: sceneNo,
    params: ok.map(r => ({ cmd: r.p.cmd, name: r.p.name, group: r.p.g, raw: r.raw, value: decode(r.p, r.raw) })),
    unavailable: read.filter(r => !r.raw).map(r => ({ cmd: r.p.cmd, name: r.p.name, reason: r.err })),
    wbSet: true,
  };
}
function makeFile(cam, scenes) {
  const prof = profileFor(cam.model);
  return {
    format: FORMAT_ID, version: 1,
    generator: 'Panasonic Toolbox ' + (state.version || ''),
    created: new Date().toISOString(),
    camera: { ip: cam.ip, port: cam.port || 80, model: cam.model, title: cam.title || '', profile: prof.fam },
    scenes,
  };
}
/* ---- file names: a pattern per kind, e.g. operatorfile_{title}; the extension is added automatically ---- */
const NAME_DEFAULTS = { scene: '{title}_{ip}_{scenes}_{date}', operator: '{title}_{ip}_operator_{date}', zipscene: 'scenes_{count}cams_{date}', zipoperator: 'operator_{count}cams_{date}' };
const NAME_TOKENS = { title: 'name on the camera', desc: 'your description', model: 'model', ip: 'IP address', zone: 'zone', scenes: 'scene numbers', date: 'date', time: 'time' };
const ZIP_TOKENS = { count: 'number of cameras', date: 'date', time: 'time' };
// The name fields start empty; an empty field uses the default pattern.
const namePattern = k => store.get('name_' + k, '') || NAME_DEFAULTS[k];
function makeName(pattern, ctx = {}) {
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const v = { date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, time: `${p2(d.getHours())}${p2(d.getMinutes())}`, ...ctx };
  const out = pattern.replace(/\{(\w+)\}/g, (m, k) => v[k] != null && v[k] !== '' ? String(v[k]) : '')
    .replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '');
  return out || 'file';
}
const camCtx = cam => ({ title: cam.title || cam.model || 'cam', desc: cam.desc || '', model: cam.model || '', ip: cam.ip.replace(/\./g, '-'), zone: cam.zone || '' });
function fileName(cam, scenes, suffix = '') {
  const sc = scenes.length === 1 ? `scene${scenes[0].scene}` : 'scenes' + scenes.map(s => s.scene).join('');
  return makeName(namePattern('scene'), { ...camCtx(cam), scenes: sc }) + suffix + '.pscene.json';
}
const operatorName = (cam, suffix = '') => makeName(namePattern('operator'), { ...camCtx(cam), scenes: 'operator' }) + suffix + '.poper';
const zipName = (kind, count) => makeName(namePattern('zip' + kind), { count, title: `${count}cams`, ip: '', scenes: kind === 'operator' ? 'operator' : 'scenes' }) + '.zip';
// names inside one ZIP must differ
function uniqueNames(files) {
  const seen = new Map();
  for (const f of files) {
    const n = seen.get(f.name) || 0; seen.set(f.name, n + 1);
    if (n) f.name = f.name.replace(/(\.pscene\.json|\.poper)$/, `-${n + 1}$1`);
  }
  return files;
}

/* ------------------------------------------------------------------ downloads + zip */
const IN_APP = TOKEN && !TOKEN.startsWith('__');
// Where saved files go: <save folder>/<project>/<type folder>. Backups get a folder per day.
const FOLDERS = { scene: 'Scene files', operator: 'Operator files', engineering: 'Engineering files', show: 'Shows', backup: 'Backups', script: 'Scripts', rp150: 'RP150', params: 'Parameter lists', project: '' };
const today = () => { const d = new Date(), p2 = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const projectFolder = () => projectName().replace(/[^A-Za-z0-9._ ()&+-]+/g, '_').replace(/^[ .]+|[ .]+$/g, '') || 'Project';
const subFor = kind => [projectFolder(), FOLDERS[kind] || '', kind === 'backup' ? today() : ''].filter(Boolean);
async function download(name, blobOrText, type = 'application/json', kind = '') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  if (IN_APP) {
    // In the app: save to Downloads/Panasonic Toolbox via the local server (never overwrites)
    try {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      const j = await bridgeFetch('/api/save', kind ? { name, dataB64: btoa(bin), sub: subFor(kind) } : { name, dataB64: btoa(bin) });
      log(`Saved: ${j.path}`);
      toast(`Saved to ${j.dir}`, j.path);
      return j.path;
    } catch (e) { log(`Saving failed: ${e.message}`, 'ERROR'); alert(`Saving failed: ${e.message}`); return null; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
let toastTimer;
$('#toastClose').onclick = () => $('#toast').classList.add('hidden');
function toast(text, path) {
  $('#toastText').textContent = text;
  $('#toastOpen').onclick = () => bridgeFetch('/api/reveal', { path }).catch(() => { });
  $('#toastOpen').classList.toggle('hidden', !path);
  $('#toast').classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 8000);
}
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function makeZip(files) { // [{name, text}] — opgeslagen zonder compressie
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
async function readZip(buf) {
  const dv = new DataView(buf); const u8 = new Uint8Array(buf); const out = [];
  let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid ZIP file');
  let p = dv.getUint32(eocd + 16, true); const n = dv.getUint16(eocd + 10, true);
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen)); p += 46 + nlen + xlen + clen;
    const lstart = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    const comp = u8.subarray(lstart, lstart + csize);
    if (!/\.json$/i.test(name)) continue;
    let data;
    if (method === 0) data = comp;
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else continue;
    out.push({ name: name.split('/').pop(), text: new TextDecoder().decode(data) });
  }
  return out;
}

/* ------------------------------------------------------------------ dialogs */
function ask({ title, body, ok = 'OK', cancel = 'Cancel', danger = false, wide = false }) {
  return new Promise(resolve => {
    const dlg = $('#askDlg');
    dlg.classList.toggle('wide', !!wide);
    $('#askTitle').textContent = title;
    $('#askBody').innerHTML = body;
    $('#askOk').textContent = ok;
    $('#askOk').className = danger ? 'danger-solid' : '';
    $('#askCancel').textContent = cancel || '';
    $('#askCancel').classList.toggle('hidden', !cancel);
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
    // focus the first field, or else the blue button, so Enter confirms
    const first = $$('#askBody input:not([type=hidden]):not([type=checkbox]):not([type=radio]), #askBody textarea, #askBody select').find(x => !x.disabled && x.offsetParent);
    // red (destructive) dialogs: Cancel has the focus, so Enter never deletes by accident
    (first || (danger && cancel ? $('#askCancel') : $('#askOk'))).focus();
  });
}
// Text that is cut off (…) shows in full when you hover over it. Works everywhere, also for rows drawn later.
document.addEventListener('mouseover', e => {
  for (let n = e.target, i = 0; n && n.nodeType === 1 && n !== document.body && i < 3; n = n.parentElement, i++) {
    const tag = n.tagName;
    if (tag === 'SELECT') { const t = n.selectedOptions?.[0]?.textContent?.trim(); if (t && (n.title === '' || n.dataset.autotitle)) { n.title = t; n.dataset.autotitle = '1'; } return; }
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && n.scrollWidth > n.clientWidth + 1) { if (n.title === '' || n.dataset.autotitle) { n.title = n.value; n.dataset.autotitle = '1'; } return; }
    // only plain text that is cut off: an element without other elements in it, or one set to end in "…"
    const textOnly = !n.firstElementChild || getComputedStyle(n).textOverflow === 'ellipsis';
    if (textOnly && n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0) {
      const t = n.innerText.trim();
      if (t && (n.title === '' || n.dataset.autotitle)) { n.title = t; n.dataset.autotitle = '1'; }
      return;
    }
    if (n.dataset.autotitle && n.scrollWidth <= n.clientWidth + 1) { n.removeAttribute('title'); delete n.dataset.autotitle; }
  }
}, true);
// Enter in a dialog presses its blue (primary) button, not Cancel; Enter in a text area still makes a new line.
$('#askDlg').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); $('#askOk').click(); } });
$('#settingsDlg').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') { e.preventDefault(); $('#saveSettings').click(); } });
const info = (title, body) => ask({ title, body: `<p>${body}</p>`, ok: 'OK', cancel: null });

/* ------------------------------------------------------------------ tabs + settings */
$$('.tabs button').forEach(b => b.addEventListener('click', () => {
  $$('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'export') renderExport();
  if (b.dataset.tab === 'import') renderImports();
  if (b.dataset.tab === 'params') { renderHttpTargets(); renderCmds(); renderParamTab(); renderOperatorTab(); }
  if (b.dataset.tab === 'eng') { renderEng(); renderSetup(); }
  if (b.dataset.tab === 'cams' && Date.now() - (state.eipAt || 0) > 60000 && !$('#eipSearch').disabled) { state.eipAt = Date.now(); eipDiscover(); }
  if (b.dataset.tab === 'live') liveEnter(); else liveLeave();
  $('.content').scrollTop = 0;
}));
$$('.subtabs button').forEach(b => b.addEventListener('click', () => {
  $$('.subtabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.subtab').forEach(t => t.classList.toggle('active', t.id === 'sub-' + b.dataset.sub));
  if (b.dataset.sub === 'http') { renderHttpTargets(); renderCmds(); }
}));

state.livePath = store.get('livePath', '/live/index.html');
state.setupPath = store.get('setupPath', '/admin/index.html');
$('#bridgeSettingsBtn').onclick = () => {
  renderProjects(); renderDefaults();
  $('#setDelay').value = state.delayMs; $('#setSceneWait').value = state.sceneWait;
  $('#setUpdates').checked = store.get('updateCheck', true);
  $('#setExpert').checked = !!ls.get('pscene.expert', false);
  $('#setLivePath').value = state.livePath; $('#setSetupPath').value = state.setupPath;
  $('#aboutText').textContent = `Panasonic Toolbox ${state.version || ''}. Running locally at ${location.host}. This computer's IP addresses: ${state.localIps.join(', ') || '–'}`;
  $('#settingsDlg').showModal();
};
$('#saveSettings').onclick = () => {
  state.delayMs = +$('#setDelay').value || 0; state.sceneWait = +$('#setSceneWait').value || 2000;
  state.livePath = $('#setLivePath').value.trim() || '/'; state.setupPath = $('#setSetupPath').value.trim() || '/';
  store.set('delayMs', state.delayMs); store.set('sceneWait', state.sceneWait);
  store.set('livePath', state.livePath); store.set('setupPath', state.setupPath);
  store.set('updateCheck', $('#setUpdates').checked);
  ls.set('pscene.expert', $('#setExpert').checked); applyExpert();
  const d = $('#setSaveDir').value.trim();
  if (d && d !== state.saveDir) setSaveDir(d).catch(e => info('Cannot use this folder', esc(e.message)));
};
/* ---- projects and config files ---- */
const CONFIG_ID = 'panasonic-toolbox-config';
const projects = () => { const l = ls.get('pscene.projects', null); return Array.isArray(l) && l.length ? l : [{ id: 'default', name: 'Project 1' }]; };
const saveProjects = l => ls.set('pscene.projects', l);
const projectName = () => projects().find(p => p.id === projectId())?.name || 'Project 1';
function renderProjects() {
  const sel = $('#setProject');
  sel.innerHTML = projects().map(p => `<option value="${esc(p.id)}" ${p.id === projectId() ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}
function switchProject(id) {
  if (id === projectId()) return;
  ls.set('pscene.project', id);
  reloadAfterSave();
}
// all localStorage keys of one project, without the project prefix
function projectData(pid) {
  const out = {};
  for (const full of ls.keys()) {
    if (!full.startsWith('pscene.')) continue;
    if (pid === 'default') { const k = full.slice(7); if (PROJECT_KEYS.test(k)) out[k] = ls.get(full); }
    else if (full.startsWith(`pscene.p.${pid}.`)) out[full.slice(`pscene.p.${pid}.`.length)] = ls.get(full);
  }
  return out;
}
function appData() {
  const out = {};
  for (const full of ls.keys()) {
    if (!full.startsWith('pscene.') || full.startsWith('pscene.p.') || full === 'pscene.migrated') continue;
    const k = full.slice(7); if (!PROJECT_KEYS.test(k) && !/^(project|projects)$/.test(k)) out[k] = ls.get(full);
  }
  return out;
}
$('#setProject').onchange = e => switchProject(e.target.value);
$('#projNew').onclick = async () => {
  $('#settingsDlg').close();
  if (!await ask({ title: 'New project', ok: 'Create', body: `<label>Name <input id="askProj" value="Project ${projects().length + 1}" autocomplete="off"></label>
    <label class="check"><input type="checkbox" id="askProjCopy"> Start with a copy of the cameras of “${esc(projectName())}”</label>
    <p class="hint">A project has its own cameras, zones, shows, RP150 rows, scripts, file names and camera login. Switch between projects in Settings.</p>` })) return;
  const name = $('#askProj').value.trim() || `Project ${projects().length + 1}`;
  const id = 'p' + Date.now().toString(36);
  if (!ls.get('pscene.projects', null)) saveProjects(projects()); // make the first project explicit
  saveProjects(projects().concat([{ id, name }]));
  if ($('#askProjCopy').checked) ls.set(keyFor('cameras', id), store.get('cameras', []));
  switchProject(id);
};
$('#projRename').onclick = async () => {
  $('#settingsDlg').close();
  if (!await ask({ title: 'Rename project', ok: 'Rename', body: `<label>Name <input id="askProj" value="${esc(projectName())}" autocomplete="off"></label><p class="hint">Its folder in the save folder (<span class="mono">${esc(projectFolder())}</span>) gets the new name too.</p>` })) return;
  const name = $('#askProj').value.trim(); if (!name || name === projectName()) return;
  if (projects().some(p => p.name === name)) return info('Name already used', `There is already a project called “${esc(name)}”.`);
  const oldFolder = projectFolder();
  saveProjects(projects().map(p => p.id === projectId() ? { ...p, name } : p)); $('#projectName').textContent = name;
  try { const j = await bridgeFetch('/api/rename_project_dir', { old: oldFolder, new: projectFolder() }); toast(j.renamed ? `Project and its folder renamed to ${name}` : `Project renamed to ${name}`); }
  catch (e) { toast(`Project renamed to ${name}`); info('The project folder was not renamed', `${esc(e.message)}. New files go into a folder called “${esc(projectFolder())}”.`); }
};
const PROJECT_ID = 'panasonic-toolbox-project';
const PROJ_SETTINGS = ['delayMs', 'sceneWait', 'livePath', 'setupPath'];
const projSummary = d => {
  const cams = d?.cameras || [], shows = d?.shows || [], rp = d?.rpRows || [], zones = [...new Set(cams.map(c => c.zone).filter(Boolean))];
  const n = (x, w) => `${x} ${w}${x === 1 ? '' : 's'}`;
  return `${n(cams.length, 'camera')}${zones.length ? ` in ${n(zones.length, 'zone')}` : ''}, ${n(shows.length, 'show')}${rp.length ? ', ' + n(rp.length, 'RP150 row') : ''}`;
};
function currentProjectData() {
  const d = projectData(projectId());
  for (const k of PROJ_SETTINGS) if (d[k] === undefined) d[k] = store.get(k, { delayMs: 20, sceneWait: 2000, livePath: '/live/index.html', setupPath: '/admin/index.html' }[k]);
  return d;
}
async function saveProjectFile() {
  const pf = { format: PROJECT_ID, version: 1, generator: 'Panasonic Toolbox ' + (state.version || ''), created: new Date().toISOString(), name: projectName(), data: currentProjectData() };
  return download(`${projectFolder()}_${today()}.ptproject`, JSON.stringify(pf, null, 1), 'application/json', 'project');
}
$('#projSave').onclick = async () => { $('#settingsDlg').close(); await saveProjectFile(); };
async function importProject(pf) {
  if (pf?.format !== PROJECT_ID || !pf.data) throw new Error('Not a Panasonic Toolbox project file');
  const name = String(pf.name || 'Project').trim();
  const same = projects().find(p => p.name === name);
  const t = v => esc(String(v ?? '–'));
  if (!await ask({ title: `Open project “${esc(name)}”?`, ok: same ? 'Replace and open' : 'Open', danger: !!same, wide: true, body: `
    <table class="tbl dense"><tbody>
      <tr><td>In the file</td><td>${projSummary(pf.data)}</td></tr>
      <tr><td>Timing</td><td>${t(pf.data.delayMs)} ms between commands, ${t(pf.data.sceneWait)} ms after a scene change</td></tr>
      <tr><td>Web pages</td><td class="mono small">${t(pf.data.livePath)} · ${t(pf.data.setupPath)}</td></tr>
      <tr><td>Saved</td><td>${pf.created ? new Date(pf.created).toLocaleString('en-GB') : '–'}${pf.generator ? ' · ' + esc(pf.generator) : ''}</td></tr>
    </tbody></table>
    <ul class="tight">${same ? `<li><span class="warn-text">Replaces your project “${esc(name)}”</span> (${projSummary(projectData(same.id))}). Save that one first if you want to keep it.</li>` : '<li>Added as a new project; your other projects stay as they are.</li>'}
      <li>The app switches to this project. Nothing is sent to the cameras.</li>${(pf.data.login?.pass || (pf.data.cameras || []).some(c => c.pass)) ? '<li>The file contains saved camera logins.</li>' : ''}</ul>` })) return;
  let list = projects(); if (!ls.get('pscene.projects', null)) saveProjects(list);
  let id = same?.id;
  if (id) for (const k of Object.keys(projectData(id))) ls.set(keyFor(k, id), undefined);
  else { id = 'p' + Date.now().toString(36); list = list.concat([{ id, name }]); saveProjects(list); }
  for (const [k, v] of Object.entries(pf.data)) if (PROJECT_KEYS.test(k)) ls.set(keyFor(k, id), v);
  ls.set('pscene.project', id); reloadAfterSave();
}
$('#projOpen').onclick = async () => {
  $('#settingsDlg').close();
  try {
    const j = await bridgeFetch('/api/choose', { kind: 'files', multiple: false });
    if (j.ok && j.paths?.length) return openPaths(j.paths);
    if (j.ok) return;
  } catch { }
  $('#projFile').click();
};
$('#projFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { await importProject(JSON.parse(await f.text())); } catch (err) { info('Could not open', esc(err.message)); }
};
$('#projClose').onclick = async () => {
  $('#settingsDlg').close();
  const id = projectId(), name = projectName(), d = currentProjectData();
  if (!await ask({ title: `Close project “${esc(name)}”?`, ok: 'Close project', danger: true, body: `
    <p>The project is removed from the app: ${projSummary(d)}, its scripts, file names and settings.</p>
    <label class="check"><input type="checkbox" id="askSaveFirst" checked> Save a project file first <span class="muted">(in the folder ${esc(projectFolder())})</span></label>
    <ul class="tight"><li>${projects().length > 1 ? `The app then opens “${esc(projects().find(p => p.id !== id).name)}”.` : 'The app then opens an empty project.'}</li><li>Files already saved stay where they are, and the cameras are not changed.</li></ul>` })) return;
  if ($('#askSaveFirst').checked && !(await saveProjectFile()) && IN_APP) return info('Project not closed', 'The project file could not be saved, so the project stays open.');
  for (const k of Object.keys(projectData(id))) ls.set(keyFor(k, id), undefined);
  const rest = projects().filter(p => p.id !== id);
  // another project left: open that one; otherwise start an empty project
  if (rest.length) { saveProjects(rest); ls.set('pscene.project', rest[0].id); return reloadAfterSave(); }
  const nid = 'p' + Date.now().toString(36);
  saveProjects([{ id: nid, name: 'New project' }]);
  ls.set('pscene.project', nid); reloadAfterSave();
};
async function importConfig(cfg) {
  if (cfg?.format !== CONFIG_ID || !Array.isArray(cfg.projects)) throw new Error('Not a Panasonic Toolbox config file');
  const count = d => `${(d?.cameras || []).length} camera${(d?.cameras || []).length === 1 ? '' : 's'}, ${(d?.shows || []).length} show${(d?.shows || []).length === 1 ? '' : 's'}`;
  const mine = projects();
  const prow = cfg.projects.map(p => { const m = mine.find(x => x.name === p.name);
    return `<tr><td><b>${esc(p.name)}</b></td><td>${count(p.data)}</td><td>${m ? `<span class="warn-text">Replaces your project</span> <span class="muted">(${count(projectData(m.id))})</span>` : 'Added as a new project'}</td></tr>`; }).join('');
  const kept = mine.filter(m => !cfg.projects.some(p => p.name === m.name));
  const LABELS = { delayMs: 'Pause between commands (ms)', sceneWait: 'Wait after a scene change (ms)', livePath: 'Camera live page path', setupPath: 'Camera settings page path', updateCheck: 'Check for new versions', liveRes: 'Live picture size' };
  const appRows = Object.entries(cfg.app || {}).filter(([k, v]) => LABELS[k] && JSON.stringify(ls.get('pscene.' + k, null)) !== JSON.stringify(v))
    .map(([k, v]) => `<tr><td>${LABELS[k]}</td><td>${esc(String(ls.get('pscene.' + k, '–')))}</td><td>${esc(String(v))}</td></tr>`).join('');
  const opens = cfg.projects.find(p => p.id === cfg.current) || cfg.projects[0];
  if (!await ask({ title: 'Import config file?', ok: 'Import', wide: true, body: `
    <table class="tbl dense"><thead><tr><th>Project in the file</th><th>Contains</th><th>What happens</th></tr></thead><tbody>${prow}</tbody></table>
    ${kept.length ? `<p class="small">Your other projects stay as they are: ${kept.map(m => esc(m.name)).join(', ')}.</p>` : ''}
    ${appRows ? `<table class="tbl dense"><thead><tr><th>Setting</th><th>Now</th><th>From the file</th></tr></thead><tbody>${appRows}</tbody></table>` : (Object.keys(cfg.app || {}).some(k => LABELS[k]) ? '<p class="small">The app settings in the file are the same as yours.</p>' : '<p class="small">The file has no app settings; yours stay as they are.</p>')}
    <ul class="tight"><li>Afterwards the app opens project <b>${esc(opens.name)}</b>.</li><li>Nothing is sent to the cameras.</li><li>Tip: download your own config file first if you might want to go back.</li></ul>` })) return;
  let list = projects(); if (!ls.get('pscene.projects', null)) saveProjects(list);
  for (const p of cfg.projects) {
    let id = list.find(x => x.name === p.name)?.id;
    if (id) for (const k of Object.keys(projectData(id))) ls.set(keyFor(k, id), undefined);
    else { id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); list = list.concat([{ id, name: p.name }]); }
    for (const [k, v] of Object.entries(p.data || {})) if (PROJECT_KEYS.test(k)) ls.set(keyFor(k, id), v);
  }
  saveProjects(list);
  for (const [k, v] of Object.entries(cfg.app || {})) if (!PROJECT_KEYS.test(k) && !/^(project|projects)$/.test(k)) ls.set('pscene.' + k, v);
  const cur = cfg.projects.find(p => p.id === cfg.current) || cfg.projects[0];
  ls.set('pscene.project', list.find(x => x.name === cur.name).id);
  reloadAfterSave();
}
$('#projectName').textContent = projectName();
$('#projectName').onclick = () => $('#bridgeSettingsBtn').click();
$('#quitBtn').onclick = async () => {
  $('#settingsDlg').close();
  if (!await ask({ title: 'Quit Panasonic Toolbox?', body: '<p>The window closes and the cameras are no longer controlled from this computer.</p>', ok: 'Quit', danger: true })) return;
  try { await bridgeFetch('/api/quit', {}); } catch { }
  document.body.innerHTML = '<p style="padding:40px;font:15px system-ui;color:#aaa">Panasonic Toolbox has quit. You can close this window.</p>';
};
$('#retryBridge').onclick = () => checkBridge();
$('#reloadWin').onclick = () => reloadAfterSave();
$('#copyDetail').onclick = e => copyText(`${$('#bridgeDetail').textContent}\n${navigator.userAgent}\n${location.href.replace(/\?.*/, '')}`, e.target);
setInterval(() => { if (!document.hidden) bridgeFetch('/api/ping', undefined, 3000).then(() => { if (!state.bridgeOk) checkBridge(); }).catch(() => { if (state.bridgeOk) checkBridge(); }); }, 10000);

/* New version available? (latest GitHub release; skipped silently when offline) */
const REPO = 'seppeva/panasonic-toolbox';
async function checkUpdate() {
  if (!store.get('updateCheck', true)) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: 'no-store' }); if (!r.ok) return;
    const rel = await r.json(); const latest = String(rel.tag_name || '').replace(/^v/, '');
    const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
    if (latest && state.version && newer(latest, state.version)) {
      $('#updateText').innerHTML = `Version ${esc(latest)} is available (you have ${esc(state.version)}). <a href="https://github.com/${REPO}/releases/latest" target="_blank" rel="noopener">Download the update</a>`;
      $('#updateBox').classList.remove('hidden');
    }
  } catch { /* offline on set: fine */ }
}

/* ------------------------------------------------------------------ cameras */
const saveCams = () => store.set('cameras', state.cameras.map(({ ip, port, model, title, desc, selected, zone, user, pass }) => ({ ip, port, model, title, desc, selected, zone, user, pass: $('#rememberLogin').checked ? pass : undefined })));
const login = store.get('login', null);
if (login) { $('#authUser').value = login.user || ''; $('#authPass').value = login.pass || ''; $('#rememberLogin').checked = true; }
function saveLogin() {
  if ($('#rememberLogin').checked) store.set('login', { user: $('#authUser').value.trim(), pass: $('#authPass').value });
  else store.set('login', null);
}
['#authUser', '#authPass', '#rememberLogin'].forEach(s => $(s).addEventListener('change', saveLogin));
const loginSummary = () => { $('#loginSummary').textContent = $('#authUser').value.trim() ? `User ${$("#authUser").value.trim()}` : 'No login filled in'; };
['#authUser', '#authPass'].forEach(s => $(s).addEventListener('input', loginSummary)); loginSummary();

function hostPort(c) { return c.ip + (c.port && +c.port !== 80 ? ':' + c.port : ''); }
// Open the live or settings page of every selected camera, one browser tab each.
async function openCamPages(cams, kind) {
  if (!cams.length) return;
  const far = state.localIps.length ? cams.filter(c => !sameRange(c.ip)) : [];
  if (far.length && !await ask({ title: `${far.length} of ${cams.length} camera${cams.length > 1 ? 's are' : ' is'} in another IP range`, ok: 'Open anyway', body: `<p>This computer cannot reach ${far.map(c => `${esc(camName(c))} <span class="mono">${esc(c.ip)}</span>`).join(', ')}; their pages will not load.</p>` })) return;
  for (const c of cams) { await openCamPage(c, kind, true); await sleep(250); }
  toast(`Opened the ${kind === 'setup' ? 'settings' : 'live'} page of ${cams.length} camera${cams.length > 1 ? 's' : ''}`);
}
$('#camLiveSel').onclick = () => openCamPages(state.cameras.filter(c => c.selected), 'live');
$('#camSetupSel').onclick = () => openCamPages(state.cameras.filter(c => c.selected), 'setup');
async function openCamPage(c, kind, quiet = false) {
  if (!quiet && state.localIps.length && !sameRange(c.ip)) {
    if (!await ask({ title: `${esc(camName(c))} is in another IP range`, ok: 'Open anyway', body: `<p>This computer (${state.localIps.map(i => `<span class="mono">${esc(i)}</span>`).join(', ')}) cannot reach <span class="mono">${esc(c.ip)}</span>, so the browser will say the page is not reachable.</p><p>Give the camera an address in your range (type it in its IP column on the Cameras page and choose Apply), or give this computer an address in the camera's range.</p>` })) return;
  }
  const { user, pass } = camAuth(c);
  const path = kind === 'setup' ? state.setupPath : state.livePath;
  try {
    // with a login, the app opens the page through its own pass-through on this computer and signs in for you
    // (browsers ignore a login in the address, and the camera asks with Digest authentication)
    const j = await bridgeFetch('/api/open_cam', { ip: c.ip, port: c.port || 80, user, pass, path, noOpen: !IN_APP });
    if (!IN_APP) window.open(j.url, '_blank', 'noopener');
    log(`${c.ip}: opened the ${kind === 'setup' ? 'settings' : 'live'} page in the browser`);
    if (kind === 'setup' && !user) toast('Tip: fill in Camera login to sign in to the settings page automatically.');
  } catch (e) { info('Could not open the page', esc(e.message)); }
}

// The Cameras page shows one list: the cameras in your list, then the Panasonic cameras the network search found
// that are not in it yet. Name and IP address can be changed right in the list; Apply sends them with Easy IP.
// netRow(c): the Easy IP row of a camera in the list (found by the search), or a local row when the search did not
// find it (then only the name can change: that goes over the camera's web interface).
function netRow(c) {
  const r = state.eip.find(x => x.orig.ip === c.ip);
  if (r) { state.netLocal.delete(c.ip); return r; }
  let l = state.netLocal.get(c.ip);
  const v = { name: c.title || '', ip: c.ip, mask: '255.255.255.0', gateway: '', port: c.port || 80 };
  if (!l || (!netPending(l) && l.orig.name !== v.name)) { l = { mac: c.ip, model: c.model || '', local: true, orig: { ...v }, edit: { ...v } }; state.netLocal.set(c.ip, l); }
  return l;
}
const netPending = r => JSON.stringify(r.edit) !== JSON.stringify(r.orig);
const foundRows = () => state.eip.filter(r => !state.cameras.some(c => c.ip === r.orig.ip));
const allNetRows = () => [...state.cameras.map(netRow), ...foundRows()];
function renderCams() {
  // do not rebuild the table while you type in one of its fields: it is drawn again when you leave the field
  const f = document.activeElement;
  if (f && $('#camTable').contains(f) && f.tagName === 'INPUT' && f.type !== 'checkbox') { state.camRedraw = true; updateSel(); return; }
  state.camRedraw = false;
  const tb = $('#camTable tbody'); tb.innerHTML = '';
  const ipCell = (r, editable) => editable
    ? `<input data-k="ip" class="mono ipin${r.edit.ip !== r.orig.ip ? ' changed' : ''}" value="${esc(r.edit.ip)}" aria-label="IP address" title="Type a new IP address and choose Apply; it is sent with Easy IP">`
    : `<span class="mono" title="Choose Search to change this address with Easy IP (the search did not find this camera)">${esc(r.orig.ip)}</span>`;
  const nameCell = r => `<input data-k="name" class="namein${r.edit.name !== r.orig.name ? ' changed' : ''}" value="${esc(r.edit.name)}" maxlength="15" placeholder="${esc(r.model || 'Name')}" aria-label="Camera name" title="Name on the camera (menu and web page). Up to 15 letters, digits, spaces, - _ .">`;
  const range = r => !r.local && state.localIps.length && !sameRange(r.orig.ip, r.orig.mask);
  // at a glance: green = in this computer's range and answering, amber = another IP range, red = not answering,
  // blue = found on the network, not in your list yet
  const health = (c, r) => c ? (c.busy ? 'busy' : range(r) ? 'far' : c.statusKind === 'ok' ? 'ok' : c.statusKind === 'err' ? 'off' : 'busy') : (range(r) ? 'far' : 'new');
  const HEALTH_TXT = { ok: 'In your IP range and reachable', far: 'In another IP range than this computer', off: 'Not reachable', new: 'Found on the network, in your IP range', busy: 'Checking…' };
  const dot = h => `<span class="sdot s-${h}" title="${HEALTH_TXT[h]}" aria-label="${HEALTH_TXT[h]}"></span>`;
  const tally = { ok: 0, far: 0, off: 0, new: 0 };
  const bindNet = (tr, r) => $$('input[data-k]', tr).forEach(i => i.onchange = () => { r.edit[i.dataset.k] = i.value.trim(); renderCams(); });
  for (const c of state.cameras) {
    const r = netRow(c);
    const tr = document.createElement('tr'); tally[health(c, r)] = (tally[health(c, r)] || 0) + 1;
    const status = c.busy ? '<span class="pill busy">Busy</span>' : range(r) ? '<span class="pill warn" title="Another IP range than this computer: give the camera an address in your range (type it in the IP column), or change this computer\'s IP address">Other range</span>' : c.statusKind === 'ok' && c.power === 'standby' ? '<span class="pill busy">Standby</span>' : c.status ? `<span class="pill ${c.statusKind || ''}">${esc(c.status)}</span>` : '';
    tr.innerHTML = `<td><input type="checkbox" class="selcb" ${c.selected ? 'checked' : ''} aria-label="Select ${esc(c.ip)}"></td>
      <td class="namecell">${dot(health(c, r))}${nameCell(r)}</td>
      <td>${ipCell(r, !r.local)}${(c.port || 80) != 80 ? `<span class="mono muted small">:${c.port}</span>` : ''}</td>
      <td><input class="descin" value="${esc(c.desc || '')}" placeholder="Add a description" aria-label="Description of ${esc(c.ip)}" title="Your own description, e.g. where the camera is. Not sent to the camera."></td>
      <td>${c.model ? `<span class="pill">${esc(c.model)}</span>` : '<span class="muted">–</span>'}</td><td><input class="zonein" list="zoneList" value="${esc(c.zone || '')}" placeholder="–" aria-label="Zone of ${esc(c.ip)}"></td>
      <td class="nowrap">${c.scene == null ? "–" : c.scene === 0 ? "Off" : "Scene " + c.scene}</td>
      <td>${status}</td>
      <td class="nowrap">${icoBtn('live', 'live', 'Open the live page of ' + c.ip)}${icoBtn('setup', 'setup', 'Open the settings page of ' + c.ip + ', signed in')}</td>
      <td class="end"><button class="icon" data-act="del" title="Remove from the list" aria-label="Remove ${esc(c.ip)}">×</button></td>`;
    $('.selcb', tr).onchange = e => { c.selected = e.target.checked; saveCams(); updateSel(); };
    bindNet(tr, r);
    $('.descin', tr).onchange = e => { const d = e.target.value.trim(); if (d === (c.desc || '')) return; track(`Description of ${c.ip}`, () => { c.desc = d; }); saveCams(); };
    $('.zonein', tr).onchange = e => { const z = e.target.value.trim(); if (z === (c.zone || '')) return; track(`Zone of ${c.ip}`, () => { c.zone = z; }); saveCams(); renderZones(); };
    $('[data-act=live]', tr).onclick = () => openCamPage(c, 'live');
    $('[data-act=setup]', tr).onclick = () => openCamPage(c, 'setup');
    $('[data-act=del]', tr).onclick = () => { track(`Remove ${c.ip}`, () => { state.cameras = state.cameras.filter(x => x !== c); }); saveCams(); renderCams(); };
    tb.appendChild(tr);
  }
  // found on the network, not in the list yet
  for (const r of foundRows()) {
    const tr = document.createElement('tr'); tr.className = 'found'; tally[health(null, r)]++;
    tr.innerHTML = `<td><input type="checkbox" class="selcb" ${r.sel ? 'checked' : ''} aria-label="Select ${esc(r.orig.ip)}"></td>
      <td class="namecell">${dot(health(null, r))}${nameCell(r)}</td><td>${ipCell(r, true)}</td><td class="muted small">Found on the network</td>
      <td>${r.model ? `<span class="pill">${esc(r.model)}</span>` : '–'}</td><td></td><td></td>
      <td>${range(r) ? '<span class="pill warn" title="Another IP range than this computer: give the camera an address in your range (type it in the IP column) and choose Apply">Other range</span>' : '<span class="pill info">Found</span>'}</td>
      <td colspan="2" class="end"><button type="button" class="ghost small" data-act="add" title="Add this camera to your list">Add</button></td>`;
    $('.selcb', tr).onchange = e => { r.sel = e.target.checked; updateSel(); };
    bindNet(tr, r);
    $('[data-act=add]', tr).onclick = () => addFound([r]);
    tb.appendChild(tr);
  }
  const nf = foundRows().length;
  $('#camHealth').innerHTML = state.cameras.length + nf ? [['ok', 'reachable'], ['far', 'in another IP range'], ['off', 'not reachable'], ['new', 'found, not in your list']].filter(([k]) => tally[k]).map(([k, t]) => `<span>${dot(k)}<b>${tally[k]}</b>${t}</span>`).join('') : '';
  $('#camCount').textContent = state.cameras.length;
  $('#camFoundN').textContent = nf ? `+ ${nf} found on the network` : '';
  $('#camEmpty').classList.toggle('hidden', state.cameras.length + nf > 0);
  $('#camWelcome').classList.toggle('hidden', state.cameras.length + nf > 0);
  const pend = allNetRows().filter(netPending).length;
  $('#camPending').classList.toggle('hidden', !pend);
  $('#camPendingN').textContent = `${pend} camera${pend > 1 ? 's' : ''} changed, not sent yet`;
  updateSel(); renderZones(); renderGrid();
}
$('#camTable').addEventListener('focusout', () => setTimeout(() => { if (state.camRedraw && !$('#camTable').contains(document.activeElement)) renderCams(); }, 0));
function addFound(list) {
  if (!list.length) return info('Nothing to add', 'Choose Search first, or tick the found cameras you want to add.');
  track(`Add ${list.length} camera(s) from the network`, () => list.forEach(r => { upsertCam(r.orig.ip, r.orig.port, { model: r.model, title: r.orig.name }); r.sel = false; }));
  saveCams(); renderCams(); refreshAll(state.cameras.filter(c => list.some(r => r.orig.ip === c.ip)));
  const far = list.filter(r => state.localIps.length && !sameRange(r.orig.ip, r.orig.mask));
  if (far.length) info(`${list.length} camera${list.length > 1 ? 's' : ''} added`, `${far.length} of them ${far.length > 1 ? 'are' : 'is'} in another IP range than this computer (${far.map(r => `<span class="mono">${esc(r.orig.ip)}</span>`).join(', ')}) and cannot be reached yet. Type an address in your range in the IP column and choose Apply, or change this computer's IP address.`);
  else toast(`${list.length} camera${list.length > 1 ? 's' : ''} added to the list`);
}
$('#camAddFound').onclick = () => { const sel = foundRows().filter(r => r.sel); addFound(sel.length ? sel : foundRows()); };
$('#camDiscard').onclick = () => { allNetRows().forEach(r => { r.edit = { ...r.orig }; }); renderCams(); };
$('#camApply').onclick = () => applyNet(allNetRows().filter(netPending));
// Search: Easy IP over the whole cable (also other IP ranges) and read every camera in the list again
async function camSearch() {
  if (!state.bridgeOk && !(await checkBridge())) return;
  $('#camSearch').disabled = true; state.eipAt = Date.now();
  try { await Promise.all([eipDiscover(), state.cameras.length ? refreshAll(state.cameras) : null]); }
  finally { $('#camSearch').disabled = false; }
}
$('#camSearch').onclick = camSearch;
// Edit IP settings…: name, IP address, subnet mask and gateway of the ticked cameras in one table, sent with Easy IP
$('#camIpSel').onclick = async () => {
  const rows = [...state.cameras.filter(c => c.selected).map(netRow), ...foundRows().filter(r => r.sel)];
  if (!rows.length) return info('Select cameras first', 'Tick the cameras you want to change.');
  const first = rows.find(r => !r.local)?.edit;
  const opened = ask({ title: `IP settings of ${rows.length} camera${rows.length > 1 ? 's' : ''}`, ok: 'Send to the cameras', wide: true, danger: true, body: `
    <div class="row wrap"><label class="w140">First IP address <input id="ipFirst" class="mono" value="${esc(first?.ip || '')}"></label>
      <label class="w140">Subnet mask <input id="ipMask" class="mono" value="${esc(first?.mask || '255.255.255.0')}"></label>
      <label class="w140">Gateway <input id="ipGw" class="mono" value="${esc(first?.gateway || '')}"></label>
      <button type="button" class="ghost small" id="ipFill" title="Number the addresses from the first one, in the order of the list, and give every camera this subnet mask and gateway">Fill in all</button></div>
    <table class="tbl dense ipdlg"><thead><tr><th>Camera</th><th>Name</th><th>IP address</th><th>Subnet mask</th><th>Gateway</th></tr></thead><tbody>${rows.map((r, i) => `<tr>
      <td class="small">${esc(r.model || '')}<div class="muted mono">${esc(r.local ? r.orig.ip : r.mac)}</div></td>
      <td><input data-i="${i}" data-f="name" value="${esc(r.edit.name)}" maxlength="15" aria-label="Name"></td>
      ${['ip', 'mask', 'gateway'].map(f => `<td><input class="mono" data-i="${i}" data-f="${f}" value="${esc(r.edit[f])}" ${r.local ? 'disabled title="The network search did not find this camera, so only its name can change. Choose Search and try again."' : ''} aria-label="${f}"></td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="hint">Only what you change is sent. Cameras only accept a new IP address in the first 20 minutes after they are switched on. A new name needs the camera to be in this computer's IP range (after the change).</p>` });
  await sleep(0);
  $('#ipFill').onclick = () => {
    const ip = $('#ipFirst').value.trim(), mask = $('#ipMask').value.trim(), gw = $('#ipGw').value.trim();
    if (ip && !validIp(ip)) return toast('The first IP address is not valid');
    let n = ip ? ipNum(ip) : null;
    rows.forEach((r, i) => { if (r.local) return; const f = k => $(`[data-i="${i}"][data-f="${k}"]`);
      if (n != null) { f('ip').value = ipStr(n); n++; } if (mask) f('mask').value = mask; if (gw) f('gateway').value = gw; });
  };
  if (!await opened) return;
  rows.forEach((r, i) => ['name', 'ip', 'mask', 'gateway'].forEach(k => { const el = $(`[data-i="${i}"][data-f="${k}"]`); if (el && !el.disabled) r.edit[k] = el.value.trim(); }));
  renderCams();
  const list = rows.filter(netPending);
  if (!list.length) return toast('Nothing changed');
  applyNet(list, { confirmed: true });
};
/* ---- zones: group cameras (stage, FOH, ...) and select them per zone ---- */
const zoneNames = () => [...new Set(state.cameras.map(c => (c.zone || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
// Zone chips: click a zone to add its cameras to the selection; a zone whose cameras are all selected is blue,
// and clicking it again deselects them. Several zones can be selected at once. sel = { get(c), set(c, on), done() }.
function zoneChips(box, sel, label = 'Zone', allNone = false) {
  if (!box) return;
  const zs = zoneNames();
  const cams = z => state.cameras.filter(c => inZone(c, z));
  const isOn = z => cams(z).length > 0 && cams(z).every(c => sel.get(c));
  const none = state.cameras.filter(c => !c.zone).length;
  const btns = (zs.length ? zs.map(z => [z, z]) : []).concat(zs.length && none ? [['', 'No zone']] : []);
  box.innerHTML = (btns.length ? `<span class="muted small">${label}:</span> ` + btns.map(([z, l]) => `<button type="button" class="chip${isOn(z) ? ' on' : ''}" data-zone="${esc(z)}" aria-pressed="${isOn(z)}" title="${isOn(z) ? 'Deselect' : 'Select'} the cameras in ${esc(l)}">${esc(l)} <span class="muted">${cams(z).length}</span></button>`).join('') : '')
    + (allNone && state.cameras.length ? `<span class="row allnone"><button type="button" class="ghost small" data-all>All</button><button type="button" class="ghost small" data-none>None</button></span>` : '');
  // act on press (before a field loses focus and the bar is redrawn); keyboard presses come in as clicks with detail 0
  const act = (el, fn) => { if (!el) return; el.addEventListener('pointerdown', e => { if (e.button === 0) { e.preventDefault(); fn(); } }); el.addEventListener('click', e => { if (e.detail === 0) fn(); }); };
  $$('[data-zone]', box).forEach(b => act(b, () => { const z = b.dataset.zone, on = !isOn(z); cams(z).forEach(c => sel.set(c, on)); sel.done(); }));
  act($('[data-all]', box), () => { state.cameras.forEach(c => sel.set(c, true)); sel.done(); });
  act($('[data-none]', box), () => { state.cameras.forEach(c => sel.set(c, false)); sel.done(); });
}
const inZone = (c, z) => (c.zone || '') === z;
// Zones…: one place to rename zones, choose which cameras are in each zone, add and remove zones.
// A camera is in one zone at a time: ticking it in a zone takes it out of the other one.
$('#zonesBtn').onclick = async () => {
  if (!state.cameras.length) return info('No cameras yet', 'Add cameras first.');
  const rows = zoneNames().map(z => ({ orig: z, name: z }));
  const member = new Map(state.cameras.map(c => [c.ip, (c.zone || '').trim()])); // ip -> zone name (original names)
  const draw = () => {
    const box = $('#zoneEd'); if (!box) return;
    box.innerHTML = (rows.length ? '' : '<p class="muted small">No zones yet. Add one below.</p>') + rows.map((r, i) => `
      <div class="zone-ed-row">
        <input class="zone-name" data-i="${i}" value="${esc(r.name)}" aria-label="Zone name">
        <div class="zone-cams">${state.cameras.map(c => `<label class="check small"><input type="checkbox" data-i="${i}" data-ip="${esc(c.ip)}" ${member.get(c.ip) === r.orig ? 'checked' : ''}> ${esc(camName(c))}</label>`).join('')}</div>
        <button type="button" class="ghost small danger-text" data-del="${i}" title="Remove this zone (its cameras get no zone)">Remove</button>
      </div>`).join('');
    $$('.zone-name', box).forEach(inp => inp.oninput = () => { rows[+inp.dataset.i].name = inp.value; });
    $$('input[data-ip]', box).forEach(cb => cb.onchange = () => { const r = rows[+cb.dataset.i]; member.set(cb.dataset.ip, cb.checked ? r.orig : ''); draw(); });
    $$('[data-del]', box).forEach(b => b.onclick = () => { const r = rows[+b.dataset.del]; for (const [ip, z] of member) if (z === r.orig) member.set(ip, ''); rows.splice(+b.dataset.del, 1); draw(); });
  };
  const opened = ask({ title: 'Zones', ok: 'Save', wide: true, body: `
    <p class="muted small">Rename a zone in its field. Tick the cameras that belong to it; a camera is in one zone at a time.</p>
    <div id="zoneEd"></div>
    <div class="row"><input id="zoneNew" placeholder="New zone, e.g. Stage" aria-label="New zone name"><button type="button" class="ghost small" id="zoneAdd">Add zone</button></div>` });
  await sleep(0); draw();
  const add = () => { const n = $('#zoneNew').value.trim(); if (!n) return; if (rows.some(r => r.name === n)) return toast(`${n} already exists`); rows.push({ orig: '\u0000new' + rows.length + n, name: n }); $('#zoneNew').value = ''; draw(); };
  $('#zoneAdd').onclick = add;
  $('#zoneNew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } });
  if (!await opened) return;
  const finalName = orig => { const r = rows.find(x => x.orig === orig); return r ? (r.name.trim() || r.orig.replace(/^\u0000new\d+/, '')) : ''; };
  const plan = state.cameras.map(c => ({ c, to: member.get(c.ip) ? finalName(member.get(c.ip)) : '' })).filter(x => (x.c.zone || '') !== x.to);
  if (!plan.length) return;
  track(`Zones (${plan.length} camera${plan.length > 1 ? 's' : ''})`, () => { for (const x of plan) x.c.zone = x.to; });
  saveCams(); renderCams();
  toast(`Zones saved: ${plan.length} camera${plan.length > 1 ? 's' : ''} changed`);
};
const camSel = after => ({ get: c => !!c.selected, set: (c, on) => { c.selected = on; }, done: () => { saveCams(); after(); } });
function renderZones() {
  $('#zoneList').innerHTML = zoneNames().map(z => `<option value="${esc(z)}">`).join('');
  zoneChips($('#camZoneBar'), camSel(() => renderCams()), 'Select zone', true);
  zoneChips($('#expZones'), camSel(() => { renderExport(); renderCams(); }));
}
// The bar with actions for the selected rows always keeps its place (no jumping rows); without a selection its controls are off.
function selBar(bar, n) {
  // the bar with actions for the ticked rows only shows when something is ticked
  bar.classList.toggle('hidden', !n); bar.classList.toggle('idle', !n);
  $$('button, input, select', bar).forEach(x => { x.disabled = !n; });
}
// Select-all checkbox: shows a dash when some rows are selected; a click then clears the selection, the next click selects all.
function selAllState(cb, list, get) {
  const n = list.filter(get).length;
  cb.checked = list.length > 0 && n === list.length; cb.indeterminate = n > 0 && n < list.length;
}
// A 'Select all' checkbox on top of a list of camera checkboxes, working like the one on the Cameras page.
function selAllRow(box, list, get, set, done) {
  if (!list.length) return;
  const l = document.createElement('label'); l.className = 'check selall-row';
  l.innerHTML = '<input type="checkbox" aria-label="Select all cameras"><span>Select all</span>';
  box.prepend(l);
  const cb = $('input', l); selAllState(cb, list, get);
  cb.onchange = () => { selAllClick(cb, list, get, set); done(); };
  return cb;
}
function selAllClick(cb, list, get, set) {
  const any = list.some(get);
  list.forEach(x => set(x, !any));
  cb.checked = !any && list.length > 0; cb.indeterminate = false;
}
$('#camDelSel').onclick = async () => {
  const sel = state.cameras.filter(c => c.selected);
  const fsel = foundRows().filter(r => r.sel);
  if (fsel.length) { state.eip = state.eip.filter(r => !fsel.includes(r)); renderEip(); } // found ones: hidden until the next search
  if (!sel.length) return renderCams();
  if (!await ask({ title: `Remove ${sel.length} camera${sel.length > 1 ? 's' : ''} from the list?`, body: '<p>The cameras themselves are not changed. You can undo this.</p>', ok: 'Remove', danger: true })) return;
  track(`Remove ${sel.length} camera(s)`, () => { state.cameras = state.cameras.filter(c => !c.selected); });
  saveCams(); renderCams();
};
$('#camEditSel').onclick = async () => {
  const sel = state.cameras.filter(c => c.selected);
  const same = k => sel.every(c => (c[k] ?? '') === (sel[0][k] ?? '')) ? (sel[0][k] ?? '') : '';
  const ok = ask({ title: `Edit ${sel.length} camera${sel.length > 1 ? 's' : ''}`, ok: 'Apply', wide: true, body: `
      <table class="tbl dense edit-cams"><thead><tr><th>IP address</th><th>Name on camera</th><th>Description</th></tr></thead><tbody>${sel.map((c, i) => `<tr>
        <td><input class="mono" data-ed-ip="${i}" value="${esc(c.ip)}" aria-label="IP address"></td>
        <td>${esc(c.title || '–')}<div class="muted small">${esc(c.model || '')}</div></td>
        <td><input data-ed-desc="${i}" value="${esc(c.desc || '')}" placeholder="e.g. balcony left" aria-label="Description"></td></tr>`).join('')}</tbody></table>
      ${sel.length > 1 ? `<div class="row wrap bulk-desc"><label class="grow">Description for all selected cameras <input id="edDescAll" placeholder="e.g. Stage {n}" autocomplete="off"></label><button type="button" class="ghost small" id="edDescFill">Fill in</button></div>
      <p class="hint">{n} becomes 1, 2, 3… in the order of the list, so “Stage {n}” gives Stage 1, Stage 2… Without {n} every camera gets the same description. You can still change single rows afterwards.</p>` : ''}
      <p class="hint">Change the IP address when a camera got a new one. The app then talks to the new address; destinations on the Restore page and in your shows move along.</p>
      <div class="row wrap">
      <label class="w140">Zone <input id="edZone" list="zoneList" value="${esc(same('zone'))}" placeholder="${sel.length > 1 && !same('zone') ? 'several' : ''}"></label>
      <label class="w90">Port <input id="edPort" type="number" value="${esc(same('port') || '')}" placeholder="${sel.length > 1 && !same('port') ? 'several' : '80'}"></label></div>
      <div class="row wrap"><label class="w140">Login user name <input id="edUser" autocomplete="off" value="${esc(same('user'))}"></label><label class="w140">Password <input id="edPass" type="password" autocomplete="off"></label></div>
      <label class="check"><input type="checkbox" id="edGeneral"> Use the general camera login for these cameras</label>
      <p class="hint">Empty zone, port and login fields stay as they are. A login here is only for these cameras and replaces the general one at the top of the page.</p>` });
  const fillDesc = () => { const t = $('#edDescAll').value; sel.forEach((c, i) => { $(`[data-ed-desc="${i}"]`).value = t.replace(/\{n\}/g, String(i + 1)); }); };
  $('#edDescFill')?.addEventListener('click', fillDesc);
  $('#edDescAll')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); fillDesc(); } });
  if (!await ok) return;
  const ips = sel.map((c, i) => $(`[data-ed-ip="${i}"]`).value.trim()), descs = sel.map((c, i) => $(`[data-ed-desc="${i}"]`).value.trim());
  const z = $('#edZone').value.trim(), port = +$('#edPort').value, user = $('#edUser').value.trim(), pass = $('#edPass').value, general = $('#edGeneral').checked;
  const bad = ips.find(ip => !validIp(ip));
  if (bad != null) return info('Invalid IP address', `“${esc(bad)}” is not a valid IPv4 address. Nothing was changed.`);
  const newPort = (c) => (port > 0 && port < 65536 ? port : (c.port || 80));
  const clash = sel.map((c, i) => ({ c, ip: ips[i] })).find(({ c, ip }, i) => ips.some((o, k) => k !== i && o === ip && newPort(sel[k]) === newPort(c)) || state.cameras.some(o => !sel.includes(o) && o.ip === ip && (o.port || 80) === newPort(c)));
  if (clash) return info('IP address used twice', `${esc(clash.ip)} would be used by two cameras in the list. Nothing was changed.`);
  const moved = sel.map((c, i) => ({ c, from: c.ip, to: ips[i] })).filter(m => m.from !== m.to);
  const beforeApp = snapApp(), beforeShows = JSON.stringify(state.shows);
  sel.forEach((c, i) => {
    c.ip = ips[i]; c.desc = descs[i];
    if (z) c.zone = z;
    if (port > 0 && port < 65536) c.port = port;
    if (general) { delete c.user; delete c.pass; } else if (user) { c.user = user; if (pass) c.pass = pass; }
  });
  if (moved.length) {
    for (const m of moved) {
      state.jobs.forEach(j => { if (j.target === m.from) j.target = m.to; });
      state.shows.forEach(sh => sh.items.forEach(it => { if (it.target === m.from) it.target = m.to; }));
      m.c.scene = null; m.c.status = ''; m.c.statusKind = '';
      log(`${m.c.title || m.c.model || 'Camera'}: IP address changed in the app from ${m.from} to ${m.to}`);
    }
    state.cameras.sort((a, b) => ipNum(a.ip) - ipNum(b.ip));
    saveShows(); renderImports(); renderShows();
  }
  saveCams(); renderCams();
  const afterApp = snapApp(), afterShows = JSON.stringify(state.shows);
  if (beforeApp !== afterApp || beforeShows !== afterShows) {
    const put = (app, shows) => { restoreApp(app); state.shows = JSON.parse(shows); saveShows(); renderShows(); };
    pushHistory({ label: `Edit ${sel.length} camera(s)`, undo: async () => put(beforeApp, beforeShows), redo: async () => put(afterApp, afterShows) });
  }
  if (moved.length && (state.bridgeOk || await checkBridge())) refreshAll(moved.map(m => m.c));
};
function updateSel() {
  const n = state.cameras.filter(c => c.selected).length;
  const items = [...state.cameras, ...foundRows()], isSel = x => x.ip && !x.mac ? !!x.selected : !!x.sel;
  selAllState($('#selAll'), items, isSel); renderZones();
  $('#camSelN').textContent = n + foundRows().filter(r => r.sel).length; selBar($('#camSelBar'), n + foundRows().filter(r => r.sel).length);
  $('#expSel').textContent = n ? `${n} camera${n > 1 ? 's' : ''} selected` : 'Select at least one camera';
}
$('#selAll').onchange = () => { const items = [...state.cameras, ...foundRows()], isCam = x => !x.mac; selAllClick($('#selAll'), items, x => isCam(x) ? !!x.selected : !!x.sel, (x, v) => { if (isCam(x)) x.selected = v; else x.sel = v; }); saveCams(); renderCams(); };
function upsertCam(ip, port, data = {}) {
  let c = state.cameras.find(x => x.ip === ip && (x.port || 80) == (port || 80));
  if (!c) { c = { ip, port: port || 80, selected: true }; state.cameras.push(c); }
  Object.assign(c, data);
  state.cameras.sort((a, b) => ipNum(a.ip) - ipNum(b.ip));
  return c;
}
const ipNum = ip => ip.split('.').reduce((s, x) => s * 256 + (+x || 0), 0);
const validIp = ip => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip) && ip.split('.').every(x => +x <= 255);

// Is this IP address in the same IP range as one of this computer's addresses (with the camera's subnet mask)?
function sameRange(ip, mask = '255.255.255.0') {
  if (!validIp(ip)) return false;
  const m = validIp(mask) ? ipNum(mask) : ipNum('255.255.255.0');
  return state.localIps.some(l => validIp(l) && ((ipNum(l) & m) >>> 0) === ((ipNum(ip) & m) >>> 0));
}
// After a range scan: an Easy IP search shows the Panasonic cameras the scan could not reach (another IP range)
async function scanOthers(foundIps) {
  const box = $('#scanOther'); box.classList.add('hidden');
  let j; try { j = await bridgeFetch('/api/eip/discover', { timeout: 2 }); } catch { return; }
  eipTake(j.cameras || []);
  const other = state.eip.filter(r => !foundIps.includes(r.orig.ip) && !state.cameras.some(c => c.ip === r.orig.ip));
  if (!other.length) return;
  box.innerHTML = `<b>${other.length} more Panasonic camera${other.length > 1 ? 's' : ''} on the cable</b> that this scan could not reach: ${other.slice(0, 6).map(r => `${esc(r.orig.name || r.model)} <span class="mono">${esc(r.orig.ip)}</span>`).join(', ')}${other.length > 6 ? ', …' : ''}. ${other.some(r => !sameRange(r.orig.ip, r.orig.mask)) ? 'They are in another IP range.' : ''} They are in the list below as found cameras: type an address in your range in their IP column and choose Apply.`;
  box.classList.remove('hidden');
  renderCams();
}
function gotoNetsetup() {
  $('[role=tab][data-tab=cams]').click(); renderCams();
  if (!state.eip.length) eipDiscover();
}
$('#toNetsetup').onclick = e => { e.preventDefault(); gotoNetsetup(); };
const scanMsg = t => { $('#scanStatus').textContent = t; $('#camSearchStatus').textContent = t; };
$('#scanBtn').onclick = async () => {
  if (!state.bridgeOk && !(await checkBridge())) return;
  const range = $('#scanRange').value.trim();
  if (!range) return info('Fill in an IP range', 'For example 192.168.0.0/24 or 192.168.0.10-60.');
  $('#scanBtn').disabled = true; scanMsg('Scanning…');
  try {
    const j = await bridgeFetch('/api/scan', { range, port: +$('#scanPort').value || 80, user: $('#authUser').value.trim(), pass: $('#authPass').value });
    track('Scan', () => { for (const f of j.cameras) {
      const c = upsertCam(f.ip, f.port, { model: f.model, title: f.title || '' });
      if (f.auth) { c.status = 'Login required'; c.statusKind = 'err'; }
      c.power = f.power === 'p1' ? 'on' : f.power === 'p0' ? 'standby' : f.power;
    } });
    scanMsg(`${j.scanned} addresses scanned, ${j.cameras.length} camera${j.cameras.length === 1 ? '' : 's'} found.`);
    log(`Scan ${range}: ${j.cameras.map(c => c.ip + ' ' + c.model).join(', ') || 'nothing found'}`);
    saveCams(); renderCams();
    await refreshAll(state.cameras.filter(c => j.cameras.some(f => f.ip === c.ip)));
    scanOthers(j.cameras.map(f => f.ip));
  } catch (e) { scanMsg('Scan failed: ' + e.message); log('Scan failed: ' + e.message, 'ERROR'); }
  finally { $('#scanBtn').disabled = false; }
};
$('#addCamsBtn').onclick = async () => {
  const last = state.cameras[state.cameras.length - 1];
  const opened = ask({ title: 'Add cameras', ok: 'Add', body: `<label>Scan an IP range <span class="row nowrap"><input id="acRange" class="mono grow" value="${esc($('#scanRange').value)}" placeholder="192.168.0.0/24 or 192.168.0.10-60"><label class="check small nowrap"><input type="checkbox" id="acDoScan"> Scan this range</label></span></label>
      <p class="hint">Finds the cameras this computer can reach in that range and adds them. Search on the Cameras page finds the cameras in other ranges too.</p>
      <h4 class="mt">Or add by IP address</h4><div class="row wrap">
      <label class="w140">First IP address <input id="acIp" class="mono" value="${esc(last ? ipStr(ipNum(last.ip) + 1) : (state.localIps[0] || '192.168.0.10').replace(/\.\d+$/, '.11'))}"></label>
      <label class="w90">Amount <input id="acCount" type="number" min="1" max="254" value="1"></label>
      <label class="w90">IP step <input id="acStep" type="number" min="1" max="50" value="1"></label>
      <label class="w90">Port <input id="acPort" type="number" value="80"></label>
      <label class="w140">Zone <input id="acZone" list="zoneList" placeholder="optional"></label></div>
      <label>Or paste a list <textarea id="acList" rows="5" placeholder="192.168.0.11&#10;192.168.0.12, 192.168.0.13"></textarea></label>
      <p class="hint">With Amount set to 4, 192.168.0.11 adds .11 to .14. A pasted list (one or more addresses per line, from Excel for example) is used instead when it is filled in.</p>` });
  await sleep(0); $('#acRange').oninput = () => { $('#acDoScan').checked = !!$('#acRange').value.trim(); };
  const ok = await opened;
  if (!ok) return;
  if ($('#acDoScan').checked) { $('#scanRange').value = $('#acRange').value.trim(); $('#scanPort').value = $('#acPort').value || 80; return $('#scanBtn').click(); }
  const listTxt = $('#acList').value.trim(), port = +$('#acPort').value || 80, zone = $('#acZone').value.trim();
  let ips;
  if (listTxt) ips = listTxt.split(/[\s,;]+/).filter(Boolean);
  else {
    const first = $('#acIp').value.trim(), n = Math.max(1, Math.min(254, +$('#acCount').value || 1)), step = Math.max(1, +$('#acStep').value || 1);
    if (!validIp(first)) return info('Invalid IP address', esc(first));
    if ((ipNum(first) & 255) + step * (n - 1) > 254) return info('Not enough addresses', `From ${esc(first)} there is no room for ${n} cameras with step ${step} in this network.`);
    ips = Array.from({ length: n }, (_, i) => ipStr(ipNum(first) + i * step));
  }
  const bad = ips.filter(i => !validIp(i)); if (bad.length) return info('Invalid IP address', esc(bad.join(', ')));
  if (!state.bridgeOk && !(await checkBridge())) return;
  const cams = track(`Add ${ips.length} camera(s)`, () => ips.map(ip => upsertCam(ip, port, zone ? { zone } : {})));
  saveCams(); renderCams(); await refreshAll(cams);
};
async function refreshAll(cams) {
  await Promise.all(cams.map(async c => {
    c.busy = true; renderCams();
    try { await identify(c); c.status = 'Online'; c.statusKind = 'ok'; }
    catch (e) { c.status = e.message; c.statusKind = 'err'; log(`${c.ip}: ${e.message}`, 'ERROR'); }
    c.busy = false; renderCams();
  }));
  // Still no name? Easy IP announces the camera name too (the name Easy IP Setup shows).
  const noName = cams.filter(c => !c.title && c.statusKind === 'ok');
  if (noName.length) {
    try {
      const j = await bridgeFetch('/api/eip/discover', { timeout: 2 });
      for (const c of noName) { const f = j.cameras.find(x => x.ip === c.ip); if (f?.name) c.title = f.name; }
    } catch { /* Easy IP not available (port in use); names stay empty */ }
  }
  saveCams(); renderCams();
}

/* ------------------------------------------------------------------ undo / redo */
// One history for app edits (lists and tables) and camera changes (imports, commands, network settings).
const hist = { past: [], future: [], busy: false };
function pushHistory(entry) {
  hist.past.push(entry); if (hist.past.length > 100) hist.past.shift();
  hist.future = []; updUndo();
}
function updUndo() {
  const u = hist.past[hist.past.length - 1], r = hist.future[hist.future.length - 1];
  $('#undoBtn').disabled = !u || hist.busy; $('#redoBtn').disabled = !r || hist.busy;
  $('#undoBtn').title = u ? `Undo: ${u.label} (Ctrl/Cmd+Z)` : 'Nothing to undo';
  $('#redoBtn').title = r ? `Redo: ${r.label} (Shift+Ctrl/Cmd+Z)` : 'Nothing to redo';
}
async function runHistory(from, to, fn, verb) {
  const e = from.pop(); if (!e || hist.busy) return;
  if (e.camera && !await ask({ title: `${verb} on the camera?`, body: `<p>${verb}: <b>${esc(e.label)}</b>. This changes the camera${e.many ? 's' : ''} again.</p>`, ok: verb, danger: true })) { from.push(e); return; }
  hist.busy = true; updUndo();
  try { await fn(e); to.push(e); toast(`${verb === 'Undo' ? 'Undone' : 'Redone'}: ${e.label}`); log(`${verb}: ${e.label}`); }
  catch (err) { from.push(e); info(`${verb} failed`, esc(err.message)); }
  hist.busy = false; updUndo();
}
const undo = () => runHistory(hist.past, hist.future, e => e.undo(), 'Undo');
const redo = () => runHistory(hist.future, hist.past, e => e.redo(), 'Redo');
$('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return; // keep text undo in fields
  e.preventDefault(); e.shiftKey ? redo() : undo();
});
function snapApp() {
  return JSON.stringify({
    cameras: state.cameras.map(({ ip, port, model, title, desc, selected, scene, power, status, statusKind, zone, user, pass }) => ({ ip, port, model, title, desc, selected, scene, power, status, statusKind, zone, user, pass })),
    sources: state.sources, jobs: state.jobs, rp: state.rp,
  });
}
function restoreApp(snap) {
  const s = JSON.parse(snap);
  state.cameras = s.cameras; state.sources = s.sources; state.jobs = s.jobs; state.rp = s.rp;
  saveCams(); saveRp(); renderCams(); renderImports(); renderRp(); renderExport();
}
function track(label, fn) {
  const before = snapApp(); const r = fn(); const after = snapApp();
  if (before !== after) pushHistory({ label, undo: async () => restoreApp(before), redo: async () => restoreApp(after) });
  return r;
}

/* ------------------------------------------------------------------ save folder and opening files */
state.saveDir = '';
function renderSaveDir() { $$('[data-savedir]').forEach(e => e.textContent = state.saveDir || 'Downloads › Panasonic Toolbox'); if ($('#setSaveDir')) $('#setSaveDir').value = state.saveDir; }
async function loadSaveDir() { try { const j = await bridgeFetch('/api/folder', {}); state.saveDir = j.dir; renderSaveDir(); } catch { } }
async function setSaveDir(path) {
  const j = await bridgeFetch('/api/folder', { set: path }); state.saveDir = j.dir; renderSaveDir(); log(`Save folder: ${j.dir}`);
}
async function chooseFolder() {
  try {
    const j = await bridgeFetch('/api/choose', { kind: 'folder' });
    if (j.ok && j.paths?.length) return setSaveDir(j.paths[0]);
    if (j.ok) return; // cancelled
  } catch { }
  // No native dialog (browser mode): ask for a path
  const ok = await ask({ title: 'Save folder', body: `<label>Folder path<input id="askPath" class="mono" value="${esc(state.saveDir)}"></label>`, ok: 'Use this folder' });
  if (ok) { try { await setSaveDir($('#askPath').value.trim()); } catch (e) { info('Cannot use this folder', esc(e.message)); } }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-changedir]'); if (b) { e.preventDefault(); chooseFolder(); } });
async function openPaths(paths) {
  for (const p of paths) {
    try {
      const j = await bridgeFetch('/api/read_file', { path: p });
      const bin = atob(j.dataB64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      await openBytes(j.name, u8, p);
    } catch (e) { info(`Could not open ${esc(p)}`, esc(e.message)); }
  }
}
async function openBytes(name, u8, path) {
  if (/\.(ps1|sh)$/i.test(name)) { try { openScriptFile(name, new TextDecoder().decode(u8)); } catch (e) { info(`Could not open ${esc(name)}`, esc(e.message)); } return; }
  if (/\.zip$/i.test(name)) { for (const z of await readZip(u8.buffer)) openJson(z.name, JSON.parse(z.text)); }
  else openJson(name, JSON.parse(new TextDecoder().decode(u8)), path);
  log(`Opened: ${name}`);
}
function openJson(name, data, path) {
  if (data?.format === SHOW_ID) return addShow(data, true, path);
  if (data?.format === ENG_ID) return importEngFile(data).catch(e => info('Could not open', esc(e.message)));
  if (data?.format === CONFIG_ID) return importConfig(data).catch(e => info('Could not import', esc(e.message)));
  if (data?.format === PROJECT_ID) return importProject(data).catch(e => info('Could not open', esc(e.message)));
  return addImportFile(name, data);
}
$('#openFilesBtn').onclick = async () => {
  try { const j = await bridgeFetch('/api/choose', { kind: 'files', multiple: true }); if (j.ok) return openPaths(j.paths || []); } catch { }
  $('#fileInput').click();
};
$('#browseFolderBtn').onclick = async () => {
  try {
    const j = await bridgeFetch('/api/list_files', { sub: [projectFolder()], withRoot: true });
    const files = j.files.filter(f => /\.(json|zip|pshow|poper)$/i.test(f.name)).sort((a, b) => b.mtime - a.mtime);
    $('#folderList').innerHTML = files.length ? `<table class="tbl dense"><thead><tr><th>File in ${esc(j.folder)}</th><th>Folder</th><th>Saved</th><th></th></tr></thead><tbody>${files.map(f => { const dir = (f.rel || '').split(/[\\/]/).slice(0, -1).join(' › '); return `<tr><td>${esc(f.name)}</td><td class="muted small">${dir === '..' ? 'Main folder (older files)' : esc(dir || projectFolder())}</td><td class="muted small">${new Date(f.mtime * 1000).toLocaleString('en-GB')}</td><td class="end"><button class="ghost small" data-open="${esc(f.path)}">Open</button></td></tr>`; }).join('')}</tbody></table>` : `<p class="muted">No Panasonic Toolbox files in ${esc(j.folder)}.</p>`;
    $$('#folderList [data-open]').forEach(b => b.onclick = () => openPaths([b.dataset.open]));
  } catch (e) { info('Could not read the folder', esc(e.message)); }
};

/* ------------------------------------------------------------------ operator settings */
// Personal operating preferences, separate from the scenes: presets, speeds, pan/tilt and lens behaviour.
// Tally is left out on purpose: it belongs to the camera/studio setup, not to the operator.
const OPERATOR_SPEC = [
  ['Presets', ['OSJ:29', '#PST', '#UPVS', 'OSE:71', 'OSJ:A8', 'OSJ:A9', 'OSJ:AA', 'OSJ:AB', 'OSJ:AC', 'OSJ:AD', 'OSJ:AE', 'OSE:7C', 'OSE:7D', 'OSJ:5B', 'OSJ:D5', 'OSJ:2B', 'OSJ:2C', '#PRF']],
  ['Pan/tilt', ['OSJ:2D', '#SWZ', 'OAZ', '#SPF', 'OSJ:45', 'OSJ:46']],
  ['Lens', ['OAF', 'OSJ:D8', 'OSE:70', 'OSE:7A', 'OSJ:4E', 'OIS']],
];
const OPERATOR_ID = 'panasonic-ptz-operator';
const OPERATOR_PARAMS = (() => {
  const out = [];
  for (const [g, list] of OPERATOR_SPEC) for (const base of list) {
    const c = (window.PANA_COMMANDS || []).find(x => x.c && (x.c === base + '[Data]' || x.c === base + ':[Data]' || x.c.startsWith(base + ':[Data') || x.c.startsWith(base + '[Data')) && x.q);
    if (c) out.push({ cmd: base, q: c.q, t: base.startsWith('#') ? 'ptz' : 'cam', name: c.n, g, src: c });
  }
  return out;
})();
async function readOperatorFile(cam) {
  const read = await readParams(cam, OPERATOR_PARAMS);
  return {
    format: OPERATOR_ID, version: 1, generator: 'Panasonic Toolbox ' + (state.version || ''), created: new Date().toISOString(),
    camera: { ip: cam.ip, port: cam.port || 80, model: cam.model, title: cam.title || '', profile: profileFor(cam.model).fam },
    settings: read.filter(r => r.raw).map(r => ({ cmd: r.p.cmd, name: r.p.name, group: r.p.g, raw: r.raw })),
    unavailable: read.filter(r => !r.raw).map(r => ({ cmd: r.p.cmd, name: r.p.name, reason: r.err })),
  };
}

/* ------------------------------------------------------------------ export */
function renderExport() {
  const box = $('#expCams'); box.innerHTML = '';
  for (const c of state.cameras) {
    const l = document.createElement('label'); l.className = 'check camline';
    l.innerHTML = `<input type="checkbox" ${c.selected ? 'checked' : ''}><span class="mono">${esc(c.ip)}</span><span>${esc(c.title || c.model || '')}${c.zone ? ` <span class="pill">${esc(c.zone)}</span>` : ''}</span><span class="muted small">${c.scene ? 'Scene ' + c.scene + ' live' : ''}</span>`;
    $('input', l).onchange = e => { c.selected = e.target.checked; saveCams(); renderExport(); renderCams(); };
    box.appendChild(l);
  }
  selAllRow(box, state.cameras, c => c.selected, (c, v) => c.selected = v, () => { saveCams(); renderExport(); renderCams(); });
  $('#expCamsEmpty').classList.toggle('hidden', state.cameras.length > 0);
  renderExportScenes(); updateSel(); renderNameFields();
}
function renderExportScenes() {
  const sel = state.cameras.filter(c => c.selected);
  const max = Math.max(4, ...sel.map(c => c.model ? profileFor(c.model).scenes : 4));
  const box = $('#expScenes'); const prev = new Set($$('input', box).filter(i => i.checked).map(i => +i.value));
  box.innerHTML = Array.from({ length: max }, (_, i) => `<label><input type="checkbox" value="${i + 1}" ${prev.has(i + 1) ? 'checked' : ''}> Scene ${i + 1}</label>`).join('');
  $$('input', box).forEach(i => i.onchange = () => { $('input[name=expMode][value=pick]').checked = true; });
}
$('#expAll').onclick = () => { state.cameras.forEach(c => c.selected = true); saveCams(); renderExport(); renderCams(); };
$('#expNone').onclick = () => { state.cameras.forEach(c => c.selected = false); saveCams(); renderExport(); renderCams(); };

// Read the live scene, or the picked scenes (switching to each and back to the scene that was live).
async function readCamScenes(cam, mode, picked, status = () => { }) {
  if (!cam.model) await identify(cam);
  const orig = await getScene(cam);
  const scenes = [];
  const list = mode === 'active' ? [orig ?? 0] : picked.filter(n => n <= profileFor(cam.model).scenes);
  let current = orig;
  try {
    for (const n of list) {
      if (mode === 'pick' && n !== current) { await switchScene(cam, n); current = n; }
      status(`reading scene ${n}…`);
      scenes.push(await readSceneFile(cam, n));
    }
  } finally {
    if (orig && current !== orig) await switchScene(cam, orig);
  }
  return scenes;
}
$('#exportBtn').onclick = async () => {
  if (expKindNow() === 'engineering') return exportEngFile();
  const cams = state.cameras.filter(c => c.selected);
  if (!cams.length) return info('No cameras selected', 'Tick the cameras you want to export.');
  if (!state.bridgeOk && !(await checkBridge())) return;
  const kind = $('input[name=expKind]:checked').value;
  const mode = $('input[name=expMode]:checked').value;
  const picked = $$('#expScenes input:checked').map(i => +i.value);
  if (kind === 'scene' && mode === 'pick' && !picked.length) return info('No scenes chosen', 'Tick the scenes you want to export.');
  // read the live scene first, so the confirmation shows the real scene numbers (and which cameras do not answer)
  const offline = new Set();
  $('#exportBtn').disabled = true; $('#expSel').textContent = 'Checking the cameras…';
  await Promise.all(cams.map(async c => { try { if (!c.model) await identify(c); const n = await getScene(c); if (n != null) c.scene = n; else offline.add(c); } catch { offline.add(c); } }));
  $('#exportBtn').disabled = false; renderCams();
  // what each camera will give, and the file it goes into
  const plan = cams.map(c => {
    if (offline.has(c)) return { c, what: '<b class="warn-text">not reachable</b>', name: '', html: true };
    if (kind === 'operator') return { c, what: 'operator settings', name: operatorName(c) };
    const sc = mode === 'active' ? [c.scene || 1] : picked.filter(n => n <= (c.model ? profileFor(c.model).scenes : 4));
    return { c, what: mode === 'active' ? `live scene${c.scene ? ' (scene ' + c.scene + ')' : ''}` : sc.length ? 'scene ' + sc.join(', ') : 'nothing (this model has fewer scenes)', name: sc.length || kind === 'operator' ? fileName(c, sc.map(n => ({ scene: n }))) : '' };
  });
  const zip = cams.length > 1 && $('#expZip').checked;
  const jumps = kind === 'scene' && mode === 'pick';
  const ok = await ask({
    title: `Back up ${kind === 'operator' ? 'the operator settings of ' : ''}${cams.length} camera${cams.length > 1 ? 's' : ''}?`,
    wide: true, danger: jumps, ok: jumps ? 'Switch scenes and back up' : 'Back up',
    body: `<table class="tbl dense"><thead><tr><th>Camera</th><th>Reads</th><th>File</th></tr></thead><tbody>${plan.map(p => `<tr><td>${esc(camName(p.c))} <span class="mono muted small">${esc(p.c.ip)}</span></td><td>${p.html ? p.what : esc(p.what)}</td><td class="mono small">${esc(p.name)}</td></tr>`).join('')}</tbody></table>
      <p>${zip ? `The files go into one ZIP: <span class="mono">${esc(zipName(kind, cams.length))}</span>, ` : 'The files are saved '}in <span class="mono">${esc([state.saveDir || 'Downloads › Panasonic Toolbox', ...subFor(kind)].join(' › '))}</span>. Existing files are never overwritten.</p>
      ${jumps ? '<p><b>The picture will change:</b> to read these scenes each camera switches to them and then returns to the scene that was live. Do not do this while a camera is on air.</p>' : '<p>Reading changes nothing on the cameras.</p>'}`,
  });
  if (!ok) return;
  if (kind === 'operator') return exportOperator(cams);
  $('#exportBtn').disabled = true;
  const card = $('#expResultCard'); card.classList.remove('hidden');
  const out = $('#expResult'); out.innerHTML = '<div class="progress"><i></i></div><div id="expRows"></div>';
  const files = [];
  let done = 0; const total = cams.length;
  await Promise.all(cams.map(async cam => {
    const row = document.createElement('div'); row.className = 'note'; row.textContent = `${cam.ip}: working…`; $('#expRows').appendChild(row);
    cam.busy = true; renderCams();
    try {
      const scenes = await readCamScenes(cam, mode, picked, t => row.textContent = `${cam.ip}: ${t}`);
      const file = makeFile(cam, scenes);
      const name = fileName(cam, scenes);
      files.push({ name, text: JSON.stringify(file, null, 1), file });
      addImportFile(name, file);
      const cnt = scenes.map(s => `Scene ${s.scene}: ${s.params.length} settings${s.unavailable.length ? `, ${s.unavailable.length} not available in the current mode` : ''}`).join('. ');
      row.className = 'note ok'; row.innerHTML = `<b>${esc(cam.title || cam.model)}</b> <span class="mono">${esc(cam.ip)}</span><br>${esc(cnt)}<span class="row-actions"><button class="ghost small" data-dl>Save again</button><button class="ghost small" data-view>Show values</button></span>`;
      $('[data-dl]', row).onclick = () => download(name, JSON.stringify(file, null, 1), undefined, 'scene');
      $('[data-view]', row).onclick = () => showSceneTable(row, file);
      log(`${cam.ip}: exported. ${cnt}`);
    } catch (e) {
      row.className = 'note err'; row.textContent = `${cam.ip}: export failed. ${e.message}`; log(`${cam.ip}: export failed: ${e.message}`, 'ERROR');
    }
    cam.busy = false; renderCams();
    $('.progress > i', out).style.width = (++done / total * 100) + '%';
  }));
  if (files.length === 1) await download(files[0].name, files[0].text, undefined, 'scene');
  else if (files.length > 1) {
    if ($('#expZip').checked) await download(zipName('scene', files.length), makeZip(uniqueNames(files)), undefined, 'scene');
    else for (const f of files) await download(f.name, f.text, undefined, 'scene');
  }
  $('#exportBtn').disabled = false;
};
function showSceneTable(anchor, file) {
  const ex = anchor.nextElementSibling; if (ex && ex.classList.contains('scene-view')) { ex.remove(); return; }
  const div = document.createElement('div'); div.className = 'scene-view';
  div.innerHTML = file.scenes.map(s => `<h3>Scene ${s.scene}</h3><table class="tbl dense"><thead><tr><th>Group</th><th>Setting</th><th>Value</th><th>Raw</th></tr></thead><tbody>${s.params.map(p => `<tr><td class="grp">${esc(p.group)}</td><td>${esc(p.name)}</td><td>${esc(p.value)}</td><td class="mono">${esc(p.raw)}</td></tr>`).join('')}</tbody></table>${s.unavailable.length ? `<p class="muted small">Not available on this camera or in the current mode: ${s.unavailable.map(u => esc(u.name) + ' (' + esc(u.reason) + ')').join(', ')}</p>` : ''}`).join('');
  anchor.after(div);
}

function expKindUi() {
  const k = expKindNow();
  $('#expSceneBox').classList.toggle('disabled', k !== 'scene');
  $('#expCamOpts').classList.toggle('hidden', k === 'engineering');
  $('#expDefHint').classList.toggle('hidden', k !== 'engineering');
  if (k === 'engineering') {
    const ef = engFile();
    $('#expDefHint').innerHTML = ef
      ? `Saves the engineering file in a file: the system setup of ${esc(ef.fromName || ef.fromIp || '')} (${Object.keys(ef.values || {}).length} settings, saved ${new Date(ef.savedAt).toLocaleString('en-GB')}). Open that file on the Restore page to put it on cameras, also on another computer.`
      : 'There is no engineering file yet. Make one on the Engineering page: tick one camera and choose <b>Save engineering file…</b>.';
  }
}
$$('input[name=expKind]').forEach(r => r.onchange = expKindUi);
function expKindNow() { return $('input[name=expKind]:checked')?.value || 'scene'; }
function renderNameFields() {
  const k = expKindNow();
  $('#expName').value = store.get('name_' + k, ''); $('#expZipName').value = store.get('name_zip' + k, '');
  updNamePreview();
}
function updNamePreview() {
  const k = expKindNow();
  if (k === 'engineering') return;
  $('#expExt').textContent = k === 'operator' ? '.poper' : '.pscene.json';
  const cam = state.cameras.find(c => c.selected) || state.cameras[0] || { ip: '192.168.0.11', title: 'CAM1', model: 'AW-UE150', zone: 'Stage' };
  const ex = k === 'operator' ? operatorName(cam) : fileName(cam, [{ scene: cam.scene || 1 }]);
  $('#expNamePreview').innerHTML = `Example: <span class="mono">${esc(ex)}</span>${$('#expName').value.trim() ? '' : ' <span class="muted">(standard name while the field is empty)</span>'}`;
  $('#expZipPreview').innerHTML = `Example: <span class="mono">${esc(zipName(k, Math.max(2, state.cameras.filter(c => c.selected).length)))}</span>${$('#expZipName').value.trim() ? '' : ' <span class="muted">(standard name while the field is empty)</span>'}`;
  $('#expZipBox').classList.toggle('hidden', !$('#expZip').checked);
}
const tokenChips = (box, tokens, field) => {
  box.innerHTML = '<span class="muted small">Insert:</span> ' + Object.entries(tokens).map(([k, l]) => `<button type="button" class="chip" data-token="${k}" title="${esc(l)}">{${k}}</button>`).join('');
  $$('[data-token]', box).forEach(b => b.onclick = () => {
    const f = $(field), t = `{${b.dataset.token}}`, st = f.selectionStart ?? f.value.length;
    f.value = f.value.slice(0, st) + t + f.value.slice(f.selectionEnd ?? st); f.focus(); f.setSelectionRange(st + t.length, st + t.length);
    f.dispatchEvent(new Event('input'));
  });
};
tokenChips($('#expTokens'), NAME_TOKENS, '#expName');
tokenChips($('#expZipTokens'), ZIP_TOKENS, '#expZipName');
['#expName', '#expZipName'].forEach(sel => $(sel).addEventListener('input', () => { const k = expKindNow(); store.set('name_' + (sel === '#expName' ? k : 'zip' + k), $(sel).value.trim()); updNamePreview(); }));
$('#expZip').checked = store.get('expZip', true);
$('#expZip').addEventListener('change', () => { store.set('expZip', $('#expZip').checked); updNamePreview(); });
$$('input[name=expKind]').forEach(r => r.addEventListener('change', renderNameFields));
async function exportOperator(cams) {
  if (!state.bridgeOk && !(await checkBridge())) return;
  $('#exportBtn').disabled = true;
  $('#expResultCard').classList.remove('hidden');
  const out = $('#expResult'); out.innerHTML = '';
  const files = [];
  await Promise.all(cams.map(async cam => {
    const row = document.createElement('div'); row.className = 'note'; row.textContent = `${cam.ip}: reading operator settings…`; out.appendChild(row);
    try {
      if (!cam.model) await identify(cam);
      const f = await readOperatorFile(cam);
      const name = operatorName(cam);
      files.push({ name, text: JSON.stringify(f, null, 1) });
      addImportFile(name, f);
      row.className = 'note ok'; row.innerHTML = `<b>${esc(cam.title || cam.model)}</b> <span class="mono">${esc(cam.ip)}</span><br>${f.settings.length} operator settings${f.unavailable.length ? `, ${f.unavailable.length} not supported by this camera` : ''}`;
    } catch (e) { row.className = 'note err'; row.textContent = `${cam.ip}: export failed. ${e.message}`; }
  }));
  if (files.length === 1) await download(files[0].name, files[0].text, undefined, 'operator');
  else if (files.length > 1) await download(zipName('operator', files.length), makeZip(uniqueNames(files)), undefined, 'operator');
  $('#exportBtn').disabled = false;
}

/* ------------------------------------------------------------------ import: sources and jobs */
state.sources = []; state.jobs = [];
let srcId = 0, jobId = 0;
function addImportFile(name, file) {
  const target = state.cameras.find(c => c.ip === file?.camera?.ip)?.ip || '';
  if (file?.format === OPERATOR_ID && Array.isArray(file.settings)) {
    track('Open operator file', () => {
      const src = { id: ++srcId, fileName: name, file, sceneIdx: null, kind: 'operator' };
      state.sources.push(src);
      state.jobs.push({ id: ++jobId, srcId: src.id, target, targetScene: '', include: true });
    });
    return renderImports();
  }
  if (!file || file.format !== FORMAT_ID || !Array.isArray(file.scenes)) throw new Error('Not a Panasonic Toolbox file');
  track('Open scene file', () => file.scenes.forEach((s, i) => {
    const src = { id: ++srcId, fileName: name, file, sceneIdx: i, kind: 'scene' };
    state.sources.push(src);
    state.jobs.push({ id: ++jobId, srcId: src.id, target, targetScene: String(s.scene), include: true });
  }));
  renderImports();
}
const OPERATOR_CMDS = new Set(OPERATOR_PARAMS.map(p => p.cmd));
const srcParams = s => s.kind === 'operator' ? s.file.settings.filter(x => OPERATOR_CMDS.has(x.cmd)).length : s.file.scenes[s.sceneIdx].params.length;
const srcById = id => state.sources.find(s => s.id === +id);
const srcLabel = s => `${s.file.camera?.title || s.file.camera?.model || s.fileName}, ${s.kind === 'operator' ? 'operator file' : 'scene ' + s.file.scenes[s.sceneIdx].scene}`;
async function handleFiles(list) {
  for (const f of list) {
    try {
      await openBytes(f.name, new Uint8Array(await f.arrayBuffer()));
    } catch (e) { info(`Could not open ${esc(f.name)}`, esc(e.message)); log(`${f.name}: ${e.message}`, 'ERROR'); }
  }
}
$('#fileInput').onchange = e => { handleFiles([...e.target.files]); e.target.value = ''; };
const dz = $('#dropZone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); handleFiles([...e.dataTransfer.files]); });
$('#clearFilesBtn').onclick = () => { track('Clear import list', () => { state.sources = []; state.jobs = []; }); renderImports(); };
$('#addJobBtn').onclick = () => {
  if (!state.sources.length) return info('Open a scene file first', 'Drop a .pscene.json or .zip file in step 1.');
  const last = state.jobs[state.jobs.length - 1];
  track('Add destination', () => state.jobs.push({ id: ++jobId, srcId: last ? last.srcId : state.sources[0].id, target: '', targetScene: 'active', include: true }));
  renderImports();
};

function renderImports() {
  renderGrid();
  // step 1: list of opened scenes
  $('#srcList').innerHTML = state.sources.filter(x => !x.fromShow).length ? `<table class="tbl dense"><thead><tr><th>File</th><th>From camera</th><th>Scene</th><th>Settings</th><th></th></tr></thead><tbody>${state.sources.filter(x => !x.fromShow).map(s => `<tr><td>${esc(s.fileName)}</td><td>${esc(s.file.camera?.title || '')} <span class="mono muted">${esc(s.file.camera?.ip || '')}</span> <span class="muted small">${esc(s.file.camera?.model || '')}</span></td><td>${s.kind === 'operator' ? 'Operator file' : 'Scene ' + esc(s.file.scenes[s.sceneIdx].scene)}</td><td>${srcParams(s)}</td><td class="end"><button class="icon" data-src="${s.id}" aria-label="Remove">×</button></td></tr>`).join('')}</tbody></table>` : '';
  $$('#srcList [data-src]').forEach(b => b.onclick = () => { const id = +b.dataset.src; track('Remove file', () => { state.sources = state.sources.filter(s => s.id !== id); state.jobs = state.jobs.filter(j => j.srcId !== id); }); renderImports(); });
  // step 2: jobs
  const tb = $('#impTable tbody'); tb.innerHTML = '';
  for (const j of state.jobs) {
    const src = srcById(j.srcId); if (!src) continue;
    const tcam = state.cameras.find(c => c.ip === j.target);
    const nsc = tcam?.model ? profileFor(tcam.model).scenes : 4;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox" ${j.include ? 'checked' : ''} aria-label="Include"></td>
      <td><select data-k="srcId">${state.sources.map(s => `<option value="${s.id}" ${s.id === j.srcId ? 'selected' : ''}>${esc(srcLabel(s))}</option>`).join('')}</select></td>
      <td><select data-k="target"><option value="">Choose a camera</option>${state.cameras.map(c => `<option value="${esc(c.ip)}" ${j.target === c.ip ? 'selected' : ''}>${esc(c.ip)} ${esc(c.title || c.model || '')}</option>`).join('')}</select></td>
      <td>${src.kind === 'operator' ? '<span class="muted">Not scene-related</span>' : `<select data-k="targetScene"><option value="active" ${j.targetScene === 'active' ? 'selected' : ''}>Live scene${tcam?.scene ? ' (' + tcam.scene + ')' : ''}</option>${Array.from({ length: nsc }, (_, i) => `<option value="${i + 1}" ${j.targetScene === String(i + 1) ? 'selected' : ''}>Scene ${i + 1}</option>`).join('')}</select>`}</td>
      <td>${srcParams(src)}</td>
      <td class="end nowrap">${icoBtn('cmp', 'compare', 'Compare with what is on the camera now')} <button class="icon" data-act="del" aria-label="Remove">×</button></td>`;
    $('input', tr).onchange = e => { j.include = e.target.checked; updImpSel(); };
    $$('select', tr).forEach(se => se.onchange = () => { track('Change destination', () => { j[se.dataset.k] = se.dataset.k === 'srcId' ? +se.value : se.value; }); renderImports(); });
    $('[data-act=del]', tr).onclick = () => { track('Remove destination', () => { state.jobs = state.jobs.filter(x => x !== j); }); renderImports(); };
    $('[data-act=cmp]', tr).onclick = () => compareImport(j, tr);
    tb.appendChild(tr);
  }
  $('#impCount').textContent = state.jobs.length;
  $('#impEmpty').classList.toggle('hidden', state.jobs.length > 0);
  $('#impSelCam').innerHTML = '<option value="">Camera: keep</option>' + state.cameras.map(c => `<option value="${esc(c.ip)}">${esc(c.ip)} ${esc(c.title || c.model || '')}${c.zone ? ' · ' + esc(c.zone) : ''}</option>`).join('');
  updImpSel();
}
function updImpSel() {
  const n = state.jobs.filter(j => j.include).length;
  $('#impSelN').textContent = n; selBar($('#impSelBar'), n);
  selAllState($('#impSelAll'), state.jobs, j => j.include);
}
$('#impSelAll').onchange = () => { selAllClick($('#impSelAll'), state.jobs, j => j.include, (j, v) => j.include = v); renderImports(); };
$('#impSelApply').onclick = () => {
  const cam = $('#impSelCam').value, sc = $('#impSelScene').value; if (!cam && !sc) return;
  const js = state.jobs.filter(j => j.include);
  track(`Change ${js.length} destination(s)`, () => js.forEach(j => { if (cam) j.target = cam; if (sc && srcById(j.srcId)?.kind !== 'operator') j.targetScene = sc; }));
  renderImports();
};
$('#impDelSel').onclick = () => {
  const n = state.jobs.filter(j => j.include).length;
  track(`Remove ${n} row(s)`, () => { state.jobs = state.jobs.filter(j => !j.include); });
  renderImports();
};
async function compareImport(j, tr) {
  const cam = state.cameras.find(c => c.ip === j.target);
  if (!cam) return info('Choose a camera first', 'Pick the camera to compare with.');
  const src = srcById(j.srcId);
  if (src.kind === 'operator') return info('Compare is for scene files', 'Operator files are applied as a whole; the current values are saved as a backup first.');
  try {
    if (!cam.model) await identify(cam);
    const cur = await getScene(cam);
    const ts = j.targetScene === 'active' ? cur : +j.targetScene;
    if (ts !== cur) return info('Only the live scene can be compared', `The camera is on scene ${cur}. Comparing scene ${ts} would make the camera switch. Choose “Live scene” or switch the camera first.`);
    const s = src.file.scenes[src.sceneIdx];
    const params = s.params.map(x => paramIndex.get(x.cmd)).filter(Boolean);
    const now = new Map((await readParams(cam, params)).map(r => [r.p.cmd, r]));
    let diff = 0;
    const rows = s.params.map(x => { const n = now.get(x.cmd); const same = n?.raw && n.raw.toUpperCase() === x.raw.toUpperCase(); if (!same) diff++; return `<tr class="${same ? '' : 'diff'}"><td class="grp">${esc(x.group)}</td><td>${esc(x.name)}</td><td>${esc(x.value)} <span class="mono muted">${esc(dataPart(x.cmd, x.raw))}</span></td><td>${n?.raw ? esc(decode(paramIndex.get(x.cmd), n.raw)) + ' <span class="mono muted">' + esc(dataPart(x.cmd, n.raw)) + '</span>' : '<span class="muted">' + esc(n?.err || '–') + '</span>'}</td></tr>`; });
    const ex = tr.nextElementSibling; if (ex?.classList.contains('cmp-row')) ex.remove();
    const r = document.createElement('tr'); r.className = 'cmp-row';
    r.innerHTML = `<td colspan="6"><div class="row between"><p><b>${diff}</b> of ${s.params.length} settings differ from ${esc(cam.ip)} (scene ${cur}).</p><button class="ghost small">Close</button></div><table class="tbl dense"><thead><tr><th>Group</th><th>Setting</th><th>In the file</th><th>On the camera now</th></tr></thead><tbody>${rows.join('')}</tbody></table></td>`;
    $('button', r).onclick = () => r.remove();
    tr.after(r);
  } catch (e) { info('Compare failed', esc(e.message)); }
}

$('#importBtn').onclick = () => runImport(state.jobs.filter(j => j.include), {
  backup: $('#optBackup').checked, restore: $('#optRestore').checked, store: $('#optStore').checked, verify: $('#optVerify').checked, force: $('#optForce').checked,
});
async function runImport(jobs, opts, title = 'Restore these cameras?') {
  if (!jobs.length) return info('Nothing to import', 'Open a file and choose a camera for it in step 2.');
  const missing = jobs.filter(j => !state.cameras.some(c => c.ip === j.target));
  if (missing.length) return info('Choose a camera for every row', `${missing.length} row${missing.length > 1 ? 's have' : ' has'} no camera yet.`);
  if (!state.bridgeOk && !(await checkBridge())) return;
  const byCam = new Map();
  for (const j of jobs) { const c = state.cameras.find(x => x.ip === j.target); if (!byCam.has(c)) byCam.set(c, []); byCam.get(c).push(j); }
  const ok = await ask({
    title,
    wide: true,
    body: `<table class="tbl dense"><thead><tr><th>Camera</th><th>Gets</th><th>Into</th><th>Settings</th></tr></thead><tbody>${[...byCam].map(([c, js]) => js.map((j, k) => { const sr = srcById(j.srcId); const into = sr.kind === 'operator' ? 'the camera (operator settings)' : j.targetScene === 'active' ? `the live scene${c.scene ? ' (scene ' + c.scene + ')' : ''}` : `scene ${j.targetScene}${c.scene && +j.targetScene !== c.scene ? ' <span class="muted">(camera switches to it, then back)</span>' : ''}`;
        return `<tr><td>${k ? '' : `${esc(camName(c))} <span class="mono muted small">${esc(c.ip)}</span>`}</td><td>${esc(srcLabel(sr))}<div class="muted small mono">${esc(sr.fileName)}</div></td><td>${into}</td><td>${srcParams(sr)}</td></tr>`; }).join('')).join('')}</tbody></table>
      <ul class="tight">${opts.backup !== false ? '<li>The current settings of every destination are saved first as a backup file.</li>' : ''}${opts.verify ? '<li>Afterwards every value is read back to check it.</li>' : ''}<li>The picture of these cameras changes immediately. You can undo this afterwards.</li></ul>`,
    ok: 'Restore', danger: true,
  });
  if (!ok) return;
  $('#importBtn').disabled = true;
  // Recall (Shows) and Initialize (Engineering, Live) run here too: show the progress where it is written
  if (!$('#tab-import').classList.contains('active')) $('[role=tab][data-tab=import]').click();
  $('#impResultCard').classList.remove('hidden');
  const out = $('#impResult'); out.innerHTML = '';
  const backups = [], undos = [];
  await Promise.all([...byCam].map(async ([cam, js]) => {
    cam.busy = true; renderCams();
    for (const j of js) {
      const src = srcById(j.srcId);
      const row = document.createElement('div'); row.className = 'note'; out.appendChild(row);
      const setRow = (cls, html) => { row.className = 'note ' + cls; row.innerHTML = html; };
      try {
        const { r, undo, redo } = await runJob(cam, src, j.targetScene, opts, msg => setRow('', `${esc(cam.ip)}: ${esc(msg)}`));
        undos.push({ undo, redo });
        if (r.backup) backups.push(r.backup);
        const bad = r.failed.length + r.mismatch.length;
        setRow(bad ? 'warn' : 'ok', `<b>${esc(cam.title || cam.model)}</b> <span class="mono">${esc(cam.ip)}</span><br>${esc(srcLabel(src))}${r.scene ? ` into scene ${r.scene}` : ''}: ${r.applied} settings changed${r.unchanged ? `, ${r.unchanged} already right` : ''}` +
          (r.skipped.length ? `, ${r.skipped.length} skipped (not supported by ${esc(profileFor(cam.model).fam)})` : '') +
          (r.failed.length ? `<br>Not accepted by the camera: ${r.failed.map(f => esc(f.name) + ' (' + esc(f.err) + ')').join(', ')}` : '') +
          (r.mismatch.length ? `<br>Different after checking: ${r.mismatch.map(m => esc(m.name)).join(', ')}` : '') +
          (r.stored ? '<br>Stored in the scene file (UE160).' : ''));
        log(`${cam.ip}: imported ${srcLabel(src)}: ${r.applied} changed, ${r.unchanged || 0} already right, ${r.failed.length} refused, ${r.mismatch.length} different`);
      } catch (e) { setRow('err', `${esc(cam.ip)}: import failed. ${esc(e.message)}`); log(`${cam.ip}: import failed: ${e.message}`, 'ERROR'); }
    }
    cam.busy = false; try { await identify(cam); } catch { } renderCams();
  }));
  if (undos.length) pushHistory({
    label: `Import ${undos.length} file${undos.length > 1 ? 's' : ''}`, camera: true, many: byCam.size > 1,
    undo: async () => { toast('Undoing the import…'); for (const u of [...undos].reverse()) await u.undo(); log(`Import undone (${undos.length} file${undos.length > 1 ? 's' : ''})`); toast('Import undone: the cameras have their settings from before again'); },
    redo: async () => { toast('Redoing the import…'); for (const u of undos) await u.redo(); log('Import redone'); toast('Import redone'); },
  });
  if (backups.length === 1) await download(backups[0].name, backups[0].text, undefined, 'backup');
  else if (backups.length > 1) await download(`backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`, makeZip(backups), undefined, 'backup');
  $('#importBtn').disabled = false;
}

// Which mode makes a setting writable (found on an AW-UE150 V3.20 by trying every mode value).
const WRITE_FIRST = ['OSJ:4D'];
const COLOR_CORR = ['80', '81', '82', '83', '84', '85', '9A', '9B', '86', '87', '9C', '9D', '88', '89', '9E', '9F', '8A', '8B', '8C', '8D', '8E', '8F', '90', '91', '92', '93', '94', '95', '96', '97'].map(x => 'OSD:' + x);
const MODE_ENABLERS = [
  { ctl: 'ORS', on: '1', label: 'auto iris', deps: ['OSD:48'] },
  { ctl: 'OSJ:03', on: '1', label: 'shutter Step', deps: ['OSJ:06'] },
  { ctl: 'OSJ:03', on: '2', label: 'shutter Synchro', deps: ['OSJ:09'] },
  { ctl: 'OSJ:03', on: '3', label: 'shutter ELC', deps: ['OSD:BF'] },
  { ctl: 'OAW', on: '0', label: 'white ATW', deps: ['OSI:25', 'OSJ:0D', 'OSJ:0E'] },
  { ctl: 'OAW', on: '9', label: 'white VAR', deps: ['OSI:20'] },
  { ctl: 'OSE:72', on: '5', label: 'gamma F-REC', wait: 700, deps: ['OSA:10', 'OSA:0F'] },
  { ctl: 'OSE:72', on: '6', label: 'gamma V-REC', wait: 700, deps: ['OSA:25', 'OSA:21'] },
  { ctl: 'OSE:72', on: '7', label: 'gamma HLG', wait: 700, deps: ['OSI:40', 'OSI:41', 'OSI:42'], then: { ctl: 'OSI:40', on: '1', deps: ['OSI:41', 'OSI:42'] } },
  { ctl: 'OSA:2D', on: '1', label: 'knee Manual', deps: ['OSA:20', 'OSA:24'] },
  { ctl: 'OSE:31', on: '3', label: 'matrix User', deps: ['OSD:A4', 'OSD:A5', 'OSD:A6', 'OSD:A7', 'OSD:A8', 'OSD:A9', 'OSJ:1C', 'OSJ:1D', ...COLOR_CORR] },
];
async function importScene(cam, sceneData, targetScene, opts, progress) {
  sceneData = sceneWbFixed(sceneData);
  if (!cam.model) await identify(cam);
  const prof = profileFor(cam.model);
  const allowed = new Map(paramsFor(cam).map(p => [p.cmd, p]));
  const list = [], skipped = [];
  for (const x of sceneData.params) {
    if (!x.raw) continue;
    if (allowed.has(x.cmd) || (opts.force && paramIndex.has(x.cmd))) list.push({ ...x, p: allowed.get(x.cmd) || paramIndex.get(x.cmd) });
    else skipped.push(x);
  }
  const orig = await getScene(cam);
  const target = targetScene === 'active' ? orig : +targetScene;
  if (!target) throw new Error('Cannot determine the active scene');
  if (target > prof.scenes) throw new Error(`Camera has no scene ${target}`);
  if (target !== orig) { progress(`switching to scene ${target}…`); await switchScene(cam, target); }
  let backup = null, before = null;
  if (!opts.noBackupRead) {
    progress('reading current settings…');
    before = await readSceneFile(cam, target);
    if (opts.backup) backup = { name: fileName(cam, [before], '_BACKUP'), text: JSON.stringify(makeFile(cam, [before]), null, 1) };
  }
  const send = async (items, label) => {
    progress(label);
    const res = await batch(cam, items.map(x => ({ type: x.cmd.startsWith('#') ? 'ptz' : 'cam', cmd: x.send })));
    return items.map((x, i) => ({ x, res: res[i], ok: res[i]?.ok && !isErr(res[i].body) }));
  };
  // Only what differs from the camera's current values is sent. A value that already matches needs no command, and
  // many of those cannot be written in the current mode anyway (the camera answers ER2, e.g. Synchro Value while the
  // shutter is in Step mode, Matrix values while the matrix type is Normal).
  const now = new Map((before?.params || []).map(b => [b.cmd, (b.raw || '').toUpperCase()]));
  const unchanged = before ? list.filter(x => now.get(x.cmd) === x.raw.toUpperCase()) : [];
  const toSend0 = before ? list.filter(x => now.get(x.cmd) !== x.raw.toUpperCase()) : list;
  // Some settings make the camera recalculate others: writing G Axis (OSJ:4D) recalculates the AWB colour temperature and
  // R/B gain (OSJ:4A/4B/4C) on an AW-UE150, so those must come after it. (Found on a real AW-UE150 V3.20.)
  const toSend = [...toSend0.filter(x => WRITE_FIRST.includes(x.cmd)), ...toSend0.filter(x => !WRITE_FIRST.includes(x.cmd))];
  // Pass 1: everything that differs, in order (modes come first in the list)
  let pending = toSend.map(x => ({ ...x, send: x.raw }));
  let r = await send(pending, `setting ${pending.length} values…`);
  // Pass 2: retry what failed (e.g. a value that only becomes valid after a mode further down)
  pending = r.filter(z => !z.ok).map(z => z.x);
  if (pending.length) { r = await send(pending, `retrying ${pending.length} values…`); pending = r.filter(z => !z.ok).map(z => ({ ...z.x, lastErr: z.res?.body || z.res?.error })); }
  // Pass 3: multi-field commands (e.g. OSI:20:colortemp:status) -> first field only
  const multi = pending.filter(x => !x.cmd.startsWith('#') && dataPart(x.cmd, x.raw).includes(':'));
  if (multi.length) {
    r = await send(multi.map(x => ({ ...x, send: x.cmd + ':' + dataPart(x.cmd, x.raw).split(':')[0] })), 'simplifying fields…');
    const fixed = new Set(r.filter(z => z.ok).map(z => z.x.cmd));
    pending = pending.filter(x => !fixed.has(x.cmd));
  }
  // Values that only become writable in another mode (the camera answers ER2): switch the mode that enables
  // them, write them, then put the mode to the value it should have (the file's, else what the camera had).
  const goal = c => (list.find(x => x.cmd === c)?.raw) || (before?.params || []).find(x => x.cmd === c)?.raw;
  for (const en of MODE_ENABLERS) {
    const deps = pending.filter(x => en.deps.includes(x.cmd));
    if (!deps.length) continue;
    const back = goal(en.ctl);
    progress(`setting ${deps.length} value${deps.length > 1 ? 's' : ''} that need ${en.label}…`);
    const items = [{ cmd: `${en.ctl}:${en.on}` }, { sleepMs: en.wait || 300 }];
    const inner = en.then ? deps.filter(x => en.then.deps.includes(x.cmd)) : [];
    const outer = deps.filter(x => !inner.includes(x));
    items.push(...outer.map(x => ({ cmd: x.raw })));
    if (inner.length) { // e.g. HLG Knee Point: gamma HLG and HLG Knee on
      items.push({ cmd: `${en.then.ctl}:${en.then.on}` }, ...inner.map(x => ({ cmd: x.raw })));
      const b2 = goal(en.then.ctl); if (b2) items.push({ cmd: b2 });
    }
    if (back) items.push({ cmd: back }, { sleepMs: en.wait || 300 });
    const r3 = await batch(cam, items);
    const okCmds = new Set(items.map((it, i) => ({ it, r: r3[i] })).filter(z => z.it.cmd && z.r?.ok && !isErr(z.r.body)).map(z => z.it.cmd));
    pending = pending.filter(x => !(deps.includes(x) && okCmds.has(x.raw)));
  }
  const failed = pending.map(x => ({ cmd: x.cmd, name: x.name, err: /^er2/i.test(x.lastErr || '') ? 'ER2: not changeable in the current mode' : String(x.lastErr || '').slice(0, 3) || 'error' }));
  let stored = false;
  if (opts.store && prof.fam === 'UE160') {
    progress('storing in scene file…');
    const [s] = await batch(cam, [{ cmd: 'OSL:90:' + target }, { sleepMs: 500 }]);
    stored = s.ok && !isErr(s.body);
  }
  let mismatch = [];
  if (opts.verify) {
    progress('checking…');
    const okList = toSend.filter(x => !failed.some(f => f.cmd === x.cmd));
    const back = await readParams(cam, okList.map(x => x.p));
    let off = back.map((b, i) => ({ b, x: okList[i] })).filter(({ b, x }) => b.raw && b.raw.toUpperCase() !== x.raw.toUpperCase()).map(({ x }) => x);
    if (off.length) { // the camera recalculated some values after a related write: write those once more and check again
      progress(`writing ${off.length} value${off.length > 1 ? 's' : ''} again…`);
      await send(off.map(x => ({ ...x, send: x.raw })), `writing ${off.length} again…`);
      await batch(cam, [{ sleepMs: 300 }]);
      const again = await readParams(cam, off.map(x => x.p));
      off = again.map((b, i) => ({ b, x: off[i] })).filter(({ b, x }) => b.raw && b.raw.toUpperCase() !== x.raw.toUpperCase()).map(({ x }) => x);
    }
    mismatch = off.map(x => ({ cmd: x.cmd, name: x.name }));
  }
  if (opts.restore && target !== orig && orig) { progress(`returning to scene ${orig}…`); await switchScene(cam, orig); }
  return { scene: target, applied: toSend.length - failed.length, unchanged: unchanged.length, skipped, failed, mismatch, stored, backup, before };
}




async function importOperator(cam, data, opts, progress) {
  if (!cam.model) await identify(cam);
  progress('reading current operator settings…');
  const before = await readOperatorFile(cam);
  const backup = opts.backup ? { name: operatorName(cam, '_BACKUP'), text: JSON.stringify(before, null, 1) } : null;
  const known = new Map(OPERATOR_PARAMS.map(p => [p.cmd, p]));
  const all = data.settings.filter(x => x.raw && known.has(x.cmd));
  // only what differs (see importScene: values that already match may not be writable in the current mode)
  const now = new Map((before?.settings || []).map(b => [b.cmd, (b.raw || '').toUpperCase()]));
  const list = all.filter(x => now.get(x.cmd) !== x.raw.toUpperCase());
  progress(`setting ${list.length} values…`);
  let res = await batch(cam, list.map(x => ({ type: x.cmd.startsWith('#') ? 'ptz' : 'cam', cmd: x.raw })));
  let failed = list.map((x, i) => ({ x, r: res[i] })).filter(z => !(z.r?.ok && !isErr(z.r.body)));
  if (failed.length) { res = await batch(cam, failed.map(z => ({ type: z.x.cmd.startsWith('#') ? 'ptz' : 'cam', cmd: z.x.raw }))); failed = failed.map((z, i) => ({ x: z.x, r: res[i] })).filter(z => !(z.r?.ok && !isErr(z.r.body))); }
  return { scene: null, applied: list.length - failed.length, unchanged: all.length - list.length, skipped: data.settings.filter(x => !known.has(x.cmd)), failed: failed.map(z => ({ cmd: z.x.cmd, name: z.x.name, err: /^er2/i.test(z.r?.body || '') ? 'ER2: not changeable in the current mode' : (z.r?.body || z.r?.error || 'ER').slice(0, 8) })), mismatch: [], stored: false, backup, before };
}
// Run one import job (scene or operator) and return its result plus how to undo/redo it.
async function runJob(cam, src, targetScene, opts, progress) {
  if (src.kind === 'operator') {
    const r = await importOperator(cam, src.file, opts, progress);
    return { r, undo: () => importOperator(cam, r.before, { backup: false }, () => { }), redo: () => importOperator(cam, src.file, { backup: false }, () => { }) };
  }
  // Undo and redo also read the camera first, so only the settings that differ are sent (a few seconds instead of minutes).
  const sceneData = src.file.scenes[src.sceneIdx];
  const r = await importScene(cam, sceneData, targetScene, opts, progress);
  const o2 = { ...opts, backup: false, verify: false, };
  return { r, undo: () => importScene(cam, r.before, String(r.scene), o2, () => { }), redo: () => importScene(cam, sceneData, String(r.scene), o2, () => { }) };
}

/* ------------------------------------------------------------------ parameters: scene file contents */
const FAM_TEXT = { UE150: 'AW-UE150 / UE155 / HE145', UE150A: 'AW-UE150A', UE160: 'AW-UE160', UE100: 'AW-UE100', UE80: 'AW-UE80 / UE50 / UE40 / UE30', GENERIC: 'Other models' };
function renderParamTab() {
  const sel = $('#paramFam');
  if (!sel.options.length) sel.innerHTML = Object.keys(CATALOG).map(f => `<option value="${f}">${esc(FAM_TEXT[f] || f)}</option>`).join('');
  const fam = sel.value; const words = $('#paramSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const gsel = $('#paramGroup'), groups = [...new Set(CATALOG[fam].map(p => p.g))], g = groups.includes(gsel.value) ? gsel.value : '';
  gsel.innerHTML = '<option value="">All groups</option>' + groups.map(x => `<option ${x === g ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const list = CATALOG[fam].filter(p => (!g || p.g === g) && words.every(w => (p.name + ' ' + p.cmd + ' ' + p.q + ' ' + p.g).toLowerCase().includes(w)));
  $('#sceneCount').textContent = list.length;
  $('#paramInfo').textContent = `${CATALOG[fam].length} settings belong to a scene on the ${FAM_TEXT[fam] || fam}. Source: the list of commands that belong to a scene in Panasonic's interface specification for this model.` + (fam === 'GENERIC' ? ' For other models every known scene command is tried; whatever the camera does not support is skipped.' : '');
  $('#paramTable tbody').innerHTML = list.map(p => `<tr><td class="grp">${esc(p.g)}</td><td>${esc(p.name)}</td><td class="mono">${esc(p.t === 'ptz' ? p.cmd + '[Data]' : p.cmd + ':[Data]')}</td><td class="mono">${esc(p.q)}</td><td class="small muted">${esc(rangeText(p))}</td></tr>`).join('');
}
function rangeText(p) {
  const parts = [];
  if (p.dec?.kind === 'lin') parts.push(`${p.dec.lo.toString(16).toUpperCase()}h…${p.dec.hi.toString(16).toUpperCase()}h = ${p.dec.vlo}…${p.dec.vhi}${p.dec.unit || ''}`);
  if (p.dec?.kind === 'enum') parts.push(Object.entries(p.dec.map).map(([k, v]) => `${k}=${v}`).join(', '));
  if (p.sup) parts.push(p.sup);
  return parts.join('; ');
}
$('#paramFam').onchange = renderParamTab;
$('#paramGroup').onchange = renderParamTab;
$('#paramCsv').onclick = () => {
  const fam = $('#paramFam').value;
  const csv = ['Group;Setting;Set command;Query command;Values'].concat(CATALOG[fam].map(p => [p.g, p.name, p.cmd, p.q, rangeText(p)].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))).join('\r\n');
  download(`panasonic_scene_parameters_${fam}.csv`, '﻿' + csv, 'text/csv', 'params');
};

/* ------------------------------------------------------------------ parameters: operator file contents */
function operatorValues(c) {
  if (!c?.d || (c.d.length === 1 && (c.d[0] === '-' || c.d[0] === '※'))) return '';
  const d = c.d.map(x => x.replace(/h$/i, '')), v = c.v;
  if (d.length !== v.length || !v.join('') || d.some(x => x !== '-' && !/^[0-9A-F]{1,5}$/i.test(x))) return valueHint(c);
  // "00, -, 1E" with "0, -, 30" is a range: 00…1E = 0…30
  if (d.length === 3 && d[1] === '-') return `${d[0]}…${d[2]} = ${v[0]}…${v[2]}`;
  return d.map((x, i) => `${x}=${v[i]}`).join(', ');
}
function renderOperatorTab() {
  const words = $('#paramSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const gsel = $('#operGroup'), groups = OPERATOR_SPEC.map(x => x[0]), g = groups.includes(gsel.value) ? gsel.value : '';
  gsel.innerHTML = '<option value="">All groups</option>' + groups.map(x => `<option ${x === g ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const list = OPERATOR_PARAMS.filter(p => (!g || p.g === g) && words.every(w => (p.name + ' ' + p.cmd + ' ' + p.q + ' ' + p.g).toLowerCase().includes(w)));
  $('#operCount').textContent = list.length;
  $('#operInfo').textContent = `${OPERATOR_PARAMS.length} settings go into an operator file (.poper): an operator's own way of working, separate from the scenes. Tally is not included; that stays with the camera. A camera skips whatever its model does not support.`;
  $('#operTable tbody').innerHTML = list.map(p => `<tr><td class="grp">${esc(p.g)}</td><td>${esc(p.name)}</td><td class="mono">${esc(p.src.c)}</td><td class="mono">${esc(p.q)}</td><td class="small muted">${esc(operatorValues(p.src))}</td><td class="small muted">${esc(p.src.m.join(', '))}</td></tr>`).join('');
}
$('#operGroup').onchange = renderOperatorTab;
$('#operCsv').onclick = () => {
  const csv = ['Group;Setting;Set command;Query command;Values;Models'].concat(OPERATOR_PARAMS.map(p => [p.g, p.name, p.src.c, p.q, operatorValues(p.src), p.src.m.join(', ')].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))).join('\r\n');
  download('panasonic_operator_parameters.csv', '\ufeff' + csv, 'text/csv', 'params');
};

/* ------------------------------------------------------------------ parameters: REST commands */
const COMMANDS = window.PANA_COMMANDS || [];
const pad2 = n => String(n).padStart(2, '0');
function encCmd(cmd) { return cmd.replace(/%/g, '%25').replace(/#/g, '%23').replace(/&/g, '%26').replace(/ /g, '%20').replace(/\+/g, '%2B'); }
function httpTarget() {
  const v = $('#httpCam').value;
  const c = state.cameras.find(x => x.ip === v);
  return c ? { ip: c.ip, port: c.port || 80 } : { ip: $('#httpIp').value.trim() || '192.168.0.10', port: +$('#httpPort').value || 80 };
}
function cmdUrl(t, cmd, target = httpTarget()) {
  return `http://${target.ip}${target.port && +target.port !== 80 ? ':' + target.port : ''}/cgi-bin/${t === 'ptz' ? 'aw_ptz' : 'aw_cam'}?cmd=${encCmd(cmd)}&res=1`;
}
function renderHttpTargets() {
  const sel = $('#httpCam'); const cur = sel.value;
  sel.innerHTML = `<option value="">Other IP address</option>` + state.cameras.map(c => `<option value="${esc(c.ip)}">${esc(c.ip)} ${esc(c.title || c.model || '')}</option>`).join('');
  sel.value = state.cameras.some(c => c.ip === cur) ? cur : (state.cameras[0]?.ip || '');
  $('#httpIpWrap').classList.toggle('hidden', !!sel.value);
  $$('.urlrow').forEach(r => r.update && r.update());
  if (!$('#cmdModel').options.length) {
    const models = [...new Set(COMMANDS.flatMap(c => c.m.map(m => m.replace('*', ''))))].sort();
    $('#cmdModel').innerHTML = `<option value="">All models</option>` + models.map(m => `<option>${m}</option>`).join('');
  }
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  if (btn) { // keep the button's width, so nothing next to it moves
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.style.minWidth = btn.offsetWidth + 'px'; btn.classList.add('copied'); btn.textContent = 'Copied';
    clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = btn.dataset.label; btn.classList.remove('copied'); }, 1400);
  }
}
function urlRow(t, cmdFn, extraHtml = '') {
  const wrap = document.createElement('div'); wrap.className = 'urlrow';
  wrap.innerHTML = `${extraHtml}<code class="url"></code><button class="ghost small" data-copy>Copy link</button><button class="ghost small" data-send>Send</button><span class="muted small" data-out></span>`;
  const upd = () => { $('code', wrap).textContent = cmdUrl(t, cmdFn(wrap)); };
  $$('input,select', wrap).forEach(i => i.addEventListener('input', upd));
  $('[data-copy]', wrap).onclick = e => copyText($('code', wrap).textContent, e.target);
  $('[data-send]', wrap).onclick = () => sendCmd(t, cmdFn(wrap), $('[data-out]', wrap));
  wrap.update = upd; upd();
  return wrap;
}

// The query that reads back the current value of a set command, taken from the command list (for undo).
function queryFor(t, cmd) {
  for (const x of COMMANDS) {
    if (!x.q || x.t !== t || !x.c) continue;
    const re = new RegExp('^' + x.c.split(/\[Data\d*\]/).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+') + '$');
    if (re.test(cmd)) return x.q;
  }
  return null;
}
// Common actions: shown first in the command list. 'p' = preset number 1-100 (sent as 00-99).
const COMMON = [
  ['Zoom in (tele)', 'ptz', '#Z75'], ['Zoom out (wide)', 'ptz', '#Z25'], ['Zoom stop', 'ptz', '#Z50'],
  ['Focus near', 'ptz', '#F25'], ['Focus far', 'ptz', '#F75'], ['Focus stop', 'ptz', '#F50'],
  ['Auto focus on', 'ptz', '#D11'], ['Manual focus', 'ptz', '#D10'], ['One-push auto focus', 'cam', 'OSE:69:1'],
  ['Auto iris on', 'ptz', '#D31'], ['Manual iris', 'ptz', '#D30'],
  ['Night mode on (infrared, IR cut filter out)', 'ptz', '#D61'], ['Night mode off (day)', 'ptz', '#D60'],
  ['Pan left', 'ptz', '#P25'], ['Pan right', 'ptz', '#P75'], ['Tilt up', 'ptz', '#T75'], ['Tilt down', 'ptz', '#T25'],
  ['Stop pan and tilt', 'ptz', '#PTS5050'], ['Home position', 'ptz', '#APC80008000'],
  ['Recall preset', 'ptz', '#R[Data]', 'p'], ['Store preset', 'ptz', '#M[Data]', 'p'],
  ['Scene 1', 'cam', 'XSF:1'], ['Scene 2', 'cam', 'XSF:2'], ['Scene 3', 'cam', 'XSF:3'], ['Scene 4', 'cam', 'XSF:4'],
  ['Auto white balance (AWB)', 'cam', 'OWS'], ['Auto black balance (ABB)', 'cam', 'OAS'],
  ['Color bars on', 'cam', 'DCB:1'], ['Color bars off', 'cam', 'DCB:0'],
  ['Power on', 'ptz', '#O1'], ['Standby', 'ptz', '#O0'],
  ['Red tally on', 'cam', 'TLR:1'], ['Red tally off', 'cam', 'TLR:0'], ['Green tally on', 'cam', 'TLG:1'], ['Green tally off', 'cam', 'TLG:0'],
].map(([n, t, c, p]) => ({ n, t, c, q: queryFor(t, c), d: p ? ['1', '-', '100'] : ['-'], v: p ? ['Preset 1', '-', 'Preset 100'] : [''], m: ['Most models'], common: 1, preset: !!p }));
['#httpCam', '#httpIp', '#httpPort'].forEach(s => $(s).addEventListener('input', () => { $('#httpIpWrap').classList.toggle('hidden', !!$('#httpCam').value); $$('#cmdTable tr').forEach(r => r.update && r.update()); }));

// Value lists can have a part per model, e.g. d = [0, 1, 'UE160', 0, 1], v = [Normal, High Sens., 'UE160', Normal, Low Light].
const MODEL_MARK = /^(U[EBR]|H[ER])\d{1,3}[A-Z]?(,(U[EBR]|H[ER])\d{1,3}[A-Z]?)*$/i;
function enumOpts(c) {
  const d = c.d, v = c.v;
  if (!d || d.length !== v.length || d.length < 2 || d.length > 80) return null;
  // split into the general part and the per-model parts
  const parts = [{ model: '', d: [], v: [] }];
  d.forEach((x, i) => {
    if (MODEL_MARK.test(x) && v[i] === x) parts.push({ model: x.toUpperCase(), d: [], v: [] });
    else { parts[parts.length - 1].d.push(x); parts[parts.length - 1].v.push(v[i]); }
  });
  const okPart = pt => pt.d.length && pt.d.every(x => x !== '-' && /^[0-9A-F]{1,5}h?$/i.test(x));
  if (!parts.every(pt => okPart(pt) || (!pt.d.length && pt.model === ''))) return null;
  const opts = new Map(); // value -> { general label, model labels }
  for (const pt of parts) pt.d.forEach((x, i) => {
    const val = x.replace(/h$/i, '');
    if (!opts.has(val)) opts.set(val, { base: '', alt: [] });
    const o = opts.get(val);
    if (!pt.model) o.base = pt.v[i];
    else if (pt.v[i].toLowerCase() !== o.base.toLowerCase()) o.alt.push(`${pt.model.replace(/,/g, '/')}: ${pt.v[i]}`);
  });
  if (opts.size < 2) return null;
  return [...opts].map(([val, o]) => ({ val, label: `${val}: ${o.base || o.alt.shift()?.replace(/^[^:]+: /, '') || ''}${o.alt.length ? ` (${o.alt.join(', ')})` : ''}` }));
}
function valueHint(c) {
  if (!c.d || (c.d.length === 1 && (c.d[0] === '-' || c.d[0] === '※'))) return '';
  return (c.d.join(' ') + (c.v.join('') ? '  →  ' + c.v.join(' ') : '')).slice(0, 300);
}
// Categories for the command list, from the command's name and code
const CMD_CATS = [
  ['lens', 'Lens: zoom, focus, iris', /zoom|focus|iris|\bOIS\b|stabili|\bAF\b|lens|extender|\b(#Z|#F|#I|#AX)/i],
  ['pt', 'Pan and tilt', /\bpan\b|tilt|P\/T|\bPTS|\bAPC|\bAPS|position|limit|speed|install/i],
  ['preset', 'Presets', /preset|#R\[|#M\[|recall|memory/i],
  ['image', 'Picture: gain, white, black, shutter', /gain|white|black|\bAWB|\bABB|\bAWC|\bABC|shutter|\bND\b|filter|gamma|knee|matrix|detail|chroma|color|colour|saturation|hue|flare|pedestal|level|skin|contrast|brightness|DRS|iris|day\/night|night|ATW|white clip|linear|back ?light|haze|HDR|HLG|SDR|spotlight|flicker|intelligent|shooting mode/i],
  ['scene', 'Scene files', /scene/i],
  ['tally', 'Tally and indicators', /tally|lamp|LED|indicator/i],
  ['audio', 'Audio and recording', /audio|\bREC\b|record/i],
  ['video', 'Video format and outputs', /format|output|SDI|HDMI|\b12G|\b3G|frequency|frame|resolution|down.?con|\bUHD|\bHD\b|genlock|sync|\bIP out|bar|color bar|crop|phase|SC coarse|D\/C/i],
  ['stream', 'Streaming and IP video', /stream|NDI|SRT|RTMP|RTSP|H\.26|JPEG|\bIP video|multicast/i],
  ['system', 'Power, network and system', /power|standby|network|\bIP\b|address|version|model|error|status|fan|temperature|title|name|date|time|reset|login|user|OSD|menu|lock|language|USB|mirror|privacy|SFP|option device|DC out|conference/i],
];
function cmdCat(c) {
  const s = `${c.n} ${c.c} ${c.q || ''}`;
  for (const [k, , re] of CMD_CATS) if (re.test(s)) return k;
  return 'other';
}
const SCENE_CODES = new Set(Object.values(window.PANA_CATALOG || {}).flat().map(p => p.cmd));
const isSceneCmd = c => { const m = /^(#?[A-Z]+(?::[0-9A-F]{2})?)/.exec(c.c || ''); return !!m && (SCENE_CODES.has(m[1]) || SCENE_CODES.has(m[1].replace(/:$/, ''))); };
const hasValue = c => /\[Data/.test(c.c || '');
function matchKind(c, kind) {
  if (!kind) return true;
  if (kind === 'action') return !hasValue(c);
  if (kind === 'setting') return hasValue(c);
  if (kind === 'readable') return !!c.q;
  if (kind === 'scene') return isSceneCmd(c);
  return true;
}
$('#cmdCat').innerHTML = '<option value="">All categories</option>' + CMD_CATS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('') + '<option value="other">Other</option>';
function matchType(c, type) {
  if (!type) return true;
  if (type === 'common') return !!c.common;
  if (type === 'rp') return !!c.rp;
  return !c.common && !c.rp && c.t === type;
}
function renderCmds() {
  const words = $('#paramSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const m = $('#cmdModel').value, type = $('#cmdType').value, cat = $('#cmdCat').value, kind = $('#cmdKind').value;
  const extra = c => (!cat || (c._cat ??= cmdCat(c)) === cat) && matchKind(c, kind);
  const match = c => words.every(w => (c.n + ' ' + c.c + ' ' + (c.q || '')).toLowerCase().includes(w));
  const common = COMMON.filter(c => match(c) && matchType(c, type) && !m && extra(c));
  const list = COMMANDS.filter(c => c.c && (!m || c.m.some(x => x.replace('*', '') === m)) && matchType(c, type) && match(c) && extra(c));
  list.sort((x, y) => (y.m.length - x.m.length) || x.n.localeCompare(y.n)); // widely supported first
  const all = [...common, ...list];
  $('#cmdCount').textContent = all.length;
  const shown = all.slice(0, 120);
  const tb = $('#cmdTable tbody'); tb.innerHTML = '';
  for (const c of shown) tb.appendChild(cmdRow(c));
  $('#cmdMore').textContent = all.length > shown.length ? `Showing the first ${shown.length} of ${all.length}. Search or filter to narrow the list.` : (all.length ? '' : 'No commands match.');
}
// One row: name, value field(s), the link for the selected camera (always visible), and actions.
function cmdRow(c) {
  const tr = document.createElement('tr'); tr.className = 'cmdrow';
  // Read-only values (Model Number, Software Version): the button sends the query, the camera has nothing to set
  const ro = !!(c.q && c.d?.length === 1 && c.d[0] === '');
  const holders = ro ? [] : c.c.match(/\[Data\d*\]/g) || [];
  const opts = holders.length === 1 && !c.preset ? enumOpts(c) : null;
  const inputs = holders.map((h, i) => c.preset
    ? `<input data-i="${i}" type="number" min="1" max="100" value="1" class="num" aria-label="Preset number" title="Preset number 1-100">`
    : opts ? `<select data-i="${i}" aria-label="Value">${opts.map(o => `<option value="${esc(o.val)}">${esc(o.label)}</option>`).join('')}</select>`
    : `<input data-i="${i}" class="mono val" placeholder="${esc(holders.length > 1 ? h.replace(/[[\]]/g, '') : 'value')}" title="${esc(valueHint(c))}">`).join(' ');
  const pills = (c.common ? ' <span class="pill ok">Common</span>' : '') + (c.rp ? ' <span class="pill info">Controller</span>' : '');
  tr.innerHTML = `<td class="fn"><div>${esc(c.n)}${pills}</div><div class="muted small">${esc(c.c)}${c.common ? '' : ' · ' + esc(c.m.join(', '))}</div>${valueHint(c) && !c.preset ? `<div class="muted small hintline">${esc(valueHint(c))}</div>` : ''}</td>
    <td class="valcell">${inputs || '<span class="muted">–</span>'}</td>
    <td class="linkcell"><code class="url"></code>${c.q ? '<div class="small muted qline">Query: <code class="qurl"></code></div>' : ''}</td>
    <td class="end nowrap acts"><button class="ghost small" data-act="copy">Copy</button><button class="ghost small" data-act="send">Send</button><button class="ghost small" data-act="script" title="Add to a script for Companion">+ Script</button><div class="small muted out"></div></td>`;
  const val = el => c.preset ? pad2(Math.max(1, Math.min(100, +el.value || 1)) - 1) : (el?.value || '').trim();
  const build = () => { if (ro) return c.q; let i = 0; return c.c.replace(/\[Data\d*\]/g, () => val($(`[data-i="${i++}"]`, tr))); };
  tr.update = () => { $('code.url', tr).textContent = cmdUrl(c.t, build()); if (c.q) $('code.qurl', tr).textContent = cmdUrl(c.t, c.q); };
  $$('[data-i]', tr).forEach(el => el.addEventListener('input', tr.update));
  $('[data-act=copy]', tr).onclick = e => copyText(cmdUrl(c.t, build()), e.target);
  $('[data-act=send]', tr).onclick = () => sendCmd(c.t, build(), $('.out', tr), ro ? null : c);
  $('[data-act=script]', tr).onclick = () => addToScript(c.preset ? `${c.n} ${$('[data-i="0"]', tr).value}` : c.n, c.t, build());
  tr.update();
  return tr;
}
$('#paramSearch').addEventListener('input', () => { renderCmds(); renderParamTab(); renderOperatorTab(); });
$('#cmdModel').addEventListener('change', renderCmds);
$('#cmdType').addEventListener('change', renderCmds);
$('#cmdCat').addEventListener('change', renderCmds);
$('#cmdKind').addEventListener('change', renderCmds);
$('#cmdReset').onclick = () => { ['#cmdType', '#cmdCat', '#cmdKind', '#cmdModel'].forEach(s => $(s).value = ''); $('#paramSearch').value = ''; renderCmds(); renderParamTab(); renderOperatorTab(); };

/* ---- script builder for Companion ---- */
state.script = store.get('script', []);
const saveScript = () => store.set('script', state.script);
function addToScript(name, t, cmd) {
  if (/\[Data/.test(cmd) || /:$/.test(cmd)) return info('Fill in a value first', 'This command needs a value before it can be added.');
  state.script.push({ name, t, cmd }); saveScript(); renderScript();
  toast(`Added to script: ${name}`);
}
function renderScript() {
  $('#scriptCard').classList.toggle('hidden', !state.script.length && !state.scriptEdit);
  $('#scriptCount').textContent = state.script.length;
  const ed = state.scripts.find(x => x.id === state.scriptEdit);
  $('#scriptTitle').textContent = ed ? `Editing script “${ed.name}”` : 'Script';
  $('#scriptSave').textContent = ed ? 'Save changes' : 'Save in list';
  $('#scriptList').innerHTML = state.script.map((s, i) => `<li data-i="${i}"><input class="sname" value="${esc(s.name)}" aria-label="Action name"><select class="stype" aria-label="Command type"><option value="cam" ${s.t !== 'ptz' ? 'selected' : ''}>aw_cam</option><option value="ptz" ${s.t === 'ptz' ? 'selected' : ''}>aw_ptz</option></select><input class="scmd mono" value="${esc(s.cmd)}" aria-label="Command"><span class="sbtns"><button class="icon" data-mv="-1" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button><button class="icon" data-mv="1" aria-label="Move down" ${i < state.script.length - 1 ? '' : 'disabled'}>↓</button><button class="icon" data-del aria-label="Remove">×</button></span></li>`).join('');
  $$('#scriptList li').forEach(li => {
    const i = +li.dataset.i, it = state.script[i];
    $('.sname', li).onchange = e => { it.name = e.target.value.trim() || it.cmd; saveScript(); };
    $('.stype', li).onchange = e => { it.t = e.target.value; saveScript(); };
    $('.scmd', li).onchange = e => { it.cmd = e.target.value.trim(); saveScript(); };
    $$('[data-mv]', li).forEach(b => b.onclick = () => { const j = i + +b.dataset.mv; [state.script[i], state.script[j]] = [state.script[j], state.script[i]]; saveScript(); renderScript(); });
    $('[data-del]', li).onclick = () => { state.script.splice(i, 1); saveScript(); renderScript(); };
  });
  renderSavedScripts();
  const prev = new Set(store.get('scriptCams', []));
  $('#scriptCams').innerHTML = state.cameras.length ? state.cameras.map(c => `<label class="check"><input type="checkbox" value="${esc(c.ip)}" ${prev.has(c.ip) ? 'checked' : ''}> ${esc(c.title || c.model || '')} <span class="mono muted">${esc(c.ip)}</span>${c.zone ? ` <span class="pill">${esc(c.zone)}</span>` : ''}</label>`).join('') : '<span class="muted">Find cameras first; the script runs on the cameras you tick here.</span>';
  $$('#scriptCams label:not(.selall-row) input').forEach(i => i.onchange = () => { store.set('scriptCams', $$('#scriptCams label:not(.selall-row) input:checked').map(x => x.value)); renderScript(); });
  { const on = new Set(store.get('scriptCams', []));
    selAllRow($('#scriptCams'), state.cameras, c => on.has(c.ip), (c, v) => v ? on.add(c.ip) : on.delete(c.ip), () => { store.set('scriptCams', [...on]); renderScript(); }); }
  const scriptBox = c => $$('#scriptCams label:not(.selall-row) input').find(i => i.value === c.ip);
  zoneChips($('#scriptZones'), { get: c => !!scriptBox(c)?.checked, set: (c, on) => { const i = scriptBox(c); if (i) i.checked = on; },
    done: () => { store.set('scriptCams', $$('#scriptCams label:not(.selall-row) input:checked').map(x => x.value)); renderScript(); } }, 'Zone');
}
const setScriptCams = on => { $$('#scriptCams label:not(.selall-row) input').forEach(i => i.checked = on); store.set('scriptCams', $$('#scriptCams label:not(.selall-row) input:checked').map(x => x.value)); renderScript(); };
$('#scriptAll').onclick = () => setScriptCams(true);
$('#scriptNone').onclick = () => setScriptCams(false);
$('#scriptLogin').checked = store.get('scriptLogin', false);
$('#scriptLogin').onchange = e => store.set('scriptLogin', e.target.checked);
$('#scriptClear').onclick = () => { state.script = []; saveScript(); state.scriptEdit = null; store.set('scriptEdit', null); renderScript(); };
/* ---- saved scripts: kept in the project, editable like shows ---- */
state.scripts = store.get('scripts', []);
state.scriptEdit = store.get('scriptEdit', null);
const saveScripts = () => store.set('scripts', state.scripts);
const SCRIPT_MARK = '# panasonic-toolbox-script ';
function scriptData() {
  return { name: $('#scriptName').value.trim() || 'panasonic-action', items: state.script.map(x => ({ ...x })), cams: $$('#scriptCams label:not(.selall-row) input:checked').map(x => x.value), login: $('#scriptLogin').checked };
}
// store the script in the list (new, or the one being edited); returns the entry
async function storeScript(confirmEdit = true) {
  if (!state.script.length) { info('No actions', 'Add at least one command with + Script first.'); return null; }
  const d = scriptData(), now = new Date().toISOString();
  let ed = state.scripts.find(x => x.id === state.scriptEdit);
  if (ed && confirmEdit) {
    const was = ed.items.map(x => x.name), is = d.items.map(x => x.name);
    const camN = ips => ips.map(ip => { const c = state.cameras.find(x => x.ip === ip); return c ? camName(c) : ip; }).join(', ') || '–';
    if (!await ask({ title: `Save changes to “${esc(ed.name)}”?`, ok: 'Save changes', wide: true, body: `<table class="tbl dense"><thead><tr><th></th><th>Was</th><th>Becomes</th></tr></thead><tbody>
      ${ed.name !== d.name ? `<tr><td>Name</td><td>${esc(ed.name)}</td><td>${esc(d.name)}</td></tr>` : ''}
      <tr><td>Actions</td><td>${was.map(esc).join('<br>') || '–'}</td><td>${is.map(esc).join('<br>') || '–'}</td></tr>
      <tr><td>Cameras</td><td>${esc(camN(ed.cams))}</td><td>${esc(camN(d.cams))}</td></tr>
      ${ed.login !== d.login ? `<tr><td>Login in the file</td><td>${ed.login ? 'yes' : 'no'}</td><td>${d.login ? 'yes' : 'no'}</td></tr>` : ''}
      </tbody></table><p class="small">Script files you saved before stay as they are; save the file again to update it.</p>` })) return null;
  }
  if (ed) Object.assign(ed, d, { modified: now });
  else { ed = { id: 's' + Date.now().toString(36), ...d, created: now, modified: now }; state.scripts.push(ed); state.scriptEdit = ed.id; store.set('scriptEdit', ed.id); }
  saveScripts(); renderScript(); return ed;
}
$('#scriptOpenFile').onclick = () => $('#openFilesBtn').click();
$('#scriptSave').onclick = async () => { const e = await storeScript(); if (e) toast(`Script “${e.name}” saved in the list`); };
function editScript(sc) {
  state.script = sc.items.map(x => ({ ...x })); saveScript();
  state.scriptEdit = sc.id; store.set('scriptEdit', sc.id);
  $('#scriptName').value = sc.name; $('#scriptLogin').checked = !!sc.login; store.set('scriptCams', sc.cams || []);
  renderScript(); $('#scriptCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderSavedScripts() {
  const box = $('#savedScripts'); if (!box) return;
  box.classList.toggle('hidden', !state.scripts.length);
  $('#savedScriptCount').textContent = state.scripts.length;
  $('#savedScriptTable tbody').innerHTML = state.scripts.map(sc => `<tr data-id="${esc(sc.id)}" class="${sc.id === state.scriptEdit ? 'editing' : ''}"><td><b>${esc(sc.name)}</b>${sc.id === state.scriptEdit ? ' <span class="pill info">editing</span>' : ''}</td><td class="small">${sc.items.map(x => esc(x.name)).join('<br>')}</td><td class="small">${(sc.cams || []).map(ip => { const c = state.cameras.find(x => x.ip === ip); return esc(c ? camName(c) : ip); }).join(', ') || '<span class="muted">no cameras</span>'}</td><td class="muted small">${new Date(sc.modified || sc.created).toLocaleString('en-GB')}</td>
    <td class="end nowrap"><button class="ghost small" data-act="edit">Edit</button> ${icoBtn('ps1', 'save', 'Save as PowerShell file (Windows)', '<span class="mono">PS1</span>')}${icoBtn('sh', 'save', 'Save as Mac/Linux file', '<span class="mono">SH</span>')} <button class="icon" data-act="del" aria-label="Delete script">×</button></td></tr>`).join('');
  $$('#savedScriptTable tbody tr').forEach(tr => {
    const sc = state.scripts.find(x => x.id === tr.dataset.id);
    $('[data-act=edit]', tr).onclick = () => editScript(sc);
    $('[data-act=ps1]', tr).onclick = () => { editScript(sc); $('#scriptPs1').click(); };
    $('[data-act=sh]', tr).onclick = () => { editScript(sc); $('#scriptSh').click(); };
    $('[data-act=del]', tr).onclick = async () => {
      if (!await ask({ title: `Delete script “${esc(sc.name)}”?`, ok: 'Delete', danger: true, body: '<p>It is removed from the list. Script files you saved stay where they are.</p>' })) return;
      state.scripts = state.scripts.filter(x => x !== sc); if (state.scriptEdit === sc.id) { state.scriptEdit = null; store.set('scriptEdit', null); }
      saveScripts(); renderScript();
    };
  });
}
// a saved .ps1/.sh file carries its script on one comment line, so it can be opened and edited again
function openScriptFile(name, text) {
  const line = text.split(/\r?\n/).find(l => l.startsWith(SCRIPT_MARK));
  if (!line) throw new Error('This script was not made with Panasonic Toolbox 2.15 or later, so it cannot be edited here');
  const d = JSON.parse(line.slice(SCRIPT_MARK.length));
  const ex = state.scripts.find(x => x.name === d.name);
  const now = new Date().toISOString();
  if (ex) Object.assign(ex, { items: d.items, cams: d.cams || [], login: !!d.login, modified: now });
  else state.scripts.push({ id: 's' + Date.now().toString(36), name: d.name, items: d.items, cams: d.cams || [], login: !!d.login, created: now, modified: now });
  saveScripts(); renderScript();
  toast(`Script “${d.name}” ${ex ? 'updated' : 'added'} on the Parameters page`);
}
function scriptTargets() {
  const ips = $$('#scriptCams label:not(.selall-row) input:checked').map(x => x.value);
  return state.cameras.filter(c => ips.includes(c.ip)).map(c => ({ ip: c.ip, port: c.port || 80 }));
}
function scriptName(ext) { return ($('#scriptName').value.trim() || 'panasonic-action').replace(/[^\w.-]+/g, '_') + ext; }
$('#scriptPs1').onclick = async () => {
  const cams = scriptTargets(); if (!cams.length) return info('Tick at least one camera', 'Choose on which cameras the script runs.');
  if (!await storeScript(false)) return;
  const user = $('#authUser').value.trim(), pass = $('#authPass').value;
  const withLogin = $('#scriptLogin').checked && !!user;
  const lines = [
    `# Panasonic Toolbox script: ${$('#scriptName').value.trim()}`,
    `# Generated ${new Date().toLocaleString('en-GB')}. Runs ${state.script.length} command(s) on ${cams.length} camera(s).`,
    SCRIPT_MARK + JSON.stringify({ name: scriptData().name, items: state.script, cams: cams.map(c => c.ip), login: withLogin }),
    `# Companion: System > Run shell path:  powershell -ExecutionPolicy Bypass -File "<path to this file>"`,
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `$ProgressPreference = 'SilentlyContinue'`,
    `$cameras = @(${cams.map(c => `'${c.ip}${c.port !== 80 ? ':' + c.port : ''}'`).join(', ')})`,
    `$commands = @(`, ...state.script.map((s, i) => `  @{ path = '${s.t === 'ptz' ? 'aw_ptz' : 'aw_cam'}'; cmd = '${encCmd(s.cmd)}' }${i < state.script.length - 1 ? ',' : ''}  # ${s.name.replace(/[\r\n]/g, ' ')}`), `)`,
    ...(withLogin ? [`$user = '${user.replace(/'/g, "''")}'`, `$pass = '${pass.replace(/'/g, "''")}'`] : [`# Camera login (only needed when User Auth is on): set the environment variables PANASONIC_USER and PANASONIC_PASS`, `$user = $env:PANASONIC_USER`, `$pass = $env:PANASONIC_PASS`]),
    `$cred = $null`,
    `if ($user) { $cred = New-Object System.Management.Automation.PSCredential($user, (ConvertTo-SecureString ([string]$pass) -AsPlainText -Force)) }`,
    `foreach ($cam in $cameras) {`,
    `  foreach ($c in $commands) {`,
    `    $url = "http://$cam/cgi-bin/$($c.path)?cmd=$($c.cmd)&res=1"`,
    `    try { if ($cred) { Invoke-WebRequest -Uri $url -Credential $cred -UseBasicParsing -TimeoutSec 3 | Out-Null } else { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 | Out-Null } } catch { Write-Host "Failed: $url" }`,
    `    Start-Sleep -Milliseconds 30`,
    `  }`,
    `}`,
  ];
  download(scriptName('.ps1'), lines.join('\r\n') + '\r\n', 'text/plain', 'script');
  if (withLogin) toast('Note: the camera login is stored in the script as plain text.');
};
$('#scriptSh').onclick = async () => {
  const cams = scriptTargets(); if (!cams.length) return info('Tick at least one camera', 'Choose on which cameras the script runs.');
  if (!await storeScript(false)) return;
  const user = $('#authUser').value.trim(), pass = $('#authPass').value;
  const withLogin = $('#scriptLogin').checked && !!user;
  const lines = [
    '#!/bin/bash',
    `# Panasonic Toolbox script: ${$('#scriptName').value.trim()}`,
    SCRIPT_MARK + JSON.stringify({ name: scriptData().name, items: state.script, cams: cams.map(c => c.ip), login: withLogin }),
    `# Companion: System > Run shell path:  bash "<path to this file>"`,
    ...(withLogin ? [`PANASONIC_USER='${user.replace(/'/g, "'\\''")}'`, `PANASONIC_PASS='${pass.replace(/'/g, "'\\''")}'`] : ['# Camera login (only needed when User Auth is on): export PANASONIC_USER and PANASONIC_PASS']),
    'AUTH=()',
    '[ -n "$PANASONIC_USER" ] && AUTH=(--digest -u "$PANASONIC_USER:$PANASONIC_PASS")',
    `CAMERAS=(${cams.map(c => `"${c.ip}${c.port !== 80 ? ':' + c.port : ''}"`).join(' ')})`,
    `for CAM in "\${CAMERAS[@]}"; do`,
    ...state.script.map(s => `  curl -s -m 3 "\${AUTH[@]}" "http://$CAM/cgi-bin/${s.t === 'ptz' ? 'aw_ptz' : 'aw_cam'}?cmd=${encCmd(s.cmd)}&res=1" > /dev/null  # ${s.name.replace(/[\r\n]/g, ' ')}`),
    `done`,
  ];
  download(scriptName('.sh'), lines.join('\n') + '\n', 'text/plain', 'script');
};

/* ------------------------------------------------------------------ shows */
// A show: which file goes to which camera and scene, with the file contents embedded, recallable in one go.
const SHOW_ID = 'panasonic-toolbox-show';
state.shows = store.get('shows', []);
const saveShows = () => store.set('shows', state.shows);
const showFile = sh => `${sh.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Show'}.pshow`;
const showJson = sh => { const { sel, path, ...rest } = sh; return JSON.stringify(rest); };
const b64 = s => { const u8 = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(bin); };
// Renaming a show also renames its saved .pshow file (and the name inside it)
async function renameShow(sh, name) {
  name = name.trim(); if (!name || name === sh.name) return;
  const old = sh.name; sh.name = name; saveShows();
  if (sh.path && IN_APP) {
    try { const j = await bridgeFetch('/api/rename', { path: sh.path, name: showFile(sh), dataB64: b64(showJson(sh)) }); sh.path = j.path; saveShows(); toast(`Renamed to ${j.path.split(/[\\/]/).pop()}`, j.path); }
    catch (e) { info('The file could not be renamed', `The show is now called “${esc(name)}”, but its file stayed as it was: ${esc(e.message)}. Use Save file to save it under the new name.`); delete sh.path; saveShows(); }
  }
  log(`Show “${old}” renamed to “${name}”`);
  renderShows();
}
function addShow(show, fromFile, path) {
  if (path) show.path = path;
  if (!show || show.format !== SHOW_ID || !Array.isArray(show.items)) throw new Error('Not a Panasonic Toolbox show');
  track(fromFile ? 'Open show' : 'Save show', () => { state.shows = state.shows.filter(s => s.name !== show.name); state.shows.push(show); });
  saveShows(); renderShows();
  if (fromFile) toast(`Show “${show.name}” added to Shows`);
}
$('#saveShowBtn').onclick = async () => {
  const jobs = state.jobs.filter(j => j.include && j.target);
  if (!jobs.length) return info('Nothing to save', 'Choose a camera for at least one file first. A show remembers which file goes to which camera and scene.');
  const ok = await ask({ title: 'Save as show', body: `<label>Name of the show<input id="askPath" value="Show ${new Date().toLocaleDateString('en-GB')}"></label><p class="hint">${jobs.length} destination${jobs.length > 1 ? 's' : ''}. The file contents are stored in the show, so it keeps working if the files are moved.</p>`, ok: 'Save show' });
  if (!ok) return;
  const name = $('#askPath').value.trim() || 'Show';
  const show = {
    format: SHOW_ID, version: 1, name, created: new Date().toISOString(),
    items: jobs.map(j => { const s = srcById(j.srcId); const cam = state.cameras.find(c => c.ip === j.target); return { target: j.target, port: cam?.port || 80, targetTitle: cam?.title || cam?.model || '', targetScene: j.targetScene, kind: s.kind, sceneIdx: s.sceneIdx, fileName: s.fileName, file: s.file }; }),
  };
  addShow(show);
  const path = await download(showFile(show), showJson(show), undefined, 'show');
  if (path) { show.path = path; saveShows(); renderShows(); }
};
function renderShows() {
  const tb = $('#showTable tbody'); tb.innerHTML = '';
  for (const sh of state.shows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox" ${sh.sel ? 'checked' : ''} aria-label="Select show"></td><td><input class="namein" value="${esc(sh.name)}" aria-label="Show name" title="Type a new name; the saved file is renamed too">${sh.path ? `<div class="muted small mono filepath" title="${esc(sh.path)}">${esc(sh.path.split(/[\\/]/).pop())}</div>` : '<div class="muted small">Not saved as a file yet</div>'}</td><td class="small">${sh.items.map(i => `${esc(i.targetTitle || i.target)} <span class="mono muted">${esc(i.target)}</span>: ${i.kind === 'operator' ? 'operator file' : (i.targetScene === 'active' ? 'live scene' : 'scene ' + esc(i.targetScene))}`).join('<br>')}</td><td class="muted small">${new Date(sh.created).toLocaleString('en-GB')}</td>
      <td class="end nowrap"><button class="secondary small" data-act="recall">Recall</button> ${icoBtn('edit', 'edit', 'Edit this show')}${icoBtn('file', 'save', 'Save the show file')} <button class="icon" data-act="del" aria-label="Delete show">×</button></td>`;
    $('input[type=checkbox]', tr).onchange = e => { sh.sel = e.target.checked; updShowSel(); };
    $('[data-act=recall]', tr).onclick = () => recallShow(sh);
    $('[data-act=edit]', tr).onclick = () => editShow(sh);
    const ni = $('.namein', tr);
    ni.addEventListener('keydown', e => { if (e.key === 'Enter') ni.blur(); if (e.key === 'Escape') { ni.value = sh.name; ni.blur(); } });
    ni.addEventListener('change', () => renameShow(sh, ni.value));
    // Save file: a show that already has its file is written into that same file (no "… (1).pshow" copies)
    $('[data-act=file]', tr).onclick = async () => {
      if (IN_APP && sh.path) {
        try {
          const b = new TextEncoder().encode(showJson(sh)); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
          const j = await bridgeFetch('/api/rename', { path: sh.path, name: showFile(sh), dataB64: btoa(bin) });
          sh.path = j.path; saveShows(); renderShows(); log(`Saved: ${j.path}`); toast('Show file updated', j.path); return;
        } catch (e) { log(`${sh.path}: ${e.message}, saving a new file`); }
      }
      const p = await download(showFile(sh), showJson(sh), undefined, 'show'); if (p) { sh.path = p; saveShows(); renderShows(); }
    };
    $('[data-act=del]', tr).onclick = async () => { if (await ask({ title: `Delete “${esc(sh.name)}”?`, body: '<p>The cameras are not changed. A saved .pshow file stays where it is.</p>', ok: 'Delete', danger: true })) { track('Delete show', () => { state.shows = state.shows.filter(x => x !== sh); }); saveShows(); renderShows(); } };
    tb.appendChild(tr);
  }
  $('#showCount').textContent = state.shows.length;
  $('#showEmpty').classList.toggle('hidden', state.shows.length > 0);
  updShowSel();
}
function updShowSel() {
  const n = state.shows.filter(s => s.sel).length;
  $('#showSelN').textContent = n; selBar($('#showSelBar'), n);
  selAllState($('#showSelAll'), state.shows, x => x.sel);
}
$('#showSelAll').onchange = () => { selAllClick($('#showSelAll'), state.shows, x => x.sel, (x, v) => x.sel = v); renderShows(); };
$('#showDelSel').onclick = async () => {
  const sel = state.shows.filter(s => s.sel);
  if (!await ask({ title: `Delete ${sel.length} show${sel.length > 1 ? 's' : ''}?`, body: '<p>The cameras are not changed. Saved .pshow files stay where they are. You can undo this.</p>', ok: 'Delete', danger: true })) return;
  const before = state.shows.slice();
  state.shows = state.shows.filter(s => !s.sel); saveShows(); renderShows();
  pushHistory({ label: `Delete ${sel.length} show(s)`, undo: async () => { state.shows = before; saveShows(); renderShows(); }, redo: async () => { state.shows = before.filter(s => !sel.includes(s)); saveShows(); renderShows(); } });
};
async function recallShow(sh) {
  // make sure every camera of the show is in the list, then run it like an import
  for (const it of sh.items) if (!state.cameras.some(c => c.ip === it.target)) upsertCam(it.target, it.port, { title: it.targetTitle });
  const jobs = sh.items.map(it => {
    const src = { id: ++srcId, fileName: it.fileName, file: it.file, sceneIdx: it.sceneIdx, kind: it.kind };
    state.sources.push(src);
    return { id: ++jobId, srcId: src.id, target: it.target, targetScene: it.targetScene, include: true };
  });
  renderCams();
  await runImport(jobs, { backup: true, restore: true, store: true, verify: true, force: false }, `Recall show “${esc(sh.name)}”?`);
  state.sources = state.sources.filter(s => !jobs.some(j => j.srcId === s.id)); // keep the import page clean
}
// Name to show for a camera: the name on the camera, else your description, else the model.
const camName = c => c.title || c.desc || c.model || 'Camera';
/* ---- show grid: rows = cameras, columns = scenes; each cell picks an opened scene ---- */
state.gridCams = new Set(store.get('gridCams', []));
state.grid = {}; // ip -> { '1': srcId, ..., op: srcId }
const saveGridCams = () => store.set('gridCams', [...state.gridCams]);
function renderGrid() {
  if (!$('#gridTable') || !state.gridCams) return;
  const scenes = state.sources.filter(x => x.kind === 'scene'), opers = state.sources.filter(x => x.kind === 'operator');
  $('#gridFiles').textContent = state.sources.length ? `Opened: ${scenes.length} scene${scenes.length === 1 ? '' : 's'}${opers.length ? ` and ${opers.length} operator file${opers.length === 1 ? '' : 's'}` : ''}.` : 'No files opened yet. Use Open files… or export from the cameras first.';
  zoneChips($('#gridZones'), { get: c => state.gridCams.has(c.ip), set: (c, on) => on ? state.gridCams.add(c.ip) : state.gridCams.delete(c.ip), done: () => { saveGridCams(); renderGrid(); } }, 'Cameras', true);
  $('#gridCams').innerHTML = state.cameras.length ? state.cameras.map(c => `<label class="check"><input type="checkbox" value="${esc(c.ip)}" ${state.gridCams.has(c.ip) ? 'checked' : ''}><span>${esc(camName(c))} <span class="mono muted small">${esc(c.ip)}</span></span></label>`).join('') : '<span class="muted">Find or add cameras on the Cameras page first.</span>';
  $$('#gridCams input').forEach(i => i.onchange = () => { i.checked ? state.gridCams.add(i.value) : state.gridCams.delete(i.value); saveGridCams(); renderGrid(); });
  selAllRow($('#gridCams'), state.cameras, c => state.gridCams.has(c.ip), (c, v) => v ? state.gridCams.add(c.ip) : state.gridCams.delete(c.ip), () => { saveGridCams(); renderGrid(); });
  const cams = state.cameras.filter(c => state.gridCams.has(c.ip));
  const n = Math.max(0, ...cams.map(c => c.model ? profileFor(c.model).scenes : 4));
  // drop assignments whose file was closed
  for (const ip in state.grid) for (const k in state.grid[ip]) if (!srcById(state.grid[ip][k])) delete state.grid[ip][k];
  const byFile = list => { const m = new Map(); list.forEach(x => { if (!m.has(x.fileName)) m.set(x.fileName, []); m.get(x.fileName).push(x); }); return m; };
  const opts = (list, cur) => `<option value="">–</option>` + [...byFile(list)].map(([f, xs]) => `<optgroup label="${esc(f)}">${xs.map(x => `<option value="${x.id}" ${+cur === x.id ? 'selected' : ''}>${esc(srcLabel(x))}</option>`).join('')}</optgroup>`).join('');
  const t = $('#gridTable');
  if (!cams.length) { t.innerHTML = `<tbody><tr><td class="muted">Tick the cameras for this show above.</td></tr></tbody>`; }
  else {
    t.innerHTML = `<thead><tr><th>Camera</th>${Array.from({ length: n }, (_, i) => `<th>Scene ${i + 1}</th>`).join('')}<th>Operator file</th></tr></thead><tbody>${cams.map(c => {
      const g = state.grid[c.ip] || {}, max = c.model ? profileFor(c.model).scenes : 4;
      return `<tr data-ip="${esc(c.ip)}"><td class="nowrap"><b>${esc(camName(c))}</b><div class="mono muted small">${esc(c.ip)}${c.desc && c.title ? ' · ' + esc(c.desc) : ''}${c.model ? ' · ' + esc(c.model) : ''}</div></td>${Array.from({ length: n }, (_, i) => i < max
        ? `<td><select data-col="${i + 1}" class="${g[i + 1] ? 'set' : ''}" aria-label="Scene ${i + 1} of ${esc(c.ip)}">${opts(scenes, g[i + 1])}</select></td>`
        : '<td class="muted">–</td>').join('')}<td><select data-col="op" class="${g.op ? 'set' : ''}" aria-label="Operator file for ${esc(c.ip)}">${opts(opers, g.op)}</select></td></tr>`;
    }).join('')}</tbody>`;
    $$('#gridTable select').forEach(sel => sel.onchange = () => {
      const ip = sel.closest('tr').dataset.ip, k = sel.dataset.col;
      state.grid[ip] = state.grid[ip] || {};
      if (sel.value) state.grid[ip][k] = +sel.value; else delete state.grid[ip][k];
      sel.classList.toggle('set', !!sel.value); gridCount();
    });
  }
  gridCount();
}
function gridItems() {
  const items = [];
  for (const c of state.cameras.filter(x => state.gridCams.has(x.ip))) {
    const g = state.grid[c.ip] || {};
    for (const [k, id] of Object.entries(g)) {
      const src = srcById(id); if (!src) continue;
      items.push({ target: c.ip, port: c.port || 80, targetTitle: c.title || c.model || '', targetScene: k === 'op' ? null : String(k), kind: src.kind, sceneIdx: src.sceneIdx, fileName: src.fileName, file: src.file });
    }
  }
  return items;
}
function gridCount() { const n = gridItems().length; $('#gridCount').textContent = n ? `${n} cell${n === 1 ? '' : 's'} filled` : ''; $('#gridSave').disabled = !n; }
/* ---- engineering file: the system setup of a camera (format, OSD mix, tally, pan/tilt, presets, fans, IP video),
   saved on this computer and put on many cameras by Initialize. No white balance per scene: that is in the scene files. */
const ENG_ID = 'panasonic-toolbox-engineering';
const engFile = () => store.get('engFile', null);
const ENG_FIELDS = () => SETUP.filter(f => !f.wb);
const engOnly = v => Object.fromEntries(ENG_FIELDS().filter(f => v?.[f.k]).map(f => [f.k, v[f.k]]));
const engSummary = v => [...new Set(ENG_FIELDS().filter(f => v[f.k]).map(f => f.g))].map(g => `<div><b>${esc(g)}</b>: ${ENG_FIELDS().filter(f => f.g === g && v[f.k]).map(f => `${esc(f.l)} ${esc(setupLabel(f, v[f.k]))}`).join(', ')}</div>`).join('');
async function saveEngFile(cam) {
  if (!state.bridgeOk && !(await checkBridge())) return;
  const old = engFile();
  if (!await ask({ title: `Save the engineering file of ${esc(camName(cam))}?`, ok: old ? 'Replace' : 'Save', danger: !!old, body: `
    <p>Reads the system setup of this camera: format, OSD mix, tally, pan/tilt, presets, power-on position, fans and IP video. <b>Initialize</b> then puts it on the cameras you tick.</p>
    <ul class="tight"><li>White balance per scene is not included: that is part of the scene files.</li>
    ${old ? `<li><span class="warn-text">Replaces the engineering file</span> saved ${new Date(old.savedAt).toLocaleString('en-GB')} from ${esc(old.fromName || old.fromIp)}.</li>` : ''}
    <li>Reading changes nothing on the camera.</li></ul>` })) return;
  $('#engStatus').textContent = `Reading ${camName(cam)}…`;
  try {
    if (!cam.model) await identify(cam);
    const values = engOnly(await readSetup(cam, false));
    if (!Object.keys(values).length) throw new Error('the camera gave no settings');
    store.set('engFile', { values, savedAt: new Date().toISOString(), fromIp: cam.ip, fromName: camName(cam), model: cam.model || '' });
    renderEngFile(); toast(`Engineering file of ${camName(cam)} saved: ${Object.keys(values).length} settings`);
    $('#engStatus').textContent = `Engineering file saved · ${new Date().toLocaleTimeString('en-GB')}`;
    log(`Engineering file saved from ${cam.ip}: ${Object.keys(values).length} settings`);
  } catch (e) { $('#engStatus').textContent = ''; info('Could not read the camera', esc(e.message)); }
}
async function initializeCams(cams) {
  if (!cams.length) return;
  const ef = engFile();
  if (!ef) return info('No engineering file yet', 'Tick one camera that is set up the way you want and choose <b>Save engineering file…</b>, or open an engineering file on the Restore page.');
  const v = engOnly(ef.values);
  if (!await ask({ title: `Put the engineering file on ${cams.length} camera${cams.length > 1 ? 's' : ''}?`, ok: 'Initialize', danger: true, wide: true, body: `
    <p>From ${esc(ef.fromName || ef.fromIp || 'a file')}${ef.model ? ` (${esc(ef.model)})` : ''}, saved ${new Date(ef.savedAt).toLocaleString('en-GB')}.</p>
    <div class="setup-sum">${engSummary(v)}</div>
    ${v.format ? '<p class="warn-text">A camera that gets another frequency restarts (about a minute without picture).</p>' : ''}
    <p class="muted small">Only settings that differ are sent; every value is read back afterwards. ${cams.map(c => esc(camName(c))).join(', ')}</p>` })) return;
  if (!state.bridgeOk && !(await checkBridge())) return;
  await runSetup(cams, v, 'Initialize');
}
function renderEngFile() {
  const ef = engFile();
  const txt = ef ? `From ${esc(ef.fromName || '')} <span class="mono muted small">${esc(ef.fromIp || '')}</span>${ef.model ? ' · ' + esc(ef.model) : ''} · ${Object.keys(ef.values || {}).length} settings · saved ${new Date(ef.savedAt).toLocaleString('en-GB')}` : 'No engineering file yet.';
  const box = $('#defList');
  if (box) {
    box.innerHTML = ef ? `<p class="small">${txt} <button type="button" class="icon" id="engFileDel" aria-label="Delete the engineering file">×</button></p>` : '<p class="muted small">No engineering file yet.</p>';
    $('#engFileDel')?.addEventListener('click', () => { store.set('engFile', null); renderEngFile(); toast('Engineering file deleted'); });
  }
  const st = $('#engFileInfo'); if (st) st.innerHTML = txt;
}
const renderDefaults = renderEngFile;
async function exportEngFile() {
  const ef = engFile();
  if (!ef) return info('No engineering file yet', 'Make one on the Engineering page: tick one camera and choose <b>Save engineering file…</b>.');
  const name = `Engineering file ${ef.fromName ? ef.fromName.replace(/[^A-Za-z0-9._ -]+/g, '_') + ' ' : ''}${today()}.json`;
  if (!await ask({ title: 'Back up the engineering file?', ok: 'Back up', wide: true, body: `
    <p>From ${esc(ef.fromName || ef.fromIp || '')}${ef.model ? ` (${esc(ef.model)})` : ''}, saved ${new Date(ef.savedAt).toLocaleString('en-GB')}.</p>
    <div class="setup-sum">${engSummary(ef.values)}</div>
    <p>Saved as <span class="mono">${esc(name)}</span> in <span class="mono">${esc([state.saveDir || 'Downloads › Panasonic Toolbox', ...subFor('engineering')].join(' › '))}</span>. Nothing changes on the cameras.</p>` })) return;
  await download(name, JSON.stringify({ format: ENG_ID, version: 1, ...ef }, null, 1), undefined, 'engineering');
  $('#expResultCard').classList.remove('hidden');
  $('#expResult').innerHTML = `<div class="note ok"><b>Engineering file</b><br>${Object.keys(ef.values).length} settings saved in ${esc(name)}</div>`;
  log(`Engineering file saved: ${name}`);
}
async function importEngFile(data) {
  const values = engOnly(data.values || {});
  if (!Object.keys(values).length) return info('Empty engineering file', 'This file holds no settings.');
  const old = engFile();
  if (!await ask({ title: 'Use this engineering file?', ok: 'Use it', danger: !!old, wide: true, body: `
    <p>From ${esc(data.fromName || data.fromIp || 'a file')}${data.model ? ` (${esc(data.model)})` : ''}, saved ${data.savedAt ? new Date(data.savedAt).toLocaleString('en-GB') : '?'}.</p>
    <div class="setup-sum">${engSummary(values)}</div>
    ${old ? `<p class="warn-text">Replaces the engineering file from ${esc(old.fromName || old.fromIp || '')}, saved ${new Date(old.savedAt).toLocaleString('en-GB')}.</p>` : ''}
    <p>Next you can put it on cameras: you are asked which ones.</p>` })) return;
  const ef = { values, savedAt: data.savedAt || new Date().toISOString(), fromIp: data.fromIp || '', fromName: data.fromName || '', model: data.model || '' };
  store.set('engFile', ef); renderEngFile(); expKindUi();
  pushHistory({ label: 'Open engineering file', undo: () => { store.set('engFile', old); renderEngFile(); }, redo: () => { store.set('engFile', ef); renderEngFile(); } });
  log(`Engineering file opened: ${Object.keys(values).length} settings`);
  await pickAndInitialize();
}
// After opening an engineering file on the Restore page: choose the cameras that get it
async function pickAndInitialize() {
  if (!state.cameras.length) return toast('Engineering file loaded');
  const ok = await ask({ title: 'Put the engineering file on cameras now?', ok: 'Next', cancel: 'Not now', body: `<p>Tick the cameras that should get it.</p><div class="checklist-cams">${state.cameras.map(c => `<label class="check"><input type="checkbox" data-ini="${esc(c.ip)}" ${c.selected ? 'checked' : ''}> ${esc(camName(c))} <span class="mono muted small">${esc(c.ip)}</span></label>`).join('')}</div>` });
  if (!ok) return toast('Engineering file loaded. Use Initialize on the Engineering page.');
  const ips = new Set($$('#askDlg [data-ini]:checked').map(i => i.dataset.ini));
  const cams = state.cameras.filter(c => ips.has(c.ip));
  if (!cams.length) return;
  $('[role=tab][data-tab=eng]').click();
  return initializeCams(cams);
}

$('#gridOpen').onclick = () => $('#openFilesBtn').click();
$('#gridClear').onclick = () => { state.grid = {}; endGridEdit(); renderGrid(); };
// Edit a saved show: its scenes go back into the grid (as opened files), its cameras are ticked.
function editShow(sh) {
  for (const it of sh.items) if (!state.cameras.some(c => c.ip === it.target)) upsertCam(it.target, it.port, { title: it.targetTitle });
  state.sources = state.sources.filter(x => !x.fromShow);
  state.grid = {}; state.gridCams = new Set(sh.items.map(it => it.target)); saveGridCams();
  const skipped = [];
  for (const it of sh.items) {
    const src = { id: ++srcId, fileName: it.fileName || sh.name, file: it.file, sceneIdx: it.sceneIdx, kind: it.kind, fromShow: true };
    state.sources.push(src);
    const cam = state.cameras.find(c => c.ip === it.target);
    const col = it.kind === 'operator' ? 'op' : it.targetScene === 'active' ? (cam?.scene ? String(cam.scene) : null) : String(it.targetScene);
    if (!col) { skipped.push(it); continue; }
    (state.grid[it.target] = state.grid[it.target] || {})[col] = src.id;
  }
  state.gridEdit = sh;
  $('#gridName').value = sh.name;
  $('#gridSave').textContent = 'Save changes';
  $('#gridEditing').innerHTML = `Editing <b>${esc(sh.name)}</b>. Change the cells and choose Save changes. <button type="button" class="ghost small" id="gridEditStop">Stop editing</button>`;
  $('#gridEditing').classList.remove('hidden');
  $('#gridEditStop').onclick = () => { state.grid = {}; endGridEdit(); renderGrid(); };
  renderCams(); renderImports();
  $('#gridCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (skipped.length) info('Some items need a scene number', `${skipped.length} item${skipped.length > 1 ? 's go' : ' goes'} to “the live scene” of a camera whose live scene is unknown right now. Pick the scene for ${skipped.length > 1 ? 'them' : 'it'} in the grid; the file is in the cell lists.`);
}
function endGridEdit() {
  state.gridEdit = null; $('#gridSave').textContent = 'Save as show';
  $('#gridEditing').classList.add('hidden');
  state.sources = state.sources.filter(x => !x.fromShow || Object.values(state.grid).some(g => Object.values(g).includes(x.id)));
}
$('#gridAuto').onclick = () => {
  let n = 0;
  for (const c of state.cameras.filter(x => state.gridCams.has(x.ip))) for (const src of state.sources) {
    if (src.file.camera?.ip !== c.ip) continue;
    const k = src.kind === 'operator' ? 'op' : String(src.file.scenes[src.sceneIdx].scene);
    if (k !== 'op' && +k > (c.model ? profileFor(c.model).scenes : 4)) continue;
    state.grid[c.ip] = state.grid[c.ip] || {}; state.grid[c.ip][k] = src.id; n++;
  }
  renderGrid(); toast(n ? `${n} cell${n === 1 ? '' : 's'} filled` : 'No opened file comes from these cameras');
};
$('#gridSave').onclick = async () => {
  const items = gridItems();
  if (!items.length) return info('Nothing chosen', 'Choose a scene in at least one cell.');
  const name = $('#gridName').value.trim() || `Show ${new Date().toLocaleDateString('en-GB')}`;
  items.sort((a, b) => ipNum(a.target) - ipNum(b.target) || (a.kind === 'operator') - (b.kind === 'operator') || String(a.targetScene).localeCompare(String(b.targetScene), 'en', { numeric: true }));
  const ed = state.gridEdit && state.shows.includes(state.gridEdit) ? state.gridEdit : null;
  if (ed) {
    // what changes: per camera and scene, the old and the new content
    const key = it => `${it.target}|${it.kind === 'operator' ? 'op' : it.targetScene}`;
    const what = it => it ? `${it.kind === 'operator' ? 'operator file' : 'scene ' + (it.file.scenes?.[it.sceneIdx]?.scene ?? '?')} from ${it.file.camera?.title || it.file.camera?.model || it.file.camera?.ip || 'file'}` : '';
    const olds = new Map(ed.items.map(it => [key(it), it])), news = new Map(items.map(it => [key(it), it]));
    const rows = [];
    for (const k of new Set([...olds.keys(), ...news.keys()])) {
      const o = olds.get(k), n = news.get(k);
      if (o && n && o.file === n.file && o.sceneIdx === n.sceneIdx) continue;
      const [ip, col] = k.split('|'), c = state.cameras.find(x => x.ip === ip);
      rows.push(`<tr><td>${esc(c ? camName(c) : (o || n).targetTitle || ip)} <span class="mono muted small">${esc(ip)}</span></td><td>${col === 'op' ? 'Operator file' : 'Scene ' + esc(col)}</td><td>${o ? esc(what(o)) : '<span class="muted">empty</span>'}</td><td>${n ? esc(what(n)) : '<span class="muted">removed</span>'}</td></tr>`);
    }
    const renamed = name !== ed.name;
    if (!rows.length && !renamed) { info('Nothing changed', 'The show is the same as before.'); return; }
    if (!await ask({ title: `Save changes to “${esc(ed.name)}”?`, ok: 'Save changes', wide: true, body: `
      ${renamed ? `<p>New name: <b>${esc(name)}</b></p>` : ''}
      ${rows.length ? `<table class="tbl dense"><thead><tr><th>Camera</th><th>Cell</th><th>Was</th><th>Becomes</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : ''}
      <ul class="tight"><li>${ed.path ? `The file <span class="mono">${esc(ed.path.split(/[\\/]/).pop())}</span> is overwritten with the new version.` : 'The show is updated in the app; use Save file to keep it as a file.'}</li><li>Nothing is sent to the cameras until you recall the show.</li></ul>` })) return;
    const before = JSON.stringify(state.shows);
    ed.items = items; ed.modified = new Date().toISOString();
    if (name !== ed.name) ed.name = name;
    saveShows(); renderShows();
    const after = JSON.stringify(state.shows);
    pushHistory({ label: `Edit show ${name}`, undo: async () => { state.shows = JSON.parse(before); saveShows(); renderShows(); }, redo: async () => { state.shows = JSON.parse(after); saveShows(); renderShows(); } });
    if (ed.path && IN_APP) {
      try { const j = await bridgeFetch('/api/rename', { path: ed.path, name: showFile(ed), dataB64: b64(showJson(ed)) }); ed.path = j.path; saveShows(); renderShows(); toast(`Show “${name}” updated`, j.path); }
      catch (e) { delete ed.path; saveShows(); renderShows(); info('Show updated in the app', `The file could not be updated (${esc(e.message)}). Use Save file to save it again.`); }
    } else toast(`Show “${name}” updated`);
    endGridEdit(); state.grid = {}; renderGrid();
    return;
  }
  const show = { format: SHOW_ID, version: 1, name, created: new Date().toISOString(), items };
  addShow(show); toast(`Show “${name}” saved`);
  const path = await download(showFile(show), showJson(show), undefined, 'show');
  if (path) { show.path = path; saveShows(); renderShows(); }
};
$('#showNew').onclick = async () => {
  if (!state.cameras.length) return info('No cameras yet', 'Find or add cameras on the Cameras page first.');
  const pre = state.cameras.some(c => c.selected) ? state.cameras.filter(c => c.selected) : state.cameras;
  const maxSc = Math.max(4, ...state.cameras.map(c => c.model ? profileFor(c.model).scenes : 4));
  const pending = ask({ title: 'New show from cameras', ok: 'Read cameras and save show', wide: true, body: `
    <label>Name of the show <input id="nsName" value="Show ${new Date().toLocaleDateString('en-GB')}"></label>
    <div><b class="small">Cameras</b><div class="zonebar" id="nsZones"></div>
      <div class="ns-cams">${state.cameras.map((c, i) => `<label class="check"><input type="checkbox" data-ns="${i}" ${pre.includes(c) ? 'checked' : ''}><span>${esc(camName(c))}${c.desc && c.title ? ` <span class="muted">· ${esc(c.desc)}</span>` : ''} <span class="mono muted small">${esc(c.ip)}</span></span></label>`).join('')}</div></div>
    <div><b class="small">What goes in the show</b>
      <label class="check"><input type="checkbox" id="nsScene" checked> Scene files</label>
      <div class="subbox">
        <label class="check"><input type="radio" name="nsMode" value="active" checked> The live scene of each camera <span class="muted">(the picture does not change)</span></label>
        <label class="check"><input type="radio" name="nsMode" value="pick"> These scenes <span class="muted">(each camera switches to them and back)</span></label>
        <div class="ns-scenes" id="nsScenes">${Array.from({ length: maxSc }, (_, i) => `<label class="check"><input type="checkbox" value="${i + 1}"> Scene ${i + 1}</label>`).join('')}</div>
      </div>
      <label class="check"><input type="checkbox" id="nsOper"> Operator files</label></div>
    <p class="hint">The app reads the current settings of these cameras now and stores them in the show. Recalling the show later puts each scene back in the same scene number on the same camera.</p>` });
  const nsBox = c => $(`[data-ns="${state.cameras.indexOf(c)}"]`);
  const nsSel = { get: c => !!nsBox(c)?.checked, set: (c, on) => { nsBox(c).checked = on; }, done: () => nsRender() };
  let nsAllCb = null;
  const nsRender = () => { zoneChips($('#nsZones'), nsSel, 'Zone', true); if (nsAllCb) selAllState(nsAllCb, state.cameras, nsSel.get); };
  nsAllCb = selAllRow($('.ns-cams'), state.cameras, nsSel.get, nsSel.set, nsRender);
  $$('[data-ns]').forEach(x => x.addEventListener('change', nsRender));
  nsRender();
  $$('#nsScenes input').forEach(x => x.onchange = () => { if (x.checked) $('input[name=nsMode][value=pick]').checked = true; });
  if (!await pending) return;
  const name = $('#nsName').value.trim() || 'Show';
  const cams = $$('[data-ns]').filter(x => x.checked).map(x => state.cameras[+x.dataset.ns]);
  const wantScene = $('#nsScene').checked, wantOper = $('#nsOper').checked;
  const mode = $('input[name=nsMode]:checked').value, picked = $$('#nsScenes input:checked').map(x => +x.value);
  if (!cams.length) return info('No cameras chosen', 'Tick at least one camera.');
  if (!wantScene && !wantOper) return info('Nothing to save', 'Tick scene files, operator files or both.');
  if (wantScene && mode === 'pick' && !picked.length) return info('No scenes chosen', 'Tick the scenes to put in the show.');
  if (wantScene && mode === 'pick' && !await ask({ title: 'The picture will change', danger: true, ok: 'Switch scenes and read',
    body: `<p>To read scene ${picked.join(', ')} the cameras have to switch to ${picked.length > 1 ? 'each of those scenes' : 'that scene'}. Afterwards every camera returns to the scene it was on. Do not do this while a camera is on air.</p>` })) return;
  if (!state.bridgeOk && !(await checkBridge())) return;
  const out = $('#showProgress'); out.classList.remove('hidden'); out.innerHTML = '';
  const items = [], fails = [];
  await Promise.all(cams.map(async cam => {
    const row = document.createElement('div'); row.className = 'note'; row.textContent = `${cam.ip}: working…`; out.appendChild(row);
    cam.busy = true; renderCams();
    const base = { target: cam.ip, port: cam.port || 80, targetTitle: cam.title || cam.model || '' };
    try {
      const parts = [];
      if (wantScene) {
        const scenes = await readCamScenes(cam, mode, picked, t => row.textContent = `${cam.ip}: ${t}`);
        for (const sc of scenes) {
          const file = makeFile(cam, [sc]);
          items.push({ ...base, targetScene: sc.scene ? String(sc.scene) : 'active', kind: 'scene', sceneIdx: 0, fileName: fileName(cam, [sc]), file });
        }
        parts.push(scenes.map(sc => 'scene ' + sc.scene).join(', '));
      }
      if (wantOper) {
        row.textContent = `${cam.ip}: reading operator settings…`;
        const file = await readOperatorFile(cam);
        items.push({ ...base, targetScene: null, kind: 'operator', sceneIdx: null, fileName: operatorName(cam), file });
        parts.push('operator file');
      }
      row.className = 'note ok'; row.innerHTML = `<b>${esc(cam.title || cam.model)}</b> <span class="mono">${esc(cam.ip)}</span>: ${esc(parts.join(' and '))}`;
    } catch (e) { fails.push(cam.ip); row.className = 'note err'; row.textContent = `${cam.ip}: could not be read. ${e.message}`; }
    cam.busy = false; renderCams();
  }));
  if (!items.length) return info('Show not saved', 'No camera could be read.');
  items.sort((a, b) => ipNum(a.target) - ipNum(b.target) || (a.kind === 'operator') - (b.kind === 'operator') || String(a.targetScene).localeCompare(String(b.targetScene)));
  const show = { format: SHOW_ID, version: 1, name, created: new Date().toISOString(), items };
  addShow(show);
  if (!fails.length) setTimeout(() => out.classList.add('hidden'), 6000);
  if (fails.length) info('Show saved without some cameras', `These cameras could not be read and are not in the show: ${esc(fails.join(', '))}.`);
  const path = await download(showFile(show), showJson(show), undefined, 'show');
  if (path) { show.path = path; saveShows(); renderShows(); }
};
$('#showOpen').onclick = async () => {
  try { const j = await bridgeFetch('/api/choose', { kind: 'files', multiple: true }); if (j.ok) return openPaths(j.paths || []); } catch { }
  $('#fileInput').click();
};

/* ------------------------------------------------------------------ send a command (with undo) */
// Turns a query response into the set command that restores it: OSD:A4:1 stays, d61 becomes #D61.
const restoreCmd = (t, body) => (!body || isErr(body)) ? null : (t === 'ptz' ? '#' + body.toUpperCase() : body);
async function sendCmd(t, cmd, outEl, c) {
  const tg = httpTarget();
  if (!validIp(tg.ip)) return info('Invalid IP address', 'Choose a camera or fill in a valid IP address.');
  if (/\[Data/.test(cmd)) return info('Fill in a value first', 'This command needs a value before it can be sent.');
  outEl.textContent = 'Sending…';
  const cam = { ip: tg.ip, port: tg.port };
  try {
    let prev = null;
    if (c && c.q) { try { const [q] = await batch(cam, [{ type: t, cmd: c.q }]); if (q.ok) prev = restoreCmd(t, q.body); } catch { } }
    const [r] = await batch(cam, [{ type: t, cmd }]);
    outEl.textContent = r.ok ? `Response: ${r.body || '(empty)'}` : `No response: ${r.error || ''}`;
    log(`${tg.ip}: ${cmd} → ${r.ok ? r.body : r.error}`);
    const same = (x, y) => t === 'ptz' ? x.startsWith(c.q) && y.startsWith(c.q) : x.split(':').slice(0, -1).join(':') === y.split(':').slice(0, -1).join(':');
    if (r.ok && !isErr(r.body) && prev && prev !== cmd && same(prev, cmd)) pushHistory({
      label: `${c.n} on ${tg.ip}`, camera: true,
      undo: async () => { const [u] = await batch(cam, [{ type: t, cmd: prev }]); if (!u.ok) throw new Error(u.error || 'no response'); },
      redo: async () => { const [u] = await batch(cam, [{ type: t, cmd }]); if (!u.ok) throw new Error(u.error || 'no response'); },
    });
  } catch (e) { outEl.textContent = 'Failed: ' + e.message; }
}

/* ------------------------------------------------------------------ network setup (Easy IP) */
function renderEip() {
  const tb = $('#eipTable tbody'); tb.innerHTML = '';
  for (const r of state.eip) {
    const tr = document.createElement('tr');
    const changed = k => r.edit[k] !== r.orig[k] ? ' changed' : '';
    tr.innerHTML = `<td><input type="checkbox" ${r.sel ? 'checked' : ''} aria-label="Select"></td><td class="mono small">${esc(r.mac)}</td><td>${esc(r.model)}</td>
      <td><input data-k="name" class="${changed('name').trim()}" value="${esc(r.edit.name)}" maxlength="15" aria-label="Camera name" title="Up to 15 characters: letters, digits, space, - _ ."></td>
      <td><input data-k="ip" class="mono${changed('ip')}" value="${esc(r.edit.ip)}" aria-label="IP address"></td>
      <td><input data-k="mask" class="mono${changed('mask')}" value="${esc(r.edit.mask)}" aria-label="Subnet mask"></td>
      <td><input data-k="gateway" class="mono${changed('gateway')}" value="${esc(r.edit.gateway)}" aria-label="Gateway"></td>
      <td><input data-k="port" type="number" class="num${changed('port')}" value="${r.edit.port}" aria-label="Port"></td>
      <td class="small">${sameRange(r.orig.ip, r.orig.mask) ? (state.cameras.some(c => c.ip === r.orig.ip) ? '<span class="ok-text nowrap" title="In this computer\'s IP range and already in the Cameras list">In Cameras</span>' : '<span class="ok-text" title="In this computer\'s IP range">Yes</span>') : '<span class="warn-text nowrap" title="Another IP range than this computer: give the camera an address in your range, or change this computer\'s IP address">Other range</span>'}</td>
      <td class="small muted">${JSON.stringify(r.edit) !== JSON.stringify(r.orig) ? 'Changed' : ''}</td>`;
    $('input[type=checkbox]', tr).onchange = e => { r.sel = e.target.checked; updEipSel(); };
    $$('input[data-k]', tr).forEach(i => i.onchange = () => { r.edit[i.dataset.k] = i.dataset.k === 'port' ? (+i.value || 80) : i.value.trim(); renderEip(); });
    tb.appendChild(tr);
  }
  $('#eipEmpty').classList.toggle('hidden', state.eip.length > 0);
  const changed = state.eip.filter(r => JSON.stringify(r.edit) !== JSON.stringify(r.orig)).length;
  $('#eipApply').disabled = !changed;
  $('#eipChanged').textContent = changed ? `${changed} camera${changed > 1 ? 's' : ''} changed, not applied yet` : '';
  $('#eipCount').textContent = state.eip.length;
  updEipSel();
  renderCams();
}
function updEipSel() {
  const n = state.eip.filter(r => r.sel).length;
  $('#eipSelN').textContent = n; selBar($('#eipSelBar'), n);
  selAllState($('#eipSelAll'), state.eip, r => r.sel);
}
// Take Easy IP search results; keeps the selection and any edits that were not applied yet
function eipTake(found) {
  const old = new Map(state.eip.map(r => [r.mac, r]));
  state.eip = found.map(c => {
    const v = { name: c.name, ip: c.ip, mask: c.mask, gateway: c.gateway, port: c.port }, o = old.get(c.mac);
    const pending = o && JSON.stringify(o.edit) !== JSON.stringify(o.orig) && JSON.stringify(o.orig) === JSON.stringify(v);
    return { ...c, sel: o?.sel || false, orig: { ...v }, edit: pending ? o.edit : { ...v } };
  });
  renderEip();
}
async function eipDiscover() {
  if (!state.bridgeOk && !(await checkBridge())) return;
  $('#eipSearch').disabled = true; eipProgress('Searching the network…');
  try {
    const j = await bridgeFetch('/api/eip/discover', { timeout: 3 });
    eipTake(j.cameras);
    eipProgress(`${state.eip.length} camera${state.eip.length === 1 ? '' : 's'} on the network · ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
    log(`Easy IP: ${state.eip.length} camera(s) found`);
  } catch (e) { eipProgress('Search failed: ' + e.message); }
  $('#eipSearch').disabled = false; renderEip();
}
$('#eipSearch').onclick = eipDiscover;
$('#eipSelAll').onchange = () => { selAllClick($('#eipSelAll'), state.eip, r => r.sel, (r, v) => r.sel = v); renderEip(); };
$('#eipFill').onclick = () => {
  const sel = state.eip.filter(r => r.sel);
  if (!sel.length) return info('Select cameras first', 'Tick the cameras you want to give new settings.');
  const start = $('#eipStart').value.trim(), mask = $('#eipMask').value.trim(), gw = $('#eipGw').value.trim();
  if (start && !validIp(start, true)) return info('Invalid first IP address', esc(start));
  let n = start ? ipNum(start) : null;
  for (const r of sel) {
    if (n != null) { r.edit.ip = [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255].join('.'); n++; }
    if (mask) r.edit.mask = mask;
    if (gw) r.edit.gateway = gw;
  }
  renderEip();
};
// Camera name (title): letters, digits, space and - _ . , at most 15 characters.
const validCamName = n => /^[A-Za-z0-9 _.\-]{1,15}$/.test(n);
const netChanged = (a, b) => ['ip', 'mask', 'gateway', 'port'].some(k => a[k] !== b[k]);
// The name is set over the camera's REST interface (OSJ:5C), so the camera must be reachable from this computer.
async function setCamName(r, v, waitForNetwork) {
  const cam = { ip: v.ip, port: v.port || 80 };
  const tries = waitForNetwork ? 10 : 1;
  let last = '';
  for (let i = 0; i < tries; i++) {
    if (waitForNetwork) await sleep(i ? 2000 : 4000); // the camera restarts its network after an IP change
    try {
      // two names: the camera title in the camera menu (OSJ:5C) and the camera name of the web page and the
      // network (cam_title, also what Easy IP shows). Both are set; the web name needs the admin login.
      // web name first (set_basic, admin login), then the title: as hex (AW-UE150 V3.x), else as text
      const [webSet, hexTitle] = await batch(cam, [{ type: 'cgi', path: '/cgi-bin/set_basic', query: { cam_title: v.name } }, { cmd: 'OSJ:5C:' + titleHex(v.name) }], { delayMs: 300 });
      const titleSet = hexTitle?.ok && isErr(hexTitle.body) ? (await batch(cam, [{ cmd: 'OSJ:5C:' + v.name }]))[0] : hexTitle;
      const [webNow] = await batch(cam, [{ type: 'basic' }]);
      const res = [titleSet, webSet, webNow];
      if (titleSet?.status === 401 || webSet?.status === 401) throw new Error('login required (enter the camera login in Settings)');
      const title = titleSet?.ok && !isErr(titleSet.body), web = (webNow?.body || '') === v.name;
      if (title || web) {
        log(`Name of ${r.mac} set to "${v.name}" (menu title ${title ? 'ok' : res[0]?.body}, web name ${web ? 'ok' : 'still ' + (res[2]?.body || '?')})`);
        if (!web) throw new Error(`the camera title changed, but the name on the web page is still "${res[2]?.body || '?'}" (answer to set_basic: ${res[1]?.status || res[1]?.error})`);
        return;
      }
      last = res[0]?.ok ? 'this model does not accept a new name this way (' + res[0].body + ')' : (res[0]?.error || 'no answer');
      if (res[0]?.ok) break;
    } catch (e) { last = e.message; if (/login|web page/.test(last)) throw new Error('name: ' + last); }
  }
  throw new Error(`name not changed: ${last}. The computer must be in the same IP range as ${v.ip}.`);
}
async function eipSend(list, field) {
  const fails = [];
  for (const r of list) {
    const v = r[field], other = r[field === 'edit' ? 'orig' : 'edit'];
    const net = !r.local && netChanged(v, other);
    if (net) {
      eipProgress(`${r.orig?.name || r.model || r.mac}: sending ${v.ip} with Easy IP…`);
      try { await bridgeFetch('/api/eip/set', { mac: r.mac, ip: v.ip, mask: v.mask, gateway: v.gateway, dns1: r.dns1, dns2: r.dns2, port: v.port }); log(`Easy IP: ${r.mac} → ${v.ip}`); }
      catch (e) { fails.push({ r, what: 'ip', msg: e.message }); continue; }
    }
    if (v.name !== other.name) {
      if (!r.local && state.localIps.length && !sameRange(v.ip, v.mask)) { fails.push({ r, what: 'name', msg: `Name not sent: the camera's web interface at ${v.ip} is not reachable from this computer (another IP range). Change the name once the camera is in your range.` }); continue; }
      eipProgress(`${r.orig?.name || r.model || r.mac}: sending the name…`);
      try { await setCamName(r, v, net); const c = state.cameras.find(x => x.ip === v.ip) || state.cameras.find(x => x.ip === other.ip); if (c) { c.title = v.name; saveCams(); renderCams(); } } catch (e) { fails.push({ r, what: 'name', msg: e.message }); }
    }
  }
  return fails;
}
function eipProgress(t) { $('#eipStatus').textContent = t; $('#camSearchStatus').textContent = t; }
// After sending: search again and compare what every camera now announces with what was asked.
// Changes that did not happen are dropped from the table, so it shows the cameras as they really are.
async function eipVerify(snap, field, fails) {
  const nets = snap.filter(r => netChanged(r[field], r[field === 'edit' ? 'orig' : 'edit']));
  if (nets.length) { for (let t = 5; t > 0; t--) { eipProgress(`Waiting for the camera${nets.length > 1 ? 's' : ''} to restart the network… ${t}`); await sleep(1000); } }
  eipProgress('Searching again to check…');
  for (const r of snap) { const row = state.eip.find(x => x.mac === r.mac); if (row) row.edit = { ...row.orig }; }
  let found = [];
  try { found = (await bridgeFetch('/api/eip/discover', { timeout: 3 })).cameras || []; } catch (e) { eipProgress('Search failed: ' + e.message); }
  eipTake(found);
  const rows = snap.map(r => {
    const want = r[field], was = r[field === 'edit' ? 'orig' : 'edit'], now = found.find(f => f.mac === r.mac);
    const out = [];
    if (netChanged(want, was)) {
      const f = fails.find(x => x.r === r && x.what === 'ip');
      if (f) out.push({ bad: true, t: `IP not sent: ${f.msg}` });
      else if (!now) out.push({ bad: true, t: 'The camera did not answer the new search (still restarting?). Search again in a moment.' });
      else if (now.ip === want.ip && now.mask === want.mask && now.gateway === want.gateway) {
        out.push({ t: `IP ${was.ip} → ${want.ip}` });
        // the camera keeps its place, description and zones in the Cameras list under its new address
        const c = state.cameras.find(x => x.ip === was.ip), old = state.cameras.find(x => x !== c && x.ip === want.ip);
        if (c && !old) { c.ip = want.ip; c.port = want.port || 80; c.status = ''; saveCams(); renderCams(); }
        else if (old) { // a replaced camera: the new one takes over its entry (zone, description), the temporary entry goes
          if (c) state.cameras.splice(state.cameras.indexOf(c), 1);
          old.port = want.port || 80; old.status = ''; old.statusKind = ''; old.scene = null; if (now.model) old.model = now.model;
          saveCams(); renderCams();
        }
      }
      else out.push({ bad: true, t: `IP not changed: the camera still announces ${now.ip}. Cameras only accept a new address in the first 20 minutes after power-on (Easy IP Setup accommodate period): switch it off and on and try again.` });
    }
    if (want.name !== was.name) {
      const f = fails.find(x => x.r === r && x.what === 'name');
      out.push(f ? { bad: true, t: f.msg } : { t: `Name → ${want.name}` });
    }
    return { r, out };
  });
  state.netLocal.clear(); renderCams();
  const bad = rows.some(x => x.out.some(o => o.bad));
  eipProgress(bad ? 'Not everything changed. See the result.' : `Done · ${new Date().toLocaleTimeString('en-GB')}`);
  await ask({ title: bad ? 'Not every change was made' : 'Network settings changed', ok: 'OK', cancel: null, wide: true,
    body: `<table class="tbl dense"><thead><tr><th>Camera</th><th>MAC</th><th>Result</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.r.orig.name || x.r.model || '')}</td><td class="mono small">${esc(x.r.mac)}</td><td>${x.out.map(o => `<div class="${o.bad ? 'warn-text' : 'ok-text'}">${esc(o.t)}</div>`).join('')}</td></tr>`).join('')}</tbody></table>` });
}
$('#eipApply').onclick = () => applyNet(state.eip.filter(netPending));
async function applyNet(list, opts = {}) {
  if (!list.length) return;
  const bad = list.find(r => !validIp(r.edit.ip, true) || !validIp(r.edit.mask, true) || (r.edit.gateway && r.edit.gateway !== '0.0.0.0' && !validIp(r.edit.gateway, true)));
  if (bad) return info('Check the values', `The settings for ${esc(bad.mac)} are not valid IPv4 addresses.`);
  const badName = list.find(r => r.edit.name !== r.orig.name && !validCamName(r.edit.name));
  if (badName) return info('Check the name', `“${esc(badName.edit.name)}” is not a valid camera name. Use at most 15 letters, digits, spaces, hyphens, underscores or dots.`);
  // Two cameras in this change with the same new address: never.
  const dup = list.find(r => list.some(o => o !== r && o.edit.ip === r.edit.ip));
  if (dup) return info('Duplicate IP address', `${esc(dup.edit.ip)} is used more than once.`);
  // A new address that another camera in the list or in the last search had: only a problem if something still
  // answers there. A broken camera that was replaced (switched off, unplugged) does not block its address.
  const taken = [];
  for (const r of list.filter(r => r.edit.ip !== r.orig.ip)) {
    const ip = r.edit.ip;
    const listed = state.cameras.filter(c => c.ip === ip && !list.some(o => o.orig.ip === ip));
    const found = state.eip.filter(o => o.mac !== r.mac && o.orig.ip === ip && !list.includes(o));
    if (!listed.length && !found.length) continue;
    eipProgress(`Checking whether ${ip} is still in use…`);
    const [q] = await batch({ ip, port: 80 }, [{ type: 'cam', cmd: 'QID' }]);
    eipProgress('');
    const names = [...listed.map(c => camName(c)), ...found.map(o => o.orig.name || o.model)].filter(Boolean).join(', ') || ip;
    if (q?.ok || q?.status > 0) return info('IP address in use', `${esc(ip)} still answers on the network (${esc(names)}). Switch that camera off or give it another address first. Nothing was changed.`);
    taken.push({ r, ip, names, listed });
  }
  const ok = opts.confirmed || await ask({
    title: `Change the network settings of ${list.length} camera${list.length > 1 ? 's' : ''}?`,
    body: `${taken.map(t => `<p class="warn-text">${esc(t.ip)} was used by ${esc(t.names)}, which no longer answers. ${t.listed.length ? 'That old entry is replaced in the Cameras list: the new camera keeps its zone and description.' : ''}</p>`).join('')}<ul>${list.map(r => `<li><b>${esc(r.model || r.mac)}</b> ${esc(r.orig.name)}: ${[r.edit.name !== r.orig.name ? `name → <b>${esc(r.edit.name)}</b>` : '', netChanged(r.edit, r.orig) ? `<span class="mono">${esc(r.orig.ip)} → ${esc(r.edit.ip)}</span>` : ''].filter(Boolean).join(', ')}</li>`).join('')}</ul>
      ${list.some(r => netChanged(r.edit, r.orig)) ? '<p>The cameras restart their network and are briefly unreachable. Cameras only accept new network settings within about 20 minutes after they were switched on; if a camera does not change, restart it and try again.</p>' : ''}
      ${list.some(r => r.edit.name !== r.orig.name) ? '<p>A new name is sent to the camera directly, so this computer must be in the same IP range as the camera (after any IP change).</p>' : ''}`,
    ok: 'Apply', danger: true,
  });
  if (!ok) return;
  $('#eipApply').disabled = true;
  state.eip = state.eip.filter(o => !taken.some(t => o.orig.ip === t.ip && o.mac !== t.r.mac)); // the old camera is gone
  const snap = list.map(r => ({ mac: r.mac, model: r.model, dns1: r.dns1, dns2: r.dns2, local: r.local, orig: { ...r.orig }, edit: { ...r.edit } }));
  const fails = await eipSend(snap, 'edit');
  pushHistory({ label: `Network settings of ${snap.length} camera${snap.length > 1 ? 's' : ''}`, camera: true, many: snap.length > 1,
    undo: async () => eipVerify(snap, 'orig', await eipSend(snap, 'orig')), redo: async () => eipVerify(snap, 'edit', await eipSend(snap, 'edit')) });
  await eipVerify(snap, 'edit', fails);
  renderEip();
}
$('#eipDelSel').onclick = () => {
  const n = state.eip.filter(r => r.sel).length;
  if (!n) return info('Select cameras first', 'Tick the cameras you want to remove from this list. Search again to bring them back.');
  state.eip = state.eip.filter(r => !r.sel); renderEip();
};
$('#eipToList').onclick = () => {
  const list = state.eip.filter(r => r.sel).length ? state.eip.filter(r => r.sel) : state.eip;
  if (!list.length) return info('No cameras found yet', 'Search the network first.');
  track('Add cameras from network setup', () => list.forEach(r => upsertCam(r.orig.ip, r.orig.port, { model: r.model, title: r.orig.name })));
  renderCams(); refreshAll(state.cameras.filter(c => list.some(r => r.orig.ip === c.ip)));
  const far = list.filter(r => !sameRange(r.orig.ip, r.orig.mask));
  if (far.length) info(`${list.length} camera${list.length > 1 ? 's' : ''} added to Cameras`, `${far.length} of them ${far.length > 1 ? 'are' : 'is'} in another IP range than this computer (${far.map(r => `<span class="mono">${esc(r.orig.ip)}</span>`).join(', ')}) and cannot be reached yet. Give ${far.length > 1 ? 'them' : 'it'} an address in your range here (select, Fill in, Apply changes), or change this computer's IP address.`);
  else toast(`${list.length} camera${list.length > 1 ? 's' : ''} added to Cameras`);
  renderEip();
};


/* ------------------------------------------------------------------ Engineering: one action on many cameras */
// Engineering works on the same selection as the Cameras page (one selection for the whole app)
const engSel = () => new Set(state.cameras.filter(c => c.selected).map(c => c.ip));
const setSelection = ips => { const on = new Set(ips); state.cameras.forEach(c => { c.selected = on.has(c.ip); }); saveCams(); renderCams(); };
const engCams = () => { const on = engSel(); return state.cameras.filter(c => on.has(c.ip)); };
$('#engAll').onclick = () => { setSelection(state.cameras.map(c => c.ip)); renderEng(); };
$('#engNone').onclick = () => { setSelection([]); renderEng(); };
function renderEng() {
  const on = engSel();
  $('#engCams').innerHTML = state.cameras.length ? state.cameras.map(c => `<label class="check"><input type="checkbox" value="${esc(c.ip)}" ${on.has(c.ip) ? 'checked' : ''}> ${esc(camName(c))} <span class="mono muted">${esc(c.ip)}</span>${c.statusKind === 'err' ? ' <span class="warn-text small">offline</span>' : ''}</label>`).join('') : '<span class="muted">Add cameras on the Cameras page first.</span>';
  const save = () => { setSelection($$('#engCams label:not(.selall-row) input:checked').map(x => x.value)); renderEng(); };
  $$('#engCams label:not(.selall-row) input').forEach(i => i.onchange = save);
  const box = c => $$('#engCams label:not(.selall-row) input').find(i => i.value === c.ip);
  zoneChips($('#engZones'), { get: c => !!box(c)?.checked, set: (c, v) => { const i = box(c); if (i) i.checked = v; }, done: save }, 'Zone');
  const n = Math.max(4, ...state.cameras.filter(c => c.model).map(c => profileFor(c.model).scenes || 4));
  $('#engScenes').innerHTML = Array.from({ length: n }, (_, i) => `<button data-eng="scene" data-v="${i + 1}" title="Load scene file ${i + 1}">${i + 1}</button>`).join('');
  $$('#engScenes [data-eng]').forEach(b => b.onclick = () => engClick(b));
}

// One command, with what counts as an answer: ok / not supported (ER…) / login / not reachable
function engVerdict(r, okText = 'Done') {
  if (!r) return { res: 'No answer', bad: true };
  if (r.status === 401) return { res: 'Login required (Camera login in Settings)', bad: true };
  if (r.unreachable || !r.ok) return { res: 'Not reachable', bad: true };
  if (isErr(r.body)) return { res: r.body.toUpperCase().startsWith('ER2') ? 'Camera busy or in standby (ER2)' : r.body.toUpperCase().startsWith('ER3') ? 'Value out of range (ER3)' : 'Not supported by this camera (' + r.body + ')', bad: true };
  return { res: okText };
}
const ENG = {
  power: { label: v => v === '1' ? 'Power on' : 'Standby', confirm: v => v === '0' && 'The cameras stop sending a picture until you switch them on again.',
    run: async (send, c, v) => { const r = await send('ptz', '#O' + v); return engVerdict(r, v === '1' ? 'Switching on' : 'In standby'); } },
  scene: { label: v => `Scene file ${v}`,
    run: async (send, c, v) => { const r = await send('cam', 'XSF:' + v); const x = engVerdict(r, `Scene ${v}`); if (!x.bad) c.scene = +v; return x; } },
  tallyEn: { label: v => v === '1' ? 'Tally enable' : 'Tally disable',
    run: async (send, c, v) => engVerdict(await send('ptz', '#TAE' + v), v === '1' ? 'Tally enabled' : 'Tally disabled') },
  tally: { label: (v, b) => `${b.dataset.c === 'R' ? 'Red' : 'Green'} tally ${v === '1' ? 'on' : 'off'}`,
    run: async (send, c, v, b) => {
      let r = await send('cam', `TL${b.dataset.c}:${v}`);
      if (b.dataset.c === 'R' && r?.ok && isErr(r.body)) r = await send('ptz', '#DA' + v);
      return engVerdict(r, v === '1' ? 'On' : 'Off');
    } },
  tallyBr: { label: v => `Tally brightness ${['Low', 'Mid', 'High'][v]}`,
    run: async (send, c, v) => engVerdict(await send('cam', 'OSA:D3:' + v), ['Low', 'Mid', 'High'][v]) },
  wb: { label: v => `White balance ${WB_NAME[v]}`,
    run: async (send, c, v) => engVerdict(await wbModeCmds(send, c.model, v), WB_NAME[v]) },
  varK: { label: () => `White balance VAR ${$('#engVarK').value} K`,
    check: () => validK(+$('#engVarK').value) || 'Fill in a colour temperature from 2000 to 15000 K.',
    run: async (send, c) => {
      const k = +$('#engVarK').value;
      const m = engVerdict(await wbModeCmds(send, c.model, 'var')); if (m.bad) return m;
      const x = engVerdict(await setVarK(send, k), `VAR ${k} K`); if (x.bad) return x;
      const back = kelvinFrom((await send('cam', 'QSI:20'))?.body);
      return back && Math.abs(back - k) > 20 ? { res: `VAR, camera reports ${back} K`, bad: true } : x;
    } },
  awb: { label: () => 'Auto white balance', run: async (send) => engVerdict(await send('cam', 'OWS'), 'AWB started (active memory)') },
  awbMem: { label: v => `AWB stored in memory ${v.toUpperCase()}`,
    run: async (send, c, v) => {
      const m = engVerdict(await wbModeCmds(send, c.model, v)); if (m.bad) return { ...m, res: `Memory ${v.toUpperCase()}: ${m.res}` };
      return engVerdict(await send('cam', 'OWS'), `AWB saved in ${v.toUpperCase()}`);
    } },
  abb: { label: () => 'Auto black balance', run: async (send) => engVerdict(await send('cam', 'OAS'), 'ABB started') },
  install: { label: v => v === '1' ? 'Installation hanging' : 'Installation desktop', confirm: () => 'The picture and the pan/tilt directions turn around. Some cameras restart.',
    run: async (send, c, v) => engVerdict(await send('ptz', '#INS' + v), v === '1' ? 'Hanging' : 'Desktop') },
  scope: { label: v => `Preset scope Mode ${'ABC'[v]}`,
    run: async (send, c, v) => {
      const was = /^OSE:71:(\d)/i.exec((await send('cam', 'QSE:71'))?.body || '')?.[1];
      const x = engVerdict(await send('cam', 'OSE:71:' + v)); if (x.bad) return x;
      const now = /^OSE:71:(\d)/i.exec((await send('cam', 'QSE:71'))?.body || '')?.[1];
      if (now !== v) return { res: `Not confirmed (camera reports ${now != null ? 'Mode ' + 'ABC'[now] : 'nothing'})`, bad: true };
      return { res: was === v ? `Was already Mode ${'ABC'[v]}` : `Mode ${'ABC'[v]}${was != null ? ' (was ' + 'ABC'[was] + ')' : ''}` };
    } },
  ipvideo: { label: v => `IP video ${v === '1' ? 'on' : 'off'}`, confirm: v => v === '0' && 'Switches the H.264 streams of the camera off. Anything that watches those streams (a decoder, a recorder, vMix) loses the picture.',
    run: async (send, c, v, b, cgi) => {
      // the camera's own settings page posts h264_transmit to set_h264, set_h264_2…4 (a GET is refused with 400)
      const paths = ['/cgi-bin/set_h264', '/cgi-bin/set_h264_2', '/cgi-bin/set_h264_3', '/cgi-bin/set_h264_4'];
      const rs = []; for (const p of paths) rs.push(await cgi(p, { h264_transmit: v }, 'POST'));
      if (rs[0]?.status === 401) return { res: 'Login required (Camera login in Settings)', bad: true };
      if (rs.every(r => !r?.ok)) return { res: rs[0]?.unreachable ? 'Not reachable' : 'Not accepted (HTTP ' + (rs[0]?.status || '?') + ')', bad: true };
      const sd = (await cgi('/cgi-bin/setdata', {}))?.body || '';
      const now = ['H264', 'H264_2', 'H264_3', 'H264_4'].map(k => (new RegExp('^' + k + ',"(\\d)"', 'm').exec(sd) || [])[1]).filter(Boolean);
      const good = now.filter(x => x === v).length;
      return now.length ? (good === now.length ? { res: `${good} H.264 stream${good > 1 ? 's' : ''} ${v === '1' ? 'on' : 'off'}` } : { res: `${good} of ${now.length} streams ${v === '1' ? 'on' : 'off'}`, bad: true }) : { res: `${rs.filter(r => r?.ok).length} of ${paths.length} streams ${v === '1' ? 'on' : 'off'}` };
    } },
};
$('#engWbStore').onclick = () => armStore($('#engWbStore'), !$('#engWbStore').classList.contains('armed'), $('.e-white'), 'wb-storing');
async function engClick(btn) {
  let kind = btn.dataset.eng; const v = btn.dataset.v;
  if (kind === 'wb' && $('#engWbStore').classList.contains('armed')) {
    armStore($('#engWbStore'), false, $('.e-white'), 'wb-storing');
    if (!['a', 'b'].includes(v)) return toast('Store works for A and B');
    kind = 'awbMem';
  }
  const cams = engCams();
  if (kind === 'init') { if (!cams.length) return info('Choose cameras first', 'Tick the cameras at the top of this page.'); return initializeCams(cams); }
  if (kind === 'defsave') { if (cams.length !== 1) return info('Choose one camera', 'Save engineering file reads the setup of one camera. Tick only that camera.'); return saveEngFile(cams[0]); }
  const a = ENG[kind]; if (!a) return;
  if (!cams.length) return info('Choose cameras first', 'Tick the cameras at the top of this page, or use a zone.');
  if (!state.bridgeOk && !(await checkBridge())) return;
  const chk = a.check?.(); if (chk && chk !== true) return info('Check the value', esc(chk));
  const label = a.label(v, btn);
  const warn = a.confirm?.(v) || (kind === 'awbMem' && 'Point the cameras at something white. Each camera switches to that memory and stores an auto white balance in it.');
  if (warn && !await ask({ title: `${label} on ${cams.length} camera${cams.length > 1 ? 's' : ''}?`, ok: label, danger: true, body: `<p>${esc(warn)}</p><p class="muted small">${cams.map(c => esc(camName(c))).join(', ')}</p>` })) return;
  $('#tab-eng').classList.add('busy'); $('#engStatus').textContent = `${label}: ${cams.length} camera${cams.length > 1 ? 's' : ''}…`;
  $('#engResultTitle').textContent = label;
  const rows = await Promise.all(cams.map(async c => {
    const raw = [];
    const send = async (type, cmd) => { try { const r = (await batch(c, [{ type, cmd }], { delayMs: 0 }))[0]; raw.push(`${cmd} → ${r?.ok ? (r.body || '(empty)') : (r?.status === 401 ? '401' : r?.error || 'no answer')}`); return r; } catch (e) { raw.push(`${cmd} → ${e.message}`); return { ok: false, error: e.message }; } };
    const cgi = async (path, query, method) => { try { const r = (await batch(c, [{ type: 'cgi', path, query, method }], { delayMs: 0 }))[0]; raw.push(`${path} → ${r?.ok ? 'HTTP ' + r.status + ' ' + (r.body || '').slice(0, 60) : (r?.error || 'no answer')}`); return r; } catch (e) { raw.push(`${path} → ${e.message}`); return { ok: false }; } };
    try { return { c, raw, ...(await a.run(send, c, v, btn, cgi)) }; } catch (e) { return { c, raw, res: e.message, bad: true }; }
  }));
  $('#tab-eng').classList.remove('busy');
  const ok = rows.filter(r => !r.bad).length;
  $('#engStatus').textContent = `${ok} of ${rows.length} done · ${new Date().toLocaleTimeString('en-GB')}`;
  $('#engResult').innerHTML = `<table class="tbl dense eng-res"><thead><tr><th>Camera</th><th>IP</th><th>Result</th><th>Camera's answer</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(camName(r.c))}</td><td class="mono small">${esc(r.c.ip)}</td><td class="${r.bad ? 'warn-text' : 'ok-text'}">${esc(r.res)}</td><td class="mono raw">${r.raw.map(esc).join('<br>')}</td></tr>`).join('')}</tbody></table>`;
  log(`Engineering: ${label}: ${ok}/${rows.length} ok`);
  if (live.cam && cams.includes(live.cam)) liveRead();
}
$$('#tab-eng .eng-tiles [data-eng]').forEach(b => b.onclick = () => engClick(b));
/* ---- Engineering: setup for many cameras (system settings, OSD mix, tally, pan/tilt, white balance per scene) ---- */
// Commands as the camera's own web page uses them (System page of an AW-UE150 V3.20). cam: set prefix + value, the
// query answers with the same prefix; ptz: '#XXX' + value, the query answers e.g. 'tAE1'.
const FREQS = [['0', '59.94Hz', [['19', '2160/59.94p'], ['17', '2160/29.97p'], ['10', '1080/59.94p'], ['04', '1080/59.94i'], ['14', '1080/29.97p'], ['07', '1080/29.97PsF'], ['16', '1080/23.98p (over 59.94i)'], ['01', '720/59.94p']]],
  ['1', '50Hz', [['1A', '2160/50p'], ['18', '2160/25p'], ['11', '1080/50p'], ['05', '1080/50i'], ['15', '1080/25p'], ['08', '1080/25PsF'], ['02', '720/50p']]],
  ['2', '24Hz', [['21', '2160/24p'], ['22', '1080/24p']]],
  ['3', '23.98Hz', [['1B', '2160/23.98p'], ['23', '1080/23.98p'], ['0A', '1080/23.98PsF']]]];
const SCENE_WB_OPTS = [['', '–'], ['auto', 'Auto (ATW)'], ['k32', '3200K'], ['k56', '5600K'], ['a', 'Memory A'], ['b', 'Memory B'], ['var', 'VAR']];
const OFFON = [['0', 'Off'], ['1', 'On']], DISEN = [['1', 'Enable'], ['0', 'Disable']], FAN = [['0', 'Auto'], ['1', 'High'], ['2', 'Mid'], ['3', 'Low']];
const SETUP = [
  { g: 'Video', k: 'format', l: 'Frequency and format', format: true },
  { g: 'Video', k: 'shoot', l: 'Shooting mode', set: 'OSI:30:', q: 'QSI:30', o: [['0', 'Normal'], ['1', 'High Sens.']] },
  { g: 'Video', k: 'color', l: 'Color setting', set: 'OSJ:56:', q: 'QSJ:56', o: [['0', 'Normal'], ['1', 'V-Log']] },
  { g: 'Video', k: 'ipvideo', l: 'IP video (H.264)', ipv: true, o: [['1', 'On'], ['0', 'Off']] },
  { g: 'OSD mix', k: 'osd12g', l: '12G SDI / optical', bit: 0x20, o: OFFON },
  { g: 'OSD mix', k: 'osd3g', l: '3G SDI', bit: 0x01, o: OFFON },
  { g: 'OSD mix', k: 'osdmoni', l: 'MONI', bit: 0x40, o: OFFON },
  { g: 'OSD mix', k: 'osdhdmi', l: 'HDMI', bit: 0x02, o: OFFON },
  { g: 'OSD mix', k: 'osdip', l: 'IP', bit: 0x10, o: OFFON },
  { g: 'OSD mix', k: 'osdrt', l: 'OSD off with R-tally', set: 'OSE:75:', q: 'QSE:75', o: OFFON },
  { g: 'Tally', k: 'tally', l: 'Tally', ptz: '#TAE', o: DISEN },
  { g: 'Tally', k: 'tallybr', l: 'Tally brightness', set: 'OSA:D3:', q: 'QSA:D3', o: [['0', 'Low'], ['1', 'Mid'], ['2', 'High']] },
  { g: 'Tally', k: 'lamp', l: 'Status lamp', ptz: '#LMP', o: DISEN },
  { g: 'Pan / tilt', k: 'install', l: 'Install position', ptz: '#INS', o: [['0', 'Desktop'], ['1', 'Hanging']] },
  { g: 'Pan / tilt', k: 'spf', l: 'Smart picture flip', ptz: '#SPF', o: [['0', 'Off'], ['1', 'Auto']] },
  { g: 'Pan / tilt', k: 'ptspeed', l: 'P/T speed mode', set: 'OSJ:2D:', q: 'QSJ:2D', o: [['0', 'Normal (60°/s)'], ['1', 'Fast (180°/s)'], ['2', 'Quick (60°/s)']] },
  { g: 'Pan / tilt', k: 'swz', l: 'Speed with zoom position', ptz: '#SWZ', o: OFFON },
  { g: 'Pan / tilt', k: 'faz', l: 'Focus adjust with PTZ', set: 'OAZ:', q: 'QAZ', o: OFFON },
  { g: 'Presets', k: 'scope', l: 'Preset scope', set: 'OSE:71:', q: 'QSE:71', o: [['0', 'Mode A'], ['1', 'Mode B'], ['2', 'Mode C']] },
  { g: 'Presets', k: 'pst', l: 'Preset speed table', ptz: '#PST', o: [['0', 'Slow'], ['1', 'Mid (not on AW-UE150)'], ['2', 'Fast']] }, // AW-UE150 V3.20 answers eR3 to #PST1
  { g: 'Presets', k: 'prf', l: 'Freeze during preset', ptz: '#PRF', o: OFFON },
  { g: 'Presets', k: 'pwron', l: 'Power-on position', set: 'OSJ:45:', q: 'QSJ:45', o: [['0', 'None'], ['1', 'Standby'], ['2', 'Home'], ['3', 'Preset']] },
  { g: 'System', k: 'wlc', l: 'Wireless control', ptz: '#WLC', o: DISEN },
  { g: 'System', k: 'fan1', l: 'Fan 1', ptz: '#FAN', o: FAN },
  { g: 'System', k: 'fan2', l: 'Fan 2', ptz: '#FA2', o: FAN },
  ...[1, 2, 3, 4].map(n => ({ g: 'White balance per scene', k: 'wb' + n, l: `Scene ${n}`, wb: n, o: SCENE_WB_OPTS.slice(1) })),
];
const setupVal = () => store.get('engSetup', {});
const setupLabel = (f, v) => f.format ? (() => { const [fr, fm] = v.split('|'); const F = FREQS.find(x => x[0] === fr); return `${F?.[1]} ${F?.[2].find(x => x[0] === fm)?.[1] || ''}`; })() : f.wb && v === 'var' ? `VAR ${setupVal()['k' + f.wb] || ''} K` : (f.o.find(x => x[0] === v)?.[1] || v);
function renderSetup() {
  const v = setupVal();
  const groups = [...new Set(SETUP.map(f => f.g))];
  const sel = f => f.format
    ? `<select data-k="${f.k}" aria-label="${esc(f.l)}"><option value="">–</option>${FREQS.map(([fr, fl, list]) => `<optgroup label="${fl}">${list.map(([fm, l]) => `<option value="${fr}|${fm}" ${v[f.k] === fr + '|' + fm ? 'selected' : ''}>${fl} · ${l}</option>`).join('')}</optgroup>`).join('')}</select>`
    : `<select data-k="${f.k}" aria-label="${esc(f.l)}"><option value="">–</option>${f.o.map(([k, l]) => `<option value="${k}" ${v[f.k] === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  $('#setupForm').innerHTML = groups.map(g => `<div class="setup-group"><h3>${esc(g)}</h3>${SETUP.filter(f => f.g === g).map(f => `<label class="setup-row${v[f.k] ? ' set' : ''}"><span>${esc(f.l)}</span>${sel(f)}${f.wb ? `<span class="kfield${v[f.k] === 'var' ? '' : ' hidden'}"><input type="number" data-k="k${f.wb}" min="2000" max="15000" step="10" value="${esc(v['k' + f.wb] || '')}" placeholder="5600" aria-label="VAR colour temperature of scene ${f.wb}"><span>K</span></span>` : ''}</label>`).join('')}</div>`).join('');
  $$('#setupForm [data-k]').forEach(el => el.onchange = () => { const t = setupVal(); if (el.value.trim()) t[el.dataset.k] = el.value.trim(); else delete t[el.dataset.k]; store.set('engSetup', t); renderSetup(); });
  const n = SETUP.filter(f => v[f.k]).length;
  $('#setupStatus').textContent = n ? `${n} setting${n > 1 ? 's' : ''} chosen` : 'Nothing chosen yet';
}
$('#setupClear').onclick = () => { store.set('engSetup', {}); renderSetup(); };
const H264_PATHS = ['/cgi-bin/set_h264', '/cgi-bin/set_h264_2', '/cgi-bin/set_h264_3', '/cgi-bin/set_h264_4'];
async function readH264(c) {
  const b = (await batch(c, [{ type: 'cgi', path: '/cgi-bin/setdata', query: {} }]))[0]?.body || '';
  return ['H264', 'H264_2', 'H264_3', 'H264_4'].map(k => (new RegExp('^' + k + ',"(\\d)"', 'm').exec(b) || [])[1]).filter(Boolean);
}
// one camera: read every setting (and, if asked, the white balance of scenes 1 to 4: the camera switches scenes)
async function readSetup(c, withScenes) {
  const send = async (type, cmd) => (await batch(c, [{ type, cmd }], { delayMs: 0 }))[0];
  const got = {};
  for (const f of SETUP) {
    if (f.wb || f.bit) continue;
    if (f.ipv) { const st = await readH264(c); if (st.length && st.every(x => x === st[0])) got.ipvideo = st[0]; continue; }
    if (f.format) { const a = await send('cam', 'QSE:77'), b = await send('cam', 'QSA:87'); const fr = /OSE:77:(\d)/.exec(a?.body || '')?.[1], fm = /OSA:87:([0-9A-F]{2})/i.exec(b?.body || '')?.[1]?.toUpperCase(); if (fr && fm) got.format = fr + '|' + fm; continue; }
    const r = f.ptz ? await send('ptz', f.ptz) : await send('cam', f.q);
    if (!r?.ok || isErr(r.body)) continue;
    const val = f.ptz ? r.body.slice(f.ptz.length - 1) : r.body.startsWith(f.set) ? r.body.slice(f.set.length) : null;
    if (val != null && f.o.some(o => o[0] === val)) got[f.k] = val;
  }
  const m = await send('cam', 'QSE:7B'); const mask = parseInt(/OSE:7B:([0-9A-F]+)/i.exec(m?.body || '')?.[1], 16);
  if (Number.isFinite(mask)) SETUP.filter(f => f.bit).forEach(f => { got[f.k] = mask & f.bit ? '1' : '0'; });
  if (withScenes) {
    const orig = await getScene(c);
    for (let n = 1; n <= 4; n++) {
      await switchScene(c, n);
      const q = await send('cam', 'QAW'); const w = WB_FROM_OAW[/^OAW:(\d)$/i.exec(q?.body || '')?.[1]];
      if (w) { got['wb' + n] = w; if (w === 'var') { const k = kelvinFrom((await send('cam', 'QSI:20'))?.body); if (k) got['k' + n] = String(k); } }
    }
    await switchScene(c, orig);
  }
  return got;
}
$('#setupRead').onclick = async () => {
  if (!state.cameras.length) return info('No cameras yet', 'Add cameras on the Cameras page first.');
  const first = engCams()[0] || state.cameras[0];
  const ok = await ask({ title: 'Read the setup of a camera', ok: 'Read', body: `<label>Camera <select id="srCam">${state.cameras.map(c => `<option value="${esc(c.ip)}" ${c === first ? 'selected' : ''}>${esc(camName(c))} – ${esc(c.ip)}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" id="srScenes" checked> Also read the white balance of scenes 1 to 4 <span class="muted">(the camera switches to each scene for a moment, then back)</span></label>
    <p class="hint">The form gets the camera's current values; nothing changes on the camera${''}. Then tick the cameras that should get the same and choose Apply.</p>` });
  if (!ok) return;
  const c = state.cameras.find(x => x.ip === $('#srCam').value), withScenes = $('#srScenes').checked;
  if (!state.bridgeOk && !(await checkBridge())) return;
  $('#setupStatus').textContent = `Reading ${camName(c)}…`;
  try { const got = await readSetup(c, withScenes); store.set('engSetup', got); renderSetup(); toast(`Setup of ${camName(c)} read: ${Object.keys(got).filter(k => !/^k\d$/.test(k)).length} settings`); }
  catch (e) { info('Could not read the camera', esc(e.message)); renderSetup(); }
};
// Frequency changes make the camera restart: wait until it is gone and back with the new frequency
async function waitRestart(c, check, progress) {
  let gone = false;
  for (let i = 0; i < 100; i++) {
    await sleep(2000);
    let r; try { r = (await batch(c, [{ cmd: 'QSE:77' }, { type: 'ptz', cmd: '#O' }], { delayMs: 0 }))[0]; } catch { r = null; }
    if (!r?.ok) { gone = true; progress(`${camName(c)}: restarting…`); continue; }
    if ((gone || i > 20) && check(r.body)) return true;
  }
  return false;
}
$('#setupApply').onclick = async () => {
  const v = setupVal(), cams = engCams();
  const plan = SETUP.filter(f => v[f.k]);
  if (!plan.length) return info('Nothing chosen yet', 'Choose at least one setting, or read the setup of a camera first.');
  if (!cams.length) return info('Choose cameras first', 'Tick the cameras at the top of this page, or use a zone.');
  const badK = plan.find(f => f.wb && v[f.k] === 'var' && !validK(+v['k' + f.wb]));
  if (badK) return info('Check the colour temperature', `${esc(badK.l)} is set to VAR: fill in a colour temperature from 2000 to 15000 K.`);
  const freq = v.format?.split('|')[0];
  const scenes = plan.filter(f => f.wb);
  if (!await ask({ title: `Apply ${plan.length} setting${plan.length > 1 ? 's' : ''} to ${cams.length} camera${cams.length > 1 ? 's' : ''}?`, ok: 'Apply', danger: true, wide: true, body: `
      <div class="setup-sum">${[...new Set(plan.map(f => f.g))].map(g => `<div><b>${esc(g)}</b>: ${plan.filter(f => f.g === g).map(f => `${esc(f.l)} ${esc(setupLabel(f, v[f.k]))}`).join(', ')}</div>`).join('')}</div>
      ${freq ? '<p class="warn-text">A camera that gets another frequency restarts (about a minute without picture).</p>' : ''}
      ${scenes.length ? '<p>For the white balance every camera switches to those scenes one by one and then goes back to the scene that was live.</p>' : ''}
      <p class="muted small">Only settings that differ are sent; every value is read back afterwards. ${cams.map(c => esc(camName(c))).join(', ')}</p>` })) return;
  if (!state.bridgeOk && !(await checkBridge())) return;
  await runSetup(cams, v, 'Setup');
};
async function runSetup(cams, v, title) {
  $('#tab-eng').classList.add('busy'); $('#engResultTitle').textContent = title;
  const progress = t => { $('#setupStatus').textContent = $('#engStatus').textContent = t; };
  progress(`${title}: ${cams.length} camera${cams.length > 1 ? 's' : ''}…`);
  const rows = await applySetup(cams, v, progress);
  $('#tab-eng').classList.remove('busy');
  const ok = rows.filter(r => !r.bad).length;
  progress(`${title}: ${ok} of ${rows.length} camera${rows.length > 1 ? 's' : ''} done · ${new Date().toLocaleTimeString('en-GB')}`);
  $('#engResult').innerHTML = `<table class="tbl dense eng-res"><thead><tr><th>Camera</th><th>IP</th><th>Result</th><th>Camera's answer</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(camName(r.c))}</td><td class="mono small">${esc(r.c.ip)}</td><td>${r.out.map(o => `<div class="${o.bad ? 'warn-text' : 'ok-text'}">${esc(o.t)}</div>`).join('')}</td><td class="mono small muted"><details><summary>${r.raw.length} commands</summary>${r.raw.map(esc).join('<br>')}</details></td></tr>`).join('')}</tbody></table>`;
  $('#engResultCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  log(`Engineering: ${title}: ${ok}/${rows.length} ok`);
  if (live.cam && cams.includes(live.cam)) liveRead();
  return rows;
}
// Put the setup v on every camera; returns per camera what was done ({ c, out: [{ t, bad }], raw })
async function applySetup(cams, v, progress = () => {}) {
  const plan = SETUP.filter(f => v[f.k]), scenes = plan.filter(f => f.wb);
  return Promise.all(cams.map(async c => {
    const raw = [], out = [];
    const send = async (type, cmd) => { try { const r = (await batch(c, [{ type, cmd }], { delayMs: 0 }))[0]; raw.push(`${cmd} → ${r?.ok ? (r.body || '(empty)') : (r?.status === 401 ? '401' : r?.error || 'no answer')}`); return r; } catch (e) { raw.push(`${cmd} → ${e.message}`); return { ok: false, error: e.message }; } };
    const okBody = r => r?.ok && !isErr(r.body);
    try { if (!c.model) await identify(c); } catch { return { c, raw, out: [{ bad: true, t: 'Not reachable' }], bad: true }; }
    // 1. frequency and format first (a frequency change restarts the camera)
    if (v.format) {
      const [fr, fm] = v.format.split('|'), f = SETUP[0];
      const nowF = /OSE:77:(\d)/.exec((await send('cam', 'QSE:77'))?.body || '')?.[1];
      if (nowF !== fr) {
        const r = await send('cam', 'OSE:77:' + fr);
        if (!okBody(r)) out.push({ bad: true, t: `Frequency: ${engVerdict(r).res}` });
        else { progress(`${camName(c)}: restarting for ${FREQS.find(x => x[0] === fr)[1]}…`); if (!await waitRestart(c, b => b === 'OSE:77:' + fr, progress)) out.push({ bad: true, t: 'Frequency: the camera did not come back within 3 minutes' }); }
      }
      const nowM = /OSA:87:([0-9A-F]{2})/i.exec((await send('cam', 'QSA:87'))?.body || '')?.[1]?.toUpperCase();
      if (nowM !== fm) { const r = await send('cam', 'OSA:87:' + fm); if (!okBody(r)) out.push({ bad: true, t: `Format: ${engVerdict(r).res}` }); await sleep(1500); }
      const chkF = (await send('cam', 'QSE:77'))?.body, chkM = (await send('cam', 'QSA:87'))?.body?.toUpperCase();
      out.push(chkF === 'OSE:77:' + fr && chkM === 'OSA:87:' + fm ? { t: `Format: ${setupLabel(f, v.format)}` } : { bad: true, t: `Format: reads ${chkF || '?'} ${chkM || '?'}` });
    }
    // 2. single settings: send only what differs, then read back
    for (const f of plan.filter(f => !f.format && !f.wb && !f.bit && !f.ipv)) {
      const want = v[f.k];
      const read = async () => { const r = f.ptz ? await send('ptz', f.ptz) : await send('cam', f.q); return !okBody(r) ? null : f.ptz ? r.body.slice(f.ptz.length - 1) : r.body.startsWith(f.set) ? r.body.slice(f.set.length) : null; };
      let now = await read();
      if (now !== want) { const r = f.ptz ? await send('ptz', f.ptz + want) : await send('cam', f.set + want); if (!okBody(r)) { out.push({ bad: true, t: `${f.l}: ${engVerdict(r).res}` }); continue; } await sleep(150); now = await read(); }
      out.push(now === want ? { t: `${f.l}: ${setupLabel(f, want)}` } : { bad: true, t: `${f.l}: reads ${now ?? '?'}` });
    }
    // IP video: the four H.264 streams together
    if (v.ipvideo) {
      const f = SETUP.find(x => x.ipv); let now = await readH264(c);
      // right after a restart (frequency change) the camera answers commands before its web server is ready: wait for it
      for (let i = 0; i < 15 && !now.length; i++) { await sleep(2000); now = await readH264(c); }
      if (!now.length) out.push({ bad: true, t: `${f.l}: not available on this camera` });
      else {
        if (now.some(x => x !== v.ipvideo)) for (const p of H264_PATHS) { const r = (await batch(c, [{ type: 'cgi', path: p, query: { h264_transmit: v.ipvideo }, method: 'POST' }]))[0]; raw.push(`POST ${p} h264_transmit=${v.ipvideo} → ${r?.ok ? 'HTTP ' + (r.status || 200) : r?.status === 401 ? '401 (camera login needed)' : r?.error || 'no answer'}`); }
        now = await readH264(c);
        out.push(now.every(x => x === v.ipvideo) ? { t: `${f.l}: ${setupLabel(f, v.ipvideo)}` } : { bad: true, t: `${f.l}: ${now.filter(x => x === v.ipvideo).length} of ${now.length} streams ${v.ipvideo === '1' ? 'on' : 'off'}${!camAuth(c).user ? ' (fill in the camera login on the Cameras page)' : ''}` });
      }
    }
    // 3. OSD mix: one byte, a bit per output
    const bits = plan.filter(f => f.bit);
    if (bits.length) {
      const cur = parseInt(/OSE:7B:([0-9A-F]+)/i.exec((await send('cam', 'QSE:7B'))?.body || '')?.[1], 16);
      if (!Number.isFinite(cur)) out.push({ bad: true, t: 'OSD mix: not supported by this camera' });
      else {
        let m = cur; bits.forEach(f => { m = v[f.k] === '1' ? (m | f.bit) : (m & ~f.bit); });
        if (m !== cur) await send('cam', 'OSE:7B:' + m.toString(16).toUpperCase().padStart(2, '0'));
        const back = parseInt(/OSE:7B:([0-9A-F]+)/i.exec((await send('cam', 'QSE:7B'))?.body || '')?.[1], 16);
        bits.forEach(f => { const on = !!(back & f.bit); out.push(on === (v[f.k] === '1') ? { t: `OSD mix ${f.l}: ${on ? 'On' : 'Off'}` } : { bad: true, t: `OSD mix ${f.l}: reads ${on ? 'On' : 'Off'}` }); });
      }
    }
    // 4. white balance per scene
    if (scenes.length) {
      let orig, cur;
      try { orig = cur = await getScene(c); } catch { orig = null; }
      for (const f of scenes) {
        const n = f.wb, want = v[f.k];
        if (n > (profileFor(c.model).scenes || 4)) { out.push({ bad: true, t: `Scene ${n}: this camera has no scene ${n}` }); continue; }
        try { if (n !== cur) { await switchScene(c, n); cur = n; } } catch (e) { out.push({ bad: true, t: `Scene ${n}: ${e.message}` }); continue; }
        const m = engVerdict(await wbModeCmds(send, c.model, want));
        if (!m.bad && want === 'var') { const k = engVerdict(await setVarK(send, +v['k' + n])); if (k.bad) { out.push({ bad: true, t: `Scene ${n} colour temperature: ${k.res}` }); continue; } }
        if (profileFor(c.model).fam === 'UE160') await send('cam', 'OSL:90:' + n);
        if (m.bad) { out.push({ bad: true, t: `Scene ${n} white balance: ${m.res}` }); continue; }
        await sleep(300);
        const q = /^OAW:(\d)$/i.exec((await send('cam', 'QAW'))?.body || ''), now = q && WB_FROM_OAW[q[1]];
        let okK = true; if (want === 'var') { const k = kelvinFrom((await send('cam', 'QSI:20'))?.body); okK = !!k && Math.abs(k - v['k' + n]) <= 10; }
        out.push(now === want && okK ? { t: `Scene ${n}: ${setupLabel(f, want)}` } : { bad: true, t: `Scene ${n}: white balance reads ${now ? WB_NAME[now] : '?'}` });
      }
      try { if (orig && cur !== orig) await switchScene(c, orig); c.scene = orig; } catch (e) { out.push({ bad: true, t: `Back to scene ${orig}: ${e.message}` }); }
    }
    return { c, raw, out, bad: out.some(o => o.bad) };
  }));
}

/* ------------------------------------------------------------------ refresh: read everything again */
async function refreshPage() {
  const btn = $('#refreshAllBtn'); if (btn.classList.contains('spin')) return;
  btn.classList.add('spin');
  try {
    if (!state.bridgeOk) await checkBridge();
    const tab = $('[role=tab][data-tab].active')?.dataset.tab;
    const jobs = [state.cameras.length ? refreshAll(state.cameras) : null];
    if (tab === 'live' && live.cam) jobs.push(liveRead());
    if (tab === 'cams') jobs.push(eipDiscover());
    await Promise.all(jobs.filter(Boolean));
    if (tab === 'eng') renderEng();
    if (tab === 'export') renderExport();
    if (tab === 'import') renderImports();
    toast('Refreshed');
  } finally { btn.classList.remove('spin'); }
}
$('#refreshAllBtn').onclick = refreshPage;
document.addEventListener('keydown', e => { if (e.key === 'F5') { e.preventDefault(); refreshPage(); } });

/* ------------------------------------------------------------------ RP150: assignment */
const saveRp = () => store.set('rpRows', state.rp);
function renderRp() {
  const tb = $('#rpTable tbody'); tb.innerHTML = '';
  state.rp.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox" ${r.sel ? 'checked' : ''} aria-label="Select row"></td><td><input data-k="cam" type="number" min="1" max="200" value="${r.cam}" class="num" aria-label="CAM number"></td><td><input data-k="ip" value="${esc(r.ip)}" class="mono${validIp(r.ip) ? '' : ' bad'}" style="width:150px" aria-label="IP address"></td><td><input data-k="port" type="number" value="${r.port || 80}" class="num" aria-label="Port"></td>
      <td><select data-k="conn" aria-label="Connection"><option value="lan">LAN</option><option value="none">None (NoAsign)</option></select></td><td>${esc(r.label || '')}</td><td class="end"><button class="icon" aria-label="Remove row">×</button></td>`;
    $('select', tr).value = r.conn || 'lan';
    $('input[type=checkbox]', tr).onchange = e => { r.sel = e.target.checked; saveRp(); renderRp(); };
    $$('[data-k]', tr).forEach(el => el.onchange = () => {
      const k = el.dataset.k; const v = k === 'cam' ? +el.value : k === 'port' ? (+el.value || 80) : el.value.trim();
      track(`Edit CAM ${r.cam}`, () => { state.rp[i] = { ...r, [k]: v }; });
      saveRp(); renderRp(); if (s15.a) analyzeS15();
    });
    $('button', tr).onclick = () => { track(`Remove CAM ${r.cam}`, () => state.rp.splice(i, 1)); saveRp(); renderRp(); if (s15.a) analyzeS15(); };
    tb.appendChild(tr);
  });
  $('#rpEmpty').classList.toggle('hidden', state.rp.length > 0);
  selAllState($('#rpSelAll'), state.rp, r => r.sel);
  const n = state.rp.filter(r => r.sel).length;
  $('#rpBulkScope').textContent = n ? `${n} selected row${n > 1 ? 's' : ''}` : 'all rows';
  $('#rpSelN').textContent = n; selBar($('#rpSelBar'), n); $('#rpCount').textContent = state.rp.length;
}
/* ---- bulk IP changes: selected rows, or all rows when none are selected ---- */
const ipStr = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.');
const rpTargets = () => { const sel = state.rp.filter(r => r.sel); return (sel.length ? sel : state.rp).slice().sort((a, b) => a.cam - b.cam); };
function rpBulk(label, fn) {
  if (!state.rp.length) return info('No rows yet', 'Take the found cameras or add rows first.');
  track(label, () => { state.rp = state.rp.map(r => ({ ...r })); fn(rpTargets().map(t => state.rp.find(r => r.cam === t.cam && r.ip === t.ip))); });
  saveRp(); renderRp(); if (s15.a) analyzeS15();
}
$('#rpBulkFill').onclick = () => {
  const first = $('#rpBulkIp').value.trim(), step = Math.max(1, +$('#rpBulkStep').value || 1);
  if (!validIp(first)) return info('Fill in the first IP address', 'For example 192.168.0.11. The rows get that address and the next ones, in CAM order.');
  let n = ipNum(first);
  const rows = rpTargets();
  if ((n & 255) + step * (rows.length - 1) > 254) return info('Not enough addresses', `From ${esc(first)} with step ${step} there is no room for ${rows.length} cameras in this network.`);
  rpBulk(`Number ${rows.length} IP address${rows.length > 1 ? 'es' : ''} from ${first}`, rs => rs.forEach(r => { r.ip = ipStr(n); n += step; }));
};
$('#rpBulkNetBtn').onclick = () => {
  const net = $('#rpBulkNet').value.trim().replace(/\.$/, '');
  if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(net) || net.split('.').some(x => +x > 255)) return info('Fill in the new network', 'The first three numbers of the new addresses, for example 10.0.1. The last number of every address stays the same.');
  rpBulk(`Move to network ${net}`, rs => rs.forEach(r => { r.ip = net + '.' + (r.ip.split('.')[3] || '1'); }));
};
$('#rpBulkPaste').onclick = async () => {
  const ok = await ask({ title: 'Paste IP addresses', ok: 'Apply', body: `<p>One camera per line, for example a column copied from Excel. A line with only an IP address goes to the next row in CAM order; a line like <code>3 192.168.0.13</code> sets CAM 3 (and adds that row if it doesn't exist yet).</p><label>IP addresses<textarea id="askList" class="mono" rows="10" placeholder="192.168.0.11&#10;192.168.0.12&#10;5 192.168.0.20"></textarea></label>` });
  if (!ok) return;
  const lines = $('#askList').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bad = [], plain = [], byCam = [];
  for (const l of lines) {
    const t = l.split(/[\s,;\t]+/).filter(Boolean);
    const ip = t.find(x => validIp(x)); const cam = t.find(x => /^\d{1,3}$/.test(x));
    if (!ip) bad.push(l); else if (cam && t.length > 1) byCam.push({ cam: +cam, ip }); else plain.push(ip);
  }
  if (bad.length) return info('Some lines have no valid IP address', esc(bad.slice(0, 5).join(', ')));
  track(`Paste ${lines.length} IP address${lines.length > 1 ? 'es' : ''}`, () => {
    state.rp = state.rp.map(r => ({ ...r }));
    const rows = state.rp.length ? rpTargets().map(t => state.rp.find(r => r.cam === t.cam && r.ip === t.ip)) : [];
    plain.forEach((ip, i) => {
      if (rows[i]) rows[i].ip = ip;
      else { const last = Math.max(0, ...state.rp.map(r => r.cam)); state.rp.push({ cam: last + 1, ip, port: 80, conn: 'lan' }); }
    });
    for (const b of byCam) { const r = state.rp.find(x => x.cam === b.cam); if (r) r.ip = b.ip; else state.rp.push({ cam: b.cam, ip: b.ip, port: 80, conn: 'lan' }); }
    state.rp.sort((a, b) => a.cam - b.cam);
  });
  saveRp(); renderRp(); if (s15.a) analyzeS15();
};
$('#rpDelSel').onclick = () => {
  const n = state.rp.filter(r => r.sel).length;
  if (!n) return info('Select rows first', 'Tick the rows you want to remove.');
  track(`Remove ${n} row(s)`, () => { state.rp = state.rp.filter(r => !r.sel); });
  saveRp(); renderRp(); if (s15.a) analyzeS15();
};
$('#rpEditSel').onclick = async () => {
  const sel = state.rp.filter(r => r.sel);
  if (!sel.length) return info('Select rows first', 'Tick the rows you want to edit.');
  const ok = await ask({ title: `Edit ${sel.length} row${sel.length > 1 ? 's' : ''}`, ok: 'Apply', body: `<div class="row wrap">
    <label class="w140">First CAM number <input id="edCam" type="number" min="1" max="200" placeholder="keep"></label>
    <label class="w90">Port <input id="edPort" type="number" placeholder="keep"></label>
    <label class="w140">Connection <select id="edConn"><option value="">Keep</option><option value="lan">LAN</option><option value="none">None (NoAsign)</option></select></label></div>
    <p class="hint">With a first CAM number the selected rows are renumbered in their current order. For IP addresses use the tools above the table.</p>` });
  if (!ok) return;
  const cam0 = +$('#edCam').value, port = +$('#edPort').value, conn = $('#edConn').value;
  track(`Edit ${sel.length} row(s)`, () => { state.rp = state.rp.map(r => ({ ...r })); const rows = state.rp.filter(r => r.sel).sort((a, b) => a.cam - b.cam); rows.forEach((r, i) => { if (cam0 > 0) r.cam = cam0 + i; if (port > 0 && port < 65536) r.port = port; if (conn) r.conn = conn; }); state.rp.sort((a, b) => a.cam - b.cam); });
  saveRp(); renderRp(); if (s15.a) analyzeS15();
};
$('#rpSelAll').onchange = () => { selAllClick($('#rpSelAll'), state.rp, r => r.sel, (r, v) => r.sel = v); saveRp(); renderRp(); };
$$('#rpSelBar [data-conn]').forEach(b => b.onclick = () => {
  const v = b.dataset.conn, sel = state.rp.filter(r => r.sel);
  track(`Set ${sel.length} row(s) to ${v === 'lan' ? 'LAN' : 'None'}`, () => { state.rp = state.rp.map(r => r.sel ? { ...r, conn: v } : r); });
  saveRp(); renderRp(); if (s15.a) analyzeS15();
});
$('#rpFromCams').onclick = async () => {
  const cams = [...(state.cameras.some(c => c.selected) ? state.cameras.filter(c => c.selected) : state.cameras)];
  if (!cams.length) return info('No cameras found yet', 'Find the cameras on the Cameras page first.');
  const ok = await ask({ title: `Take ${cams.length} camera${cams.length > 1 ? 's' : ''} from the camera list`, ok: 'Fill the table', body: `<p>${state.cameras.some(c => c.selected) ? 'The cameras selected on the Cameras page' : 'All cameras on the Cameras page'} replace the rows in the table.</p>
    <div class="row wrap"><label class="w140">Order by <select id="tcSort"><option value="ip">IP address</option><option value="title">Title</option><option value="zone">Zone, then IP</option></select></label><label class="w140">First CAM number <input id="tcStart" type="number" min="1" max="200" value="1"></label></div>` });
  if (!ok) return;
  const by = $('#tcSort').value, start = +$('#tcStart').value || 1;
  cams.sort((a, b) => by === 'title' ? String(a.title || '').localeCompare(String(b.title || ''), 'en', { numeric: true }) : by === 'zone' ? String(a.zone || '~').localeCompare(String(b.zone || '~')) || ipNum(a.ip) - ipNum(b.ip) : ipNum(a.ip) - ipNum(b.ip));
  track('Take found cameras', () => { state.rp = cams.map((c, i) => ({ cam: start + i, ip: c.ip, port: c.port || 80, conn: 'lan', label: [c.model, c.title, c.zone].filter(Boolean).join(', ') })); });
  saveRp(); renderRp(); if (s15.a) analyzeS15();
};
$('#rpAddRow').onclick = () => {
  const last = state.rp[state.rp.length - 1];
  track('Add row', () => state.rp.push({ cam: last ? last.cam + 1 : 1, ip: last ? last.ip.replace(/\d+$/, n => +n + 1) : '192.168.0.11', port: 80, conn: 'lan' }));
  saveRp(); renderRp();
};
$('#rpAddRows').onclick = async () => {
  const last = state.rp[state.rp.length - 1];
  const ok = await ask({ title: 'Add several rows', ok: 'Add rows', body: `<div class="row wrap"><label class="w90">Number of rows <input id="askCount" type="number" min="1" max="200" value="4"></label><label class="w140">First CAM <input id="askCam" type="number" min="1" max="200" value="${last ? last.cam + 1 : 1}"></label><label class="w140">First IP <input id="askIp" class="mono" value="${esc(last ? ipStr(ipNum(last.ip) + 1) : '192.168.0.11')}"></label><label class="w90">IP step <input id="askStep" type="number" min="1" max="50" value="1"></label></div><p class="hint">The CAM numbers and IP addresses count up from the first one. You can change them afterwards, one by one or with the tools above the table.</p>` });
  if (!ok) return;
  const n = Math.max(1, Math.min(200, +$('#askCount').value || 1)), cam0 = Math.max(1, +$('#askCam').value || 1), step = Math.max(1, +$('#askStep').value || 1), ip0 = $('#askIp').value.trim();
  if (!validIp(ip0)) return info('Invalid first IP address', esc(ip0));
  const taken = state.rp.map(r => r.cam).filter(c => c >= cam0 && c < cam0 + n);
  if (taken.length && !await ask({ title: 'CAM numbers already used', body: `<p>CAM ${taken.join(', ')} already exist${taken.length === 1 ? 's' : ''}. Add the rows anyway?</p>`, ok: 'Add anyway' })) return;
  track(`Add ${n} rows`, () => { for (let i = 0; i < n; i++) state.rp.push({ cam: cam0 + i, ip: ipStr(ipNum(ip0) + i * step), port: 80, conn: 'lan' }); state.rp.sort((a, b) => a.cam - b.cam); });
  saveRp(); renderRp(); if (s15.a) analyzeS15();
};
const s15 = { a: null, b: null, name: '', layout: null };
$('#s15Input').onchange = async e => { const f = e.target.files[0]; if (!f) return; s15.a = new Uint8Array(await f.arrayBuffer()); s15.name = f.name; s15.b = null; s15.layout = null; analyzeS15(); e.target.value = ''; };
$('#s15Input2').onchange = async e => { const f = e.target.files[0]; if (!f) return; if (!s15.a) return info('Open the first file first', 'Open the Network.s15 you want to change, then the second version.'); s15.b = new Uint8Array(await f.arrayBuffer()); analyzeS15(); e.target.value = ''; };

const privIp = (a, b) => a === 192 && b === 168 || a === 10 || a === 172 && b >= 16 && b <= 31;
function findLayout(u8) {
  const cands = [];
  // binary, big or little endian
  for (const le of [false, true]) {
    const hits = [];
    for (let i = 0; i + 4 <= u8.length; i++) {
      const a = le ? u8[i + 3] : u8[i], b = le ? u8[i + 2] : u8[i + 1];
      if (privIp(a, b)) hits.push(i);
    }
    cands.push({ kind: le ? 'bin-le' : 'bin-be', hits });
  }
  // ASCII (e.g. "192.168.000.010" or "192.168.0.10")
  const txt = new TextDecoder('latin1').decode(u8); const re = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/g; let m; const ah = [];
  while ((m = re.exec(txt))) if (privIp(+m[1], +m[2])) ah.push({ i: m.index, len: m[0].length });
  cands.push({ kind: 'ascii', hits: ah.map(h => h.i), lens: ah.map(h => h.len) });
  let best = null;
  for (const c of cands) {
    if (c.hits.length < 3) continue;
    const diffs = new Map();
    for (let i = 1; i < c.hits.length; i++) { const d = c.hits[i] - c.hits[i - 1]; if (d >= 6 && d <= 4096) diffs.set(d, (diffs.get(d) || 0) + 1); }
    const [stride, n] = [...diffs].sort((a, b) => b[1] - a[1])[0] || [0, 0];
    if (n < 2) continue;
    // longest run with that stride
    const set = new Set(c.hits); let bestRun = { start: 0, len: 0 };
    for (const h of c.hits) { if (set.has(h - stride)) continue; let len = 1; while (set.has(h + len * stride)) len++; if (len > bestRun.len) bestRun = { start: h, len }; }
    const score = bestRun.len;
    const fixedLen = c.kind === 'ascii' ? c.lens[c.hits.indexOf(bestRun.start)] : 4;
    if (!best || score > best.score) best = { kind: c.kind, stride, base: bestRun.start % stride, first: bestRun.start, run: bestRun.len, score, fixedLen };
  }
  return best;
}
function readIpAt(u8, L, off) {
  if (off < 0 || off + (L.kind === 'ascii' ? L.fixedLen : 4) > u8.length) return null;
  if (L.kind === 'bin-be') return [u8[off], u8[off + 1], u8[off + 2], u8[off + 3]].join('.');
  if (L.kind === 'bin-le') return [u8[off + 3], u8[off + 2], u8[off + 1], u8[off]].join('.');
  return new TextDecoder('latin1').decode(u8.subarray(off, off + L.fixedLen));
}
function writeIpAt(u8, L, off, ip) {
  const p = ip.split('.').map(Number);
  if (L.kind === 'bin-be') p.forEach((v, i) => u8[off + i] = v);
  else if (L.kind === 'bin-le') p.forEach((v, i) => u8[off + 3 - i] = v);
  else {
    const old = readIpAt(u8, L, off);
    const padded = /^\d{3}\.\d{3}\.\d{3}\.\d{3}$/.test(old) ? p.map(v => String(v).padStart(3, '0')).join('.') : ip;
    if (padded.length > L.fixedLen) throw new Error(`IP ${ip} does not fit in the text field (${L.fixedLen} characters)`);
    const s = padded.padEnd(L.fixedLen, old.length > padded.length && /\0/.test(old) ? '\0' : ' ');
    for (let i = 0; i < L.fixedLen; i++) u8[off + i] = s.charCodeAt(i);
  }
}

function hexDump(u8, start, len) {
  let s = ''; for (let o = start; o < Math.min(u8.length, start + len); o += 16) { const row = u8.subarray(o, o + 16); s += o.toString(16).padStart(6, '0') + '  ' + [...row].map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(48) + '  ' + [...row].map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('') + '\n'; }
  return `<pre class="hex">${esc(s)}</pre>`;
}

function analyzeS15() {
  const out = $('#s15Out'); const u8 = s15.a;
  const L = s15.layout && s15.layout.src === u8 ? s15.layout : findLayout(u8); if (L) L.src = u8; s15.layout = L;
  if (!L) { out.innerHTML = `<div class="note err">No table of IP addresses found in ${esc(s15.name)} (${u8.length} bytes). Send this file to the developer so the format can be added.</div>${hexDump(u8, 0, 256)}`; return; }
  L.cam1 = L.cam1 ?? L.first;
  const recs = [];
  for (let k = 0; ; k++) { const off = L.cam1 + k * L.stride; const ip = readIpAt(u8, L, off); if (ip == null) break; recs.push({ cam: k + 1, off, ip }); if (k > 260) break; }
  let typeInfo = '';
  if (s15.b) {
    if (s15.b.length !== u8.length) typeInfo = `<div class="note warn">The second file has a different size (${s15.b.length} vs ${u8.length} bytes), so it cannot be compared.</div>`;
    else {
      const diffs = []; for (let i = 0; i < u8.length; i++) if (u8[i] !== s15.b[i]) diffs.push(i);
      const ipLen = L.kind === 'ascii' ? L.fixedLen : 4;
      const changedCam = s15.changedCam || 1;
      const camOff = L.cam1 + (changedCam - 1) * L.stride;
      const rel = diffs.map(i => ({ i, rel: i - camOff, a: u8[i], b: s15.b[i] }));
      const single = rel.filter(d => Math.abs(d.rel) < L.stride && (d.rel < 0 || d.rel >= ipLen));
      typeInfo = `<div class="row"><label class="w180">In the second version I changed CAM <input id="s15Changed" type="number" min="1" max="200" value="${changedCam}"></label></div>
        <div class="note ${diffs.length ? 'ok' : 'warn'}">${diffs.length} byte(s) differ: ${rel.slice(0, 12).map(d => `offset ${d.i} (${d.rel >= 0 ? '+' : ''}${d.rel} from the IP of CAM ${changedCam}): ${d.a} → ${d.b}`).join('; ') || 'none'}${diffs.length > 12 ? '…' : ''}</div>`;
      if (single.length === 1 || (single.length > 1 && new Set(single.map(d => d.rel)).size === 1)) {
        const d = single[0];
        L.typeRel = d.rel; L.typeVals = [d.a, d.b];
        typeInfo += `<div class="note ok">Connection type found at ${d.rel >= 0 ? '+' : ''}${d.rel} from the IP field of each record. Value in the first file: <b>${d.a}</b>, in the second: <b>${d.b}</b>. Which one means LAN?</div>
          <label class="check"><input type="radio" name="lanVal" value="${d.b}" checked> ${d.b} means LAN (the second version had LAN)</label>
          <label class="check"><input type="radio" name="lanVal" value="${d.a}"> ${d.a} means LAN (the first version had LAN)</label>`;
      }
    }
  }
  const rp = new Map(state.rp.map(r => [r.cam, r]));
  out.innerHTML = `<div class="note ok">Found: ${L.run} records of ${L.stride} bytes with IP addresses (${esc(L.kind)}). Check that CAM 1 below matches the controller.</div>
    <div class="row wrap"><label class="w180">Offset of CAM 1 <input id="s15Cam1" type="number" value="${L.cam1}" step="${L.stride}"></label><label class="w180">Record length <input id="s15Stride" type="number" value="${L.stride}"></label></div>
    ${typeInfo}
    <div class="scroll"><table class="tbl dense"><thead><tr><th>CAM</th><th>Offset</th><th>IP now</th><th>New IP</th><th>Connection</th></tr></thead><tbody>
    ${recs.slice(0, 200).map(r => `<tr class="${rp.has(r.cam) && rp.get(r.cam).ip !== r.ip ? 'diff' : ''}"><td>${r.cam}</td><td class="mono">${r.off}</td><td class="mono">${esc(r.ip)}</td><td class="mono">${esc(rp.get(r.cam)?.ip || '')}</td><td>${rp.has(r.cam) ? (rp.get(r.cam).conn === 'none' ? 'None' : 'LAN') : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row"><button id="s15Apply">Save new Network.s15</button></div>`;
  $('#s15Cam1').onchange = e => { L.cam1 = +e.target.value; analyzeS15(); };
  $('#s15Stride').onchange = e => { L.stride = +e.target.value; analyzeS15(); };
  if ($('#s15Changed')) $('#s15Changed').onchange = e => { s15.changedCam = +e.target.value || 1; analyzeS15(); };
  $('#s15Apply').onclick = async () => {
    if (!state.rp.length) return info('No assignment yet', 'Fill in the assignment table first (Take found cameras or Add row).');
    const copy = new Uint8Array(u8); const lanVal = $('input[name=lanVal]:checked')?.value;
    if (lanVal == null && state.rp.some(r => r.conn === 'none') && !await ask({ title: 'Connection type unknown', body: '<p>Some rows are set to <b>None</b>, but the position of the connection type in this file is not known yet. Only the IP addresses will be written. Set those CAMs to NoAsign on the controller, or open a second version of the file first.</p>', ok: 'Save anyway' })) return;
    try {
      for (const r of state.rp) {
        if (!validIp(r.ip)) throw new Error(`Invalid IP address for CAM ${r.cam}`);
        const off = L.cam1 + (r.cam - 1) * L.stride;
        if (off < 0 || off + 4 > copy.length || (L.typeRel != null && (off + L.typeRel < 0 || off + L.typeRel >= copy.length))) throw new Error(`CAM ${r.cam} falls outside the file`);
        writeIpAt(copy, L, off, r.ip);
        if (lanVal != null && L.typeRel != null) {
          const noneVal = L.typeVals.find(v => v !== +lanVal);
          copy[off + L.typeRel] = (r.conn || 'lan') === 'none' && noneVal != null ? noneVal : +lanVal;
        }
      }
    } catch (e) { return info('Cannot save', esc(e.message)); }
    await download('Network_ORIGINAL_backup.s15', new Blob([u8]), 'application/octet-stream', 'rp150');
    await download('Network.s15', new Blob([copy]), 'application/octet-stream', 'rp150');
    log(`Network.s15 changed for ${state.rp.length} camera(s)${lanVal != null ? ', connection type included' : ' (IP addresses only)'}`);
    info('Network.s15 saved', `The new file and a backup of the original are in ${esc(state.saveDir || 'Downloads › Panasonic Toolbox')}. Copy the new file to the SD card as <code>Network.s15</code> and load it on the RP150 with DATA LOAD › YES+NW.` +
      (lanVal == null ? '<br><br>The connection type could not be set automatically. Set CNNCT MD to LAN on the controller for each CAM, or open a second version of the file as explained above.' : ''));
  };
}

/* ------------------------------------------------------------------ live view and control */
const live = { cam: null, sid: null, moving: null, poll: null, irisVal: null, keys: new Set() };
function renderLiveCams() {
  const sel = $('#liveCam'); const cur = sel.value || store.get('liveCam', '');
  const opt = c => `<option value="${esc(c.ip)}">${c.title ? esc(c.title) + ' - ' : ''}${esc(c.ip)}</option>`;
  const zs = zoneNames();
  sel.innerHTML = !state.cameras.length ? '<option value="">No cameras yet</option>' : !zs.length ? state.cameras.map(opt).join('')
    : zs.map(z => `<optgroup label="${/^\d+$/.test(z) ? "Zone " + esc(z) : esc(z)}">${state.cameras.filter(c => c.zone === z).map(opt).join('')}</optgroup>`).join('') + (state.cameras.some(c => !c.zone) ? `<optgroup label="No zone">${state.cameras.filter(c => !c.zone).map(opt).join('')}</optgroup>` : '');
  sel.value = state.cameras.some(c => c.ip === cur) ? cur : (state.cameras[0]?.ip || '');

}
// From anywhere: show this camera on the Live page
setInterval(() => {
  if (!$('#tab-cams').classList.contains('active') || document.visibilityState !== 'visible' || !state.bridgeOk) return;
  if (state.cameras.length && !state.cameras.some(c => c.busy)) refreshAll(state.cameras);
}, 60000);
function goLive(ip) { store.set('liveCam', ip); $('#liveCam').value = ip; $('[role=tab][data-tab=live]').click(); }
const liveActive = () => $('#tab-live').classList.contains('active');
function liveEnter() { renderLiveCams(); liveStart(); }
function liveLeave() { liveStop(); liveClose(); clearInterval(live.poll); live.poll = null; }
function liveMsg(text) { $('#liveMsg').textContent = text || ''; $('#liveMsg').classList.toggle('hidden', !text); }
async function liveClose() {
  const sid = live.sid; live.sid = null;
  $('#liveImg').removeAttribute('src');
  if (sid) try { await bridgeFetch('/api/stream/close', { id: sid }); } catch { }
}
async function liveStart() {
  await liveClose();
  const cam = state.cameras.find(c => c.ip === $('#liveCam').value);
  live.cam = cam || null;
  $('#tab-live').classList.toggle('nocam', !cam);
  if (!cam) { liveMsg('Find cameras on the Cameras page first.'); $('#liveStatus').textContent = ''; return; }
  store.set('liveCam', cam.ip);
  renderLiveScenes(); renderPresets();
  if (!state.bridgeOk && !(await checkBridge())) return;
  liveMsg('Connecting to the picture…');
  try {
    const a = camAuth(cam);
    const j = await bridgeFetch('/api/stream/open', { ip: cam.ip, port: cam.port || 80, user: a.user, pass: a.pass, res: $('#liveRes').value });
    live.sid = j.id;
    const img = $('#liveImg'); const sid = j.id;
    img.src = `/api/stream/${encodeURIComponent(sid)}`;
    const t0 = Date.now();
    const wait = () => { if (live.sid !== sid) return; if (img.naturalWidth > 0) return liveMsg(''); if (Date.now() - t0 > 8000) return liveMsg('No picture. Check that JPEG streaming is on in the camera (Video over IP), and the login if User Auth is on. The controls still work.'); setTimeout(wait, 300); };
    img.onerror = () => { if (live.sid === sid) liveMsg('No picture from this camera. The controls still work.'); };
    wait();
  } catch (e) { liveMsg('Picture failed: ' + e.message); }
  liveRead();
  clearInterval(live.poll); live.poll = setInterval(() => { if (liveActive() && !live.moving && document.visibilityState === 'visible') liveRead(); }, 4000);
}
$('#liveCam').onchange = liveStart;
$('#liveRes').onchange = () => { store.set('liveRes', $('#liveRes').value); liveStart(); };
$('#liveRes').value = store.get('liveRes', '640x360');

async function liveSend(t, cmd) {
  if (!live.cam) return null;
  try {
    const [r] = await batch(live.cam, [{ type: t, cmd }], { delayMs: 0 });
    if (!r.ok) $('#liveStatus').textContent = `${cmd}: ${r.error || 'no response'}`;
    else if (isErr(r.body)) $('#liveStatus').textContent = `${cmd}: not accepted (${r.body})`;
    return r;
  } catch (e) { $('#liveStatus').textContent = 'Failed: ' + e.message; return null; }
}
const setToggle = (sel, on) => { const el = typeof sel === 'string' ? $(sel) : sel; el.classList.toggle('on', !!on); el.setAttribute('aria-pressed', on ? 'true' : 'false'); };
async function liveRead() {
  const cam = live.cam; if (!cam || live.reading) return; // never stack status requests (e.g. on a camera that is off)
  live.reading = true;
  try { await liveReadNow(cam); } finally { live.reading = false; }
}
async function liveReadNow(cam) {
  let res;
  try { res = await batch(cam, [{ type: 'ptz', cmd: '#O' }, { type: 'ptz', cmd: '#D1' }, { type: 'ptz', cmd: '#D3' }, { type: 'ptz', cmd: '#D6' }, { type: 'cam', cmd: 'QLR' }, { type: 'cam', cmd: 'QLG' }, { type: 'cam', cmd: 'QSF' }, { type: 'ptz', cmd: '#I' }, { type: 'ptz', cmd: '#DA' }, { type: 'cam', cmd: 'QAW' }, { type: 'ptz', cmd: '#INS' }, { type: 'cam', cmd: 'QSI:30' }, { type: 'cam', cmd: 'QSE:71' }, { type: 'cam', cmd: 'QSI:20' }], { delayMs: 0 }); }
  catch (e) { $('#liveStatus').textContent = 'Not reachable: ' + e.message; return; }
  if (cam !== live.cam) return;
  if (res[0]?.unreachable) { $('#liveStatus').textContent = 'Camera not reachable'; return; }
  const b = i => (res[i]?.ok ? (res[i].body || '').trim() : '');
  const power = b(0).toLowerCase();
  live.power = power === 'p1' ? 'on' : power === 'p0' ? 'standby' : power === 'p3' ? 'starting' : '';
  setToggle('#liveAF', b(1).toLowerCase() === 'd11'); setToggle('#liveAI', b(2).toLowerCase() === 'd31'); { const dn = /^d6([01])$/i.exec(b(3)); if (dn) { setToggle('#liveNight', dn[1] === '1'); setToggle('#liveDay', dn[1] === '0'); } }
  // shooting mode and preset scope: only when the camera answers them
  { const sm = /^OSI:30:([01])$/i.exec(b(11)); setToggle('#liveShoot0', sm?.[1] === '0'); setToggle('#liveShoot1', sm?.[1] === '1');
    for (const id of ['#liveShoot0', '#liveShoot1']) $(id).disabled = !sm;
    $('#liveShoot1').textContent = /UE160/i.test(cam.model || '') ? 'Low Light' : 'High Sens.' }
  { const k = kelvinFrom(b(13)); if (k && document.activeElement !== $('#liveVarK')) $('#liveVarK').value = k; }
  const wb = /^OAW:(\d)$/i.exec(b(9));
  if (wb && Date.now() - (live.wbAt || 0) > 3000) showWb(WB_FROM_OAW[wb[1]]);
  else if (!wb && /UE160/i.test(cam.model || '') && Date.now() - (live.wbAt || 0) > 3000) {
    try {
      const [atw, mem] = await batch(cam, [{ cmd: 'QSL:2A' }, { cmd: 'QSL:2B' }], { delayMs: 0 });
      const a = /^OSL:2A:(\d)/i.exec(atw?.body || ''), m = /^OSL:2B:(\d)/i.exec(mem?.body || '');
      if (a?.[1] === '1') showWb('auto'); else if (m) showWb({ 0: 'a', 1: 'b', 4: 'var' }[m[1]] || '');
    } catch { }
  }
  const sc = /^OSF:(\d)/.exec(b(6)); if (sc) { cam.scene = +sc[1] + 1; $$('#liveScenes button').forEach(x => x.classList.toggle('on', +x.dataset.scene === cam.scene)); }
  const ir = /^ic?(\d{2})$/i.exec(b(7)); live.irisVal = ir ? +ir[1] : null; $('#liveIris').textContent = ir ? ir[1] : '–';
  // a message from a button (e.g. "White balance: VAR 4300 K") stays readable for a few seconds
  if (Date.now() - (live.msgAt || 0) > 4000) { live.selfStatus = true; $('#liveStatus').textContent = `${cam.model || ''} ${live.power ? '· ' + live.power : ''}`; live.selfStatus = false; }
}
new MutationObserver(() => { if (!live.selfStatus) live.msgAt = Date.now(); }).observe($('#liveStatus'), { childList: true, characterData: true, subtree: true });

// press and hold: pan/tilt, zoom and focus move while the button is held and stop on release
const spd = id => Math.max(1, Math.min(49, +$(id).value || 25));
function ptCmd(dx, dy) { const s = spd('#ptSpeed'); return `#PTS${pad2(50 + dx * s)}${pad2(50 + dy * s)}`; }
// Movements never pile up: one channel per kind (pan/tilt, zoom, focus, iris) with at most one request on its way.
// A newer command replaces one that is still waiting, so a camera that hangs for a moment does not play back
// everything later. A stop that does not get through is sent again (a few times) so the camera really stops.
const motionCh = {};
function motionSend(kind, cmd) {
  const cam = live.cam; if (!cam) return;
  const ch = motionCh[kind] ||= { busy: false, next: null, kind };
  ch.next = { cam, cmd };
  if (!ch.busy) motionPump(ch);
}
const isStopCmd = cmd => /^#(PTS5050|Z50|F50)$/.test(cmd);
async function motionPump(ch) {
  ch.busy = true;
  let stopTries = 0, moveTries = 0;
  while (ch.next) {
    const { cam, cmd } = ch.next; ch.next = null;
    let r = null;
    try { [r] = await batch(cam, [{ type: 'ptz', cmd, motion: true }], { delayMs: 0 }); } catch { }
    if (r?.ok && !isErr(r.body)) { stopTries = 0; moveTries = 0; continue; }
    if (cam === live.cam) $('#liveStatus').textContent = `${cmd}: ${r?.ok ? 'not accepted (' + r.body + ')' : 'camera did not answer in time, skipped'}`;
    // A stop is repeated so the camera really stops. A move is repeated only while its button is still held (the
    // camera refuses moves for a moment, e.g. right after a scene switch); never when something newer is waiting.
    if (isStopCmd(cmd) && !ch.next && stopTries++ < 3) { await sleep(300); if (!ch.next) ch.next = { cam, cmd }; }
    else if (!isStopCmd(cmd) && ch.kind && live.moving?.kind === ch.kind && !ch.next && moveTries++ < 8) { await sleep(300); if (!ch.next && live.moving?.kind === ch.kind) ch.next = { cam, cmd }; }
  }
  ch.busy = false;
}
function liveMove(kind, cmd) {
  if (live.moving && live.moving.kind !== kind) liveStop();
  live.moving = { kind }; motionSend(kind, cmd);
}
function liveStop() {
  const m = live.moving; live.moving = null; if (!m) return;
  motionSend(m.kind, m.kind === 'PT' ? '#PTS5050' : `#${m.kind}50`);
}
function holdButton(btn, start) {
  btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); btn.classList.add('pressed'); start(); });
  const end = () => { if (btn.classList.contains('pressed')) { btn.classList.remove('pressed'); liveStop(); } };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => btn.addEventListener(ev, end));
}
$$('#ptPad [data-pt]').forEach(b => { const [dx, dy] = b.dataset.pt.split(',').map(Number); holdButton(b, () => liveMove('PT', ptCmd(dx, dy))); });
$('#ptPad [data-home]').onclick = () => liveSend('ptz', '#APC80008000');
$$('[data-hold]').forEach(b => { const [k, d] = b.dataset.hold.split(','); holdButton(b, () => liveMove(k, `#${k}${pad2(50 + +d * spd(k === 'Z' ? '#zSpeed' : '#ptSpeed'))}`)); });
window.addEventListener('blur', liveStop);
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') liveStop(); });

// iris: one step per click, repeating while held
$$('[data-iris]').forEach(b => {
  let timer = null;
  const step = async () => {
    if (live.irisVal == null) { const r = await liveSend('ptz', '#I'); const m = /^ic?(\d{2})$/i.exec(r?.body || ''); live.irisVal = m ? +m[1] : 50; }
    live.irisVal = Math.max(1, Math.min(99, live.irisVal + 3 * +b.dataset.iris));
    $('#liveIris').textContent = pad2(live.irisVal);
    if ($('#liveAI').classList.contains('on')) { await liveSend('ptz', '#D30'); setToggle('#liveAI', false); }
    motionSend('I', '#I' + pad2(live.irisVal));
  };
  b.addEventListener('pointerdown', e => { e.preventDefault(); step(); timer = setInterval(step, 250); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => { clearInterval(timer); timer = null; }));
});

const toggleCmd = (sel, t, on, off, after) => $(sel).onclick = async () => { const isOn = $(sel).classList.contains('on'); const r = await liveSend(t, isOn ? off : on); if (r?.ok && !isErr(r.body)) setToggle(sel, !isOn); after && after(); };
toggleCmd('#liveAF', 'ptz', '#D11', '#D10');
toggleCmd('#liveAI', 'ptz', '#D31', '#D30');
async function liveDayNight(night) {
  const r = await liveSend('ptz', night ? '#D61' : '#D60');
  if (r?.ok && !isErr(r.body)) { setToggle('#liveNight', night); setToggle('#liveDay', !night); $('#liveStatus').textContent = night ? 'Night mode' : 'Day mode'; }
  else toast('Day/night is not available on this camera right now');
}
// Install position (#INS0 desktop / #INS1 hanging): turns the picture and the pan/tilt directions, so ask first

// Shooting mode (OSI:30): 0 = Normal, 1 = High Sens. (Low Light on the AW-UE160)
async function liveShoot(v) {
  if (!live.cam) return;
  const r = await liveSend('cam', 'OSI:30:' + v);
  if (r?.ok && !isErr(r.body)) { setToggle('#liveShoot0', v === 0); setToggle('#liveShoot1', v === 1); $('#liveStatus').textContent = 'Shooting mode: ' + $(v ? '#liveShoot1' : '#liveShoot0').textContent; }
  else toast(`Shooting mode is not available on this camera${r?.body ? ' (' + r.body + ')' : ''}`);
}
$('#liveShoot0').onclick = () => liveShoot(0);
$('#liveShoot1').onclick = () => liveShoot(1);
$('#liveDay').onclick = () => liveDayNight(false);
$('#liveNight').onclick = () => liveDayNight(true);
// White balance mode: OAW 0 = ATW (auto), 1 = AWB A, 2 = AWB B, 4 = 3200K, 5 = 5600K, 9 = VAR (OAW:3 gives ATW).
// Checked on an AW-UE150 V3.20: the query answers 2 for A and 3 for B, but 4 and 5 for 3200K and 5600K.
// The AW-UE160 uses OSL:2A (ATW on/off) and OSL:2B (0 = A, 1 = B, 4 = VAR) when OAW is refused.
const WB_OAW = { auto: '0', a: '1', b: '2', k32: '4', k56: '5', var: '9' };
// QAW answers with other numbers than OAW takes: 0 ATW, 2 AWB A, 3 AWB B, 4 3200K, 5 5600K, 9 VAR
// ("Data of control and question is different", Panasonic protocol table; checked on an AW-UE150 V3.20)
const WB_NAME = { auto: 'Auto (ATW)', var: 'VAR', a: 'Memory A', b: 'Memory B', k32: '3200K', k56: '5600K' };
const WB_FROM_OAW = { 0: 'auto', 2: 'a', 3: 'b', 4: 'k32', 5: 'k56', 9: 'var' };
const WB_UE160 = { auto: ['OSL:2A:1'], a: ['OSL:2A:0', 'OSL:2B:0'], b: ['OSL:2A:0', 'OSL:2B:1'], k32: ['OSL:2A:0', 'OSL:2B:2'], k56: ['OSL:2A:0', 'OSL:2B:3'], var: ['OSL:2A:0', 'OSL:2B:4'] };
const showWb = m => $$('.t-white [data-wb]').forEach(x => setToggle(x, x.dataset.wb === m));
$$('.t-white [data-wb]').forEach(btn => btn.onclick = async () => {
  if (!live.cam) return;
  if ($('#liveWbStore').classList.contains('armed')) {
    if (!['a', 'b'].includes(btn.dataset.wb)) return toast('Store works for A and B');
    armStore($('#liveWbStore'), false, $('.t-white'), 'wb-storing');
    const m = btn.dataset.wb.toUpperCase();
    if (!await ask({ title: `Store white balance in memory ${m}?`, ok: 'Store', body: `<p>Point ${esc(camName(live.cam))} at something white. The camera switches to memory ${m} and stores an auto white balance in it.</p>` })) return;
    return liveAwbMem(btn.dataset.wb);
  }
  const m = btn.dataset.wb; live.wbAt = Date.now();
  let r = await liveSend('cam', 'OAW:' + WB_OAW[m]);
  if (!r?.ok || isErr(r.body)) { for (const c of WB_UE160[m]) r = await liveSend('cam', c); }
  if (r?.ok && !isErr(r.body)) { showWb(m); $('#liveStatus').textContent = `White balance: ${btn.textContent}`; }
  else toast('This white balance mode is not available on this camera right now');
});
$('#liveOPAF').onclick = () => liveSend('cam', 'OSE:69:1');
// VAR colour temperature (OSI:20: kelvin as 5 hex digits); switches the camera to VAR first
const kelvinHex = k => Math.round(k).toString(16).toUpperCase().padStart(5, '0');
const kelvinFrom = body => { const m = /^OSI:20:([0-9A-F]{5})/i.exec(body || ''); return m ? parseInt(m[1], 16) : null; };
const validK = k => Number.isFinite(k) && k >= 2000 && k <= 15000;
async function wbModeCmds(send, model, m) {
  let r = await send('cam', 'OAW:' + WB_OAW[m]);
  if ((!r?.ok || isErr(r.body)) && !r?.unreachable) { for (const c of WB_UE160[m]) r = await send('cam', c); }
  return r;
}
async function setVarK(send, k) {
  let r = await send('cam', `OSI:20:${kelvinHex(k)}:0`);
  if (r?.ok && isErr(r.body)) r = await send('cam', `OSI:20:${kelvinHex(k)}`);
  return r;
}
$('#liveVarSet').onclick = async () => {
  if (!live.cam) return;
  const k = +$('#liveVarK').value;
  if (!validK(k)) return toast('Fill in a colour temperature from 2000 to 15000 K');
  live.wbAt = Date.now();
  const m = await wbModeCmds(liveSend, live.cam.model, 'var');
  if (!m?.ok || isErr(m.body)) return toast('VAR is not available on this camera right now');
  showWb('var');
  const r = await setVarK(liveSend, k);
  if (r?.ok && !isErr(r.body)) $('#liveStatus').textContent = `White balance: VAR ${k} K`; else toast(`The camera did not accept ${k} K${r?.body ? ' (' + r.body + ')' : ''}`);
  setTimeout(liveRead, 800);
};
$('#liveVarK').addEventListener('keydown', e => { if (e.key === 'Enter') $('#liveVarSet').click(); });
// pan/tilt and zoom speed: readout, and one click back to the nominal speed (25, the middle)
for (const id of ['#ptSpeed', '#zSpeed']) {
  const show = () => { const v = $(id).value; $(id + 'Val').textContent = v; $(id + 'Val').classList.toggle('off', +v !== 25); };
  $(id).addEventListener('input', show); show();
}
$$('[data-nominal]').forEach(b => b.onclick = () => { const r = $(b.dataset.nominal); r.value = 25; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
// AWB into memory A or B: switch to that memory first, then run the auto white balance (OWS); the camera keeps it there
async function liveAwbMem(m) {
  if (!live.cam) return;
  live.wbAt = Date.now();
  const sel = await wbModeCmds(liveSend, live.cam.model, m);
  if (!sel?.ok || isErr(sel.body)) return toast(`Memory ${m.toUpperCase()} is not available on this camera right now`);
  showWb(m);
  const r = await liveSend('cam', 'OWS');
  if (r?.ok && !isErr(r.body)) { $('#liveStatus').textContent = `Auto white balance saved in ${m.toUpperCase()}`; toast(`AWB running: saved in memory ${m.toUpperCase()} in a few seconds`); }
  else toast(`AWB not possible now${r?.body ? ' (' + r.body + ')' : ''}`);
}
$('#liveWbStore').onclick = () => armStore($('#liveWbStore'), !$('#liveWbStore').classList.contains('armed'), $('.t-white'), 'wb-storing');
$('#liveAWB').onclick = async () => { const r = await liveSend('cam', 'OWS'); if (r?.ok) toast(isErr(r.body) ? `AWB not possible now (${r.body}). Choose A or B first, or use Store A / Store B.` : 'Auto white balance started (kept in the memory that is active)'); };
$('#liveABB').onclick = async () => { const r = await liveSend('cam', 'OAS'); if (r?.ok) toast(isErr(r.body) ? `ABB not possible now (${r.body})` : 'Auto black balance started'); };
function renderLiveScenes() {
  const cam = live.cam; const box = $('#liveScenes');
  if (!cam) { box.innerHTML = ''; return; }
  const n = cam.model ? profileFor(cam.model).scenes : 4;
  box.innerHTML = Array.from({ length: n }, (_, i) => `<button data-scene="${i + 1}" class="${cam.scene === i + 1 ? 'on' : ''}" title="Load scene file ${i + 1}">Scene ${i + 1}</button>`).join('');
  $$('button', box).forEach(b => b.onclick = async () => {
    const r = await liveSend('cam', 'XSF:' + b.dataset.scene);
    if (r?.ok && !isErr(r.body)) { cam.scene = +b.dataset.scene; $$('button', box).forEach(x => x.classList.toggle('on', x === b)); renderCams(); }
  });
}
// presets: 12 per page, click to recall; with Store ticked, click saves the current position
const PRESETS_PER_PAGE = 12;
$('#presetPage').innerHTML = Array.from({ length: Math.ceil(100 / PRESETS_PER_PAGE) }, (_, i) => `<option value="${i}">${i * PRESETS_PER_PAGE + 1}–${Math.min(100, (i + 1) * PRESETS_PER_PAGE)}</option>`).join('');
$('#presetPage').value = store.get('presetPage', 0);
$('#presetPage').onchange = () => { store.set('presetPage', +$('#presetPage').value); renderPresets(); };
// Store buttons: arm, then click what to store into. A second click, Escape or another tab disarms.
function armStore(btn, on, target, cls = 'storing') {
  btn.classList.toggle('armed', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (target) target.classList.toggle(cls, on);
}
const presetArmed = () => $('#presetStore').classList.contains('armed');
$('#presetStore').onclick = () => armStore($('#presetStore'), !presetArmed(), $('#presetGrid'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { armStore($('#presetStore'), false, $('#presetGrid')); armStore($('#liveWbStore'), false, $('.t-white'), 'wb-storing'); armStore($('#engWbStore'), false, $('.e-white'), 'wb-storing'); } });
function renderPresets() {
  const page = +$('#presetPage').value || 0; const grid = $('#presetGrid');
  grid.innerHTML = Array.from({ length: PRESETS_PER_PAGE }, (_, i) => page * PRESETS_PER_PAGE + i + 1).filter(n => n <= 100).map(n => `<button data-preset="${n}">${n}</button>`).join('');
  $$('button', grid).forEach(b => b.onclick = () => livePreset(+b.dataset.preset));
}
async function livePreset(n) {
  if (!live.cam) return;
  if (presetArmed()) {
    if (!await ask({ title: `Store preset ${n}?`, body: `<p>Preset ${n} of ${esc(live.cam.title || live.cam.ip)} is replaced by the current position.</p>`, ok: 'Store' })) return;
    const r = await liveSend('ptz', '#M' + pad2(n - 1));
    if (r?.ok && !isErr(r.body)) toast(`Preset ${n} stored`);
    armStore($('#presetStore'), false, $('#presetGrid'));
  } else {
    const r = await liveSend('ptz', '#R' + pad2(n - 1));
    if (r?.ok && !isErr(r.body)) { $$('#presetGrid button').forEach(x => x.classList.toggle('on', +x.dataset.preset === n)); }
  }
}
// keyboard on the Live page
const KEY_PT = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
document.addEventListener('keydown', e => {
  if (!liveActive() || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || $('dialog[open]')) return;
  if (KEY_PT[e.key] || ['+', '=', '-', '_'].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  if (KEY_PT[e.key]) {
    live.keys.add(e.key);
    const dx = [...live.keys].reduce((s, k) => s + (KEY_PT[k]?.[0] || 0), 0), dy = [...live.keys].reduce((s, k) => s + (KEY_PT[k]?.[1] || 0), 0);
    liveMove('PT', ptCmd(Math.sign(dx), Math.sign(dy)));
  } else if (e.key === '+' || e.key === '=') liveMove('Z', '#Z' + pad2(50 + spd('#zSpeed')));
  else if (e.key === '-' || e.key === '_') liveMove('Z', '#Z' + pad2(50 - spd('#zSpeed')));
  else if (/^[1-9]$/.test(e.key)) livePreset(+e.key);
});
document.addEventListener('keyup', e => {
  if (KEY_PT[e.key]) {
    live.keys.delete(e.key);
    if (!live.keys.size) liveStop();
    else { const dx = [...live.keys].reduce((s, k) => s + KEY_PT[k][0], 0), dy = [...live.keys].reduce((s, k) => s + KEY_PT[k][1], 0); liveMove('PT', ptCmd(Math.sign(dx), Math.sign(dy))); }
  } else if (['+', '=', '-', '_'].includes(e.key) && live.moving?.kind === 'Z') liveStop();
});

/* ------------------------------------------------------------------ init */
renderCams(); renderRp(); renderParamTab(); renderOperatorTab(); renderExport(); renderImports(); renderShows(); renderScript(); renderEip(); updUndo(); renderEngFile();
checkBridge().then(() => loadSaveDir());


/* ---- More menus (details.menu) and foldable blocks on Live and Engineering ---- */
// A menu opens below its button, also inside cards that scroll sideways, and closes after a choice or a click elsewhere.
function placeMenu(d) {
  const pop = $('.menu-pop', d); if (!pop) return;
  const r = $('summary', d).getBoundingClientRect();
  pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 4) + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
}
document.addEventListener('toggle', e => {
  const d = e.target; if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('menu') || !d.open) return;
  $$('details.menu[open]').forEach(x => { if (x !== d) x.open = false; });
  placeMenu(d);
}, true);
document.addEventListener('click', e => {
  $$('details.menu[open]').forEach(d => { if (!d.contains(e.target) || e.target.closest('.menu-pop button')) d.open = false; });
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('details.menu[open]').forEach(d => d.open = false); });
window.addEventListener('scroll', () => $$('details.menu[open]').forEach(d => d.open = false), true);
window.addEventListener('resize', () => $$('details.menu[open]').forEach(d => d.open = false));

// Click a block title (White, Zoom, Tally…) to fold it away; the app remembers it.
(function foldBlocks() {
  const folded = new Set(ls.get('pscene.folded', []));
  for (const sec of ['tab-live', 'tab-eng']) $$(`#${sec} .live-block`).forEach((b, i) => {
    const h = b.querySelector(':scope > h3') || b.querySelector(':scope > .row:first-child > h3');
    if (!h) return;
    const key = sec + ':' + ([...b.classList].find(c => c !== 'live-block' && c !== 'collapsed') || i);
    h.classList.add('fold'); h.title = 'Click to fold or unfold'; h.setAttribute('role', 'button'); h.tabIndex = 0;
    if (folded.has(key)) b.classList.add('collapsed');
    const flip = () => {
      b.classList.toggle('collapsed');
      const f = new Set(ls.get('pscene.folded', []));
      b.classList.contains('collapsed') ? f.add(key) : f.delete(key);
      ls.set('pscene.folded', [...f]);
    };
    h.addEventListener('click', flip);
    h.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  });
})();


/* ---- easy for everyone: expert tools hidden unless switched on, one big button per page ---- */
// The raw camera answers in result tables only show with Settings > Show the raw answers of the cameras.
function applyExpert() {
  const on = !!ls.get('pscene.expert', false);
  document.body.classList.toggle('expert', on);
}
applyExpert();
$('#camWelcomeBtn').onclick = () => camSearch();

// Settings > About: the mail link opens the mail app through the app (a mailto link does nothing inside the app window)
document.addEventListener('click', e => { const a = e.target.closest('a[href^="mailto:"]'); if (!a) return; e.preventDefault(); bridgeFetch('/api/mail_developer', {}).catch(() => toast('Mail to seppe@vanaken.be')); });
