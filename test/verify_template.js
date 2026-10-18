// Checks a filled unified template against the template it came from:
//  - structure unchanged: sheet states, hidden columns, hidden header row, sheet protection, defined names
//  - every user row's boundary path is selectable through the template's own dropdown cascade
//    (helper hash → <hash>_LIST for console/ExcelJS templates, MATCH(path) → _hL<row> for newer POI templates)
//  - the boundary code (cached formula result or plain value) equals the lookup code for that path
//  - roles come from the role list; data validations are one contiguous range per column, anchored on their first row
// Usage: node test/verify_template.js original.xlsx filled.xlsx
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const MPW = require(path.join(__dirname, '..', 'writer.js'));

const val = (v) => { if (v && typeof v === 'object') { if ('result' in v || 'formula' in v || 'sharedFormula' in v) return v.result == null ? '' : String(v.result); if (v.richText) return v.richText.map((t) => t.text).join(''); if (v.text) return String(v.text); } return v == null ? '' : String(v); };
const colNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };

function rawSheets(u8) {
  const cfb = XLSX.CFB.read(u8, { type: 'array' }); const files = new Map();
  cfb.FileIndex.forEach((fi, i) => { if (fi.type === 2 && fi.content) files.set(cfb.FullPaths[i].replace(/^Root Entry\//, ''), Buffer.from(fi.content).toString('utf8')); });
  const rels = {}; (files.get('xl/_rels/workbook.xml.rels') || '').replace(/<Relationship\b[^>]*>/g, (t) => { rels[(t.match(/Id="([^"]+)"/) || [])[1]] = (t.match(/Target="([^"]+)"/) || [])[1].replace(/^\/?(xl\/)?/, 'xl/'); return t; });
  const out = {}; (files.get('xl/workbook.xml') || '').replace(/<sheet\b[^>]*>/g, (t) => { out[(t.match(/name="([^"]*)"/) || [])[1]] = files.get(rels[(t.match(/r:id="([^"]+)"/) || [])[1]]) || ''; return t; });
  return out;
}
function dvRanges(xml) {
  const out = []; const re = /<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/g; let m;
  while ((m = re.exec(xml))) {
    const sq = (m[1].match(/sqref="([^"]+)"/) || [])[1] || ''; const f = ((m[2].match(/<formula1>([\s\S]*?)<\/formula1>/) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    for (const r of sq.split(/\s+/).filter(Boolean)) out.push({ r, f });
  }
  return out;
}

async function verify(origU8, outU8) {
  const O = await MPW.loadTemplate(ExcelJS, origU8), F = await MPW.loadTemplate(ExcelJS, outU8);
  const report = { structure: [], users: 0, mismatches: { code: 0, dropdown: 0, helper: 0, role: 0 }, examples: [], dv: [], facilities: {}, rowIdOnNew: 0, textPhones: 0, mandatoryBlank: 0 };
  // structure
  const hiddenCols = (ws) => { const s = []; for (let c = 1; c <= ws.columnCount; c++) if (ws.getColumn(c).hidden) s.push(c); return s.join(','); };
  for (const wo of O.worksheets) {
    const wf = F.getWorksheet(wo.name); if (!wf) { report.structure.push(wo.name + ': missing'); continue; }
    const a = { state: wo.state, cols: hiddenCols(wo), row1: !!wo.getRow(1).hidden, prot: !!(wo.sheetProtection && wo.sheetProtection.sheet) };
    const b = { state: wf.state, cols: hiddenCols(wf), row1: !!wf.getRow(1).hidden, prot: !!(wf.sheetProtection && wf.sheetProtection.sheet) };
    for (const k of Object.keys(a)) if (a[k] !== b[k]) report.structure.push(`${wo.name}.${k}: ${a[k]} → ${b[k]}`);
  }
  const no = O.definedNames.model.length, nf = F.definedNames.model.length; if (no !== nf) report.structure.push(`defined names ${no} → ${nf}`);
  const ro = rawSheets(origU8), rf = rawSheets(outU8);
  for (const n of Object.keys(ro)) { const p = /<sheetProtection\b[^>]*>/.exec(ro[n]), q = /<sheetProtection\b[^>]*>/.exec(rf[n] || ''); if (p && (!q || q[0] !== p[0])) report.structure.push(`${n}: protection element changed`); }
  // lookup sheet
  const hasLookup = !!F.getWorksheet('_h_SimpleLookup_h_');
  const L = F.getWorksheet('_h_SimpleLookup_h_') || { eachRow() {} }; // templates without a lookup sheet: dropdown checks are skipped
  const name2code = new Map(), pathRow = new Map(), name2hash = new Map();
  L.eachRow((row, r) => {
    const a = val(row.getCell(1).value), d = val(row.getCell(4).value), e = val(row.getCell(5).value), i = val(row.getCell(9).value), j = val(row.getCell(10).value);
    if (d && e) name2code.set(d, e); if (a && !/^H_[0-9a-f]{64}$/i.test(a)) pathRow.set(a, r); if (i && j) name2hash.set(i, j);
  });
  const names = new Map(F.definedNames.model.map((d) => [d.name, d.ranges]));
  const rangeVals = (ref) => {
    const m = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(ref); if (!m) return [];
    const ws = F.getWorksheet(m[1]); const out = [];
    for (let r = +m[3]; r <= +(m[5] || m[3]); r++) for (let c = colNum(m[2]); c <= colNum(m[4] || m[2]); c++) { const v = val(ws.getRow(r).getCell(c).value); if (v) out.push(v); }
    return out;
  };
  const listOf = (name) => (names.get(name) || []).flatMap(rangeVals);
  for (const wf of F.worksheets) {
    const hm = MPW.headerMap(wf); if (!hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE) continue;
    // data validations straight from the written XML
    const per = {};
    for (const { r, f } of dvRanges(rf[wf.name] || '')) {
      const st = +(/(\d+)/.exec(r) || [])[1]; const col = r.replace(/\d+/g, '').split(':')[0]; (per[col] = per[col] || []).push(r);
      const refs = f.replace(/"[^"]*"/g, '').replace(/_h_\w+!\$[A-Z]+\$\d+(:\$[A-Z]+\$\d+)?/g, '').match(/(?<![A-Z$_])[A-Z]{1,2}(\d+)(?![\d(A-Za-z_])/g) || [];
      if (refs.some((x) => +x.replace(/[A-Z]/g, '') !== st)) report.dv.push(`${wf.name}!${r} not anchored: ${f.slice(0, 60)}`);
    }
    for (const [c, rs] of Object.entries(per)) if (rs.length > 1) report.dv.push(`${wf.name} column ${c} split into ${rs.join(' ')}`);
    const formulaByCol = (xml) => { const m = {}; for (const { r, f } of dvRanges(xml || '')) m[r.replace(/\d+/g, '').split(':')[0]] = f; return m; };
    const fo = formulaByCol(ro[wf.name]), ff = formulaByCol(rf[wf.name]);
    for (const [c, f] of Object.entries(fo)) if (f && !ff[c]) report.dv.push(`${wf.name} column ${c} lost its dropdown formula`);
    if (hm.HCM_ADMIN_CONSOLE_FACILITY_CODE && hm.HCM_ADMIN_CONSOLE_FACILITY_USAGE) {
      wf.eachRow((row, r) => { if (r < 3 || !val(row.getCell(hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE).value)) return; const u = val(row.getCell(hm.HCM_ADMIN_CONSOLE_FACILITY_USAGE).value); report.facilities[u] = (report.facilities[u] || 0) + 1; });
      continue;
    }
    if (!hm.HCM_ADMIN_CONSOLE_USER_NAME) continue;
    const lv = MPW.levelCols(hm); const roleKeys = Object.keys(hm).filter((k) => /ROLE_MULTISELECT_\d+$/.test(k)).sort((a, b) => hm[a] - hm[b]);
    const roleOK = new Set(MPW.allowedValues(F, wf, hm[roleKeys[0]]));
    const top = new Set(MPW.allowedValues(F, wf, hm[lv[0]]));
    const origRows = new Set(MPW.readUsers(O.getWorksheet(wf.name)).map((u) => u.row));
    wf.eachRow((row, r) => {
      if (r < 3 || !val(row.getCell(hm.HCM_ADMIN_CONSOLE_USER_NAME).value)) return;
      report.users++;
      const p = lv.map((k) => val(row.getCell(hm[k]).value)); let depth = -1; p.forEach((x, i) => { if (x) depth = i; });
      const ex = (what) => { if (report.examples.length < 6) report.examples.push(`row ${r}: ${what}`); };
      for (let i = 0; i <= depth && hasLookup; i++) {
        const hk = lv[i] + '_HELPER'; let ok;
        if (hm[hk]) {
          const h = val(row.getCell(hm[hk]).value), want = i ? name2hash.get(p.slice(0, i).join('#')) || '' : name2hash.get('') || '';
          if (i && h !== want) { report.mismatches.helper++; ex(`${hk} ${h.slice(0, 10)} ≠ ${want.slice(0, 10)}`); }
          ok = i === 0 ? !top.size || top.has(p[0]) : listOf(h + '_LIST').includes(p[i]);
        } else if (i === 0) ok = !top.size || top.has(p[0]);
        else { const pr = pathRow.get(p.slice(0, i).join('#')); ok = pr != null && listOf('_hL' + pr).includes(p[i]); }
        if (!ok) { report.mismatches.dropdown++; ex(`${lv[i]} “${p[i]}” not offered by the dropdown`); }
      }
      const c = val(row.getCell(hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE).value), want = name2code.get(p.slice(0, depth + 1).join('#'));
      if (hasLookup && c !== want) { report.mismatches.code++; ex(`code ${c} ≠ ${want}`); }
      const rs = roleKeys.map((k) => val(row.getCell(hm[k]).value)).filter(Boolean);
      if (roleOK.size && rs.some((x) => !roleOK.has(x))) { report.mismatches.role++; ex('role ' + rs.join(',')); }
      if (hm.HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER) { const pv = row.getCell(hm.HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER).value; if (pv != null && pv !== '' && typeof pv !== 'number') { report.textPhones++; ex('phone stored as text: ' + pv); } }
      for (const [k, c] of Object.entries(hm)) if (/mandatory/i.test(val(wf.getRow(2).getCell(c).value)) && !val(row.getCell(c).value)) { report.mandatoryBlank++; ex('blank mandatory ' + k); }
      if (hm.HCM_ADMIN_CONSOLE____ROW_ID && !origRows.has(r) && val(row.getCell(hm.HCM_ADMIN_CONSOLE____ROW_ID).value)) report.rowIdOnNew++;
    });
  }
  report.ok = !report.structure.length && !report.dv.length && !Object.values(report.mismatches).some(Boolean) && !report.rowIdOnNew && !report.textPhones && !report.mandatoryBlank;
  return report;
}

module.exports = { verify };
if (require.main === module) {
  verify(new Uint8Array(fs.readFileSync(process.argv[2])), new Uint8Array(fs.readFileSync(process.argv[3])))
    .then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1); }).catch((e) => { console.error(e); process.exit(1); });
}
