/* Panasonic PTZ Scene Files — seppevanaken.be/panasonicscene
 * Praat via de lokale bridge (bridge/panasonic_scene_bridge.py) met de camera's.
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
const FAM_LABEL = { UE150: 'UE150 / UE155 / HE145', UE150A: 'UE150A', UE160: 'UE160', UE100: 'UE100', UE80: 'UE80 / UE50 / UE40 / UE30', GENERIC: 'Algemeen (andere modellen)' };

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
async function bridgeFetch(path, body, timeoutMs = 120000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const opts = { signal: ctl.signal };
    if (body !== undefined) { opts.method = 'POST'; opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    const r = await fetch(state.bridgeUrl.replace(/\/$/, '') + path, opts);
    const j = await r.json().catch(() => ({ ok: false, error: 'Ongeldig antwoord van bridge' }));
    if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  } finally { clearTimeout(to); }
}
async function checkBridge() {
  const dot = $('#bridgeDot'), txt = $('#bridgeText');
  dot.className = 'dot'; txt.textContent = 'Bridge: controleren…';
  try {
    const j = await bridgeFetch('/api/ping', undefined, 4000);
    state.bridgeOk = true; state.localIps = j.localIps || [];
    state.version = j.version;
    dot.className = 'dot ok'; txt.textContent = `Verbonden · v${j.version}`;
    $('#bridgeHelp').classList.add('hidden');
    if (!$('#scanRange').value && state.localIps.length) {
      const ip = state.localIps.find(i => i.startsWith('192.168.')) || state.localIps[0];
      $('#scanRange').value = ip.replace(/\.\d+$/, '.0/24');
    }
    log(`App v${j.version} OK, IP-adressen van deze laptop: ${state.localIps.join(', ') || '-'}`);
    checkUpdate();
  } catch (e) {
    state.bridgeOk = false;
    dot.className = 'dot err'; txt.textContent = 'Niet verbonden';
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
  if (r[0].status === 401) throw new Error('Login vereist (vul gebruiker/wachtwoord in)');
  if (!r[0].ok) throw new Error(r[0].error || 'geen antwoord');
  if (!/^OID:/i.test(r[0].body)) throw new Error('Geen Panasonic camera-antwoord: ' + r[0].body);
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
  log(`${cam.ip}: schakel naar scène ${n}`);
  const r = await batch(cam, [{ cmd: 'XSF:' + n }, { sleepMs: state.sceneWait }]);
  if (!r[0].ok || isErr(r[0].body)) throw new Error(`Scènewissel naar ${n} mislukt (${r[0].body || r[0].error})`);
}
function parseRead(p, res) {
  if (!res || !res.ok) return { err: res?.error || 'geen antwoord' };
  const b = (res.body || '').trim();
  if (isErr(b)) return { err: b.slice(0, 3).toUpperCase() };
  if (p.t === 'ptz') {
    const code = p.cmd.slice(1).toLowerCase();
    if (b.toLowerCase().startsWith(code)) return { raw: '#' + b.toUpperCase() };
  } else if (b.toUpperCase().startsWith(p.cmd + ':')) return { raw: b };
  return { err: 'onverwacht: ' + b.slice(0, 40) };
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
    generator: 'seppevanaken.be/panasonicscene',
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
function download(name, blobOrText, type = 'application/json') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
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
  if (eocd < 0) throw new Error('Geen geldig ZIP-bestand');
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

/* ------------------------------------------------------------------ UI: tabs + settings */
$$('.tabs button').forEach(b => b.addEventListener('click', () => {
  $$('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'export') renderExport();
  if (b.dataset.tab === 'import') renderImports();
}));
$('#bridgeSettingsBtn').onclick = () => {
  $('#setDelay').value = state.delayMs; $('#setSceneWait').value = state.sceneWait;
  $('#aboutText').textContent = `Panasonic Scene v${state.version || '?'} · draait lokaal op ${location.host}. Laptop-IP's: ${state.localIps.join(', ') || '–'}`;
  $('#settingsDlg').showModal();
};
$('#saveSettings').onclick = () => {
  state.delayMs = +$('#setDelay').value || 0; state.sceneWait = +$('#setSceneWait').value || 2000;
  store.set('delayMs', state.delayMs); store.set('sceneWait', state.sceneWait);
};
$('#quitBtn').onclick = async () => {
  if (!confirm('Panasonic Scene afsluiten?')) return;
  try { await bridgeFetch('/api/quit', {}); } catch { }
  document.body.innerHTML = '<p style="padding:40px;font:16px system-ui;color:#aaa">De app is afgesloten. Je mag dit venster sluiten.</p>';
};
$('#retryBridge').onclick = checkBridge;
setInterval(() => { if (!document.hidden) bridgeFetch('/api/ping', undefined, 3000).then(() => { if (!state.bridgeOk) checkBridge(); }).catch(() => { if (state.bridgeOk) checkBridge(); }); }, 10000);

/* Nieuwe versie beschikbaar? (laatste GitHub-release; stil overslaan als je offline bent) */
const REPO = 'seppeva/panasonicscene';
async function checkUpdate() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: 'no-store' }); if (!r.ok) return;
    const rel = await r.json(); const latest = String(rel.tag_name || '').replace(/^v/, '');
    const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
    if (latest && state.version && newer(latest, state.version)) {
      $('#updateText').innerHTML = `Nieuwe versie ${esc(latest)} beschikbaar (je hebt ${esc(state.version)}). <a href="https://seppevanaken.be/panasonicscene/" target="_blank" rel="noopener">Download de update</a>`;
      $('#updateBox').classList.remove('hidden');
    }
  } catch { /* offline op de set: geen probleem */ }
}

/* ------------------------------------------------------------------ UI: cameras */
const saveCams = () => store.set('cameras', state.cameras.map(({ ip, port, model, title, selected }) => ({ ip, port, model, title, selected })));
function renderCams() {
  const tb = $('#camTable tbody'); tb.innerHTML = '';
  for (const c of state.cameras) {
    const prof = c.model ? profileFor(c.model) : null;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox" ${c.selected ? 'checked' : ''}></td>
      <td class="mono">${esc(c.ip)}${c.port && c.port != 80 ? ':' + c.port : ''}</td>
      <td>${esc(c.model || '–')}</td><td>${esc(c.title || '')}</td>
      <td>${prof ? `<span class="pill ${prof.fam === 'GENERIC' ? 'info' : ''}">${esc(prof.fam)}</span> <span class="muted small">${paramsFor(c).length} par.</span>` : ''}</td>
      <td>${c.scene == null ? '–' : c.scene === 0 ? 'OFF' : 'Scene ' + c.scene}${c.power && c.power !== 'aan' ? ` <span class="pill busy">${esc(c.power)}</span>` : ''}</td>
      <td>${c.busy ? '<span class="pill busy">bezig…</span>' : c.status ? `<span class="pill ${c.statusKind || ''}">${esc(c.status)}</span>` : ''}</td>
      <td><button class="ghost small" data-act="del" title="Verwijder">✕</button></td>`;
    $('input', tr).onchange = e => { c.selected = e.target.checked; saveCams(); updateSel(); };
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
  $('#expSel').textContent = n ? `${n} camera${n > 1 ? "'s" : ''} geselecteerd` : 'Selecteer eerst camera\'s in tab 1';
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
  if (!range) return alert('Vul een IP-bereik in, bv. 192.168.0.0/24');
  $('#scanBtn').disabled = true; $('#scanStatus').textContent = 'Scannen…';
  try {
    const j = await bridgeFetch('/api/scan', { range, port: +$('#scanPort').value || 80, user: $('#authUser').value.trim(), pass: $('#authPass').value });
    for (const f of j.cameras) {
      const c = upsertCam(f.ip, f.port, { model: f.model, title: f.title || '' });
      if (f.auth) { c.status = 'login vereist'; c.statusKind = 'err'; }
      c.power = f.power === 'p1' ? 'aan' : f.power === 'p0' ? 'standby' : f.power;
    }
    $('#scanStatus').textContent = `${j.scanned} adressen gescand, ${j.cameras.length} camera('s) gevonden.`;
    log(`Scan ${range}: ${j.cameras.map(c => c.ip + ' ' + c.model).join(', ') || 'niets gevonden'}`);
    saveCams(); renderCams();
    await refreshAll(state.cameras.filter(c => j.cameras.some(f => f.ip === c.ip)));
  } catch (e) { $('#scanStatus').textContent = 'Fout: ' + e.message; log('Scan mislukt: ' + e.message, '✖'); }
  finally { $('#scanBtn').disabled = false; }
};
$('#addBtn').onclick = async () => {
  if (!state.bridgeOk && !(await checkBridge())) return;
  const ips = $('#addIp').value.split(/[\s,;]+/).filter(Boolean);
  const bad = ips.filter(i => !validIp(i)); if (bad.length) return alert('Ongeldig IP: ' + bad.join(', '));
  const cams = ips.map(ip => upsertCam(ip, +$('#addPort').value || 80));
  $('#addIp').value = ''; renderCams(); await refreshAll(cams);
};
async function refreshAll(cams) {
  await Promise.all(cams.map(async c => {
    c.busy = true; renderCams();
    try { await identify(c); c.status = 'ok'; c.statusKind = 'ok'; }
    catch (e) { c.status = e.message; c.statusKind = 'err'; log(`${c.ip}: ${e.message}`, '✖'); }
    c.busy = false; renderCams();
  }));
  saveCams(); renderCams();
}
$('#refreshBtn').onclick = async () => { if (state.bridgeOk || await checkBridge()) refreshAll(state.cameras); };
$('#clearCamsBtn').onclick = () => { if (confirm('Camera-lijst wissen?')) { state.cameras = []; saveCams(); renderCams(); } };

/* ------------------------------------------------------------------ UI: export */
function renderExport() {
  const sel = state.cameras.filter(c => c.selected);
  const max = Math.max(4, ...sel.map(c => c.model ? profileFor(c.model).scenes : 4));
  const box = $('#expScenes'); const prev = new Set($$('input', box).filter(i => i.checked).map(i => +i.value));
  box.innerHTML = Array.from({ length: max }, (_, i) => `<label><input type="checkbox" value="${i + 1}" ${prev.has(i + 1) ? 'checked' : ''}> ${i + 1}</label>`).join('');
  $$('input', box).forEach(i => i.onchange = () => { $('input[name=expMode][value=pick]').checked = true; expWarn(); });
  updateSel(); expWarn();
}
function expWarn() { $('#expWarn').classList.toggle('hidden', $('input[name=expMode]:checked').value !== 'pick'); }
$$('input[name=expMode]').forEach(r => r.onchange = expWarn);

$('#exportBtn').onclick = async () => {
  const cams = state.cameras.filter(c => c.selected);
  if (!cams.length) return alert("Selecteer eerst één of meer camera's in tab 1.");
  if (!state.bridgeOk && !(await checkBridge())) return;
  const mode = $('input[name=expMode]:checked').value;
  const picked = $$('#expScenes input:checked').map(i => +i.value);
  if (mode === 'pick' && !picked.length) return alert('Kies minstens één scène.');
  if (mode === 'pick' && !confirm("Camera's schakelen tijdens het uitlezen tussen scènes (beeld verandert). Doorgaan?")) return;
  $('#exportBtn').disabled = true;
  const card = $('#expResultCard'); card.classList.remove('hidden');
  const out = $('#expResult'); out.innerHTML = '<div class="progress"><i></i></div><div id="expRows"></div>';
  const files = [];
  let done = 0; const total = cams.length;
  await Promise.all(cams.map(async cam => {
    const row = document.createElement('div'); row.className = 'note'; row.textContent = `${cam.ip}: bezig…`; $('#expRows').appendChild(row);
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
          row.textContent = `${cam.ip}: scène ${n} uitlezen…`;
          scenes.push(await readSceneFile(cam, n));
        }
      } finally {
        if (orig && current !== orig) await switchScene(cam, orig);
      }
      const file = makeFile(cam, scenes);
      const name = fileName(cam, scenes);
      files.push({ name, text: JSON.stringify(file, null, 1), file });
      addImportFile(name, file);
      const cnt = scenes.map(s => `scène ${s.scene}: ${s.params.length} parameters${s.unavailable.length ? ` (${s.unavailable.length} niet beschikbaar)` : ''}`).join(' · ');
      row.className = 'note ok'; row.innerHTML = `✔ <b>${esc(cam.title || cam.model)}</b> ${esc(cam.ip)} — ${esc(cnt)} <button class="ghost small" data-dl>Download</button> <button class="ghost small" data-view>Bekijk</button>`;
      $('[data-dl]', row).onclick = () => download(name, JSON.stringify(file, null, 1));
      $('[data-view]', row).onclick = () => showSceneTable(row, file);
      log(`${cam.ip}: export ${cnt}`);
    } catch (e) {
      row.className = 'note err'; row.textContent = `✖ ${cam.ip}: ${e.message}`; log(`${cam.ip}: export mislukt: ${e.message}`, '✖');
    }
    cam.busy = false; renderCams();
    $('.progress > i', out).style.width = (++done / total * 100) + '%';
  }));
  if (files.length === 1) download(files[0].name, files[0].text);
  else if (files.length > 1) {
    if ($('#expZip').checked) download(`pscene_export_${files.length}cams_${new Date().toISOString().slice(0, 10)}.zip`, makeZip(files));
    else for (const f of files) { download(f.name, f.text); await sleep(350); }
  }
  $('#exportBtn').disabled = false;
};
function showSceneTable(anchor, file) {
  const ex = anchor.nextElementSibling; if (ex && ex.classList.contains('scene-view')) { ex.remove(); return; }
  const div = document.createElement('div'); div.className = 'scene-view';
  div.innerHTML = file.scenes.map(s => `<h3>Scene ${s.scene}</h3><table class="tbl dense"><thead><tr><th>Groep</th><th>Parameter</th><th>Waarde</th><th>Ruw</th></tr></thead><tbody>${s.params.map(p => `<tr><td class="grp">${esc(p.group)}</td><td>${esc(p.name)}</td><td>${esc(p.value)}</td><td class="mono">${esc(p.raw)}</td></tr>`).join('')}</tbody></table>${s.unavailable.length ? `<p class="muted small">Niet beschikbaar op deze camera/in deze modus: ${s.unavailable.map(u => esc(u.name) + ' (' + esc(u.reason) + ')').join(', ')}</p>` : ''}`).join('');
  anchor.after(div);
}

/* ------------------------------------------------------------------ UI: import */
let impId = 0;
function addImportFile(name, file) {
  if (!file || file.format !== FORMAT_ID || !Array.isArray(file.scenes)) throw new Error('Geen geldige scene file');
  file.scenes.forEach((s, i) => {
    const target = state.cameras.find(c => c.ip === file.camera?.ip)?.ip || '';
    state.imports.push({ id: ++impId, fileName: name, file, sceneIdx: i, include: true, target, targetScene: String(s.scene) });
  });
  renderImports();
}
async function handleFiles(list) {
  for (const f of list) {
    try {
      if (/\.zip$/i.test(f.name)) {
        for (const z of await readZip(await f.arrayBuffer())) addImportFile(z.name, JSON.parse(z.text));
      } else addImportFile(f.name, JSON.parse(await f.text()));
      log(`Geladen: ${f.name}`);
    } catch (e) { alert(`${f.name}: ${e.message}`); log(`${f.name}: ${e.message}`, '✖'); }
  }
}
$('#fileInput').onchange = e => { handleFiles([...e.target.files]); e.target.value = ''; };
const dz = $('#dropZone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); handleFiles([...e.dataTransfer.files]); });
$('#clearFilesBtn').onclick = () => { state.imports = []; renderImports(); };

function renderImports() {
  const tb = $('#impTable tbody'); tb.innerHTML = '';
  const camOpts = sel => `<option value="">— kies —</option><option value="*" ${sel === '*' ? 'selected' : ''}>★ alle geselecteerde camera's</option>` +
    state.cameras.map(c => `<option value="${esc(c.ip)}" ${sel === c.ip ? 'selected' : ''}>${esc(c.ip)} ${esc(c.title || c.model || '')}</option>`).join('');
  for (const it of state.imports) {
    const s = it.file.scenes[it.sceneIdx];
    const tcam = state.cameras.find(c => c.ip === it.target);
    const nsc = tcam?.model ? profileFor(tcam.model).scenes : Math.max(4, ...state.cameras.map(c => c.model ? profileFor(c.model).scenes : 4));
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox" ${it.include ? 'checked' : ''}></td>
      <td><div>${esc(it.file.camera?.title || it.file.camera?.model || '')} <span class="mono muted">${esc(it.file.camera?.ip || '')}</span></div><div class="muted small">${esc(it.fileName)}</div></td>
      <td>Scene ${esc(s.scene)} <span class="muted small">${esc(it.file.camera?.profile || '')}</span></td>
      <td><select data-k="target">${camOpts(it.target)}</select></td>
      <td><select data-k="targetScene"><option value="active" ${it.targetScene === 'active' ? 'selected' : ''}>actieve scène</option>${Array.from({ length: nsc }, (_, i) => `<option value="${i + 1}" ${it.targetScene === String(i + 1) ? 'selected' : ''}>Scene ${i + 1}</option>`).join('')}</select></td>
      <td>${s.params.length}</td>
      <td class="row"><button class="ghost small" data-act="cmp" title="Vergelijk met de doelcamera">Vergelijk</button><button class="ghost small" data-act="del">✕</button></td>`;
    $('input', tr).onchange = e => it.include = e.target.checked;
    $$('select', tr).forEach(se => se.onchange = () => { it[se.dataset.k] = se.value; if (se.dataset.k === 'target') renderImports(); });
    $('[data-act=del]', tr).onclick = () => { state.imports = state.imports.filter(x => x !== it); renderImports(); };
    $('[data-act=cmp]', tr).onclick = () => compareImport(it, tr);
    tb.appendChild(tr);
  }
  $('#impCount').textContent = state.imports.length;
  $('#impEmpty').classList.toggle('hidden', state.imports.length > 0);
}
function targetsOf(it) {
  if (it.target === '*') return state.cameras.filter(c => c.selected);
  const c = state.cameras.find(x => x.ip === it.target); return c ? [c] : [];
}
async function compareImport(it, tr) {
  const cams = targetsOf(it); if (!cams.length) return alert('Kies eerst een doelcamera.');
  const cam = cams[0];
  try {
    if (!cam.model) await identify(cam);
    const cur = await getScene(cam);
    const ts = it.targetScene === 'active' ? cur : +it.targetScene;
    if (ts !== cur) return alert(`Vergelijken kan enkel met de actieve scène (camera staat op scène ${cur}). Zet de doelscène op “actieve scène” of schakel de camera eerst om.`);
    const s = it.file.scenes[it.sceneIdx];
    const params = s.params.map(x => paramIndex.get(x.cmd)).filter(Boolean);
    const now = new Map((await readParams(cam, params)).map(r => [r.p.cmd, r]));
    let diff = 0;
    const rows = s.params.map(x => { const n = now.get(x.cmd); const same = n?.raw && n.raw.toUpperCase() === x.raw.toUpperCase(); if (!same) diff++; return `<tr class="${same ? '' : 'diff'}"><td class="grp">${esc(x.group)}</td><td>${esc(x.name)}</td><td>${esc(x.value)} <span class="mono muted">${esc(dataPart(x.cmd, x.raw))}</span></td><td>${n?.raw ? esc(decode(paramIndex.get(x.cmd), n.raw)) + ' <span class="mono muted">' + esc(dataPart(x.cmd, n.raw)) + '</span>' : '<span class="muted">' + esc(n?.err || '–') + '</span>'}</td></tr>`; });
    const ex = tr.nextElementSibling; if (ex?.classList.contains('cmp-row')) ex.remove();
    const r = document.createElement('tr'); r.className = 'cmp-row';
    r.innerHTML = `<td colspan="7"><p><b>${diff}</b> van ${s.params.length} parameters verschillen met ${esc(cam.ip)} (scène ${cur}). <button class="ghost small">Sluit</button></p><table class="tbl dense"><thead><tr><th>Groep</th><th>Parameter</th><th>In bestand</th><th>Nu in camera</th></tr></thead><tbody>${rows.join('')}</tbody></table></td>`;
    $('button', r).onclick = () => r.remove();
    tr.after(r);
  } catch (e) { alert(e.message); }
}

$('#importBtn').onclick = async () => {
  const jobs = [];
  for (const it of state.imports.filter(x => x.include)) for (const cam of targetsOf(it)) jobs.push({ it, cam });
  if (!jobs.length) return alert('Niets te importeren: vink scènes aan en kies een doelcamera.');
  if (!state.bridgeOk && !(await checkBridge())) return;
  // per camera sequentieel, camera's parallel
  const byCam = new Map(); for (const j of jobs) { if (!byCam.has(j.cam)) byCam.set(j.cam, []); byCam.get(j.cam).push(j); }
  const summary = [...byCam].map(([c, js]) => `${c.ip}: ${js.map(j => 'scene ' + j.it.file.scenes[j.it.sceneIdx].scene + ' → ' + (j.it.targetScene === 'active' ? 'actief' : 'scene ' + j.it.targetScene)).join(', ')}`).join('\n');
  if (!confirm(`Importeren naar:\n${summary}\n\nHet beeld van deze camera's verandert. Doorgaan?`)) return;
  const opts = { backup: $('#optBackup').checked, restore: $('#optRestore').checked, store: $('#optStore').checked, verify: $('#optVerify').checked, force: $('#optForce').checked };
  $('#importBtn').disabled = true;
  const card = $('#impResultCard'); card.classList.remove('hidden');
  const out = $('#impResult'); out.innerHTML = '';
  const backups = [];
  await Promise.all([...byCam].map(async ([cam, js]) => {
    cam.busy = true; renderCams();
    for (const { it } of js) {
      const row = document.createElement('div'); row.className = 'note'; out.appendChild(row);
      const setRow = (cls, html) => { row.className = 'note ' + cls; row.innerHTML = html; };
      try {
        const r = await importScene(cam, it.file.scenes[it.sceneIdx], it.targetScene, opts, msg => setRow('', `${esc(cam.ip)}: ${esc(msg)}`));
        if (r.backup) backups.push(r.backup);
        const bad = r.failed.length + r.mismatch.length;
        setRow(bad ? 'warn' : 'ok', `${bad ? '⚠' : '✔'} <b>${esc(cam.title || cam.model)}</b> ${esc(cam.ip)} — scene ${r.scene}: ${r.applied} parameters gezet` +
          (r.skipped.length ? `, ${r.skipped.length} overgeslagen (niet in profiel ${esc(profileFor(cam.model).fam)})` : '') +
          (r.failed.length ? `<br>Niet aanvaard door camera: ${r.failed.map(f => esc(f.name) + ' (' + esc(f.err) + ')').join(', ')}` : '') +
          (r.mismatch.length ? `<br>Wijkt af na controle: ${r.mismatch.map(m => esc(m.name)).join(', ')}` : '') +
          (r.stored ? '<br>Opgeslagen in scene file (UE160).' : ''));
        log(`${cam.ip}: import scene ${r.scene} — ${r.applied} gezet, ${r.failed.length} fout, ${r.mismatch.length} afwijkend`);
      } catch (e) { setRow('err', `✖ ${esc(cam.ip)}: ${esc(e.message)}`); log(`${cam.ip}: import mislukt: ${e.message}`, '✖'); }
    }
    cam.busy = false; try { await identify(cam); } catch { } renderCams();
  }));
  if (backups.length === 1) download(backups[0].name, backups[0].text);
  else if (backups.length > 1) download(`pscene_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`, makeZip(backups));
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
  if (!target) throw new Error('Kan de actieve scène niet bepalen');
  if (target > prof.scenes) throw new Error(`Camera heeft geen scène ${target}`);
  if (target !== orig) { progress(`schakel naar scène ${target}…`); await switchScene(cam, target); }
  let backup = null;
  if (opts.backup) {
    progress('back-up van huidige instellingen…');
    const b = await readSceneFile(cam, target);
    const f = makeFile(cam, [b]);
    backup = { name: fileName(cam, [b], '_BACKUP'), text: JSON.stringify(f, null, 1) };
  }
  const send = async (items, label) => {
    progress(label);
    const res = await batch(cam, items.map(x => ({ type: x.cmd.startsWith('#') ? 'ptz' : 'cam', cmd: x.send })));
    return items.map((x, i) => ({ x, res: res[i], ok: res[i]?.ok && !isErr(res[i].body) }));
  };
  // Pass 1: alles in volgorde (modi staan vooraan in de lijst)
  let pending = list.map(x => ({ ...x, send: x.raw }));
  let r = await send(pending, `${pending.length} parameters zetten…`);
  // Pass 2: wat faalde nog eens (bv. waarde die pas geldig is na een modus verderop)
  pending = r.filter(z => !z.ok).map(z => z.x);
  if (pending.length) { r = await send(pending, `${pending.length} parameters opnieuw…`); pending = r.filter(z => !z.ok).map(z => ({ ...z.x, lastErr: z.res?.body || z.res?.error })); }
  // Pass 3: commando's met meerdere velden (bv. OSI:20:kleurtemp:status) -> enkel eerste veld
  const multi = pending.filter(x => !x.cmd.startsWith('#') && dataPart(x.cmd, x.raw).includes(':'));
  if (multi.length) {
    r = await send(multi.map(x => ({ ...x, send: x.cmd + ':' + dataPart(x.cmd, x.raw).split(':')[0] })), 'velden vereenvoudigen…');
    const fixed = new Set(r.filter(z => z.ok).map(z => z.x.cmd));
    pending = pending.filter(x => !fixed.has(x.cmd));
  }
  const failed = pending.map(x => ({ cmd: x.cmd, name: x.name, err: String(x.lastErr || '').slice(0, 3) || 'fout' }));
  let stored = false;
  if (opts.store && prof.fam === 'UE160') {
    progress('opslaan in scene file…');
    const [s] = await batch(cam, [{ cmd: 'OSL:90:' + target }, { sleepMs: 500 }]);
    stored = s.ok && !isErr(s.body);
  }
  let mismatch = [];
  if (opts.verify) {
    progress('controleren…');
    const okList = list.filter(x => !failed.some(f => f.cmd === x.cmd));
    const back = await readParams(cam, okList.map(x => x.p));
    mismatch = back.map((b, i) => ({ b, x: okList[i] })).filter(({ b, x }) => b.raw && b.raw.toUpperCase() !== x.raw.toUpperCase()).map(({ x }) => ({ cmd: x.cmd, name: x.name }));
  }
  if (opts.restore && target !== orig && orig) { progress(`terug naar scène ${orig}…`); await switchScene(cam, orig); }
  return { scene: target, applied: list.length - failed.length, skipped, failed, mismatch, stored, backup };
}

/* ------------------------------------------------------------------ UI: parameter list */
function renderParamTab() {
  const sel = $('#paramFam');
  if (!sel.options.length) sel.innerHTML = Object.keys(CATALOG).map(f => `<option value="${f}">${esc(FAM_LABEL[f] || f)}</option>`).join('');
  const fam = sel.value; const q = $('#paramFilter').value.trim().toLowerCase();
  const list = CATALOG[fam].filter(p => !q || (p.name + ' ' + p.cmd + ' ' + p.g).toLowerCase().includes(q));
  $('#paramInfo').textContent = `${CATALOG[fam].length} parameters horen bij een scène voor ${FAM_LABEL[fam] || fam}. Bron: de lijst “commands belonging to the scene” uit de Panasonic interface-specificatie van dit model.` + (fam === 'GENERIC' ? ' Voor andere modellen worden alle bekende scène-commando’s geprobeerd; wat de camera niet kent wordt overgeslagen.' : '');
  $('#paramTable tbody').innerHTML = list.map(p => `<tr><td class="grp">${esc(p.g)}</td><td>${esc(p.name)}</td><td class="mono">${esc(p.t === 'ptz' ? p.cmd + '[Data]' : p.cmd + ':[Data]')}</td><td class="mono">${esc(p.q)}</td><td class="small muted">${esc(rangeText(p))}</td></tr>`).join('');
}
function rangeText(p) {
  const parts = [];
  if (p.dec?.kind === 'lin') parts.push(`${p.dec.lo.toString(16).toUpperCase()}h…${p.dec.hi.toString(16).toUpperCase()}h = ${p.dec.vlo}…${p.dec.vhi}${p.dec.unit || ''}`);
  if (p.dec?.kind === 'enum') parts.push(Object.entries(p.dec.map).map(([k, v]) => `${k}=${v}`).join(', '));
  if (p.sup) parts.push(p.sup);
  return parts.join(' · ');
}
$('#paramFam').onchange = renderParamTab; $('#paramFilter').oninput = renderParamTab;
$('#paramCsv').onclick = () => {
  const fam = $('#paramFam').value;
  const csv = ['Groep;Parameter;Zet-commando;Opvraag-commando;Bereik'].concat(CATALOG[fam].map(p => [p.g, p.name, p.cmd, p.q, rangeText(p)].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))).join('\r\n');
  download(`panasonic_scene_parameters_${fam}.csv`, '\ufeff' + csv, 'text/csv');
};

/* ------------------------------------------------------------------ UI: RP150 */
const saveRp = () => store.set('rpRows', state.rp);
function renderRp() {
  const tb = $('#rpTable tbody'); tb.innerHTML = '';
  state.rp.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="number" min="1" max="200" value="${r.cam}" style="width:70px"></td><td><input value="${esc(r.ip)}" class="mono" style="width:150px"></td><td><input type="number" value="${r.port || 80}" style="width:70px"></td><td>${esc(r.label || '')}</td><td><button class="ghost small">✕</button></td>`;
    const [cam, ip, port] = $$('input', tr);
    cam.onchange = () => { r.cam = +cam.value; saveRp(); };
    ip.onchange = () => { r.ip = ip.value.trim(); ip.style.borderColor = validIp(r.ip) ? '' : 'var(--err)'; saveRp(); };
    port.onchange = () => { r.port = +port.value || 80; saveRp(); };
    $('button', tr).onclick = () => { state.rp.splice(i, 1); saveRp(); renderRp(); };
    tb.appendChild(tr);
  });
  $('#rpEmpty').classList.toggle('hidden', state.rp.length > 0);
}
$('#rpFromCams').onclick = () => {
  const cams = [...(state.cameras.some(c => c.selected) ? state.cameras.filter(c => c.selected) : state.cameras)];
  if (!cams.length) return alert("Geen camera's gevonden. Scan eerst in tab 1.");
  const by = $('#rpSort').value;
  cams.sort((a, b) => by === 'title' ? String(a.title || '').localeCompare(String(b.title || ''), 'nl', { numeric: true }) : ipNum(a.ip) - ipNum(b.ip));
  const start = +$('#rpStart').value || 1;
  state.rp = cams.map((c, i) => ({ cam: start + i, ip: c.ip, port: c.port || 80, label: [c.model, c.title].filter(Boolean).join(' · ') }));
  saveRp(); renderRp();
};
$('#rpAddRow').onclick = () => { const last = state.rp[state.rp.length - 1]; state.rp.push({ cam: last ? last.cam + 1 : 1, ip: last ? last.ip.replace(/\d+$/, n => +n + 1) : '192.168.0.11', port: 80 }); saveRp(); renderRp(); };
$('#rpChecklistBtn').onclick = () => {
  const rows = [...state.rp].sort((a, b) => a.cam - b.cam);
  if (!rows.length) return alert('Voeg eerst toewijzingen toe.');
  const dupe = rows.find((r, i) => rows.findIndex(x => x.cam === r.cam) !== i); if (dupe) return alert(`CAM ${dupe.cam} komt dubbel voor.`);
  const k = s => `<span class="kbd">${s}</span>`;
  $('#rpChecklist').innerHTML = `
    <div class="cam"><h4>Vooraf (één keer)</h4><ol>
      <li>RP150 in dezelfde range zetten: ${k('SYSTEM')} › RP IP SET (bv. 192.168.0.9 / 255.255.255.0), daarna UPLOAD.</li>
      <li>Zorg dat elke camera een initieel account heeft en, als “User Auth” aan staat, dezelfde login in ${k('SYSTEM')} › MANUAL IP SET › USER AUTH.</li>
    </ol></div>` + rows.map(r => `
    <div class="cam"><h4>CAM ${r.cam} → ${esc(r.ip)}${r.label ? ` <span class="muted small">${esc(r.label)}</span>` : ''}</h4><ol>
      <li>${k('SYSTEM')} › CONNECT SETTING › CAM SEL = <b>${r.cam}</b> › CNNCT MD = <b>LAN</b></li>
      <li>${k('SYSTEM')} › MANUAL IP SET › CAM SEL = <b>${r.cam}</b> › CAM IP = <b>${esc(r.ip)}</b> › PORT = <b>${r.port || 80}</b> › <b>UPLOAD</b></li>
      <li>Druk ${k('CAM ' + r.cam)} en controleer dat de camera reageert (tally/status).</li>
    </ol></div>`).join('');
};
$('#rpPrintBtn').onclick = () => { if (!$('#rpChecklist').innerHTML) $('#rpChecklistBtn').click(); window.print(); };

/* ---- Network.s15 (experimenteel): heuristische analyse ---- */
const s15 = { a: null, b: null, name: '', layout: null };
$('#s15Input').onchange = async e => { const f = e.target.files[0]; if (!f) return; s15.a = new Uint8Array(await f.arrayBuffer()); s15.name = f.name; s15.b = null; analyzeS15(); e.target.value = ''; };
$('#s15Input2').onchange = async e => { const f = e.target.files[0]; if (!f) return; if (!s15.a) return alert('Laad eerst het eerste Network.s15-bestand.'); s15.b = new Uint8Array(await f.arrayBuffer()); analyzeS15(); e.target.value = ''; };
const privIp = (a, b) => a === 192 && b === 168 || a === 10 || a === 172 && b >= 16 && b <= 31;
function findLayout(u8) {
  const cands = [];
  // binair, big- of little-endian
  for (const le of [false, true]) {
    const hits = [];
    for (let i = 0; i + 4 <= u8.length; i++) {
      const a = le ? u8[i + 3] : u8[i], b = le ? u8[i + 2] : u8[i + 1];
      if (privIp(a, b)) hits.push(i);
    }
    cands.push({ kind: le ? 'bin-le' : 'bin-be', hits });
  }
  // ASCII (bv. "192.168.000.010" of "192.168.0.10")
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
    // langste reeks met die stride
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
    if (padded.length > L.fixedLen) throw new Error(`IP ${ip} past niet in het tekstveld (${L.fixedLen} tekens)`);
    const s = padded.padEnd(L.fixedLen, old.length > padded.length && /\0/.test(old) ? '\0' : ' ');
    for (let i = 0; i < L.fixedLen; i++) u8[off + i] = s.charCodeAt(i);
  }
}
function analyzeS15() {
  const out = $('#s15Out'); const u8 = s15.a;
  const L = s15.layout && s15.layout.src === u8 ? s15.layout : findLayout(u8); if (L) L.src = u8; s15.layout = L;
  if (!L) { out.innerHTML = `<div class="note err">Geen herkenbare tabel met IP-adressen gevonden in ${esc(s15.name)} (${u8.length} bytes). Stuur dit bestand gerust door, dan kan het formaat exact ingebouwd worden.</div>${hexDump(u8, 0, 256)}`; return; }
  // record-index van het eerste gevonden IP = CAM 1 (aanpasbaar)
  L.cam1 = L.cam1 ?? L.first;
  const recs = [];
  for (let k = 0; ; k++) { const off = L.cam1 + k * L.stride; const ip = readIpAt(u8, L, off); if (ip == null) break; recs.push({ cam: k + 1, off, ip }); if (k > 260) break; }
  let typeInfo = '';
  if (s15.b) {
    if (s15.b.length !== u8.length) typeInfo = `<div class="note warn">Tweede bestand heeft een andere grootte (${s15.b.length} vs ${u8.length}); vergelijken niet mogelijk.</div>`;
    else {
      const diffs = []; for (let i = 0; i < u8.length; i++) if (u8[i] !== s15.b[i]) diffs.push(i);
      const ipLen = L.kind === 'ascii' ? L.fixedLen : 4;
      const changedCam = s15.changedCam || 1;
      const camOff = L.cam1 + (changedCam - 1) * L.stride;
      const rel = diffs.map(i => ({ i, rel: i - camOff, a: u8[i], b: s15.b[i] }));
      const single = rel.filter(d => Math.abs(d.rel) < L.stride && (d.rel < 0 || d.rel >= ipLen));
      typeInfo = `<div class="row"><label class="w180">In de 2e versie veranderde ik CAM <input id="s15Changed" type="number" min="1" max="200" value="${changedCam}"></label></div>
        <div class="note ${diffs.length ? 'ok' : 'warn'}">${diffs.length} verschillende byte(s): ${rel.slice(0, 12).map(d => `offset ${d.i} (t.o.v. IP van CAM ${changedCam}: ${d.rel >= 0 ? '+' : ''}${d.rel}): ${d.a} → ${d.b}`).join('; ') || 'geen'}${diffs.length > 12 ? '…' : ''}</div>`;
      if (single.length === 1 || (single.length > 1 && new Set(single.map(d => d.rel)).size === 1)) {
        const d = single[0];
        L.typeRel = d.rel; L.typeVals = { before: d.a, after: d.b };
        typeInfo += `<div class="note ok">Verbindingstype herkend op positie ${d.rel >= 0 ? '+' : ''}${d.rel} t.o.v. het IP-veld van elk record. Waarde vóór: <b>${d.a}</b>, na: <b>${d.b}</b>. Kies hieronder welke waarde “LAN/Network” betekent.</div>
          <label class="check"><input type="radio" name="lanVal" value="${d.b}" checked> ${d.b} = LAN (tweede bestand had LAN)</label>
          <label class="check"><input type="radio" name="lanVal" value="${d.a}"> ${d.a} = LAN (eerste bestand had LAN)</label>`;
      }
    }
  }
  const rp = new Map(state.rp.map(r => [r.cam, r]));
  out.innerHTML = `<div class="note ok">Herkend: ${esc(L.kind)}-IP's, recordlengte ${L.stride} bytes, ${L.run} opeenvolgende records gevonden. Controleer of CAM 1 hieronder klopt met je paneel.</div>
    <div class="row wrap"><label class="w180">Record-offset CAM 1 <input id="s15Cam1" type="number" value="${L.cam1}" step="${L.stride}"></label><label class="w180">Recordlengte <input id="s15Stride" type="number" value="${L.stride}"></label></div>
    ${typeInfo}
    <div class="scroll"><table class="tbl dense"><thead><tr><th>CAM</th><th>Offset</th><th>IP nu</th><th>Nieuw (uit toewijzing)</th></tr></thead><tbody>
    ${recs.slice(0, 200).map(r => `<tr class="${rp.has(r.cam) && rp.get(r.cam).ip !== r.ip ? 'diff' : ''}"><td>${r.cam}</td><td class="mono">${r.off}</td><td class="mono">${esc(r.ip)}</td><td class="mono">${esc(rp.get(r.cam)?.ip || '')}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row"><button id="s15Apply">Toewijzing toepassen &amp; downloaden</button><button class="ghost" id="s15Orig">Origineel (back-up) downloaden</button></div>
    <p class="muted small">Let op: het formaat van Network.s15 is niet publiek. Als de RP150 het bestand weigert (bv. door een checksum) verandert er niets; gebruik dan het stappenplan. Laad altijd met <b>DATA LOAD › YES+NW</b> om de netwerkinstellingen mee te nemen.</p>`;
  $('#s15Cam1').onchange = e => { L.cam1 = +e.target.value; analyzeS15(); };
  if ($('#s15Changed')) $('#s15Changed').onchange = e => { s15.changedCam = +e.target.value || 1; analyzeS15(); };
  $('#s15Stride').onchange = e => { L.stride = +e.target.value; analyzeS15(); };
  $('#s15Orig').onclick = () => download('Network_ORIGINEEL.s15', new Blob([u8]), 'application/octet-stream');
  $('#s15Apply').onclick = () => {
    if (!state.rp.length) return alert('Maak eerst een toewijzing (bovenaan deze tab).');
    const copy = new Uint8Array(u8); const lanVal = $('input[name=lanVal]:checked')?.value;
    try {
      for (const r of state.rp) {
        if (!validIp(r.ip)) throw new Error(`Ongeldig IP voor CAM ${r.cam}`);
        const off = L.cam1 + (r.cam - 1) * L.stride;
        if (off < 0 || off + 4 > copy.length || (L.typeRel != null && (off + L.typeRel < 0 || off + L.typeRel >= copy.length))) throw new Error(`CAM ${r.cam} valt buiten het bestand`);
        writeIpAt(copy, L, off, r.ip);
        if (lanVal != null && L.typeRel != null) copy[off + L.typeRel] = +lanVal;
      }
    } catch (e) { return alert(e.message); }
    download('Network.s15', new Blob([copy]), 'application/octet-stream');
    log(`Network.s15 aangepast voor ${state.rp.length} camera('s)${lanVal != null ? ' incl. verbindingstype' : ' (enkel IP; verbindingstype niet herkend)'}`);
    if (lanVal == null) alert('IP-adressen zijn aangepast. Het verbindingstype (LAN) kon niet herkend worden: zet CNNCT MD op het paneel op LAN, of laad een tweede versie van Network.s15 waarin je bij één camera het type veranderde.');
  };
}
function hexDump(u8, start, len) {
  let s = ''; for (let o = start; o < Math.min(u8.length, start + len); o += 16) { const row = u8.subarray(o, o + 16); s += o.toString(16).padStart(6, '0') + '  ' + [...row].map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(48) + '  ' + [...row].map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('') + '\n'; }
  return `<pre class="hex">${esc(s)}</pre>`;
}

/* ------------------------------------------------------------------ init */
renderCams(); renderRp(); renderParamTab(); renderExport();
checkBridge();
