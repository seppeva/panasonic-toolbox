// Click through the Panasonic Toolbox interface with REAL cameras (Playwright, headless).
//
// 1. Start the app without a window, with its own empty data folder (see TESTING.md), e.g. on a Mac:
//      HOME=$(mktemp -d) python3 app/panasonic_scene.py --headless
// 2. Run:
//      CAMS=10.0.100.1,10.0.100.2 node tools/ui_real_test.js
//    Optional: PORT=80 CAM_USER=admin CAM_PASS=12345 APP_URL=http://127.0.0.1:8765/ OUT=folder
//
// Every step is logged as OK/FAIL with what the page showed; screenshots of every tab go to OUT.
// The cameras are changed (scenes, imports, white, tally, power) and put back by undo and the backups.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CAMS = (process.env.CAMS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!CAMS.length) { console.error('Set CAMS=ip1,ip2'); process.exit(2); }
const PORT = process.env.PORT || '80';
const APP = process.env.APP_URL || 'http://127.0.0.1:8765/';
const OUT = process.env.OUT || path.join(__dirname, 'test-output', 'ui-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [], logs = [];
  p.on('pageerror', e => errs.push('PAGE ERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/api\.github|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  const shot = n => p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const dlg = () => p.evaluate(() => document.querySelector('dialog[open]')?.innerText || '');
  const ok = async (ms = 400) => { await p.click('#askOk', { timeout: 30000 }); await p.waitForTimeout(ms); };
  const waitQuiet = async (sel, ms = 120000) => p.waitForFunction(s => ![...document.querySelectorAll(s)].some(n => /…/.test(n.innerText)), sel, { timeout: ms }).catch(() => {});
  const step = async (name, fn) => {
    try { const info = await fn(); logs.push('OK   ' + name + (info ? ' - ' + info : '')); }
    catch (e) {
      logs.push('FAIL ' + name + ': ' + e.message.split('\n')[0]);
      const d = await dlg(); if (d) { logs.push('     dialog: ' + d.slice(0, 300).replace(/\n/g, ' | ')); await p.keyboard.press('Escape'); }
      await shot('FAIL-' + name.replace(/[^a-z0-9]+/gi, '_'));
    }
  };

  await p.goto(APP); await p.waitForTimeout(1500);
  const version = await p.evaluate(() => state.version || document.querySelector('meta[name="ps-version"]')?.content);
  logs.push('App version ' + version);

  await step('Cameras: add the test cameras', async () => {
    await p.click('[data-tab=cams]'); await p.click('#addCamsBtn');
    await p.fill('#acList', CAMS.join('\n')); await p.fill('#acPort', PORT); await ok(500);
    if (process.env.CAM_USER) { await p.fill('#authUser', process.env.CAM_USER); await p.fill('#authPass', process.env.CAM_PASS || ''); await p.dispatchEvent('#authUser', 'change'); await p.dispatchEvent('#authPass', 'change'); }
    await p.click('#refreshBtn'); await p.waitForTimeout(8000);
    const rows = await p.$$eval('#camTable tbody tr', r => r.map(x => [...x.children].slice(1, 9).map(td => td.querySelector('input')?.value ?? td.innerText.trim()).join(' / ')));
    await shot('1-cameras');
    if (rows.length !== CAMS.length) throw new Error('rows: ' + rows.length);
    if (rows.some(r => !/Online/.test(r))) throw new Error('not all online: ' + rows.join(' | '));
    return rows.join(' | ');
  });
  await step('Cameras: edit description and zone (bulk), then undo', async () => {
    await p.evaluate(() => { state.cameras.forEach(c => c.selected = true); saveCams(); renderCams(); });
    await p.click('#camEditSel');
    if (CAMS.length > 1) { await p.fill('#edDescAll', 'Test {n}'); await p.click('#edDescFill'); }
    await p.fill('#edZone', 'TestZone'); await ok(500);
    const d = await p.$$eval('#camTable .descin', x => x.map(i => i.value));
    await p.click('#undoBtn'); await p.waitForTimeout(300);
    return 'descriptions ' + d.join(', ');
  });
  await step('Live: every tile on the first camera', async () => {
    await p.click('[data-tab=live]'); await p.waitForTimeout(3000);
    const seen = [];
    for (const [sel, label] of [['#liveWB [data-wb=auto]', 'White Auto'], ['#liveWB [data-wb=var]', 'White Var'], ['#liveAWBa', 'Store A'], ['#liveAWB', 'AWB'], ['#liveAWBb', 'Store B'], ['#liveWB [data-wb=b]', 'White B'], ['#liveABB', 'ABB'],
      ['#liveNight', 'Night'], ['#liveDay', 'Day'], ['[data-nominal="#ptSpeed"]', 'Speed nominal'],
      ['#liveAF', 'Auto focus'], ['#liveOPAF', 'One push AF'], ['#liveAI', 'Auto iris'], ['#liveScenes button[data-scene="2"]', 'Scene 2'], ['#liveScenes button[data-scene="1"]', 'Scene 1'], ['#ptPad [data-home]', 'Home']]) {
      await p.click(sel); await p.waitForTimeout(sel.includes('Scenes') ? 3500 : 1200);
      const st = await p.$eval('#liveStatus', e => e.textContent).catch(() => '');
      const toast = await p.$eval('#toastText', e => e.offsetParent ? e.textContent : '').catch(() => '');
      const on = await p.$$eval('#liveWB .on, .hold-row .on', x => x.map(e => e.textContent).join(','));
      seen.push(`${label}: ${st}${toast ? ' [' + toast + ']' : ''} {on: ${on}}`);
    }
    await shot('2-live');
    const pic = await p.$eval('#liveMsg', e => e.textContent).catch(() => '');
    return 'picture: ' + (pic || 'shown') + '\n       ' + seen.join('\n       ');
  });
  await step('Live: VAR colour temperature 4300 K', async () => {
    await p.fill('#liveVarK', '4300'); await p.click('#liveVarSet'); await p.waitForTimeout(2500);
    const back = await p.evaluate(async () => (await batch(live.cam, [{ cmd: 'QSI:20' }, { cmd: 'QAW' }])).map(r => r.body).join(' '));
    return `status: ${await p.$eval('#liveStatus', e => e.textContent)}; camera: ${back}`;
  });
  await step('Engineering: every action on all test cameras (state saved first, put back after)', async () => {
    const READ = [['cam', 'QAW'], ['cam', 'QSI:20'], ['cam', 'QSE:71'], ['ptz', '#INS'], ['cam', 'QSA:D3'], ['ptz', '#TAE'], ['cam', 'QLR'], ['cam', 'QLG'], ['cam', 'QSF']];
    const before = await p.evaluate(async R => Promise.all(state.cameras.map(async c => ({ ip: c.ip, v: (await batch(c, R.map(([type, cmd]) => ({ type, cmd })))).map(r => r.body) }))), READ);
    await p.click('[data-tab=eng]'); await p.waitForTimeout(500);
    await p.evaluate(() => { store.set('engCams', state.cameras.map(c => c.ip)); renderEng(); });
    const out = [];
    const run = async (sel, label, confirm, fill) => {
      if (fill) await p.fill('#engVarK', fill);
      await p.evaluate(() => { document.querySelector('#engStatus').textContent = ''; });
      await p.click(sel); if (confirm) { await p.waitForSelector('#askDlg[open]'); await p.click('#askOk'); }
      await p.waitForFunction(() => /done/.test(document.querySelector('#engStatus').textContent), null, { timeout: 90000 });
      const rows = await p.$$eval('#engResult tbody tr', r => r.map(x => [...x.children].map(td => td.innerText.trim().replace(/\n/g, ' ; ')).join(' | ')));
      out.push(`${label}:\n         ` + rows.join('\n         '));
    };
    await run('[data-eng=power][data-v="0"]', 'Standby', true); await p.waitForTimeout(5000);
    await run('[data-eng=power][data-v="1"]', 'Power on'); await p.waitForTimeout(30000);
    await run('#engScenes [data-v="2"]', 'Scene 2'); await p.waitForTimeout(3000);
    await run('[data-eng=tallyEn][data-v="1"]', 'Tally enable');
    await run('[data-eng=tally][data-c=R][data-v="1"]', 'Red on'); await run('[data-eng=tally][data-c=R][data-v="0"]', 'Red off');
    await run('[data-eng=tally][data-c=G][data-v="1"]', 'Green on'); await run('[data-eng=tally][data-c=G][data-v="0"]', 'Green off');
    await run('[data-eng=tallyBr][data-v="0"]', 'Tally brightness low'); await run('[data-eng=tallyBr][data-v="2"]', 'Tally brightness high');
    await run('[data-eng=awbMem][data-v="a"]', 'Store A'); await p.waitForTimeout(4000); await run('[data-eng=awb]', 'AWB'); await p.waitForTimeout(4000); await run('[data-eng=awbMem][data-v="b"]', 'Store B'); await p.waitForTimeout(4000);
    await run('[data-eng=varK]', 'VAR 4300 K', false, '4300');
    await run('[data-eng=abb]', 'ABB'); await p.waitForTimeout(4000);
    await run('[data-eng=install][data-v="1"]', 'Hanging', true); await p.waitForTimeout(8000);
    await run('[data-eng=install][data-v="0"]', 'Desktop', true); await p.waitForTimeout(8000);
    await run('[data-eng=scope][data-v="2"]', 'Preset scope C');
    await run('[data-eng=ipvideo][data-v="0"]', 'IP video off', true); await p.waitForTimeout(3000);
    await run('[data-eng=ipvideo][data-v="1"]', 'IP video on');
    await shot('2b-engineering');
    // put back what the cameras had before (scene, white balance, scope, installation, tally)
    const restore = await p.evaluate(async before => {
      const res = [];
      for (const b of before) {
        const c = state.cameras.find(x => x.ip === b.ip); const v = b.v; const items = [];
        const g = (re, i) => (re.exec(v[i] || '') || [])[1];
        if (g(/^iNS([01])/i, 3) != null) items.push({ type: 'ptz', cmd: '#INS' + g(/^iNS([01])/i, 3) });
        if (g(/^OSE:71:(\d)/i, 2) != null) items.push({ cmd: 'OSE:71:' + g(/^OSE:71:(\d)/i, 2) });
        if (g(/^OSA:D3:(\d)/i, 4) != null) items.push({ cmd: 'OSA:D3:' + g(/^OSA:D3:(\d)/i, 4) });
        if (g(/^tAE([01])/i, 5) != null) items.push({ type: 'ptz', cmd: '#TAE' + g(/^tAE([01])/i, 5) });
        if (g(/^OLR:([01])/i, 6) != null) items.push({ cmd: 'TLR:' + g(/^OLR:([01])/i, 6) });
        if (g(/^OLG:([01])/i, 7) != null) items.push({ cmd: 'TLG:' + g(/^OLG:([01])/i, 7) });
        if (g(/^OSF:(\d)/i, 8) != null) items.push({ cmd: 'XSF:' + (+g(/^OSF:(\d)/i, 8) + 1) }, { sleepMs: 3000 });
        if (g(/^OSI:20:([0-9A-F]{5})/i, 1) != null) items.push({ cmd: 'OSI:20:' + g(/^OSI:20:([0-9A-F]{5})/i, 1) + ':0' });
        if (g(/^OAW:(\d)/i, 0) != null) items.push({ cmd: 'OAW:' + g(/^OAW:(\d)/i, 0) });
        const r = await batch(c, items);
        res.push(`${b.ip}: ` + items.filter(x => x.cmd).map((x, i) => x.cmd).join(' ') + ' → ' + r.filter(x => !x.sleep).map(x => x.body || x.error).join(' '));
      }
      return res;
    }, before);
    return 'before: ' + before.map(b => `${b.ip} ${b.v.join(' ')}`).join(' || ') + '\n       ' + out.join('\n       ') + '\n       restored: ' + restore.join(' || ');
  });
  await step('Export: scenes 1 and 2 of all cameras (ZIP)', async () => {
    await p.click('[data-tab=export]'); await p.evaluate(() => { state.cameras.forEach(c => c.selected = true); saveCams(); renderExport(); });
    await p.click('input[name=expMode][value=pick]'); await p.check('#expScenes input[value="1"]'); await p.check('#expScenes input[value="2"]');
    await p.click('#exportBtn'); await p.waitForSelector('#askDlg[open]', { timeout: 60000 });
    const conf = (await dlg()).replace(/\n/g, ' | ').slice(0, 400); await ok(1000);
    await waitQuiet('#expRows .note', 300000); await shot('3-export');
    const r = await p.$$eval('#expRows .note', x => x.map(n => n.className.replace('note', '').trim() + ': ' + n.innerText.split('\n')[0]));
    if (r.some(x => /err/.test(x))) throw new Error(r.join(' | '));
    return 'confirm: ' + conf + '\n       ' + r.join(' | ');
  });
  await step('Export: operator files', async () => {
    await p.click('input[name=expKind][value=operator]'); await p.click('#exportBtn'); await p.waitForSelector('#askDlg[open]', { timeout: 60000 }); await ok(1000);
    await waitQuiet('#expRows .note', 120000);
    const r = await p.$$eval('#expRows .note', x => x.map(n => n.className.replace('note', '').trim() + ': ' + n.innerText.split('\n')[0]));
    await p.click('input[name=expKind][value=scene]'); await p.click('input[name=expMode][value=active]');
    if (r.some(x => /err/.test(x))) throw new Error(r.join(' | '));
    return r.join(' | ');
  });
  await step('Import: compare, then import everything back (with backup and check)', async () => {
    await p.click('[data-tab=import]'); await p.waitForTimeout(500);
    const cmp = await p.$('#impTable [data-act=compare]'); let c = '';
    if (cmp) { await cmp.click(); await p.waitForTimeout(8000); c = (await dlg()).slice(0, 200).replace(/\n/g, ' | '); if (c) await p.keyboard.press('Escape'); }
    await p.click('#importBtn'); await p.waitForSelector('#askDlg[open]'); await ok(1000);
    await p.waitForTimeout(3000); await waitQuiet('#impResult .note', 900000); await p.waitForTimeout(2000); await shot('4-import');
    const r = await p.$$eval('#impResult .note', x => x.map(n => n.className.replace('note', '').trim() + ': ' + n.innerText.replace(/\n/g, ' ').slice(0, 140)));
    return 'compare: ' + c + '\n       ' + r.join('\n       ');
  });
  await step('Import: undo', async () => { await p.click('#undoBtn'); await p.waitForTimeout(500); if (await dlg()) await ok(60000); });
  await step('Shows: new show from cameras, recall, edit and save', async () => {
    await p.click('[data-tab=shows]'); await p.click('#showNew'); await p.check('#nsOper'); await ok(500);
    await p.waitForFunction(() => document.querySelectorAll('#showTable tbody tr').length > 0, null, { timeout: 300000 });
    await p.click('#showTable [data-act=recall]'); await p.waitForSelector('#askDlg[open]'); await ok(1000);
    await p.waitForTimeout(60000);
    await p.click('#showTable [data-act=edit]'); await p.waitForTimeout(500);
    // put the first opened scene of the first camera into an empty scene cell of that camera
    const row = (await p.$$('#gridTable tbody tr'))[0];
    const filled = await row.$$eval('select', x => x.map(s => [s.dataset.col, s.value]));
    const src = filled.find(([c, v]) => v && c !== 'op'), empty = filled.find(([c, v]) => !v && c !== 'op');
    if (src && empty) await (await row.$(`select[data-col="${empty[0]}"]`)).selectOption(src[1]);
    await p.click('#gridSave'); const conf = (await dlg()).replace(/\n/g, ' | ').slice(0, 300); await ok(800);
    await shot('5-shows');
    return 'edit confirm: ' + conf;
  });
  await step('Parameters: send a query to the first camera, CSVs, a script', async () => {
    await p.click('[data-tab=params]'); await p.fill('#paramSearch', 'tally'); await p.waitForTimeout(400);
    await p.click('#cmdTable tbody tr:first-child [data-act=copy]'); await p.click('#cmdTable tbody tr:first-child [data-act=send]'); await p.waitForTimeout(1500);
    const out = await p.$eval('#cmdTable tbody tr:first-child .out', e => e.innerText).catch(() => '');
    await p.click('[data-sub=scene]'); await p.click('#paramCsv'); await p.click('[data-sub=operator]'); await p.click('#operCsv'); await p.click('[data-sub=http]');
    await p.evaluate(() => addToScript('Red tally on', 'cam', 'TLR:1'));
    await p.click('#scriptCams .selall-row input'); await p.fill('#scriptName', 'UI test'); await p.click('#scriptSh'); await p.waitForTimeout(800);
    await shot('6-parameters');
    return 'send answer: ' + out;
  });
  await step('Project: save project file, close, open again', async () => {
    await p.click('#bridgeSettingsBtn'); await p.click('#projRename'); await p.fill('#askProj', 'UI test'); await ok(500);
    await p.click('#bridgeSettingsBtn'); await p.click('#projClose'); await ok(3000);
    const empty = await p.$$eval('#camTable tbody tr', r => r.length);
    return 'cameras after closing: ' + empty + ' (project file is in the UI test folder)';
  });
  fs.writeFileSync(path.join(OUT, 'ui-log.txt'), logs.join('\n') + '\n\nERRORS IN THE PAGE:\n' + (errs.join('\n') || 'none') + '\n');
  console.log(logs.join('\n')); console.log('ERRORS IN THE PAGE:', errs.length ? '\n' + errs.join('\n') : 'none');
  console.log('\nScreenshots and log: ' + OUT);
  await b.close();
  process.exit(logs.some(l => l.startsWith('FAIL')) || errs.length ? 1 : 0);
})();
