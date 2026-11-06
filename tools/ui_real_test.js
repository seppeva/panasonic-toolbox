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
    for (const [sel, label] of [['#liveWB [data-wb=auto]', 'White Auto'], ['#liveWB [data-wb=var]', 'White Var'], ['#liveWB [data-wb=a]', 'White A'], ['#liveAWB', 'AWB'], ['#liveWB [data-wb=b]', 'White B'], ['#liveABB', 'ABB'],
      ['#liveTallyR', 'Red tally'], ['#liveTallyR', 'Red tally off'], ['#liveTallyG', 'Green tally'], ['#liveTallyG', 'Green tally off'], ['#liveNight', 'Night'], ['#liveDay', 'Day'],
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
  await step('Live: standby and on', async () => {
    await p.click('#livePowerStby'); await ok(5000);
    const s1 = await p.$$eval('#livePowerOn,#livePowerStby', x => x.map(e => e.textContent + (e.classList.contains('on') ? '*' : '')).join(' '));
    await p.click('#livePowerOn'); await p.waitForTimeout(30000);
    const s2 = await p.$$eval('#livePowerOn,#livePowerStby', x => x.map(e => e.textContent + (e.classList.contains('on') ? '*' : '')).join(' '));
    return `standby: ${s1}; after On: ${s2}`;
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
