// Drives the built single-file app in jsdom with the same library builds the CDN serves.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const XLSX = require('xlsx');
const { verify } = require('./verify_template.js');
const root = path.join(__dirname, '..');
const file = process.argv[2] || path.join(root, 'dist/index.html');
let html = fs.readFileSync(file, 'utf8');
const libs = {
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js': 'node_modules/xlsx/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js': 'node_modules/exceljs/dist/exceljs.min.js',
};
for (const [url, p] of Object.entries(libs)) html = html.replace(`<script src="${url}"></script>`, () => `<script>${fs.readFileSync(path.join(root, p), 'utf8')}</script>`);
html = html.replace(/<link[^>]+fonts[^>]*>/g, '');
const errors = []; const saved = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
const doc = /<html/i.test(html) ? html : '<!doctype html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>';
const dom = new JSDOM(doc, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
    w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
    w.scrollTo = () => {};
    // jsdom's Blob has no arrayBuffer(); browsers do
    if (!w.Blob.prototype.arrayBuffer) w.Blob.prototype.arrayBuffer = function () { return new Promise((res) => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsArrayBuffer(this); }); };
    w.claude = { use: async (n) => (n === 'downloads' ? { save: async ({ filename, data }) => { saved.push({ filename, data }); return { status: 'saved' }; } } : null) };
  },
});
const w = dom.window, d = w.document;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(100); } return false; }
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '(none)');
const click = (sel) => { const el = d.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.click(); };
(async () => {
  await until(() => /Example_Akko_Microplan/.test(d.getElementById('view').textContent));
  console.log('[1 Files]', txt(d.querySelector('.files')), '|', txt(d.querySelector('.example')));
  click('[data-nav="2"]');
  console.log('[2 Columns]', txt(d.querySelector('.facts')));
  console.log('   edit form fields:', d.querySelectorAll('#editMap select').length, '| open by default:', d.getElementById('editMap').open);
  click('[data-nav="3"]');
  console.log('[3 Names]', txt(d.querySelector('.intro + div')), '|', d.querySelectorAll('.card').length, 'cards |', txt(d.querySelector('.card')));
  console.log('   card:', txt(d.querySelector('.card .q')), '|', txt(d.querySelector('.card .why')), '| options:', [...d.querySelectorAll('.card .choice')].map((b) => txt(b)).join(' / '));
  const sb = d.querySelector('[data-toggle^="search:"]');
  if (sb) {
    sb.click(); await wait(50);
    const inp = d.querySelector('[data-qsearch]'); const optv = d.querySelector('#' + inp.getAttribute('list') + ' option').value;
    inp.value = optv; inp.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(200);
    console.log('   search options sample:', [...d.querySelectorAll('#' + inp.getAttribute('list') + ' option')].slice(0, 4).map((o) => o.value).join(' / '), '\n   picked via search:', optv, '→', txt(d.querySelector('.big')), '|', txt(d.querySelector('.done-state')));
  } else { d.querySelector('.card [data-pick]').click(); await wait(200); console.log('   picked:', txt(d.querySelector('.big'))); }
  console.log('   close-match rows available:', d.querySelectorAll('#autoBox select').length, '| decisions note:', txt(d.querySelector('.nav + p')).slice(0, 60));
  click('[data-nav="4"]');
  console.log('[4 Export]', txt(d.querySelector('.intro')));
  console.log('   checks:', [...d.querySelectorAll('.facts .fact .t')].map((t) => t.childNodes[0].textContent.trim()).join(' | '));
  // resolve problems by editing the affected rows
  const fire = (el, v) => { if (v !== undefined) { if (el.type === 'checkbox') el.checked = v; else el.value = v; } el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const cellIn = (ref, kind) => [...d.querySelectorAll('[data-cell]')].find((i) => { const [sh, ri, , k] = i.dataset.cell.split('|'); return sh + '!' + (Number(ri) + 1) === ref && k === kind; });
  console.log('   row cards:', d.querySelectorAll('.rowcard').length, '| first:', txt(d.querySelector('.rowcard .rc-head')), '|', '| phone cells:', [...d.querySelectorAll('[data-cell$="|p"]')].map((i) => i.value).join(', '));
  fire(cellIn('UserList!4', 'p'), '08123456790');
  click('[data-rm="UserList!6"]'); await wait(50);
  for (const k of ['Near-duplicate names', 'HF without OIC']) click(`[data-toggle="fix:${k}"]`);
  const dupName = [...d.querySelectorAll('[data-cell$="|h"]')].find((i) => i.value === 'UNG ALI');
  console.log('   rename input for UNG ALI present:', !!dupName);
  if (dupName) fire(dupName, 'Ung. Ali');
  const addBtn = d.querySelector('[data-add*="|oic|"]'); const id = addBtn.dataset.add.split('|')[2];
  d.getElementById(id + '-n').value = 'Example OIC C'; d.getElementById(id + '-p').value = '08055551234'; addBtn.click(); await wait(50);
  console.log('   after edits:', txt(d.querySelector('.intro h2')), '| edits:', txt(d.querySelector('.facts .fact .t')).slice(0, 40));
  click('[data-toggle="__edits"]');
  console.log('   edit log:', [...d.querySelectorAll('[data-undoedit]')].map((b) => b.parentElement.textContent.replace('Undo', '').trim()).join(' | '));
  const nBefore = d.querySelectorAll('[data-undoedit]').length;
  d.querySelector('[data-undoedit]').click(); await wait(50);  // undo most recent (the added OIC)
  console.log('   after undo:', d.querySelectorAll('[data-undoedit]').length, 'edits (was', nBefore + ')');
  if (!d.querySelector('[data-add*="|oic|"]')) click('[data-toggle="fix:HF without OIC"]');
  const addBtn2 = d.querySelector('[data-add*="|oic|"]'); const id2 = addBtn2.dataset.add.split('|')[2];
  d.getElementById(id2 + '-n').value = 'Example OIC C'; d.getElementById(id2 + '-p').value = '08055551234'; addBtn2.click(); await wait(50);
  click('[data-act="spread"]');
  for (const r of ['HF without CDD', 'HF without OIC', 'Special characters']) { const b = d.querySelector(`[data-ack="${r}"]`); if (b) b.click(); }
  console.log('   after spread + mark OK:', txt(d.querySelector('.intro h2')), '|', txt(d.querySelector('.intro p')));
  if (!/Ready/.test(txt(d.querySelector('.intro h2')))) { console.error('FAIL headline', txt(d.querySelector('.intro h2')), [...d.querySelectorAll('.facts .fact .t')].map(txt)); process.exit(1); }
  click('#dlCorrected'); await until(() => saved.some((s) => s.filename.endsWith('_corrected.xlsx')));
  click('#btnFill'); await until(() => saved.some((s) => s.filename.endsWith('_filled.xlsx')));
  console.log('   ', txt(d.getElementById('expStatus')));
  click('#btnReport'); await until(() => saved.some((s) => s.filename.endsWith('_report.xlsx')));
  // demo users mode
  click('[data-mode="demo"]'); await wait(100);
  console.log('[demo]', d.querySelectorAll('.demo-table tbody tr').length, 'role rows |', txt(d.querySelector('.facts .t')).slice(0, 160));
  const cnt = d.querySelector('[data-dcnt="0"]'); cnt.value = '3'; cnt.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(50);
  console.log('   after count=3 for first role:', txt(d.querySelector('.facts .t')).split('—')[0]);
  click('#dFill'); await until(() => saved.some((s) => s.filename.endsWith('_demo_users.xlsx')));
  console.log('   ', txt(d.getElementById('demoStatus')));
  click('#dList'); await until(() => saved.some((s) => s.filename.endsWith('_demo_users.csv')));
  const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const latest = (suffix) => saved.filter((s) => s.filename.endsWith(suffix)).pop();
  const tplU8 = new Uint8Array(w.__mpm.state().tplBuf);
  for (const suffix of ['_filled.xlsx', '_demo_users.xlsx']) {
    const rep = await verify(tplU8, await bytes(latest(suffix).data));
    console.log('   verify', suffix, rep.ok ? 'OK' : 'FAIL', `users ${rep.users} | facilities ${JSON.stringify(rep.facilities)}`, rep.ok ? '' : JSON.stringify(rep));
    if (!rep.ok) process.exit(1);
  }
  const setFile = async (sel, name, u8) => { const inp = d.querySelector(sel); const f = new w.File([u8], name); Object.defineProperty(inp, 'files', { value: [f], configurable: true }); fire(inp); await wait(300); };
  const rowF = (n, f) => d.querySelector(`[data-af="${n}|${f}"]`);

  // add users to the empty example template: one typed, three pasted (one bad boundary, one repeated phone)
  click('[data-mode="users"]'); await wait(100);
  console.log('[users]', txt(d.querySelector('.file .meta')), '| row cards:', d.querySelectorAll('.rowcard').length);
  const uid1 = d.querySelector('[data-af$="|name"]').dataset.af.split('|')[0];
  fire(rowF(uid1, 'name'), 'Typed Person'); fire(rowF(uid1, 'phone'), '08031230001');
  fire(rowF(uid1, 'b'), 'Garko PHC'); fire(d.querySelector(`[data-arole="${uid1}|0"]`), 'HEALTH_FACILITY_WORKER'); await wait(50);
  fire(d.querySelector(`[data-arole="${uid1}|1"]`), 'TEAM_SUPERVISOR'); await wait(50);
  console.log('   typed row:', txt(d.querySelector('.rowcard .rc-head')), '| boundary →', rowF(uid1, 'b').value);
  click('[data-toggle="__paste"]'); await wait(50);
  d.getElementById('aPaste').value = ['Name\tPhone\tRole\tBoundary', 'Pasted CDD\t0803 123 0002\tCDD\tAkko › Akko PHCC', 'Pasted Twin\t08031230002\tDistributor\tKalshingi PHC', 'Pasted Lost\t08031230003\tCDD\tNowhere Clinic'].join('\n');
  click('#aPasteGo'); await wait(100);
  console.log('   after paste:', d.querySelectorAll('.rowcard').length, 'rows | problems:', [...d.querySelectorAll('.rowcard .rc-problem')].map(txt).filter(Boolean).join(' / '));
  console.log('   ', txt(d.querySelector('.facts .fact .t')), '|', txt(d.getElementById('aSave')));
  click('#aSave'); await until(() => latest('_with_users.xlsx'));
  console.log('   ', txt(d.getElementById('addStatus')));
  const withUsers = await bytes(latest('_with_users.xlsx').data);
  let rep = await verify(tplU8, withUsers);
  console.log('   verify _with_users', rep.ok ? 'OK' : 'FAIL', 'users', rep.users, rep.ok ? '' : JSON.stringify(rep)); if (!rep.ok || rep.users !== 2) process.exit(1);

  // reopen the filled template and add more: existing users listed, their phones blocked
  await setFile('#fileTpl', 'Example_with_users.xlsx', withUsers);
  console.log('[users again]', txt(d.querySelector('.file .meta')), '| existing box:', txt(d.querySelector('#exBox summary')));
  const uid2 = d.querySelector('[data-af$="|name"]').dataset.af.split('|')[0];
  fire(rowF(uid2, 'name'), 'Second Batch'); fire(rowF(uid2, 'phone'), '08031230001'); fire(rowF(uid2, 'b'), 'Bogo Waziri HC'); fire(d.querySelector(`[data-arole="${uid2}|0"]`), 'DISTRIBUTOR'); await wait(50);
  console.log('   repeated phone:', txt(d.querySelector('.rowcard .rc-problem')));
  if (!/already used by Typed Person/.test(txt(d.querySelector('.rowcard .rc-problem')))) { console.error('FAIL existing phone not caught'); process.exit(1); }
  fire(rowF(uid2, 'phone'), '08031230009'); await wait(50);
  click('#aSave'); await until(() => saved.filter((s) => s.filename.endsWith('_with_users.xlsx')).length >= 2);
  console.log('   ', txt(d.getElementById('addStatus')));
  rep = await verify(withUsers, await bytes(latest('_with_users.xlsx').data));
  console.log('   verify second batch', rep.ok ? 'OK' : 'FAIL', 'users', rep.users, rep.ok ? '' : JSON.stringify(rep)); if (!rep.ok || rep.users !== 3) process.exit(1);

  // microplan flow with only a user list, on the filled template
  click('[data-mode="plan"]'); await wait(50); click('#steps [data-go="1"]'); await wait(50);
  const ub = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(ub, XLSX.utils.aoa_to_sheet([['State', 'LGA', 'Ward', 'Health Facility', 'Name', 'Phone Number', 'Designation'],
    ['Gombe', 'Akko', 'AKKO', 'Akko PHCC', 'List OIC', '08031230011', 'OIC'], ['Gombe', 'Akko', 'Garko', 'Garko PHC', 'List CDD', '08031230001', 'CDD']]), 'Users');
  await setFile('#fileMp', 'user_list.xlsx', new Uint8Array(XLSX.write(ub, { type: 'array', bookType: 'xlsx' })));
  console.log('[user list only]', txt(d.querySelectorAll('.file .meta')[1]));
  click('[data-nav="2"]'); console.log('   columns:', [...d.querySelectorAll('.facts .fact .t')].map((t) => t.childNodes[0].textContent.trim()).join(' | '));
  click('[data-nav="3"]'); await wait(50); console.log('   names:', txt(d.querySelector('.big')), txt(d.querySelector('.big + .muted')));
  click('[data-nav="4"]'); await wait(50);
  console.log('   export:', txt(d.querySelector('.intro')), '| checks:', [...d.querySelectorAll('.facts .fact .t')].map((t) => t.childNodes[0].textContent.trim()).join(' | '));
  if (!/phone already in the template/.test(txt(d.querySelector('.facts')))) { console.error('FAIL user-list phone clash not flagged'); process.exit(1); }
  click('#btnFill'); await until(() => saved.filter((s) => s.filename.endsWith('_filled.xlsx')).length >= 2);
  console.log('   ', txt(d.getElementById('expStatus')));

  rep = await verify(withUsers, await bytes(latest('_filled.xlsx').data));
  console.log('   verify user-list fill', rep.ok ? 'OK' : 'FAIL', 'users', rep.users, rep.ok ? '' : JSON.stringify(rep)); if (!rep.ok || rep.users !== 3) process.exit(1);

  // reload the example, then clear it
  click('#steps [data-go="1"]'); await wait(50);
  await setFile('#fileTpl', 'Example_Akko_Unified_Template.xlsx', tplU8); await wait(100);
  console.log('[after reload] template:', txt(d.querySelector('.file .meta')));
  w.__mpm.state().example = true; click('#steps [data-go="1"]'); await wait(50); click('#clearEx'); await wait(100);
  console.log('[clear] continue disabled:', d.querySelector('[data-nav="2"]').disabled, '| try example link:', !!d.getElementById('loadEx'));
  for (const s of saved) {
    const buf = Buffer.from(await new Promise((res) => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsArrayBuffer(s.data); }));
    fs.writeFileSync(path.join(__dirname, 'page_' + s.filename), buf); console.log('saved', s.filename, buf.length, 'bytes');
  }
  console.log('errors:', errors.length ? errors : 'none');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS', e); console.log('errors:', errors); process.exit(1); });
