// Drives the built single-file app in jsdom with the same library builds the CDN serves.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
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
  const pick = d.querySelector('.card [data-pick]');
  if (pick) { pick.click(); await wait(200); console.log('   after one click:', txt(d.querySelector('.big')), '| cards left', d.querySelectorAll('.card').length, '|', txt(d.querySelector('.done-state'))); }
  console.log('   close-match rows available:', d.querySelectorAll('#autoBox select').length);
  click('[data-nav="4"]');
  console.log('[4 Export]', txt(d.querySelector('.intro')));
  console.log('   checks:', [...d.querySelectorAll('.facts .fact .t')].map((t) => t.childNodes[0].textContent.trim()).join(' | '));
  // resolve problems in place
  const fire = (el, v) => { if (v !== undefined) { if (el.type === 'checkbox') el.checked = v; else el.value = v; } el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  click('[data-toggle="phones"]');
  console.log('   phone editor rows:', [...d.querySelectorAll('[data-uphone]')].map((i) => i.dataset.uphone + '=' + i.value).join(', '));
  fire(d.querySelector('[data-uphone="UserList!4"]'), '08123456790');
  fire(d.querySelector('[data-uskip="UserList!6"]'), true);
  console.log('   after phone fixes:', txt(d.querySelector('.intro')), '| phone states:', [...d.querySelectorAll('[data-uphone]')].map((i) => i.closest('tr').cells[2].textContent).join(','));
  click('[data-act="spread"]');
  console.log('   after spread:', txt(d.querySelector('.intro p')));
  for (const r of ['HF without CDD', 'HF without OIC', 'Near-duplicate names', 'Special characters']) { const b = d.querySelector(`[data-ack="${r}"]`); if (b) b.click(); }
  console.log('   after marking OK:', txt(d.querySelector('.intro h2')), '|', txt(d.querySelector('details.edit summary')));
  const fails = []; if (!/Ready/.test(txt(d.querySelector('.intro h2')))) fails.push('headline not ready');
  if (fails.length) { console.error('FAIL', fails); process.exit(1); }
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
  click('[data-mode="plan"]'); await wait(50);
  click('#steps [data-go="1"]'); click('#clearEx'); await wait(100);
  console.log('[clear] continue disabled:', d.querySelector('[data-nav="2"]').disabled, '| try example link:', !!d.getElementById('loadEx'));
  for (const s of saved) {
    const buf = Buffer.from(await new Promise((res) => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsArrayBuffer(s.data); }));
    fs.writeFileSync(path.join(__dirname, 'page_' + s.filename), buf); console.log('saved', s.filename, buf.length, 'bytes');
  }
  console.log('errors:', errors.length ? errors : 'none');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS', e); console.log('errors:', errors); process.exit(1); });
