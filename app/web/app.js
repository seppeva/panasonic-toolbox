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

/* ------------------------------------------------------------------ storage */
const store = {
  get(k, d) { try { const v = localStorage.getItem('pscene.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pscene.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
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
  let j = null, err = null;
  for (let i = 0; i < (quiet ? 1 : 3) && !j; i++) {
    try { j = await bridgeFetch('/api/info', undefined, 8000); }
    catch (e) { err = e; if (i < 2 && !quiet) await new Promise(r => setTimeout(r, 1000)); }
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
    if (wasDown) { log(`App ${j.version} ready. This computer's IP addresses: ${state.localIps.join(', ') || '-'}`); checkUpdate(); }
  } else if (quiet && state.bridgeOk && (state.bridgeMiss = (state.bridgeMiss || 0) + 1) < 2) {
    return true; // one missed background check is not yet a lost connection
  } else {
    state.bridgeOk = false;
    dot.className = 'dot err'; txt.textContent = 'Not connected'; txt.title = err ? err.message : '';
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
async function batch(cam, items, opts = {}) {
  const a = camAuth(cam);
  const j = await bridgeFetch('/api/batch', { ip: cam.ip, port: cam.port || 80, user: a.user, pass: a.pass, delayMs: opts.delayMs ?? state.delayMs, items });
  return j.results;
}
const isErr = body => /^e[rR]\d/.test(body || '');

/* ------------------------------------------------------------------ camera helpers */
async function identify(cam) {
  const r = await batch(cam, [{ cmd: 'QID' }, { cmd: 'QSF' }, { type: 'ptz', cmd: '#O' }, { cmd: 'QSJ:5C' }]);
  if (r[0].status === 401) throw new Error('Login required (enter user name and password)');
  if (!r[0].ok) throw new Error(r[0].error || 'no response');
  if (!/^OID:/i.test(r[0].body)) throw new Error('Not a Panasonic camera response: ' + r[0].body);
  cam.model = r[0].body.slice(4);
  cam.scene = parseSceneResp(r[1], cam);
  cam.power = r[2].ok ? (r[2].body === 'p1' ? 'aan' : r[2].body === 'p0' ? 'standby' : r[2].body) : '?';
  if (r[3].ok && /^OSJ:5C:/i.test(r[3].body)) cam.title = r[3].body.slice(7).trim();
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
async function getScene(cam) {
  const [r] = await batch(cam, [{ cmd: 'QSF' }]);
  return parseSceneResp(r, cam);
}
async function switchScene(cam, n) {
  log(`${cam.ip}: switching to scene ${n}`);
  const r = await batch(cam, [{ cmd: 'XSF:' + n }, { sleepMs: state.sceneWait }]);
  if (!r[0].ok || isErr(r[0].body)) throw new Error(`Switching to scene ${n} failed (${r[0].body || r[0].error})`);
}
function parseRead(p, res) {
  if (!res || !res.ok) return { err: res?.error || 'no response' };
  const b = (res.body || '').trim();
  if (isErr(b)) return { err: b.slice(0, 3).toUpperCase() };
  if (p.t === 'ptz') {
    const code = p.cmd.slice(1).toLowerCase();
    if (b.toLowerCase().startsWith(code)) return { raw: '#' + b.toUpperCase() };
  } else if (b.toUpperCase().startsWith(p.cmd + ':')) return { raw: b };
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
const NAME_TOKENS = { title: 'camera title', model: 'model', ip: 'IP address', zone: 'zone', scenes: 'scene numbers', date: 'date', time: 'time', count: 'number of cameras (ZIP)' };
const namePattern = k => store.get('name_' + k, NAME_DEFAULTS[k]) || NAME_DEFAULTS[k];
function makeName(pattern, ctx = {}) {
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const v = { date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, time: `${p2(d.getHours())}${p2(d.getMinutes())}`, ...ctx };
  const out = pattern.replace(/\{(\w+)\}/g, (m, k) => v[k] != null && v[k] !== '' ? String(v[k]) : '')
    .replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '');
  return out || 'file';
}
const camCtx = cam => ({ title: cam.title || cam.model || 'cam', model: cam.model || '', ip: cam.ip.replace(/\./g, '-'), zone: cam.zone || '' });
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
async function download(name, blobOrText, type = 'application/json') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  if (IN_APP) {
    // In the app: save to Downloads/Panasonic Toolbox via the local server (never overwrites)
    try {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      const j = await bridgeFetch('/api/save', { name, dataB64: btoa(bin) });
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
function ask({ title, body, ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    const dlg = $('#askDlg');
    $('#askTitle').textContent = title;
    $('#askBody').innerHTML = body;
    $('#askOk').textContent = ok;
    $('#askOk').className = danger ? 'danger-solid' : '';
    $('#askCancel').textContent = cancel || '';
    $('#askCancel').classList.toggle('hidden', !cancel);
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}
const info = (title, body) => ask({ title, body: `<p>${body}</p>`, ok: 'OK', cancel: null });

/* ------------------------------------------------------------------ tabs + settings */
$$('.tabs button').forEach(b => b.addEventListener('click', () => {
  $$('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'export') renderExport();
  if (b.dataset.tab === 'import') renderImports();
  if (b.dataset.tab === 'params') { renderHttpTargets(); renderCmds(); renderParamTab(); }
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
  $('#setDelay').value = state.delayMs; $('#setSceneWait').value = state.sceneWait;
  $('#setUpdates').checked = store.get('updateCheck', true);
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
  const d = $('#setSaveDir').value.trim();
  if (d && d !== state.saveDir) setSaveDir(d).catch(e => info('Cannot use this folder', esc(e.message)));
};
$('#quitBtn').onclick = async () => {
  $('#settingsDlg').close();
  if (!await ask({ title: 'Quit Panasonic Toolbox?', body: '<p>The window closes and the cameras are no longer controlled from this computer.</p>', ok: 'Quit', danger: true })) return;
  try { await bridgeFetch('/api/quit', {}); } catch { }
  document.body.innerHTML = '<p style="padding:40px;font:15px system-ui;color:#aaa">Panasonic Toolbox has quit. You can close this window.</p>';
};
$('#retryBridge').onclick = () => checkBridge();
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
const saveCams = () => store.set('cameras', state.cameras.map(({ ip, port, model, title, selected, zone, user, pass }) => ({ ip, port, model, title, selected, zone, user, pass: $('#rememberLogin').checked ? pass : undefined })));
const login = store.get('login', null);
if (login) { $('#authUser').value = login.user || ''; $('#authPass').value = login.pass || ''; $('#rememberLogin').checked = true; }
function saveLogin() {
  if ($('#rememberLogin').checked) store.set('login', { user: $('#authUser').value.trim(), pass: $('#authPass').value });
  else store.set('login', null);
}
['#authUser', '#authPass', '#rememberLogin'].forEach(s => $(s).addEventListener('change', saveLogin));

function hostPort(c) { return c.ip + (c.port && +c.port !== 80 ? ':' + c.port : ''); }
async function openCamPage(c, kind) {
  const user = $('#authUser').value.trim(), pass = $('#authPass').value;
  const path = kind === 'setup' ? state.setupPath : state.livePath;
  const cred = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
  const url = `http://${cred}${hostPort(c)}${path.startsWith('/') ? path : '/' + path}`;
  try {
    if (IN_APP) await bridgeFetch('/api/open_url', { url });
    else window.open(url, '_blank', 'noopener');
    log(`${c.ip}: opened the ${kind === 'setup' ? 'settings' : 'live'} page in the browser`);
    if (kind === 'setup' && !user) toast('Tip: fill in Camera login to sign in to the settings page automatically.');
  } catch (e) { info('Could not open the page', esc(e.message)); }
}

function renderCams() {
  const tb = $('#camTable tbody'); tb.innerHTML = '';
  for (const c of state.cameras) {
    const prof = c.model ? profileFor(c.model) : null;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox" ${c.selected ? 'checked' : ''} aria-label="Select ${esc(c.ip)}"></td>
      <td class="mono">${esc(hostPort(c))}</td>
      <td>${esc(c.model || '–')}</td><td>${esc(c.title || '')}</td><td><input class="zonein" list="zoneList" value="${esc(c.zone || '')}" placeholder="–" aria-label="Zone of ${esc(c.ip)}"></td>
      <td>${prof ? `<span class="pill ${prof.fam === 'GENERIC' ? 'info' : ''}">${esc(prof.fam)}</span> <span class="muted small">${paramsFor(c).length} settings</span>` : ''}</td>
      <td>${c.scene == null ? '–' : c.scene === 0 ? 'Off' : 'Scene ' + c.scene}</td>
      <td>${c.busy ? '<span class="pill busy">Busy</span>' : c.statusKind === 'ok' && c.power === 'standby' ? '<span class="pill busy">Standby</span>' : c.status ? `<span class="pill ${c.statusKind || ''}">${esc(c.status)}</span>` : ''}</td>
      <td class="nowrap"><button class="ghost small" data-act="live">Live view</button> <button class="ghost small" data-act="setup">Settings</button></td>
      <td class="end"><button class="icon" data-act="del" title="Remove from list" aria-label="Remove ${esc(c.ip)}">×</button></td>`;
    $('input', tr).onchange = e => { c.selected = e.target.checked; saveCams(); updateSel(); };
    $('.zonein', tr).onchange = e => { const z = e.target.value.trim(); track(`Zone of ${c.ip}`, () => { c.zone = z; }); saveCams(); renderZones(); };
    $('[data-act=live]', tr).onclick = () => openCamPage(c, 'live');
    $('[data-act=setup]', tr).onclick = () => openCamPage(c, 'setup');
    $('[data-act=del]', tr).onclick = () => { track(`Remove ${c.ip}`, () => { state.cameras = state.cameras.filter(x => x !== c); }); saveCams(); renderCams(); };
    tb.appendChild(tr);
  }
  $('#camCount').textContent = state.cameras.length;
  $('#camEmpty').classList.toggle('hidden', state.cameras.length > 0);
  $('#selAll').checked = state.cameras.length && state.cameras.every(c => c.selected);
  updateSel(); renderZones();
}
/* ---- zones: group cameras (stage, FOH, ...) and select them per zone ---- */
const zoneNames = () => [...new Set(state.cameras.map(c => (c.zone || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
// chips "Stage (3)"; onPick(zone, add) gets '' for cameras without a zone
function zoneChips(box, onPick, label = 'Zone') {
  if (!box) return;
  const zs = zoneNames();
  if (!zs.length) { box.innerHTML = ''; return; }
  const none = state.cameras.filter(c => !c.zone).length;
  box.innerHTML = `<span class="muted small">${label}:</span> ` + zs.map(z => `<button type="button" class="chip" data-zone="${esc(z)}" title="Select the cameras in ${esc(z)} (Shift: add to the selection)">${esc(z)} <span class="muted">${state.cameras.filter(c => c.zone === z).length}</span></button>`).join('') +
    (none ? `<button type="button" class="chip" data-zone="" title="Cameras without a zone">No zone <span class="muted">${none}</span></button>` : '');
  $$('[data-zone]', box).forEach(b => b.onclick = e => onPick(b.dataset.zone, e.shiftKey));
}
const inZone = (c, z) => (c.zone || '') === z;
function renderZones() {
  $('#zoneList').innerHTML = zoneNames().map(z => `<option value="${esc(z)}">`).join('');
  zoneChips($('#camZoneBar'), (z, add) => { state.cameras.forEach(c => c.selected = inZone(c, z) || (add && c.selected)); saveCams(); renderCams(); }, 'Select zone');
  zoneChips($('#expZones'), (z, add) => { state.cameras.forEach(c => c.selected = inZone(c, z) || (add && c.selected)); saveCams(); renderExport(); renderCams(); });
}
$('#camSetZone').onclick = () => {
  const z = $('#camSelZone').value.trim(); const sel = state.cameras.filter(c => c.selected);
  track(z ? `Zone ${z} for ${sel.length} camera(s)` : `Clear zone of ${sel.length} camera(s)`, () => sel.forEach(c => c.zone = z));
  saveCams(); renderCams(); toast(z ? `${sel.length} camera${sel.length > 1 ? 's' : ''} in zone ${z}` : 'Zone cleared');
};
$('#camDelSel').onclick = async () => {
  const sel = state.cameras.filter(c => c.selected);
  if (!await ask({ title: `Remove ${sel.length} camera${sel.length > 1 ? 's' : ''} from the list?`, body: '<p>The cameras themselves are not changed. You can undo this.</p>', ok: 'Remove', danger: true })) return;
  track(`Remove ${sel.length} camera(s)`, () => { state.cameras = state.cameras.filter(c => !c.selected); });
  saveCams(); renderCams();
};
$('#camEditSel').onclick = async () => {
  const sel = state.cameras.filter(c => c.selected);
  const same = k => sel.every(c => (c[k] ?? '') === (sel[0][k] ?? '')) ? (sel[0][k] ?? '') : '';
  const ok = await ask({ title: `Edit ${sel.length} camera${sel.length > 1 ? 's' : ''}`, ok: 'Apply', body: `<div class="row wrap">
      <label class="w140">Zone <input id="edZone" list="zoneList" value="${esc(same('zone'))}" placeholder="${sel.length > 1 && !same('zone') ? 'several' : ''}"></label>
      <label class="w90">Port <input id="edPort" type="number" value="${esc(same('port') || '')}" placeholder="${sel.length > 1 && !same('port') ? 'several' : '80'}"></label></div>
      <div class="row wrap"><label class="w140">Login user name <input id="edUser" autocomplete="off" value="${esc(same('user'))}"></label><label class="w140">Password <input id="edPass" type="password" autocomplete="off"></label></div>
      <label class="check"><input type="checkbox" id="edGeneral"> Use the general camera login for these cameras</label>
      <p class="hint">Empty fields stay as they are. A login here is only for these cameras and replaces the general one at the top of the page.</p>` });
  if (!ok) return;
  const z = $('#edZone').value.trim(), port = +$('#edPort').value, user = $('#edUser').value.trim(), pass = $('#edPass').value, general = $('#edGeneral').checked;
  track(`Edit ${sel.length} camera(s)`, () => sel.forEach(c => {
    if (z) c.zone = z;
    if (port > 0 && port < 65536) c.port = port;
    if (general) { delete c.user; delete c.pass; } else if (user) { c.user = user; if (pass) c.pass = pass; }
  }));
  saveCams(); renderCams();
};
function updateSel() {
  const n = state.cameras.filter(c => c.selected).length;
  $('#camSelN').textContent = n; $('#camSelBar').classList.toggle('hidden', !n);
  $('#expSel').textContent = n ? `${n} camera${n > 1 ? 's' : ''} selected` : 'Select at least one camera';
}
$('#selAll').onchange = e => { state.cameras.forEach(c => c.selected = e.target.checked); saveCams(); renderCams(); };
function upsertCam(ip, port, data = {}) {
  let c = state.cameras.find(x => x.ip === ip && (x.port || 80) == (port || 80));
  if (!c) { c = { ip, port: port || 80, selected: true }; state.cameras.push(c); }
  Object.assign(c, data);
  state.cameras.sort((a, b) => ipNum(a.ip) - ipNum(b.ip));
  return c;
}
const ipNum = ip => ip.split('.').reduce((s, x) => s * 256 + (+x || 0), 0);
const validIp = ip => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip) && ip.split('.').every(x => +x <= 255);

$('#scanBtn').onclick = async () => {
  if (!state.bridgeOk && !(await checkBridge())) return;
  const range = $('#scanRange').value.trim();
  if (!range) return info('Fill in an IP range', 'For example 192.168.0.0/24 or 192.168.0.10-60.');
  $('#scanBtn').disabled = true; $('#scanStatus').textContent = 'Scanning…';
  try {
    const j = await bridgeFetch('/api/scan', { range, port: +$('#scanPort').value || 80, user: $('#authUser').value.trim(), pass: $('#authPass').value });
    track('Scan', () => { for (const f of j.cameras) {
      const c = upsertCam(f.ip, f.port, { model: f.model, title: f.title || '' });
      if (f.auth) { c.status = 'Login required'; c.statusKind = 'err'; }
      c.power = f.power === 'p1' ? 'on' : f.power === 'p0' ? 'standby' : f.power;
    } });
    $('#scanStatus').textContent = `${j.scanned} addresses scanned, ${j.cameras.length} camera${j.cameras.length === 1 ? '' : 's'} found.`;
    log(`Scan ${range}: ${j.cameras.map(c => c.ip + ' ' + c.model).join(', ') || 'nothing found'}`);
    saveCams(); renderCams();
    await refreshAll(state.cameras.filter(c => j.cameras.some(f => f.ip === c.ip)));
  } catch (e) { $('#scanStatus').textContent = 'Scan failed: ' + e.message; log('Scan failed: ' + e.message, 'ERROR'); }
  finally { $('#scanBtn').disabled = false; }
};
$('#addToggle').onclick = () => { $('#addRow').classList.toggle('hidden'); $('#addIp').focus(); };
$('#addBtn').onclick = async () => {
  if (!state.bridgeOk && !(await checkBridge())) return;
  const ips = $('#addIp').value.split(/[\s,;]+/).filter(Boolean);
  const bad = ips.filter(i => !validIp(i)); if (bad.length) return info('Invalid IP address', esc(bad.join(', ')));
  const cams = track('Add cameras', () => ips.map(ip => upsertCam(ip, +$('#addPort').value || 80)));
  $('#addIp').value = ''; renderCams(); await refreshAll(cams);
};
async function refreshAll(cams) {
  await Promise.all(cams.map(async c => {
    c.busy = true; renderCams();
    try { await identify(c); c.status = 'Online'; c.statusKind = 'ok'; }
    catch (e) { c.status = e.message; c.statusKind = 'err'; log(`${c.ip}: ${e.message}`, 'ERROR'); }
    c.busy = false; renderCams();
  }));
  saveCams(); renderCams();
}
$('#refreshBtn').onclick = async () => { if (state.bridgeOk || await checkBridge()) refreshAll(state.cameras); };
$('#clearCamsBtn').onclick = async () => { if (await ask({ title: 'Clear the camera list?', body: '<p>The cameras themselves are not changed.</p>', ok: 'Clear list' })) { track('Clear camera list', () => { state.cameras = []; }); saveCams(); renderCams(); } };

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
    cameras: state.cameras.map(({ ip, port, model, title, selected, scene, power, status, statusKind, zone, user, pass }) => ({ ip, port, model, title, selected, scene, power, status, statusKind, zone, user, pass })),
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
      await openBytes(j.name, u8);
    } catch (e) { info(`Could not open ${esc(p)}`, esc(e.message)); }
  }
}
async function openBytes(name, u8) {
  if (/\.zip$/i.test(name)) { for (const z of await readZip(u8.buffer)) openJson(z.name, JSON.parse(z.text)); }
  else openJson(name, JSON.parse(new TextDecoder().decode(u8)));
  log(`Opened: ${name}`);
}
function openJson(name, data) {
  if (data?.format === SHOW_ID) return addShow(data, true);
  return addImportFile(name, data);
}
$('#openFilesBtn').onclick = async () => {
  try { const j = await bridgeFetch('/api/choose', { kind: 'files', multiple: true }); if (j.ok) return openPaths(j.paths || []); } catch { }
  $('#fileInput').click();
};
$('#browseFolderBtn').onclick = async () => {
  try {
    const j = await bridgeFetch('/api/list_files', {});
    const files = j.files.filter(f => /\.(json|zip|pshow|poper)$/i.test(f.name)).sort((a, b) => b.mtime - a.mtime);
    $('#folderList').innerHTML = files.length ? `<table class="tbl dense"><thead><tr><th>File in ${esc(j.folder)}</th><th>Saved</th><th></th></tr></thead><tbody>${files.map(f => `<tr><td>${esc(f.name)}</td><td class="muted small">${new Date(f.mtime * 1000).toLocaleString('en-GB')}</td><td class="end"><button class="ghost small" data-open="${esc(f.path)}">Open</button></td></tr>`).join('')}</tbody></table>` : `<p class="muted">No Panasonic Toolbox files in ${esc(j.folder)}.</p>`;
    $$('#folderList [data-open]').forEach(b => b.onclick = () => openPaths([b.dataset.open]));
  } catch (e) { info('Could not read the folder', esc(e.message)); }
};

/* ------------------------------------------------------------------ operator settings */
// Personal operating preferences, separate from the scenes: presets, speeds, pan/tilt, lens and tally behaviour.
const OPERATOR_SPEC = [
  ['Presets', ['OSJ:29', '#PST', '#UPVS', 'OSE:71', 'OSJ:A8', 'OSJ:A9', 'OSJ:AA', 'OSJ:AB', 'OSJ:AC', 'OSJ:AD', 'OSJ:AE', 'OSE:7C', 'OSE:7D', 'OSJ:5B', 'OSJ:D5', 'OSJ:2B', 'OSJ:2C', '#PRF']],
  ['Pan/tilt', ['OSJ:2D', '#SWZ', 'OAZ', '#SPF', 'OSJ:45', 'OSJ:46']],
  ['Lens', ['OAF', 'OSJ:D8', 'OSE:70', 'OSE:7A', 'OSJ:4E', 'OIS']],
  ['Tally and display', ['#TAE', 'OSA:D3', 'OSJ:D9', 'OSJ:DA', 'OSE:75']],
];
const OPERATOR_ID = 'panasonic-ptz-operator';
const OPERATOR_PARAMS = (() => {
  const out = [];
  for (const [g, list] of OPERATOR_SPEC) for (const base of list) {
    const c = (window.PANA_COMMANDS || []).find(x => x.c && (x.c === base + '[Data]' || x.c === base + ':[Data]' || x.c.startsWith(base + ':[Data') || x.c.startsWith(base + '[Data')) && x.q);
    if (c) out.push({ cmd: base, q: c.q, t: base.startsWith('#') ? 'ptz' : 'cam', name: c.n, g });
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
    $('input', l).onchange = e => { c.selected = e.target.checked; saveCams(); updateSel(); renderExportScenes(); };
    box.appendChild(l);
  }
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

$('#exportBtn').onclick = async () => {
  const cams = state.cameras.filter(c => c.selected);
  if (!cams.length) return info('No cameras selected', 'Tick the cameras you want to export.');
  if (!state.bridgeOk && !(await checkBridge())) return;
  const kind = $('input[name=expKind]:checked').value;
  if (kind === 'operator') return exportOperator(cams);
  const mode = $('input[name=expMode]:checked').value;
  const picked = $$('#expScenes input:checked').map(i => +i.value);
  if (mode === 'pick') {
    if (!picked.length) return info('No scenes chosen', 'Tick the scenes you want to export.');
    const ok = await ask({
      title: 'The picture will change',
      body: `<p>To read scene ${picked.join(', ')} the camera has to switch to ${picked.length > 1 ? 'each of those scenes' : 'that scene'}. The picture of these cameras will jump while exporting:</p>
        <ul>${cams.map(c => `<li><b>${esc(c.title || c.model || c.ip)}</b> <span class="mono">${esc(c.ip)}</span>${c.scene ? `, now on scene ${c.scene}` : ''}</li>`).join('')}</ul>
        <p>Afterwards every camera returns to the scene it was on. Do not do this while a camera is on air. Are you sure?</p>`,
      ok: 'Switch scenes and export', danger: true,
    });
    if (!ok) return;
  }
  $('#exportBtn').disabled = true;
  const card = $('#expResultCard'); card.classList.remove('hidden');
  const out = $('#expResult'); out.innerHTML = '<div class="progress"><i></i></div><div id="expRows"></div>';
  const files = [];
  let done = 0; const total = cams.length;
  await Promise.all(cams.map(async cam => {
    const row = document.createElement('div'); row.className = 'note'; row.textContent = `${cam.ip}: working…`; $('#expRows').appendChild(row);
    cam.busy = true; renderCams();
    try {
      if (!cam.model) await identify(cam);
      const orig = await getScene(cam);
      const scenes = [];
      const list = mode === 'active' ? [orig ?? 0] : picked.filter(n => n <= profileFor(cam.model).scenes);
      let current = orig;
      try {
        for (const n of list) {
          if (mode === 'pick' && n !== current) { await switchScene(cam, n); current = n; }
          row.textContent = `${cam.ip}: reading scene ${n}…`;
          scenes.push(await readSceneFile(cam, n));
        }
      } finally {
        if (orig && current !== orig) await switchScene(cam, orig);
      }
      const file = makeFile(cam, scenes);
      const name = fileName(cam, scenes);
      files.push({ name, text: JSON.stringify(file, null, 1), file });
      addImportFile(name, file);
      const cnt = scenes.map(s => `Scene ${s.scene}: ${s.params.length} settings${s.unavailable.length ? `, ${s.unavailable.length} not available in the current mode` : ''}`).join('. ');
      row.className = 'note ok'; row.innerHTML = `<b>${esc(cam.title || cam.model)}</b> <span class="mono">${esc(cam.ip)}</span><br>${esc(cnt)}<span class="row-actions"><button class="ghost small" data-dl>Save again</button><button class="ghost small" data-view>Show values</button></span>`;
      $('[data-dl]', row).onclick = () => download(name, JSON.stringify(file, null, 1));
      $('[data-view]', row).onclick = () => showSceneTable(row, file);
      log(`${cam.ip}: exported. ${cnt}`);
    } catch (e) {
      row.className = 'note err'; row.textContent = `${cam.ip}: export failed. ${e.message}`; log(`${cam.ip}: export failed: ${e.message}`, 'ERROR');
    }
    cam.busy = false; renderCams();
    $('.progress > i', out).style.width = (++done / total * 100) + '%';
  }));
  if (files.length === 1) await download(files[0].name, files[0].text);
  else if (files.length > 1) {
    if ($('#expZip').checked) await download(zipName('scene', files.length), makeZip(uniqueNames(files)));
    else for (const f of files) await download(f.name, f.text);
  }
  $('#exportBtn').disabled = false;
};
function showSceneTable(anchor, file) {
  const ex = anchor.nextElementSibling; if (ex && ex.classList.contains('scene-view')) { ex.remove(); return; }
  const div = document.createElement('div'); div.className = 'scene-view';
  div.innerHTML = file.scenes.map(s => `<h3>Scene ${s.scene}</h3><table class="tbl dense"><thead><tr><th>Group</th><th>Setting</th><th>Value</th><th>Raw</th></tr></thead><tbody>${s.params.map(p => `<tr><td class="grp">${esc(p.group)}</td><td>${esc(p.name)}</td><td>${esc(p.value)}</td><td class="mono">${esc(p.raw)}</td></tr>`).join('')}</tbody></table>${s.unavailable.length ? `<p class="muted small">Not available on this camera or in the current mode: ${s.unavailable.map(u => esc(u.name) + ' (' + esc(u.reason) + ')').join(', ')}</p>` : ''}`).join('');
  anchor.after(div);
}

$$('input[name=expKind]').forEach(r => r.onchange = () => $('#expSceneBox').classList.toggle('disabled', $('input[name=expKind]:checked').value === 'operator'));
function expKindNow() { return $('input[name=expKind]:checked')?.value || 'scene'; }
function renderNameFields() {
  const k = expKindNow();
  $('#expName').value = namePattern(k); $('#expZipName').value = namePattern('zip' + k);
  $('#expExt').textContent = k === 'operator' ? '.poper' : '.pscene.json';
  const cam = state.cameras.find(c => c.selected) || state.cameras[0] || { ip: '192.168.0.11', title: 'CAM1', model: 'AW-UE150', zone: 'Stage' };
  const ex = k === 'operator' ? operatorName(cam) : fileName(cam, [{ scene: cam.scene || 1 }]);
  $('#expNamePreview').innerHTML = `Example: <span class="mono">${esc(ex)}</span> · ZIP: <span class="mono">${esc(zipName(k, Math.max(2, state.cameras.filter(c => c.selected).length)))}</span>`;
}
$('#expTokens').innerHTML = '<span class="muted small">Insert:</span> ' + Object.entries(NAME_TOKENS).map(([k, l]) => `<button type="button" class="chip" data-token="${k}" title="${esc(l)}">{${k}}</button>`).join('');
let lastNameField = $('#expName');
['#expName', '#expZipName'].forEach(s => { $(s).addEventListener('focus', e => lastNameField = e.target); $(s).addEventListener('input', () => { const k = expKindNow(); store.set('name_' + (s === '#expName' ? k : 'zip' + k), $(s).value.trim()); renderNameFields2(); }); });
function renderNameFields2() { const a = document.activeElement; const v1 = $('#expName').value, v2 = $('#expZipName').value; renderNameFields(); $('#expName').value = v1; $('#expZipName').value = v2; a?.focus?.(); }
$$('#expTokens [data-token]').forEach(b => b.onclick = () => {
  const f = lastNameField, t = `{${b.dataset.token}}`, s = f.selectionStart ?? f.value.length;
  f.value = f.value.slice(0, s) + t + f.value.slice(f.selectionEnd ?? s); f.focus(); f.setSelectionRange(s + t.length, s + t.length);
  f.dispatchEvent(new Event('input'));
});
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
  if (files.length === 1) await download(files[0].name, files[0].text);
  else if (files.length > 1) await download(zipName('operator', files.length), makeZip(uniqueNames(files)));
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
const srcParams = s => s.kind === 'operator' ? s.file.settings.length : s.file.scenes[s.sceneIdx].params.length;
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
  // step 1: list of opened scenes
  $('#srcList').innerHTML = state.sources.length ? `<table class="tbl dense"><thead><tr><th>File</th><th>From camera</th><th>Scene</th><th>Settings</th><th></th></tr></thead><tbody>${state.sources.map(s => `<tr><td>${esc(s.fileName)}</td><td>${esc(s.file.camera?.title || '')} <span class="mono muted">${esc(s.file.camera?.ip || '')}</span> <span class="muted small">${esc(s.file.camera?.model || '')}</span></td><td>${s.kind === 'operator' ? 'Operator file' : 'Scene ' + esc(s.file.scenes[s.sceneIdx].scene)}</td><td>${srcParams(s)}</td><td class="end"><button class="icon" data-src="${s.id}" aria-label="Remove">×</button></td></tr>`).join('')}</tbody></table>` : '';
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
      <td class="end nowrap"><button class="ghost small" data-act="cmp" title="Compare with what is on the camera now">Compare</button> <button class="icon" data-act="del" aria-label="Remove">×</button></td>`;
    $('input', tr).onchange = e => { j.include = e.target.checked; updImpSel(); };
    $$('select', tr).forEach(se => se.onchange = () => { track('Change destination', () => { j[se.dataset.k] = se.dataset.k === 'srcId' ? +se.value : se.value; }); renderImports(); });
    $('[data-act=del]', tr).onclick = () => { track('Remove destination', () => { state.jobs = state.jobs.filter(x => x !== j); }); renderImports(); };
    $('[data-act=cmp]', tr).onclick = () => compareImport(j, tr);
    tb.appendChild(tr);
  }
  $('#impCount').textContent = state.jobs.length;
  $('#impEmpty').classList.toggle('hidden', state.jobs.length > 0);
  $('#impSelCam').innerHTML = '<option value="">Keep</option>' + state.cameras.map(c => `<option value="${esc(c.ip)}">${esc(c.ip)} ${esc(c.title || c.model || '')}${c.zone ? ' · ' + esc(c.zone) : ''}</option>`).join('');
  updImpSel();
}
function updImpSel() {
  const n = state.jobs.filter(j => j.include).length;
  $('#impSelN').textContent = n; $('#impSelBar').classList.toggle('hidden', !n);
  $('#impSelAll').checked = state.jobs.length > 0 && state.jobs.every(j => j.include);
}
$('#impSelAll').onchange = e => { state.jobs.forEach(j => j.include = e.target.checked); renderImports(); };
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
async function runImport(jobs, opts, title = 'Import into these cameras?') {
  if (!jobs.length) return info('Nothing to import', 'Open a file and choose a camera for it in step 2.');
  const missing = jobs.filter(j => !state.cameras.some(c => c.ip === j.target));
  if (missing.length) return info('Choose a camera for every row', `${missing.length} row${missing.length > 1 ? 's have' : ' has'} no camera yet.`);
  if (!state.bridgeOk && !(await checkBridge())) return;
  const byCam = new Map();
  for (const j of jobs) { const c = state.cameras.find(x => x.ip === j.target); if (!byCam.has(c)) byCam.set(c, []); byCam.get(c).push(j); }
  const ok = await ask({
    title,
    body: `<ul>${[...byCam].map(([c, js]) => `<li><b>${esc(c.title || c.model || c.ip)}</b> <span class="mono">${esc(c.ip)}</span>: ${js.map(j => { const s = srcById(j.srcId); return `${esc(srcLabel(s))}${s.kind === 'operator' ? '' : ' → ' + (j.targetScene === 'active' ? 'live scene' : 'scene ' + j.targetScene)}`; }).join('; ')}</li>`).join('')}</ul>
      <p>The picture of these cameras changes immediately. If a destination scene is not the live scene, the camera switches to it while importing. You can undo this afterwards.</p>`,
    ok: 'Import', danger: true,
  });
  if (!ok) return;
  $('#importBtn').disabled = true;
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
        setRow(bad ? 'warn' : 'ok', `<b>${esc(cam.title || cam.model)}</b> <span class="mono">${esc(cam.ip)}</span><br>${esc(srcLabel(src))}${r.scene ? ` into scene ${r.scene}` : ''}: ${r.applied} settings applied` +
          (r.skipped.length ? `, ${r.skipped.length} skipped (not supported by ${esc(profileFor(cam.model).fam)})` : '') +
          (r.failed.length ? `<br>Not accepted by the camera: ${r.failed.map(f => esc(f.name) + ' (' + esc(f.err) + ')').join(', ')}` : '') +
          (r.mismatch.length ? `<br>Different after checking: ${r.mismatch.map(m => esc(m.name)).join(', ')}` : '') +
          (r.stored ? '<br>Stored in the scene file (UE160).' : ''));
        log(`${cam.ip}: imported ${srcLabel(src)}: ${r.applied} applied, ${r.failed.length} refused, ${r.mismatch.length} different`);
      } catch (e) { setRow('err', `${esc(cam.ip)}: import failed. ${esc(e.message)}`); log(`${cam.ip}: import failed: ${e.message}`, 'ERROR'); }
    }
    cam.busy = false; try { await identify(cam); } catch { } renderCams();
  }));
  if (undos.length) pushHistory({
    label: `Import ${undos.length} file${undos.length > 1 ? 's' : ''}`, camera: true, many: byCam.size > 1,
    undo: async () => { for (const u of [...undos].reverse()) await u.undo(); }, redo: async () => { for (const u of undos) await u.redo(); },
  });
  if (backups.length === 1) await download(backups[0].name, backups[0].text);
  else if (backups.length > 1) await download(`backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`, makeZip(backups));
  $('#importBtn').disabled = false;
}

async function importScene(cam, sceneData, targetScene, opts, progress) {
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
  // Pass 1: everything in order (modes come first in the list)
  let pending = list.map(x => ({ ...x, send: x.raw }));
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
  const failed = pending.map(x => ({ cmd: x.cmd, name: x.name, err: String(x.lastErr || '').slice(0, 3) || 'error' }));
  let stored = false;
  if (opts.store && prof.fam === 'UE160') {
    progress('storing in scene file…');
    const [s] = await batch(cam, [{ cmd: 'OSL:90:' + target }, { sleepMs: 500 }]);
    stored = s.ok && !isErr(s.body);
  }
  let mismatch = [];
  if (opts.verify) {
    progress('checking…');
    const okList = list.filter(x => !failed.some(f => f.cmd === x.cmd));
    const back = await readParams(cam, okList.map(x => x.p));
    mismatch = back.map((b, i) => ({ b, x: okList[i] })).filter(({ b, x }) => b.raw && b.raw.toUpperCase() !== x.raw.toUpperCase()).map(({ x }) => ({ cmd: x.cmd, name: x.name }));
  }
  if (opts.restore && target !== orig && orig) { progress(`returning to scene ${orig}…`); await switchScene(cam, orig); }
  return { scene: target, applied: list.length - failed.length, skipped, failed, mismatch, stored, backup, before };
}




async function importOperator(cam, data, opts, progress) {
  if (!cam.model) await identify(cam);
  progress('reading current operator settings…');
  const before = await readOperatorFile(cam);
  const backup = opts.backup ? { name: operatorName(cam, '_BACKUP'), text: JSON.stringify(before, null, 1) } : null;
  const known = new Map(OPERATOR_PARAMS.map(p => [p.cmd, p]));
  const list = data.settings.filter(x => x.raw && known.has(x.cmd));
  progress(`setting ${list.length} values…`);
  let res = await batch(cam, list.map(x => ({ type: x.cmd.startsWith('#') ? 'ptz' : 'cam', cmd: x.raw })));
  let failed = list.filter((x, i) => !(res[i]?.ok && !isErr(res[i].body)));
  if (failed.length) { res = await batch(cam, failed.map(x => ({ type: x.cmd.startsWith('#') ? 'ptz' : 'cam', cmd: x.raw }))); failed = failed.filter((x, i) => !(res[i]?.ok && !isErr(res[i].body))); }
  return { scene: null, applied: list.length - failed.length, skipped: data.settings.filter(x => !known.has(x.cmd)), failed: failed.map(x => ({ cmd: x.cmd, name: x.name, err: 'ER' })), mismatch: [], stored: false, backup, before };
}
// Run one import job (scene or operator) and return its result plus how to undo/redo it.
async function runJob(cam, src, targetScene, opts, progress) {
  if (src.kind === 'operator') {
    const r = await importOperator(cam, src.file, opts, progress);
    return { r, undo: () => importOperator(cam, r.before, { backup: false }, () => { }), redo: () => importOperator(cam, src.file, { backup: false }, () => { }) };
  }
  const sceneData = src.file.scenes[src.sceneIdx];
  const r = await importScene(cam, sceneData, targetScene, opts, progress);
  const o2 = { ...opts, backup: false, verify: false, noBackupRead: true };
  return { r, undo: () => importScene(cam, r.before, String(r.scene), o2, () => { }), redo: () => importScene(cam, sceneData, String(r.scene), o2, () => { }) };
}

/* ------------------------------------------------------------------ parameters: scene file contents */
const FAM_TEXT = { UE150: 'AW-UE150 / UE155 / HE145', UE150A: 'AW-UE150A', UE160: 'AW-UE160', UE100: 'AW-UE100', UE80: 'AW-UE80 / UE50 / UE40 / UE30', GENERIC: 'Other models' };
function renderParamTab() {
  const sel = $('#paramFam');
  if (!sel.options.length) sel.innerHTML = Object.keys(CATALOG).map(f => `<option value="${f}">${esc(FAM_TEXT[f] || f)}</option>`).join('');
  const fam = sel.value; const words = $('#paramSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = CATALOG[fam].filter(p => words.every(w => (p.name + ' ' + p.cmd + ' ' + p.q + ' ' + p.g).toLowerCase().includes(w)));
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
$('#paramCsv').onclick = () => {
  const fam = $('#paramFam').value;
  const csv = ['Group;Setting;Set command;Query command;Values'].concat(CATALOG[fam].map(p => [p.g, p.name, p.cmd, p.q, rangeText(p)].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))).join('\r\n');
  download(`panasonic_scene_parameters_${fam}.csv`, '﻿' + csv, 'text/csv');
};

/* ------------------------------------------------------------------ parameters: HTTP commands */
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
  if (btn) { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = t, 1400); }
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

function enumOpts(c) {
  const d = c.d, v = c.v;
  if (d.length !== v.length || d.length < 2 || d.length > 60) return null;
  if (d.some(x => x === '-' || !/^[0-9A-F]{1,5}h?$/i.test(x))) return null;
  return d.map((x, i) => ({ val: x.replace(/h$/i, ''), label: `${x.replace(/h$/i, '')}: ${v[i]}` }));
}
function valueHint(c) {
  if (!c.d || (c.d.length === 1 && (c.d[0] === '-' || c.d[0] === '※'))) return '';
  return (c.d.join(' ') + (c.v.join('') ? '  →  ' + c.v.join(' ') : '')).slice(0, 300);
}
function matchType(c, type) {
  if (!type) return true;
  if (type === 'common') return !!c.common;
  if (type === 'rp') return !!c.rp;
  return !c.common && !c.rp && c.t === type;
}
function renderCmds() {
  const words = $('#paramSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const m = $('#cmdModel').value, type = $('#cmdType').value;
  const match = c => words.every(w => (c.n + ' ' + c.c + ' ' + (c.q || '')).toLowerCase().includes(w));
  const common = COMMON.filter(c => match(c) && matchType(c, type) && !m);
  const list = COMMANDS.filter(c => c.c && (!m || c.m.some(x => x.replace('*', '') === m)) && matchType(c, type) && match(c));
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
  const holders = c.c.match(/\[Data\d*\]/g) || [];
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
  const build = () => { let i = 0; return c.c.replace(/\[Data\d*\]/g, () => val($(`[data-i="${i++}"]`, tr))); };
  tr.update = () => { $('code.url', tr).textContent = cmdUrl(c.t, build()); if (c.q) $('code.qurl', tr).textContent = cmdUrl(c.t, c.q); };
  $$('[data-i]', tr).forEach(el => el.addEventListener('input', tr.update));
  $('[data-act=copy]', tr).onclick = e => copyText(cmdUrl(c.t, build()), e.target);
  $('[data-act=send]', tr).onclick = () => sendCmd(c.t, build(), $('.out', tr), c);
  $('[data-act=script]', tr).onclick = () => addToScript(c.preset ? `${c.n} ${$('[data-i="0"]', tr).value}` : c.n, c.t, build());
  tr.update();
  return tr;
}
$('#paramSearch').addEventListener('input', () => { renderCmds(); renderParamTab(); });
$('#cmdModel').addEventListener('change', renderCmds);
$('#cmdType').addEventListener('change', renderCmds);

/* ---- script builder for Companion ---- */
state.script = store.get('script', []);
const saveScript = () => store.set('script', state.script);
function addToScript(name, t, cmd) {
  if (/\[Data/.test(cmd) || /:$/.test(cmd)) return info('Fill in a value first', 'This command needs a value before it can be added.');
  state.script.push({ name, t, cmd }); saveScript(); renderScript();
  toast(`Added to script: ${name}`);
}
function renderScript() {
  $('#scriptCard').classList.toggle('hidden', !state.script.length);
  $('#scriptCount').textContent = state.script.length;
  $('#scriptList').innerHTML = state.script.map((s, i) => `<li><span>${esc(s.name)}</span> <span class="mono muted">${esc(s.cmd)}</span> <button class="icon" data-i="${i}" aria-label="Remove">×</button></li>`).join('');
  $$('#scriptList [data-i]').forEach(b => b.onclick = () => { state.script.splice(+b.dataset.i, 1); saveScript(); renderScript(); });
  const prev = new Set(store.get('scriptCams', []));
  $('#scriptCams').innerHTML = state.cameras.length ? state.cameras.map(c => `<label class="check"><input type="checkbox" value="${esc(c.ip)}" ${prev.has(c.ip) ? 'checked' : ''}> ${esc(c.title || c.model || '')} <span class="mono muted">${esc(c.ip)}</span>${c.zone ? ` <span class="pill">${esc(c.zone)}</span>` : ''}</label>`).join('') : '<span class="muted">Find cameras first; the script runs on the cameras you tick here.</span>';
  $$('#scriptCams input').forEach(i => i.onchange = () => store.set('scriptCams', $$('#scriptCams input:checked').map(x => x.value)));
  zoneChips($('#scriptZones'), (z, add) => {
    $$('#scriptCams input').forEach(i => { const c = state.cameras.find(x => x.ip === i.value); i.checked = (c && inZone(c, z)) || (add && i.checked); });
    store.set('scriptCams', $$('#scriptCams input:checked').map(x => x.value));
    if (z && !add) { const n = $('#scriptName'); n.value = n.value.replace(/^zone-[^_]*_/, '') ; n.value = `zone-${z.replace(/[^\w-]+/g, '-')}_${n.value}`; }
  }, 'Zone');
}
const setScriptCams = on => { $$('#scriptCams input').forEach(i => i.checked = on); store.set('scriptCams', $$('#scriptCams input:checked').map(x => x.value)); };
$('#scriptAll').onclick = () => setScriptCams(true);
$('#scriptNone').onclick = () => setScriptCams(false);
$('#scriptLogin').checked = store.get('scriptLogin', false);
$('#scriptLogin').onchange = e => store.set('scriptLogin', e.target.checked);
$('#scriptClear').onclick = () => { state.script = []; saveScript(); renderScript(); };
function scriptTargets() {
  const ips = $$('#scriptCams input:checked').map(x => x.value);
  return state.cameras.filter(c => ips.includes(c.ip)).map(c => ({ ip: c.ip, port: c.port || 80 }));
}
function scriptName(ext) { return ($('#scriptName').value.trim() || 'panasonic-action').replace(/[^\w.-]+/g, '_') + ext; }
$('#scriptPs1').onclick = () => {
  const cams = scriptTargets(); if (!cams.length) return info('Tick at least one camera', 'Choose on which cameras the script runs.');
  const user = $('#authUser').value.trim(), pass = $('#authPass').value;
  const withLogin = $('#scriptLogin').checked && !!user;
  const lines = [
    `# Panasonic Toolbox script: ${$('#scriptName').value.trim()}`,
    `# Generated ${new Date().toLocaleString('en-GB')}. Runs ${state.script.length} command(s) on ${cams.length} camera(s).`,
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
  download(scriptName('.ps1'), lines.join('\r\n') + '\r\n', 'text/plain');
  if (withLogin) toast('Note: the camera login is stored in the script as plain text.');
};
$('#scriptSh').onclick = () => {
  const cams = scriptTargets(); if (!cams.length) return info('Tick at least one camera', 'Choose on which cameras the script runs.');
  const user = $('#authUser').value.trim(), pass = $('#authPass').value;
  const withLogin = $('#scriptLogin').checked && !!user;
  const lines = [
    '#!/bin/bash',
    `# Panasonic Toolbox script: ${$('#scriptName').value.trim()}`,
    `# Companion: System > Run shell path:  bash "<path to this file>"`,
    ...(withLogin ? [`PANASONIC_USER='${user.replace(/'/g, "'\\''")}'`, `PANASONIC_PASS='${pass.replace(/'/g, "'\\''")}'`] : ['# Camera login (only needed when User Auth is on): export PANASONIC_USER and PANASONIC_PASS']),
    'AUTH=()',
    '[ -n "$PANASONIC_USER" ] && AUTH=(--digest -u "$PANASONIC_USER:$PANASONIC_PASS")',
    `CAMERAS=(${cams.map(c => `"${c.ip}${c.port !== 80 ? ':' + c.port : ''}"`).join(' ')})`,
    `for CAM in "\${CAMERAS[@]}"; do`,
    ...state.script.map(s => `  curl -s -m 3 "\${AUTH[@]}" "http://$CAM/cgi-bin/${s.t === 'ptz' ? 'aw_ptz' : 'aw_cam'}?cmd=${encCmd(s.cmd)}&res=1" > /dev/null  # ${s.name.replace(/[\r\n]/g, ' ')}`),
    `done`,
  ];
  download(scriptName('.sh'), lines.join('\n') + '\n', 'text/plain');
};

/* ------------------------------------------------------------------ shows */
// A show: which file goes to which camera and scene, with the file contents embedded, recallable in one go.
const SHOW_ID = 'panasonic-toolbox-show';
state.shows = store.get('shows', []);
const saveShows = () => store.set('shows', state.shows);
function addShow(show, fromFile) {
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
  await download(`${name.replace(/[^\w.-]+/g, '_')}.pshow`, JSON.stringify(show));
};
function renderShows() {
  const tb = $('#showTable tbody'); tb.innerHTML = '';
  for (const sh of state.shows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox" ${sh.sel ? 'checked' : ''} aria-label="Select show"></td><td><b>${esc(sh.name)}</b></td><td class="small">${sh.items.map(i => `${esc(i.targetTitle || i.target)} <span class="mono muted">${esc(i.target)}</span>: ${i.kind === 'operator' ? 'operator file' : (i.targetScene === 'active' ? 'live scene' : 'scene ' + esc(i.targetScene))}`).join('<br>')}</td><td class="muted small">${new Date(sh.created).toLocaleString('en-GB')}</td>
      <td class="end nowrap"><button data-act="recall">Recall</button> <button class="ghost small" data-act="file">Save file</button> <button class="icon" data-act="del" aria-label="Delete show">×</button></td>`;
    $('input[type=checkbox]', tr).onchange = e => { sh.sel = e.target.checked; updShowSel(); };
    $('[data-act=recall]', tr).onclick = () => recallShow(sh);
    $('[data-act=file]', tr).onclick = () => download(`${sh.name.replace(/[^\w.-]+/g, '_')}.pshow`, JSON.stringify(sh));
    $('[data-act=del]', tr).onclick = async () => { if (await ask({ title: `Delete “${esc(sh.name)}”?`, body: '<p>The cameras are not changed. A saved .pshow file stays where it is.</p>', ok: 'Delete', danger: true })) { track('Delete show', () => { state.shows = state.shows.filter(x => x !== sh); }); saveShows(); renderShows(); } };
    tb.appendChild(tr);
  }
  $('#showCount').textContent = state.shows.length;
  $('#showEmpty').classList.toggle('hidden', state.shows.length > 0);
  updShowSel();
}
function updShowSel() {
  const n = state.shows.filter(s => s.sel).length;
  $('#showDelSel').classList.toggle('hidden', !n); $('#showDelSel').textContent = `Delete ${n} selected`;
  $('#showSelAll').checked = state.shows.length > 0 && state.shows.every(s => s.sel);
}
$('#showSelAll').onchange = e => { state.shows.forEach(s => s.sel = e.target.checked); renderShows(); };
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
state.eip = [];
function renderEip() {
  const tb = $('#eipTable tbody'); tb.innerHTML = '';
  for (const r of state.eip) {
    const tr = document.createElement('tr');
    const changed = k => r.edit[k] !== r.orig[k] ? ' changed' : '';
    tr.innerHTML = `<td><input type="checkbox" ${r.sel ? 'checked' : ''} aria-label="Select"></td><td class="mono small">${esc(r.mac)}</td><td>${esc(r.model)}</td><td>${esc(r.name)}</td>
      <td><input data-k="ip" class="mono${changed('ip')}" value="${esc(r.edit.ip)}" aria-label="IP address"></td>
      <td><input data-k="mask" class="mono${changed('mask')}" value="${esc(r.edit.mask)}" aria-label="Subnet mask"></td>
      <td><input data-k="gateway" class="mono${changed('gateway')}" value="${esc(r.edit.gateway)}" aria-label="Gateway"></td>
      <td><input data-k="port" type="number" class="num${changed('port')}" value="${r.edit.port}" aria-label="Port"></td>
      <td class="small muted">${JSON.stringify(r.edit) !== JSON.stringify(r.orig) ? 'Changed' : ''}</td>`;
    $('input[type=checkbox]', tr).onchange = e => { r.sel = e.target.checked; };
    $$('input[data-k]', tr).forEach(i => i.onchange = () => { r.edit[i.dataset.k] = i.dataset.k === 'port' ? (+i.value || 80) : i.value.trim(); renderEip(); });
    tb.appendChild(tr);
  }
  $('#eipEmpty').classList.toggle('hidden', state.eip.length > 0);
  $('#eipApply').disabled = !state.eip.some(r => JSON.stringify(r.edit) !== JSON.stringify(r.orig));
}
async function eipDiscover() {
  if (!state.bridgeOk && !(await checkBridge())) return;
  $('#eipSearch').disabled = true; $('#eipStatus').textContent = 'Searching (3 seconds)…';
  try {
    const j = await bridgeFetch('/api/eip/discover', { timeout: 3 });
    const keep = new Map(state.eip.map(r => [r.mac, r.sel]));
    state.eip = j.cameras.map(c => { const v = { ip: c.ip, mask: c.mask, gateway: c.gateway, port: c.port }; return { ...c, sel: keep.get(c.mac) || false, orig: { ...v }, edit: { ...v } }; });
    $('#eipStatus').textContent = `${state.eip.length} camera${state.eip.length === 1 ? '' : 's'} found.`;
    log(`Easy IP: ${state.eip.length} camera(s) found`);
  } catch (e) { $('#eipStatus').textContent = 'Search failed: ' + e.message; }
  $('#eipSearch').disabled = false; renderEip();
}
$('#eipSearch').onclick = eipDiscover;
$('#eipSelAll').onchange = e => { state.eip.forEach(r => r.sel = e.target.checked); renderEip(); };
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
async function eipSend(list, field) {
  const fails = [];
  for (const r of list) {
    const v = r[field];
    try { await bridgeFetch('/api/eip/set', { mac: r.mac, ip: v.ip, mask: v.mask, gateway: v.gateway, dns1: r.dns1, dns2: r.dns2, port: v.port }); log(`Easy IP: ${r.mac} → ${v.ip}`); }
    catch (e) { fails.push(`${r.mac}: ${e.message}`); }
  }
  if (fails.length) throw new Error(fails.join('; '));
}
$('#eipApply').onclick = async () => {
  const list = state.eip.filter(r => JSON.stringify(r.edit) !== JSON.stringify(r.orig));
  const bad = list.find(r => !validIp(r.edit.ip, true) || !validIp(r.edit.mask, true) || (r.edit.gateway && r.edit.gateway !== '0.0.0.0' && !validIp(r.edit.gateway, true)));
  if (bad) return info('Check the values', `The settings for ${esc(bad.mac)} are not valid IPv4 addresses.`);
  const dup = list.find(r => state.eip.some(o => o !== r && (o.edit.ip === r.edit.ip)));
  if (dup) return info('Duplicate IP address', `${esc(dup.edit.ip)} is used more than once.`);
  const ok = await ask({
    title: `Change the network settings of ${list.length} camera${list.length > 1 ? 's' : ''}?`,
    body: `<ul>${list.map(r => `<li><b>${esc(r.model || r.mac)}</b> ${esc(r.name)}: <span class="mono">${esc(r.orig.ip)} → ${esc(r.edit.ip)}</span></li>`).join('')}</ul>
      <p>The cameras restart their network and are briefly unreachable. Cameras only accept this within about 20 minutes after they were switched on; if a camera does not change, restart it and try again.</p>`,
    ok: 'Apply', danger: true,
  });
  if (!ok) return;
  $('#eipApply').disabled = true; $('#eipStatus').textContent = 'Sending…';
  const snap = list.map(r => ({ mac: r.mac, dns1: r.dns1, dns2: r.dns2, orig: { ...r.orig }, edit: { ...r.edit } }));
  try { await eipSend(snap, 'edit'); } catch (e) { info('Not every camera accepted the change', esc(e.message)); }
  pushHistory({ label: `Network settings of ${snap.length} camera${snap.length > 1 ? 's' : ''}`, camera: true, many: snap.length > 1,
    undo: async () => { await eipSend(snap, 'orig'); setTimeout(eipDiscover, 2500); }, redo: async () => { await eipSend(snap, 'edit'); setTimeout(eipDiscover, 2500); } });
  $('#eipStatus').textContent = 'Sent. Searching again…';
  setTimeout(eipDiscover, 2500);
};
$('#eipDelSel').onclick = () => {
  const n = state.eip.filter(r => r.sel).length;
  if (!n) return info('Select cameras first', 'Tick the cameras you want to remove from this list. Search again to bring them back.');
  state.eip = state.eip.filter(r => !r.sel); renderEip();
};
$('#eipToList').onclick = () => {
  const list = state.eip.filter(r => r.sel).length ? state.eip.filter(r => r.sel) : state.eip;
  if (!list.length) return info('No cameras found yet', 'Search the network first.');
  track('Add cameras from network setup', () => list.forEach(r => upsertCam(r.orig.ip, r.orig.port, { model: r.model, title: r.name })));
  renderCams(); refreshAll(state.cameras.filter(c => list.some(r => r.orig.ip === c.ip)));
  toast(`${list.length} camera${list.length > 1 ? 's' : ''} added to Cameras`);
};

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
  $('#rpSelAll').checked = state.rp.length > 0 && state.rp.every(r => r.sel);
  const n = state.rp.filter(r => r.sel).length;
  $('#rpBulkScope').textContent = n ? `${n} selected row${n > 1 ? 's' : ''}` : 'all rows';
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
$('#rpSelAll').onchange = e => { state.rp.forEach(r => r.sel = e.target.checked); saveRp(); renderRp(); };
$('#rpBulkConn').onchange = e => {
  const v = e.target.value; e.target.value = ''; if (!v) return;
  const sel = state.rp.filter(r => r.sel);
  if (!sel.length) return info('Select rows first', 'Tick the rows whose connection type you want to change.');
  track(`Set ${sel.length} row(s) to ${v === 'lan' ? 'LAN' : 'None'}`, () => { state.rp = state.rp.map(r => r.sel ? { ...r, conn: v } : r); });
  saveRp(); renderRp(); if (s15.a) analyzeS15();
};
$('#rpFromCams').onclick = () => {
  const cams = [...(state.cameras.some(c => c.selected) ? state.cameras.filter(c => c.selected) : state.cameras)];
  if (!cams.length) return info('No cameras found yet', 'Find the cameras on the Cameras page first.');
  const by = $('#rpSort').value;
  cams.sort((a, b) => by === 'title' ? String(a.title || '').localeCompare(String(b.title || ''), 'en', { numeric: true }) : ipNum(a.ip) - ipNum(b.ip));
  const start = +$('#rpStart').value || 1;
  track('Take found cameras', () => { state.rp = cams.map((c, i) => ({ cam: start + i, ip: c.ip, port: c.port || 80, conn: 'lan', label: [c.model, c.title].filter(Boolean).join(', ') })); });
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
    await download('Network_ORIGINAL_backup.s15', new Blob([u8]), 'application/octet-stream');
    await download('Network.s15', new Blob([copy]), 'application/octet-stream');
    log(`Network.s15 changed for ${state.rp.length} camera(s)${lanVal != null ? ', connection type included' : ' (IP addresses only)'}`);
    info('Network.s15 saved', `The new file and a backup of the original are in ${esc(state.saveDir || 'Downloads › Panasonic Toolbox')}. Copy the new file to the SD card as <code>Network.s15</code> and load it on the RP150 with DATA LOAD › YES+NW.` +
      (lanVal == null ? '<br><br>The connection type could not be set automatically. Set CNNCT MD to LAN on the controller for each CAM, or open a second version of the file as explained above.' : ''));
  };
}

/* ------------------------------------------------------------------ live view and control */
const live = { cam: null, sid: null, moving: null, poll: null, irisVal: null, keys: new Set() };
function renderLiveCams() {
  const sel = $('#liveCam'); const cur = sel.value || store.get('liveCam', '');
  const opt = c => `<option value="${esc(c.ip)}">${esc(c.title || c.model || c.ip)} · ${esc(c.ip)}</option>`;
  const zs = zoneNames();
  sel.innerHTML = !state.cameras.length ? '<option value="">No cameras yet</option>' : !zs.length ? state.cameras.map(opt).join('')
    : zs.map(z => `<optgroup label="${esc(z)}">${state.cameras.filter(c => c.zone === z).map(opt).join('')}</optgroup>`).join('') + (state.cameras.some(c => !c.zone) ? `<optgroup label="No zone">${state.cameras.filter(c => !c.zone).map(opt).join('')}</optgroup>` : '');
  sel.value = state.cameras.some(c => c.ip === cur) ? cur : (state.cameras[0]?.ip || '');
}
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
const setToggle = (sel, on) => { $(sel).classList.toggle('on', !!on); $(sel).setAttribute('aria-pressed', on ? 'true' : 'false'); };
async function liveRead() {
  const cam = live.cam; if (!cam) return;
  let res;
  try { res = await batch(cam, [{ type: 'ptz', cmd: '#O' }, { type: 'ptz', cmd: '#D1' }, { type: 'ptz', cmd: '#D3' }, { type: 'ptz', cmd: '#D6' }, { type: 'cam', cmd: 'QLR' }, { type: 'cam', cmd: 'QLG' }, { type: 'cam', cmd: 'QSF' }, { type: 'ptz', cmd: '#I' }], { delayMs: 0 }); }
  catch (e) { $('#liveStatus').textContent = 'Not reachable: ' + e.message; return; }
  if (cam !== live.cam) return;
  const b = i => (res[i]?.ok ? (res[i].body || '').trim() : '');
  const power = b(0).toLowerCase();
  live.power = power === 'p1' ? 'on' : power === 'p0' ? 'standby' : power === 'p3' ? 'starting' : '';
  $('#livePower').textContent = live.power === 'standby' ? 'Power on' : 'Standby';
  setToggle('#liveAF', b(1).toLowerCase() === 'd11'); setToggle('#liveAI', b(2).toLowerCase() === 'd31'); setToggle('#liveNight', b(3).toLowerCase() === 'd61');
  setToggle('#liveTallyR', b(4) === 'OLR:1'); setToggle('#liveTallyG', b(5) === 'OLG:1');
  const sc = /^OSF:(\d)/.exec(b(6)); if (sc) { cam.scene = +sc[1] + 1; $$('#liveScenes button').forEach(x => x.classList.toggle('on', +x.dataset.scene === cam.scene)); }
  const ir = /^i(\d{2})$/i.exec(b(7)); live.irisVal = ir ? +ir[1] : null; $('#liveIris').textContent = ir ? ir[1] : '–';
  $('#liveStatus').textContent = `${cam.model || ''} ${live.power ? '· ' + live.power : ''}`;
}

// press and hold: pan/tilt, zoom and focus move while the button is held and stop on release
const spd = id => Math.max(1, Math.min(49, +$(id).value || 25));
function ptCmd(dx, dy) { const s = spd('#ptSpeed'); return `#PTS${pad2(50 + dx * s)}${pad2(50 + dy * s)}`; }
function liveMove(kind, cmd) {
  if (live.moving && live.moving.kind !== kind) liveStop();
  live.moving = { kind }; liveSend('ptz', cmd);
}
function liveStop() {
  const m = live.moving; live.moving = null; if (!m) return;
  liveSend('ptz', m.kind === 'PT' ? '#PTS5050' : `#${m.kind}50`);
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
    if (live.irisVal == null) { const r = await liveSend('ptz', '#I'); const m = /^i(\d{2})$/i.exec(r?.body || ''); live.irisVal = m ? +m[1] : 50; }
    live.irisVal = Math.max(1, Math.min(99, live.irisVal + 3 * +b.dataset.iris));
    $('#liveIris').textContent = pad2(live.irisVal);
    if ($('#liveAI').classList.contains('on')) { await liveSend('ptz', '#D30'); setToggle('#liveAI', false); }
    liveSend('ptz', '#I' + pad2(live.irisVal));
  };
  b.addEventListener('pointerdown', e => { e.preventDefault(); step(); timer = setInterval(step, 250); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => { clearInterval(timer); timer = null; }));
});

const toggleCmd = (sel, t, on, off, after) => $(sel).onclick = async () => { const isOn = $(sel).classList.contains('on'); const r = await liveSend(t, isOn ? off : on); if (r?.ok && !isErr(r.body)) setToggle(sel, !isOn); after && after(); };
toggleCmd('#liveAF', 'ptz', '#D11', '#D10');
toggleCmd('#liveAI', 'ptz', '#D31', '#D30');
toggleCmd('#liveNight', 'ptz', '#D61', '#D60');
toggleCmd('#liveTallyR', 'cam', 'TLR:1', 'TLR:0');
toggleCmd('#liveTallyG', 'cam', 'TLG:1', 'TLG:0');
$('#liveOPAF').onclick = () => liveSend('cam', 'OSE:69:1');
$('#liveAWB').onclick = async () => { const r = await liveSend('cam', 'OWS'); if (r?.ok) toast(isErr(r.body) ? `AWB not possible now (${r.body})` : 'Auto white balance started'); };
$('#liveABB').onclick = async () => { const r = await liveSend('cam', 'OAS'); if (r?.ok) toast(isErr(r.body) ? `ABB not possible now (${r.body})` : 'Auto black balance started'); };
$('#livePower').onclick = async () => {
  if (!live.cam) return;
  if (live.power !== 'standby') {
    if (!await ask({ title: `Put ${esc(live.cam.title || live.cam.ip)} in standby?`, body: '<p>The camera stops sending a picture until you switch it on again.</p>', ok: 'Standby', danger: true })) return;
    await liveSend('ptz', '#O0');
  } else await liveSend('ptz', '#O1');
  setTimeout(liveRead, 1500);
};

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
$('#presetStore').onchange = () => $('#presetGrid').classList.toggle('storing', $('#presetStore').checked);
function renderPresets() {
  const page = +$('#presetPage').value || 0; const grid = $('#presetGrid');
  grid.innerHTML = Array.from({ length: PRESETS_PER_PAGE }, (_, i) => page * PRESETS_PER_PAGE + i + 1).filter(n => n <= 100).map(n => `<button data-preset="${n}">${n}</button>`).join('');
  $$('button', grid).forEach(b => b.onclick = () => livePreset(+b.dataset.preset));
}
async function livePreset(n) {
  if (!live.cam) return;
  if ($('#presetStore').checked) {
    if (!await ask({ title: `Store preset ${n}?`, body: `<p>Preset ${n} of ${esc(live.cam.title || live.cam.ip)} is replaced by the current position.</p>`, ok: 'Store' })) return;
    const r = await liveSend('ptz', '#M' + pad2(n - 1));
    if (r?.ok && !isErr(r.body)) toast(`Preset ${n} stored`);
    $('#presetStore').checked = false; $('#presetGrid').classList.remove('storing');
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
renderCams(); renderRp(); renderParamTab(); renderExport(); renderImports(); renderShows(); renderScript(); renderEip(); updUndo();
checkBridge().then(() => loadSaveDir());
