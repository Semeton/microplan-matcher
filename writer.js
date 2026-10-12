/* Writes results into the console's own unified template using ExcelJS, preserving hidden sheets,
 * data validations and styles. Locates every column by its technical key in header row 1. */
(function (root) {
  'use strict';
  const MP = root.MP || (typeof require === 'function' ? require('./engine.js') : null);

  const s = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') { if (v.richText) return v.richText.map((r) => r.text).join(''); if (v.result !== undefined) return String(v.result); if (v.text) return String(v.text); }
    return String(v).trim();
  };
  const keyOf = (v) => s(v).replace(/\\_/g, '_');

  function headerMap(ws) {
    const m = {};
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => { m[keyOf(cell.value)] = col; });
    return m;
  }

  /** Allowed values for a column from the sheet's list validations (inline list or range ref). */
  function allowedValues(wb, ws, col) {
    const model = (ws.dataValidations && ws.dataValidations.model) || {};
    const letter = MP.colLetter(col - 1);
    for (const [addr, dv] of Object.entries(model)) {
      if (!dv || dv.type !== 'list' || !dv.formulae || !dv.formulae.length) continue;
      const first = addr.split(/[: ]/)[0].replace(/\d+/g, '');
      if (first !== letter && !addr.split(' ').some((a) => a.replace(/\d+/g, '').split(':')[0] === letter)) continue;
      let f = String(dv.formulae[0]);
      if (/^".*"$/.test(f)) return f.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean);
      f = f.replace(/^=/, '');
      const m = f.match(/^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/);
      if (m) {
        const src = wb.getWorksheet(m[1]); if (!src) continue;
        const out = [];
        const c1 = colNum(m[2]), r1 = +m[3], c2 = m[4] ? colNum(m[4]) : c1, r2 = m[5] ? +m[5] : r1;
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const v = s(src.getCell(r, c).value); if (v) out.push(v); }
        return out;
      }
      // defined name
      try {
        const ranges = wb.definedNames.getRanges(f);
        if (ranges && ranges.ranges && ranges.ranges.length) {
          const out = [];
          for (const rg of ranges.ranges) {
            const mm = rg.match(/^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/); if (!mm) continue;
            const src = wb.getWorksheet(mm[1]); if (!src) continue;
            for (let r = +mm[3]; r <= (mm[5] ? +mm[5] : +mm[3]); r++) { const v = s(src.getCell(r, colNum(mm[2])).value); if (v) out.push(v); }
          }
          return out;
        }
      } catch (e) { /* ignore */ }
    }
    return [];
  }
  function colNum(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }

  /** Suggest a console role for a free-text designation. */
  function guessRole(designation, allowed) {
    const d = MP.basicNorm(designation);
    const want =
      /\boic\b|in ?charge|hf ?w|health facility|facility (worker|staff)|hfw/.test(d) ? ['health facility', 'facility supervisor', 'hf', 'facility'] :
      /\bcdd\b|distributor|dispenser|mobiliser|vaccinator|registrar/.test(d) ? ['distributor', 'dispenser', 'registrar', 'cdd'] :
      /logistic|store|warehouse|lmcu/.test(d) ? ['warehouse', 'logistic', 'store'] :
      /national|state|lga (supervisor|coordinator)|coordinator|focal/.test(d) ? ['national supervisor', 'state supervisor', 'district supervisor', 'supervisor'] :
      /supervisor|monitor/.test(d) ? ['field supervisor', 'supervisor'] : [];
    for (const w of want) { const hit = (allowed || []).find((a) => MP.basicNorm(a).includes(w)); if (hit) return hit; }
    return null;
  }
  function roleKind(role) {
    const r = MP.basicNorm(role || '');
    if (/facility|hfw|\bhf\b/.test(r)) return 'oic';
    if (/distributor|dispenser|cdd|registrar/.test(r)) return 'cdd';
    return null;
  }

  /**
   * Fill the template.
   * plan = { tree, agg, targetMap: {templateKey: microplanColIndex}, splitMode, users: [{code, name, phone, role}],
   *          employmentType, round: true }
   * Returns a log of what was written.
   */
  async function fillTemplate(wb, plan) {
    const { tree, agg } = plan;
    const log = { targetsWritten: 0, targetRows: 0, targetMissing: [], usersWritten: 0, sheets: [] };
    const helperCache = new Map();
    const helpers = async (code) => { if (!helperCache.has(code)) helperCache.set(code, await MP.helpersFor(tree, code)); return helperCache.get(code); };

    for (const ws of wb.worksheets) {
      const hm = headerMap(ws);
      if (!hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE) continue;
      const tkeys = Object.keys(hm).filter((k) => /TARGET/i.test(k) && plan.targetMap[k] !== undefined && plan.targetMap[k] !== null && plan.targetMap[k] !== '');
      const isUser = !!hm.HCM_ADMIN_CONSOLE_USER_NAME;
      if (tkeys.length && !isUser && !hm.HCM_ADMIN_CONSOLE_FACILITY_CODE) {
        let rowsSeen = 0, written = 0;
        for (let r = 3; r <= ws.rowCount; r++) {
          const row = ws.getRow(r);
          const code = s(row.getCell(hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE).value);
          if (!code) continue;
          rowsSeen++;
          if (!tree.nodes.has(code)) { log.targetMissing.push({ sheet: ws.name, row: r, code, why: 'code not in boundary tree' }); continue; }
          let anyMissing = false;
          for (const k of tkeys) {
            const res = MP.valueFor(tree, agg, code, Number(plan.targetMap[k]), plan.splitMode);
            if (res.v === null || res.v === undefined) { anyMissing = true; continue; }
            row.getCell(hm[k]).value = plan.round === false ? res.v : Math.round(res.v);
            written++;
          }
          if (anyMissing) log.targetMissing.push({ sheet: ws.name, row: r, code, why: 'no microplan value' });
        }
        log.targetsWritten += written; log.targetRows += rowsSeen;
        log.sheets.push({ sheet: ws.name, kind: 'target', rows: rowsSeen, cells: written });
      }
      if (isUser && plan.users && plan.users.length) {
        const adminCols = Object.keys(hm).filter((k) => /^ADMIN_/.test(k) && !/_HELPER$/.test(k)).sort((a, b) => hm[a] - hm[b]);
        // first free row = after the last row that has a name or boundary code
        let r = 3;
        for (let i = 3; i <= ws.rowCount; i++) {
          const row = ws.getRow(i);
          if (s(row.getCell(hm.HCM_ADMIN_CONSOLE_USER_NAME).value) || s(row.getCell(hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE).value)) r = i + 1;
        }
        for (const u of plan.users) {
          if (!u.code) continue;
          const row = ws.getRow(r++);
          const node = tree.nodes.get(u.code);
          const { helpers: hs } = await helpers(u.code);
          adminCols.forEach((k, lvl) => {
            row.getCell(hm[k]).value = lvl <= node.level ? node.path[lvl] : null;
            const hk = k + '_HELPER';
            if (hm[hk] && lvl >= 1 && lvl <= node.level) row.getCell(hm[hk]).value = hs[lvl - 1];
          });
          row.getCell(hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE).value = u.code;
          row.getCell(hm.HCM_ADMIN_CONSOLE_USER_NAME).value = u.name;
          if (hm.HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER) row.getCell(hm.HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER).value = u.phone;
          if (hm.HCM_ADMIN_CONSOLE_USER_ROLE_MULTISELECT_1 && u.role) row.getCell(hm.HCM_ADMIN_CONSOLE_USER_ROLE_MULTISELECT_1).value = u.role;
          if (hm.HCM_ADMIN_CONSOLE_USER_EMPLOYMENT_TYPE && plan.employmentType) row.getCell(hm.HCM_ADMIN_CONSOLE_USER_EMPLOYMENT_TYPE).value = plan.employmentType;
          if (hm.HCM_ADMIN_CONSOLE_USER_USAGE) row.getCell(hm.HCM_ADMIN_CONSOLE_USER_USAGE).value = 'Active';
          row.commit && row.commit();
          log.usersWritten++;
        }
        log.sheets.push({ sheet: ws.name, kind: 'users', rows: log.usersWritten });
      }
    }
    normaliseValidations(wb);
    return log;
  }

  /** ExcelJS re-emits list validations as overlapping ranges (e.g. O3:O202 + O10:O202), which makes
   *  Excel offer to "repair" the file. Rebuild every sheet's model into clean contiguous ranges. */
  function normaliseValidations(wb) {
    for (const ws of wb.worksheets) {
      const m = ws.dataValidations && ws.dataValidations.model;
      if (!m || !Object.keys(m).length) continue;
      const groups = new Map();
      for (const [addr, dv] of Object.entries(m)) {
        for (const piece of addr.split(' ')) {
          const [p1, p2] = piece.split(':');
          const a = p1.match(/^\$?([A-Z]+)\$?(\d+)$/), b = (p2 || p1).match(/^\$?([A-Z]+)\$?(\d+)$/);
          if (!a || !b) continue;
          for (let c = colNum(a[1]); c <= colNum(b[1]); c++) {
            const col = MP.colLetter(c - 1);
            const key = col + '|' + JSON.stringify(dv);
            if (!groups.has(key)) groups.set(key, { col, dv, rows: new Set() });
            for (let r = +a[2]; r <= +b[2]; r++) groups.get(key).rows.add(r);
          }
        }
      }
      const out = {};
      for (const g of groups.values()) {
        const rows = Array.from(g.rows).sort((x, y) => x - y);
        let st = rows[0], pv = rows[0];
        for (const r of rows.slice(1).concat([Infinity])) {
          if (r !== pv + 1) { out[st === pv ? g.col + st : g.col + st + ':' + g.col + pv] = g.dv; st = r; }
          pv = r;
        }
      }
      ws.dataValidations.model = out;
    }
  }

  /** Info the UI needs before filling: target keys + labels, user role options. */
  function templateFacts(wb) {
    const facts = { targetKeys: [], roleOptions: [], employmentOptions: [], userSheet: null };
    for (const ws of wb.worksheets) {
      const hm = headerMap(ws);
      if (!hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE) continue;
      if (hm.HCM_ADMIN_CONSOLE_USER_NAME) {
        facts.userSheet = ws.name;
        if (hm.HCM_ADMIN_CONSOLE_USER_ROLE_MULTISELECT_1) facts.roleOptions = allowedValues(wb, ws, hm.HCM_ADMIN_CONSOLE_USER_ROLE_MULTISELECT_1);
        if (hm.HCM_ADMIN_CONSOLE_USER_EMPLOYMENT_TYPE) facts.employmentOptions = allowedValues(wb, ws, hm.HCM_ADMIN_CONSOLE_USER_EMPLOYMENT_TYPE);
      } else if (!hm.HCM_ADMIN_CONSOLE_FACILITY_CODE) {
        for (const [k, col] of Object.entries(hm)) if (/TARGET/i.test(k) && !facts.targetKeys.find((t) => t.key === k)) facts.targetKeys.push({ key: k, label: s(ws.getRow(2).getCell(col).value) || k, sheet: ws.name });
      }
    }
    return facts;
  }

  root.MPW = { fillTemplate, templateFacts, guessRole, roleKind, allowedValues, headerMap };
  if (typeof module !== 'undefined') module.exports = root.MPW;
})(typeof window !== 'undefined' ? window : globalThis);
