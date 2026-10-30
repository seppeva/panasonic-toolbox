/* Panasonic Scene — interface of the local app
 * Talks to the cameras through the local Panasonic Scene server (app/panasonic_scene.py).
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
async function bridgeFetch(path, body, timeoutMs = 120000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const opts = { signal: ctl.signal, headers: { 'X-PS-Token': TOKEN } };
    if (body !== undefined) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await fetch(state.bridgeUrl.replace(/\/$/, '') + path, opts);
    if (r.status === 401 && !tokenReloaded) { tokenReloaded = true; location.reload(); } // app herstart: nieuwe sessiesleutel
    const j = await r.json().catch(() => ({ ok: false, error: 'Invalid response from the app' }));
    if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  } finally { clearTimeout(to); }
}
async function checkBridge() {
  const dot = $('#bridgeDot'), txt = $('#bridgeText');
  dot.className = 'dot'; txt.textContent = 'Connecting…';
  try {
    const j = await bridgeFetch('/api/info', undefined, 4000);
    state.bridgeOk = true; state.localIps = j.localIps || [];
    state.version = j.version;
    dot.className = 'dot ok'; txt.textContent = 'Connected'; txt.title = `Panasonic Scene ${j.version}`;
    $('#bridgeHelp').classList.add('hidden');
    if (!$('#scanRange').value && state.localIps.length) {
      const ip = state.localIps.find(i => i.startsWith('192.168.')) || state.localIps[0];
      $('#scanRange').value = ip.replace(/\.\d+$/, '.0/24');
    }
    log(`App ${j.version} ready. This computer's IP addresses: ${state.localIps.join(', ') || '-'}`);
    checkUpdate();
  } catch (e) {
    state.bridgeOk = false;
    dot.className = 'dot err'; txt.textContent = 'Not connected';
    $('#bridgeHelp').classList.remove('hidden');
  }
  return state.bridgeOk;
}
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
    generator: 'Panasonic Scene ' + (state.version || ''),
    created: new Date().toISOString(),
    camera: { ip: cam.ip, port: cam.port || 80, model: cam.model, title: cam.title || '', profile: prof.fam },
    scenes,
  };
}
function fileName(cam, scenes, suffix = '') {
  const d = new Date(); const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const name = (cam.title || cam.model || 'cam').replace(/[^\w.-]+/g, '_');
  const sc = scenes.length === 1 ? `scene${scenes[0].scene}` : 'scenes' + scenes.map(s => s.scene).join('');
  return `${name}_${cam.ip.replace(/\./g, '-')}_${sc}${suffix}_${ds}.pscene.json`;
}

/* ------------------------------------------------------------------ downloads + zip */
const IN_APP = TOKEN && !TOKEN.startsWith('__');
async function download(name, blobOrText, type = 'application/json') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  if (IN_APP) {
    // In the app: save to Downloads/Panasonic Scene via the local server (never overwrites)
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
  if (b.dataset.tab === 'params') { renderParamTab(); renderHttpTargets(); }
  $('.content').scrollTop = 0;
}));
$$('.subtabs button').forEach(b => b.addEventListener('click', () => {
  $$('.subtabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.subtab').forEach(t => t.classList.toggle('active', t.id === 'sub-' + b.dataset.sub));
  if (b.dataset.sub === 'http') { renderHttpTargets(); renderQuick(); renderCmds(); }
}));

state.livePath = store.get('livePath', '/live/index.html');
state.setupPath = store.get('setupPath', '/admin/index.html');
$('#bridgeSettingsBtn').onclick = () => {
  $('#setDelay').value = state.delayMs; $('#setSceneWait').value = state.sceneWait;
  $('#setUpdates').checked = store.get('updateCheck', true);
  $('#setLivePath').value = state.livePath; $('#setSetupPath').value = state.setupPath;
  $('#aboutText').textContent = `Panasonic Scene ${state.version || ''}. Running locally at ${location.host}. This computer's IP addresses: ${state.localIps.join(', ') || '–'}`;
  $('#settingsDlg').showModal();
};
$('#saveSettings').onclick = () => {
  state.delayMs = +$('#setDelay').value || 0; state.sceneWait = +$('#setSceneWait').value || 2000;
  state.livePath = $('#setLivePath').value.trim() || '/'; state.setupPath = $('#setSetupPath').value.trim() || '/';
  store.set('delayMs', state.delayMs); store.set('sceneWait', state.sceneWait);
  store.set('livePath', state.livePath); store.set('setupPath', state.setupPath);
  store.set('updateCheck', $('#setUpdates').checked);
};
$('#quitBtn').onclick = async () => {
  $('#settingsDlg').close();
  if (!await ask({ title: 'Quit Panasonic Scene?', body: '<p>The window closes and the cameras are no longer controlled from this computer.</p>', ok: 'Quit', danger: true })) return;
  try { await bridgeFetch('/api/quit', {}); } catch { }
  document.body.innerHTML = '<p style="padding:40px;font:15px system-ui;color:#aaa">Panasonic Scene has quit. You can close this window.</p>';
};
$('#retryBridge').onclick = checkBridge;
setInterval(() => { if (!document.hidden) bridgeFetch('/api/ping', undefined, 3000).then(() => { if (!state.bridgeOk) checkBridge(); }).catch(() => { if (state.bridgeOk) checkBridge(); }); }, 10000);

/* New version available? (latest GitHub release; skipped silently when offline) */
const REPO = 'seppeva/panasonicscene';
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
const saveCams = () => store.set('cameras', state.cameras.map(({ ip, port, model, title, selected }) => ({ ip, port, model, title, selected })));
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
      <td>${esc(c.model || '–')}</td><td>${esc(c.title || '')}</td>
      <td>${prof ? `<span class="pill ${prof.fam === 'GENERIC' ? 'info' : ''}">${esc(prof.fam)}</span> <span class="muted small">${paramsFor(c).length} settings</span>` : ''}</td>
      <td>${c.scene == null ? '–' : c.scene === 0 ? 'Off' : 'Scene ' + c.scene}</td>
      <td>${c.busy ? '<span class="pill busy">Busy</span>' : c.statusKind === 'ok' && c.power === 'standby' ? '<span class="pill busy">Standby</span>' : c.status ? `<span class="pill ${c.statusKind || ''}">${esc(c.status)}</span>` : ''}</td>
      <td class="nowrap"><button class="ghost small" data-act="live">Live view</button> <button class="ghost small" data-act="setup">Settings</button></td>
      <td class="end"><button class="icon" data-act="del" title="Remove from list" aria-label="Remove ${esc(c.ip)}">×</button></td>`;
    $('input', tr).onchange = e => { c.selected = e.target.checked; saveCams(); updateSel(); };
    $('[data-act=live]', tr).onclick = () => openCamPage(c, 'live');
    $('[data-act=setup]', tr).onclick = () => openCamPage(c, 'setup');
    $('[data-act=del]', tr).onclick = () => { state.cameras = state.cameras.filter(x => x !== c); saveCams(); renderCams(); };
    tb.appendChild(tr);
  }
  $('#camCount').textContent = state.cameras.length;
  $('#camEmpty').classList.toggle('hidden', state.cameras.length > 0);
  $('#selAll').checked = state.cameras.length && state.cameras.every(c => c.selected);
  updateSel();
}
function updateSel() {
  const n = state.cameras.filter(c => c.selected).length;
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
    for (const f of j.cameras) {
      const c = upsertCam(f.ip, f.port, { model: f.model, title: f.title || '' });
      if (f.auth) { c.status = 'Login required'; c.statusKind = 'err'; }
      c.power = f.power === 'p1' ? 'on' : f.power === 'p0' ? 'standby' : f.power;
    }
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
  const cams = ips.map(ip => upsertCam(ip, +$('#addPort').value || 80));
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
$('#clearCamsBtn').onclick = async () => { if (await ask({ title: 'Clear the camera list?', body: '<p>The cameras themselves are not changed.</p>', ok: 'Clear list' })) { state.cameras = []; saveCams(); renderCams(); } };

/* ------------------------------------------------------------------ export */
function renderExport() {
  const box = $('#expCams'); box.innerHTML = '';
  for (const c of state.cameras) {
    const l = document.createElement('label'); l.className = 'check camline';
    l.innerHTML = `<input type="checkbox" ${c.selected ? 'checked' : ''}><span class="mono">${esc(c.ip)}</span><span>${esc(c.title || c.model || '')}</span><span class="muted small">${c.scene ? 'Scene ' + c.scene + ' live' : ''}</span>`;
    $('input', l).onchange = e => { c.selected = e.target.checked; saveCams(); updateSel(); renderExportScenes(); };
    box.appendChild(l);
  }
  $('#expCamsEmpty').classList.toggle('hidden', state.cameras.length > 0);
  renderExportScenes(); updateSel();
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
    if ($('#expZip').checked) await download(`pscene_export_${files.length}cams_${new Date().toISOString().slice(0, 10)}.zip`, makeZip(files));
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

/* ------------------------------------------------------------------ import: sources and jobs */
state.sources = []; state.jobs = [];
let srcId = 0, jobId = 0;
function addImportFile(name, file) {
  if (!file || file.format !== FORMAT_ID || !Array.isArray(file.scenes)) throw new Error('Not a Panasonic Scene file');
  file.scenes.forEach((s, i) => {
    const src = { id: ++srcId, fileName: name, file, sceneIdx: i };
    state.sources.push(src);
    const target = state.cameras.find(c => c.ip === file.camera?.ip)?.ip || '';
    state.jobs.push({ id: ++jobId, srcId: src.id, target, targetScene: String(s.scene), include: true });
  });
  renderImports();
}
const srcById = id => state.sources.find(s => s.id === +id);
const srcLabel = s => `${s.file.camera?.title || s.file.camera?.model || s.fileName}, scene ${s.file.scenes[s.sceneIdx].scene}`;
async function handleFiles(list) {
  for (const f of list) {
    try {
      if (/\.zip$/i.test(f.name)) { for (const z of await readZip(await f.arrayBuffer())) addImportFile(z.name, JSON.parse(z.text)); }
      else addImportFile(f.name, JSON.parse(await f.text()));
      log(`Opened: ${f.name}`);
    } catch (e) { info(`Could not open ${esc(f.name)}`, esc(e.message)); log(`${f.name}: ${e.message}`, 'ERROR'); }
  }
}
$('#fileInput').onchange = e => { handleFiles([...e.target.files]); e.target.value = ''; };
const dz = $('#dropZone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); handleFiles([...e.dataTransfer.files]); });
$('#clearFilesBtn').onclick = () => { state.sources = []; state.jobs = []; renderImports(); };
$('#addJobBtn').onclick = () => {
  if (!state.sources.length) return info('Open a scene file first', 'Drop a .pscene.json or .zip file in step 1.');
  const last = state.jobs[state.jobs.length - 1];
  state.jobs.push({ id: ++jobId, srcId: last ? last.srcId : state.sources[0].id, target: '', targetScene: 'active', include: true });
  renderImports();
};

function renderImports() {
  // step 1: list of opened scenes
  $('#srcList').innerHTML = state.sources.length ? `<table class="tbl dense"><thead><tr><th>File</th><th>From camera</th><th>Scene</th><th>Settings</th><th></th></tr></thead><tbody>${state.sources.map(s => `<tr><td>${esc(s.fileName)}</td><td>${esc(s.file.camera?.title || '')} <span class="mono muted">${esc(s.file.camera?.ip || '')}</span> <span class="muted small">${esc(s.file.camera?.model || '')}</span></td><td>Scene ${esc(s.file.scenes[s.sceneIdx].scene)}</td><td>${s.file.scenes[s.sceneIdx].params.length}</td><td class="end"><button class="icon" data-src="${s.id}" aria-label="Remove">×</button></td></tr>`).join('')}</tbody></table>` : '';
  $$('#srcList [data-src]').forEach(b => b.onclick = () => { const id = +b.dataset.src; state.sources = state.sources.filter(s => s.id !== id); state.jobs = state.jobs.filter(j => j.srcId !== id); renderImports(); });
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
      <td><select data-k="targetScene"><option value="active" ${j.targetScene === 'active' ? 'selected' : ''}>Live scene${tcam?.scene ? ' (' + tcam.scene + ')' : ''}</option>${Array.from({ length: nsc }, (_, i) => `<option value="${i + 1}" ${j.targetScene === String(i + 1) ? 'selected' : ''}>Scene ${i + 1}</option>`).join('')}</select></td>
      <td>${src.file.scenes[src.sceneIdx].params.length}</td>
      <td class="end nowrap"><button class="ghost small" data-act="cmp" title="Compare with what is on the camera now">Compare</button> <button class="icon" data-act="del" aria-label="Remove">×</button></td>`;
    $('input', tr).onchange = e => j.include = e.target.checked;
    $$('select', tr).forEach(se => se.onchange = () => { j[se.dataset.k] = se.dataset.k === 'srcId' ? +se.value : se.value; if (se.dataset.k === 'target') renderImports(); });
    $('[data-act=del]', tr).onclick = () => { state.jobs = state.jobs.filter(x => x !== j); renderImports(); };
    $('[data-act=cmp]', tr).onclick = () => compareImport(j, tr);
    tb.appendChild(tr);
  }
  $('#impCount').textContent = state.jobs.length;
  $('#impEmpty').classList.toggle('hidden', state.jobs.length > 0);
}
async function compareImport(j, tr) {
  const cam = state.cameras.find(c => c.ip === j.target);
  if (!cam) return info('Choose a camera first', 'Pick the camera to compare with.');
  const src = srcById(j.srcId);
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

$('#importBtn').onclick = async () => {
  const jobs = state.jobs.filter(j => j.include);
  if (!jobs.length) return info('Nothing to import', 'Open a scene file and choose a camera for it in step 2.');
  const missing = jobs.filter(j => !state.cameras.some(c => c.ip === j.target));
  if (missing.length) return info('Choose a camera for every row', `${missing.length} row${missing.length > 1 ? 's have' : ' has'} no camera yet.`);
  if (!state.bridgeOk && !(await checkBridge())) return;
  const byCam = new Map();
  for (const j of jobs) { const c = state.cameras.find(x => x.ip === j.target); if (!byCam.has(c)) byCam.set(c, []); byCam.get(c).push(j); }
  const ok = await ask({
    title: 'Import into these cameras?',
    body: `<ul>${[...byCam].map(([c, js]) => `<li><b>${esc(c.title || c.model || c.ip)}</b> <span class="mono">${esc(c.ip)}</span>: ${js.map(j => `${esc(srcLabel(srcById(j.srcId)))} → ${j.targetScene === 'active' ? 'live scene' : 'scene ' + j.targetScene}`).join('; ')}</li>`).join('')}</ul>
      <p>The picture of these cameras changes immediately. If a destination scene is not the live scene, the camera switches to it while importing.</p>`,
    ok: 'Import', danger: true,
  });
  if (!ok) return;
  const opts = { backup: $('#optBackup').checked, restore: $('#optRestore').checked, store: $('#optStore').checked, verify: $('#optVerify').checked, force: $('#optForce').checked };
  $('#importBtn').disabled = true;
  $('#impResultCard').classList.remove('hidden');
  const out = $('#impResult'); out.innerHTML = '';
  const backups = [];
  await Promise.all([...byCam].map(async ([cam, js]) => {
    cam.busy = true; renderCams();
    for (const j of js) {
      const src = srcById(j.srcId);
      const row = document.createElement('div'); row.className = 'note'; out.appendChild(row);
      const setRow = (cls, html) => { row.className = 'note ' + cls; row.innerHTML = html; };
      try {
        const r = await importScene(cam, src.file.scenes[src.sceneIdx], j.targetScene, opts, msg => setRow('', `${esc(cam.ip)}: ${esc(msg)}`));
        if (r.backup) backups.push(r.backup);
        const bad = r.failed.length + r.mismatch.length;
        setRow(bad ? 'warn' : 'ok', `<b>${esc(cam.title || cam.model)}</b> <span class="mono">${esc(cam.ip)}</span><br>${esc(srcLabel(src))} into scene ${r.scene}: ${r.applied} settings applied` +
          (r.skipped.length ? `, ${r.skipped.length} skipped (not supported by ${esc(profileFor(cam.model).fam)})` : '') +
          (r.failed.length ? `<br>Not accepted by the camera: ${r.failed.map(f => esc(f.name) + ' (' + esc(f.err) + ')').join(', ')}` : '') +
          (r.mismatch.length ? `<br>Different after checking: ${r.mismatch.map(m => esc(m.name)).join(', ')}` : '') +
          (r.stored ? '<br>Stored in the scene file (UE160).' : ''));
        log(`${cam.ip}: imported into scene ${r.scene}: ${r.applied} applied, ${r.failed.length} refused, ${r.mismatch.length} different`);
      } catch (e) { setRow('err', `${esc(cam.ip)}: import failed. ${esc(e.message)}`); log(`${cam.ip}: import failed: ${e.message}`, 'ERROR'); }
    }
    cam.busy = false; try { await identify(cam); } catch { } renderCams();
  }));
  if (backups.length === 1) await download(backups[0].name, backups[0].text);
  else if (backups.length > 1) await download(`pscene_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`, makeZip(backups));
  $('#importBtn').disabled = false;
};

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
  let backup = null;
  if (opts.backup) {
    progress('backing up current settings…');
    const b = await readSceneFile(cam, target);
    const f = makeFile(cam, [b]);
    backup = { name: fileName(cam, [b], '_BACKUP'), text: JSON.stringify(f, null, 1) };
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
  return { scene: target, applied: list.length - failed.length, skipped, failed, mismatch, stored, backup };
}



/* ------------------------------------------------------------------ parameters: scene file contents */
const FAM_TEXT = { UE150: 'AW-UE150 / UE155 / HE145', UE150A: 'AW-UE150A', UE160: 'AW-UE160', UE100: 'AW-UE100', UE80: 'AW-UE80 / UE50 / UE40 / UE30', GENERIC: 'Other models' };
function renderParamTab() {
  const sel = $('#paramFam');
  if (!sel.options.length) sel.innerHTML = Object.keys(CATALOG).map(f => `<option value="${f}">${esc(FAM_TEXT[f] || f)}</option>`).join('');
  const fam = sel.value; const q = $('#paramFilter').value.trim().toLowerCase();
  const list = CATALOG[fam].filter(p => !q || (p.name + ' ' + p.cmd + ' ' + p.g).toLowerCase().includes(q));
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
$('#paramFam').onchange = renderParamTab; $('#paramFilter').oninput = renderParamTab;
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
  if (!$('#cmdModel').options.length) {
    const models = [...new Set(COMMANDS.flatMap(c => c.m.map(m => m.replace('*', ''))))].sort();
    $('#cmdModel').innerHTML = `<option value="">All models</option>` + models.map(m => `<option>${m}</option>`).join('');
  }
}
async function sendCmd(t, cmd, outEl) {
  const tg = httpTarget();
  if (!validIp(tg.ip)) return info('Invalid IP address', 'Choose a camera or fill in a valid IP address.');
  outEl.textContent = 'Sending…';
  try {
    const [r] = await batch({ ip: tg.ip, port: tg.port }, [{ type: t, cmd }]);
    outEl.textContent = r.ok ? `Response: ${r.body || '(empty)'}` : `No response: ${r.error || ''}`;
    log(`${tg.ip}: ${cmd} → ${r.ok ? r.body : r.error}`);
  } catch (e) { outEl.textContent = 'Failed: ' + e.message; }
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
const QUICK = [
  ['Lens', [
    ['Zoom in (tele)', 'ptz', '#Z75'], ['Zoom out (wide)', 'ptz', '#Z25'], ['Zoom stop', 'ptz', '#Z50'],
    ['Focus near', 'ptz', '#F25'], ['Focus far', 'ptz', '#F75'], ['Focus stop', 'ptz', '#F50'],
    ['Auto focus on', 'ptz', '#D11'], ['Manual focus', 'ptz', '#D10'], ['One-push auto focus', 'cam', 'OSE:69:1'],
    ['Auto iris on', 'ptz', '#D31'], ['Manual iris', 'ptz', '#D30'],
  ]],
  ['Pan and tilt', [
    ['Pan left', 'ptz', '#P25'], ['Pan right', 'ptz', '#P75'], ['Tilt up', 'ptz', '#T75'], ['Tilt down', 'ptz', '#T25'],
    ['Stop pan and tilt', 'ptz', '#PTS5050'], ['Home position', 'ptz', '#APC80008000'],
  ]],
  ['Presets', [
    ['Recall preset', 'ptz', w => '#R' + pad2(Math.max(1, Math.min(100, +$('input', w).value || 1)) - 1), 'preset'],
    ['Store preset', 'ptz', w => '#M' + pad2(Math.max(1, Math.min(100, +$('input', w).value || 1)) - 1), 'preset'],
  ]],
  ['Picture', [
    ['Scene 1', 'cam', 'XSF:1'], ['Scene 2', 'cam', 'XSF:2'], ['Scene 3', 'cam', 'XSF:3'], ['Scene 4', 'cam', 'XSF:4'],
    ['Auto white balance (AWB)', 'cam', 'OWS'], ['Auto black balance (ABB)', 'cam', 'OAS'],
    ['Color bars on', 'cam', 'DCB:1'], ['Color bars off', 'cam', 'DCB:0'],
  ]],
  ['Camera', [
    ['Power on', 'ptz', '#O1'], ['Standby', 'ptz', '#O0'],
    ['Red tally on', 'cam', 'TLR:1'], ['Red tally off', 'cam', 'TLR:0'], ['Green tally on', 'cam', 'TLG:1'], ['Green tally off', 'cam', 'TLG:0'],
  ]],
];
function renderQuick() {
  const box = $('#quickList'); if (box.dataset.built) { $$('.urlrow', box).forEach(r => r.update()); return; }
  box.dataset.built = 1;
  for (const [group, items] of QUICK) {
    const g = document.createElement('div'); g.className = 'qgroup';
    g.innerHTML = `<h3>${esc(group)}</h3>`;
    for (const [label, t, cmd, input] of items) {
      const line = document.createElement('div'); line.className = 'qline';
      const extra = `<span class="qlabel">${esc(label)}${input === 'preset' ? ' <input type="number" min="1" max="100" value="1" aria-label="Preset number" class="num">' : ''}</span>`;
      line.appendChild(urlRow(t, typeof cmd === 'function' ? cmd : () => cmd, extra));
      g.appendChild(line);
    }
    box.appendChild(g);
  }
}
['#httpCam', '#httpIp', '#httpPort'].forEach(s => $(s).addEventListener('input', () => { $('#httpIpWrap').classList.toggle('hidden', !!$('#httpCam').value); $$('.urlrow').forEach(r => r.update && r.update()); }));

function enumOpts(c) {
  const d = c.d, v = c.v;
  if (d.length !== v.length || d.length < 2 || d.length > 60) return null;
  if (d.some(x => x === '-' || !/^[0-9A-F]{1,5}h?$/i.test(x))) return null;
  return d.map((x, i) => ({ val: x.replace(/h$/i, ''), label: `${x.replace(/h$/i, '')}: ${v[i]}` }));
}
function valueHint(c) {
  if (!c.d || (c.d.length === 1 && (c.d[0] === '-' || c.d[0] === '※'))) return '';
  const d = c.d.join(' '), v = c.v.join(' ');
  return (d + (v ? '  →  ' + v : '')).slice(0, 220);
}
let cmdOpen = null;
function renderCmds() {
  const q = $('#cmdFilter').value.trim().toLowerCase(), m = $('#cmdModel').value;
  const words = q.split(/\s+/).filter(Boolean);
  const list = COMMANDS.filter(c => c.c && (!m || c.m.some(x => x.replace('*', '') === m)) && words.every(w => (c.n + ' ' + c.c + ' ' + (c.q || '')).toLowerCase().includes(w)));
  // most widely supported first (current models before legacy-only commands), then alphabetically
  list.sort((x, y) => (y.m.length - x.m.length) || x.n.localeCompare(y.n));
  $('#cmdCount').textContent = list.length;
  const shown = list.slice(0, 150);
  const tb = $('#cmdTable tbody'); tb.innerHTML = '';
  for (const c of shown) {
    const tr = document.createElement('tr'); tr.className = 'clickable';
    tr.innerHTML = `<td>${esc(c.n)}${c.rp ? ' <span class="pill info">controller</span>' : ''}</td><td class="mono">${esc(c.c)}</td><td class="small muted">${esc(c.m.join(', '))}</td>`;
    tr.onclick = () => toggleCmd(c, tr);
    tb.appendChild(tr);
    if (cmdOpen === c) toggleCmd(c, tr, true);
  }
  $('#cmdMore').textContent = list.length > shown.length ? `Showing the first ${shown.length} of ${list.length}. Search more specifically to narrow the list.` : '';
}
function toggleCmd(c, tr, force) {
  const ex = tr.nextElementSibling;
  if (ex?.classList.contains('cmd-detail')) { ex.remove(); if (!force) { cmdOpen = null; return; } }
  cmdOpen = c;
  const holders = c.c.match(/\[Data\d*\]/g) || [];
  const opts = holders.length === 1 ? enumOpts(c) : null;
  const inputs = holders.map((h, i) => opts
    ? `<label>${esc(h.replace(/[[\]]/g, ''))}<select data-i="${i}">${opts.map(o => `<option value="${esc(o.val)}">${esc(o.label)}</option>`).join('')}</select></label>`
    : `<label>${esc(h.replace(/[[\]]/g, ''))}<input data-i="${i}" class="mono" placeholder="value"></label>`).join('');
  const d = document.createElement('tr'); d.className = 'cmd-detail';
  d.innerHTML = `<td colspan="3"><div class="cmdbox">${valueHint(c) ? `<p class="hint mono">${esc(valueHint(c))}</p>` : ''}${c.rp ? '<p class="hint">Send this to the IP address of the RP150/RP120/RP60 controller, not to a camera.</p>' : ''}<div class="row wrap">${inputs}</div><div class="set"></div>${c.q ? '<p class="small muted">Query the current value:</p><div class="get"></div>' : ''}</div></td>`;
  const build = w => { let i = 0; return c.c.replace(/\[Data\d*\]/g, () => { const el = $(`[data-i="${i++}"]`, d); return (el?.value || '').trim(); }); };
  const setRow = urlRow(c.t, build);
  $('.set', d).appendChild(setRow);
  $$('[data-i]', d).forEach(el => el.addEventListener('input', () => setRow.update()));
  if (c.q) $('.get', d).appendChild(urlRow(c.t, () => c.q));
  tr.after(d);
}
$('#cmdFilter').addEventListener('input', () => { cmdOpen = null; renderCmds(); });
$('#cmdModel').addEventListener('change', () => { cmdOpen = null; renderCmds(); });

/* ------------------------------------------------------------------ RP150: assignment + Network.s15 */
const saveRp = () => store.set('rpRows', state.rp);
function renderRp() {
  const tb = $('#rpTable tbody'); tb.innerHTML = '';
  state.rp.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="number" min="1" max="200" value="${r.cam}" style="width:70px" aria-label="CAM number"></td><td><input value="${esc(r.ip)}" class="mono" style="width:150px" aria-label="IP address"></td><td><input type="number" value="${r.port || 80}" style="width:70px" aria-label="Port"></td><td>${esc(r.label || '')}</td><td class="end"><button class="icon" aria-label="Remove row">×</button></td>`;
    const [cam, ip, port] = $$('input', tr);
    cam.onchange = () => { r.cam = +cam.value; saveRp(); if (s15.a) analyzeS15(); };
    ip.onchange = () => { r.ip = ip.value.trim(); ip.classList.toggle('bad', !validIp(r.ip)); saveRp(); if (s15.a) analyzeS15(); };
    port.onchange = () => { r.port = +port.value || 80; saveRp(); };
    $('button', tr).onclick = () => { state.rp.splice(i, 1); saveRp(); renderRp(); if (s15.a) analyzeS15(); };
    tb.appendChild(tr);
  });
  $('#rpEmpty').classList.toggle('hidden', state.rp.length > 0);
}
$('#rpFromCams').onclick = () => {
  const cams = [...(state.cameras.some(c => c.selected) ? state.cameras.filter(c => c.selected) : state.cameras)];
  if (!cams.length) return info('No cameras found yet', 'Find the cameras on the Cameras page first.');
  const by = $('#rpSort').value;
  cams.sort((a, b) => by === 'title' ? String(a.title || '').localeCompare(String(b.title || ''), 'en', { numeric: true }) : ipNum(a.ip) - ipNum(b.ip));
  const start = +$('#rpStart').value || 1;
  state.rp = cams.map((c, i) => ({ cam: start + i, ip: c.ip, port: c.port || 80, label: [c.model, c.title].filter(Boolean).join(', ') }));
  saveRp(); renderRp(); if (s15.a) analyzeS15();
};
$('#rpAddRow').onclick = () => { const last = state.rp[state.rp.length - 1]; state.rp.push({ cam: last ? last.cam + 1 : 1, ip: last ? last.ip.replace(/\d+$/, n => +n + 1) : '192.168.0.11', port: 80 }); saveRp(); renderRp(); };

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
        L.typeRel = d.rel;
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
    <div class="scroll"><table class="tbl dense"><thead><tr><th>CAM</th><th>Offset</th><th>IP now</th><th>New IP</th></tr></thead><tbody>
    ${recs.slice(0, 200).map(r => `<tr class="${rp.has(r.cam) && rp.get(r.cam).ip !== r.ip ? 'diff' : ''}"><td>${r.cam}</td><td class="mono">${r.off}</td><td class="mono">${esc(r.ip)}</td><td class="mono">${esc(rp.get(r.cam)?.ip || '')}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row"><button id="s15Apply">Save new Network.s15</button></div>`;
  $('#s15Cam1').onchange = e => { L.cam1 = +e.target.value; analyzeS15(); };
  $('#s15Stride').onchange = e => { L.stride = +e.target.value; analyzeS15(); };
  if ($('#s15Changed')) $('#s15Changed').onchange = e => { s15.changedCam = +e.target.value || 1; analyzeS15(); };
  $('#s15Apply').onclick = async () => {
    if (!state.rp.length) return info('No assignment yet', 'Fill in the assignment table first (Take found cameras or Add row).');
    const copy = new Uint8Array(u8); const lanVal = $('input[name=lanVal]:checked')?.value;
    try {
      for (const r of state.rp) {
        if (!validIp(r.ip)) throw new Error(`Invalid IP address for CAM ${r.cam}`);
        const off = L.cam1 + (r.cam - 1) * L.stride;
        if (off < 0 || off + 4 > copy.length || (L.typeRel != null && (off + L.typeRel < 0 || off + L.typeRel >= copy.length))) throw new Error(`CAM ${r.cam} falls outside the file`);
        writeIpAt(copy, L, off, r.ip);
        if (lanVal != null && L.typeRel != null) copy[off + L.typeRel] = +lanVal;
      }
    } catch (e) { return info('Cannot save', esc(e.message)); }
    await download('Network_ORIGINAL_backup.s15', new Blob([u8]), 'application/octet-stream');
    await download('Network.s15', new Blob([copy]), 'application/octet-stream');
    log(`Network.s15 changed for ${state.rp.length} camera(s)${lanVal != null ? ', connection type included' : ' (IP addresses only)'}`);
    info('Network.s15 saved', `The new file and a backup of the original are in Downloads › Panasonic Scene. Copy the new file to the SD card as <code>Network.s15</code> and load it on the RP150 with DATA LOAD › YES+NW.` +
      (lanVal == null ? '<br><br>The connection type could not be set automatically. Set CNNCT MD to LAN on the controller for each CAM, or open a second version of the file as explained above.' : ''));
  };
}

/* ------------------------------------------------------------------ init */
renderCams(); renderRp(); renderParamTab(); renderExport(); renderImports();
checkBridge();
