/* Writes results into the console's own unified template using ExcelJS.
 * Fidelity rules, from the real console template:
 *  - every column is located by its technical key in (hidden) header row 1;
 *  - cells that hold formulas in the template (helper columns, boundary code) keep their formula and only get
 *    a fresh cached result, so the cascading dropdowns keep working when someone edits the file in Excel;
 *  - rows past the template's prepared range copy the last prepared row's formulas, styles and dropdowns;
 *  - hidden rows/columns/sheets, defined names and comments are left as ExcelJS loaded them. */
(function (root) {
  'use strict';
  const MP = root.MP || (typeof require === 'function' ? require('./engine.js') : null);

  /** Display text of an ExcelJS cell value. Formula cells without a cached result read as empty. */
  const s = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map((r) => r.text).join('').trim();
      if (v.formula !== undefined || v.sharedFormula !== undefined) return v.result === undefined || v.result === null || typeof v.result === 'object' ? '' : String(v.result).trim();
      if (v.result !== undefined) return String(v.result).trim();
      if (v.text !== undefined) return String(v.text).trim();
      if (v.error) return '';
      return '';
    }
    return String(v).trim();
  };
  const keyOf = (v) => s(v).replace(/\\_/g, '_');
  const isFormula = (v) => !!v && typeof v === 'object' && (v.formula !== undefined || v.sharedFormula !== undefined);

  /** Write a value; a formula cell keeps its formula and gets the value as its cached result. */
  function put(cell, value) {
    const v = cell.value;
    const empty = value === '' || value === null || value === undefined;
    if (isFormula(v)) { const keep = Object.assign({}, v); delete keep.result; keep.result = empty ? '' : value; cell.value = keep; }
    else cell.value = empty ? null : value;
  }

  /** Shift relative row references in a formula by d rows (absolute $rows and quoted text untouched). */
  function shiftFormula(f, d) {
    if (!d || !f) return f;
    return String(f).split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : part.replace(
      /(^|[^A-Za-z0-9_.$])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g,
      (m, pre, d1, col, d2, row) => pre + d1 + col + d2 + (d2 ? row : String(Number(row) + d))))).join('');
  }

  function headerMap(ws) {
    const m = {};
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => { const k = keyOf(cell.value); if (k && !m[k]) m[k] = col; });
    return m;
  }

  /** Allowed values for a column from the sheet's list validations (inline list or range ref). */
  function allowedValues(wb, ws, col) {
    const model = (ws.dataValidations && ws.dataValidations.model) || {};
    const letter = MP.colLetter(col - 1);
    for (const [addr, dv] of Object.entries(model)) {
      if (!dv || dv.type !== 'list' || !dv.formulae || !dv.formulae.length) continue;
      const first = addr.split(/[: ]/)[0].replace(/[\d$]+/g, '');
      if (first !== letter && !addr.split(' ').some((a) => a.replace(/[\d$]+/g, '').split(':')[0] === letter)) continue;
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
      } catch (e) { /* not a defined name */ }
    }
    return [];
  }
  function colNum(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
  const pickAllowed = (allowed, re, fallback) => (allowed || []).find((a) => re.test(a)) || fallback;

  /** Suggest a console role (from the template's own list) for a free-text designation. */
  function guessRole(designation, allowed) {
    const d = MP.basicNorm(designation);
    const want =
      /\boic\b|in ?charge|hf ?w|facility (worker|staff)|health facility/.test(d) && !/supervisor/.test(d) ? ['health facility worker', 'health facility', 'facility supervisor', 'facility'] :
      /\bcdd\b|distributor|dispenser|mobiliser|vaccinator/.test(d) ? ['distributor', 'dispenser', 'cdd'] :
      /registrar/.test(d) ? ['registrar', 'distributor'] :
      /logistic|store|warehouse|lmcu/.test(d) ? ['warehouse', 'logistic', 'store'] :
      /national/.test(d) ? ['national supervisor', 'supervisor'] :
      /\bstate\b|provinc/.test(d) ? ['provincial supervisor', 'state supervisor', 'national supervisor'] :
      /\blga\b|district|coordinator|focal/.test(d) ? ['district supervisor', 'lga supervisor', 'supervisor'] :
      /facility supervisor|hf supervisor/.test(d) ? ['health facility supervisor', 'facility supervisor'] :
      /supervisor|monitor/.test(d) ? ['team supervisor', 'field supervisor', 'proximity supervisor', 'supervisor'] :
      /dashboard|viewer/.test(d) ? ['dashboard'] : [];
    for (const w of want) { const hit = (allowed || []).find((a) => MP.basicNorm(a).includes(w)); if (hit) return hit; }
    return null;
  }
  function roleKind(role) {
    const r = MP.basicNorm(role || '');
    if (/facility worker|hfw|\boic\b/.test(r) || (/facility/.test(r) && !/supervisor/.test(r)) || r === 'health facility supervisor') return 'oic';
    if (/distributor|dispenser|cdd|registrar/.test(r)) return 'cdd';
    return null;
  }

  /** Helper-column result for level `lvl` on a row whose deepest selected boundary is `node`. */
  function helperResult(tree, node, lvl, computed) {
    if (lvl < 1 || lvl - 1 > node.level) return '';
    const names = node.path.slice(0, lvl);
    if (tree.pathToHash && tree.pathToHash.size) return tree.pathToHash.get(names.join('#')) || '';
    // No lookup table in this template: use the console's rule (sha256 of ancestor codes), and only point at
    // a children list when there is one.
    if (lvl - 1 === node.level && !node.children.length) return '';
    return computed[lvl - 1] || '';
  }

  /** Copy row `fromR` (formulas shifted, styles, dropdowns) into row `toR`, for rows past the prepared range. */
  function cloneRow(ws, fromR, toR, ncol, styleOnly) {
    const src = ws.getRow(fromR), dst = ws.getRow(toR);
    for (let c = 1; c <= ncol; c++) {
      const a = src.getCell(c), b = dst.getCell(c);
      if (a.style) b.style = JSON.parse(JSON.stringify(a.style));
      if (isFormula(a.value)) { const f = a.formula || (a.value && a.value.formula); if (f) b.value = { formula: shiftFormula(f, toR - fromR), result: '' }; }
      if (styleOnly) continue;
      const dv = a.dataValidation; if (dv) b.dataValidation = JSON.parse(JSON.stringify(dv));
    }
    if (src.height) dst.height = src.height;
  }

  /** Last row that is part of the template's prepared range (has formulas, a dropdown or any content). */
  function preparedEnd(ws) {
    let end = 2;
    ws.eachRow({ includeEmpty: false }, (row, r) => { if (r > end) end = r; });
    const m = (ws.dataValidations && ws.dataValidations.model) || {};
    for (const addr of Object.keys(m)) for (const piece of addr.split(' ')) { const mm = piece.match(/(\d+)$/); if (mm && +mm[1] > end) end = +mm[1]; }
    return end;
  }

  /** Read a cell without creating it (getRow/getCell would materialise thousands of empty rows on write). */
  function peek(ws, r, c) { if (!c) return ''; const row = ws.findRow(r); if (!row) return ''; const cell = row.findCell(c); return cell ? s(cell.value) : ''; }

  /** Last row that physically exists with a value (newer templates stop at the last row in use). */
  function lastPhysicalRow(ws) {
    let end = 2;
    ws.eachRow({ includeEmpty: false }, (row, r) => { if (r > end && row.values.some((v) => v !== null && v !== undefined && v !== '')) end = r; });
    return end;
  }

  /** Boundary level columns of a user/facility sheet: everything left of the boundary code that is not a helper or
   *  console field (ADMIN_KAMBIA_PHU, ITN_LGA, SIERRALEONE_VILLAGE …), in sheet order. */
  function levelCols(hm) {
    const bc = hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE || Infinity;
    return Object.keys(hm).filter((k) => hm[k] < bc && !/_HELPER$/.test(k) && !/^HCM_/.test(k)).sort((a, b) => hm[a] - hm[b]);
  }

  /** Rows already holding a user (name or boundary code). */
  function readUsers(ws) {
    const hm = headerMap(ws); const out = [];
    if (!hm.HCM_ADMIN_CONSOLE_USER_NAME) return out;
    const roleKeys = Object.keys(hm).filter((k) => /^HCM_ADMIN_CONSOLE_USER_ROLE_MULTISELECT_\d+$/.test(k)).sort((a, b) => hm[a] - hm[b]);
    const last = preparedEnd(ws);
    for (let r = 3; r <= last; r++) {
      if (!ws.findRow(r)) continue;
      const name = peek(ws, r, hm.HCM_ADMIN_CONSOLE_USER_NAME), code = peek(ws, r, hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE);
      if (!name && !code) continue;
      out.push({ row: r, name, code, phone: peek(ws, r, hm.HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER), roles: roleKeys.map((k) => peek(ws, r, hm[k])).filter(Boolean) });
    }
    return out;
  }

  /**
   * Fill the template.
   * plan = { tree, agg, targetMap: {templateKey: microplanColIndex}, splitMode, users: [{code, name, phone, role|roles}],
   *          employmentType, activate: Set<code> | 'all' | null, round: true }
   */
  async function fillTemplate(wb, plan) {
    const { tree, agg } = plan;
    const log = { targetsWritten: 0, targetRows: 0, targetMissing: [], usersWritten: 0, rowsAdded: 0, facilitiesActivated: 0, facilitiesTotal: 0, sheets: [] };
    const helperCache = new Map();
    const helpers = async (code) => { if (!helperCache.has(code)) helperCache.set(code, (await MP.helpersFor(tree, code)).helpers); return helperCache.get(code); };

    for (const ws of wb.worksheets) {
      const hm = headerMap(ws);
      if (!hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE) continue;
      const isUser = !!hm.HCM_ADMIN_CONSOLE_USER_NAME, isFacility = !!hm.HCM_ADMIN_CONSOLE_FACILITY_CODE;
      const tkeys = Object.keys(hm).filter((k) => /TARGET/i.test(k) && plan.targetMap && plan.targetMap[k] !== undefined && plan.targetMap[k] !== null && plan.targetMap[k] !== '');

      if (tkeys.length && !isUser && !isFacility && agg) {
        let rowsSeen = 0, written = 0;
        for (let r = 3; r <= ws.rowCount; r++) {
          const code = peek(ws, r, hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE);
          if (!code) continue;
          const row = ws.getRow(r);
          rowsSeen++;
          if (!tree.nodes.has(code)) { log.targetMissing.push({ sheet: ws.name, row: r, code, why: 'code not in boundary tree' }); continue; }
          let anyMissing = false;
          for (const k of tkeys) {
            const res = MP.valueFor(tree, agg, code, Number(plan.targetMap[k]), plan.splitMode);
            if (res.v === null || res.v === undefined) { anyMissing = true; continue; }
            put(row.getCell(hm[k]), plan.round === false ? res.v : Math.round(res.v));
            written++;
          }
          if (anyMissing) log.targetMissing.push({ sheet: ws.name, row: r, code, why: 'no microplan value' });
        }
        log.targetsWritten += written; log.targetRows += rowsSeen;
        log.sheets.push({ sheet: ws.name, kind: 'target', rows: rowsSeen, cells: written });
      }

      // demo runs: the console rejects target rows with a blank mandatory target, so give each one a plausible number
      if (plan.demoTargets && !isUser && !isFacility) {
        const cols = demoTargetKeys(ws, hm); let n = 0;
        for (let r = 3; r <= ws.rowCount && cols.length; r++) {
          const code = peek(ws, r, hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE); if (!code) continue;
          const row = ws.getRow(r);
          for (const k of cols) if (peek(ws, r, hm[k]) === '') { put(row.getCell(hm[k]), demoValue(code + '|' + k)); n++; }
        }
        log.demoTargets = (log.demoTargets || 0) + n;
      }

      if (isFacility && plan.activate && hm.HCM_ADMIN_CONSOLE_FACILITY_USAGE) {
        const activeVal = pickAllowed(allowedValues(wb, ws, hm.HCM_ADMIN_CONSOLE_FACILITY_USAGE), /^active$/i, 'Active');
        for (let r = 3; r <= ws.rowCount; r++) {
          const code = peek(ws, r, hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE);
          if (!code) continue;
          const row = ws.getRow(r);
          log.facilitiesTotal++;
          const cell = row.getCell(hm.HCM_ADMIN_CONSOLE_FACILITY_USAGE);
          if ((plan.activate === 'all' || plan.activate.has(code)) && !/^active$/i.test(s(cell.value))) { put(cell, activeVal); log.facilitiesActivated++; }
        }
      }

      if (isUser && plan.users && plan.users.length) {
        const adminCols = levelCols(hm);
        const roleKeys = Object.keys(hm).filter((k) => /^HCM_ADMIN_CONSOLE_USER_ROLE_MULTISELECT_\d+$/.test(k)).sort((a, b) => hm[a] - hm[b]);
        const empVals = hm.HCM_ADMIN_CONSOLE_USER_EMPLOYMENT_TYPE ? allowedValues(wb, ws, hm.HCM_ADMIN_CONSOLE_USER_EMPLOYMENT_TYPE) : [];
        const activeVal = hm.HCM_ADMIN_CONSOLE_USER_USAGE ? pickAllowed(allowedValues(wb, ws, hm.HCM_ADMIN_CONSOLE_USER_USAGE), /^active$/i, 'Active') : 'Active';
        const end = preparedEnd(ws);
        const ncol = Math.max(ws.columnCount, ...Object.values(hm));
        const lastPhys = lastPhysicalRow(ws);
        // first free row = after the last row that already holds a user
        let r = 3;
        for (let i = 3; i <= end; i++) if (peek(ws, i, hm.HCM_ADMIN_CONSOLE_USER_NAME) || peek(ws, i, hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE)) r = i + 1;
        const existing = readUsers(ws); log.existingUsers = existing.length;
        // phones already in the sheet as text digits become numbers too, so the whole column is one type
        if (hm.HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER) for (const u of existing) {
          const cell = ws.getRow(u.row).getCell(hm.HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER);
          if (typeof cell.value === 'string' && /^'?\s*\+?[\d\s-]{4,}$/.test(cell.value)) { putPhone(cell, cell.value); log.phonesConverted = (log.phonesConverted || 0) + 1; }
        }
        for (const u of plan.users) {
          if (!u.code || !tree.nodes.has(u.code)) continue;
          if (r > end) { cloneRow(ws, end, r, ncol); log.rowsAdded++; }
          else if (r > lastPhys && lastPhys >= 3) cloneRow(ws, lastPhys, r, ncol, true); // newer templates only hold rows in use
          const row = ws.getRow(r++);
          const node = tree.nodes.get(u.code);
          const hs = await helpers(u.code);
          adminCols.forEach((k, lvl) => {
            put(row.getCell(hm[k]), lvl <= node.level ? node.path[lvl] : '');
            const hk = k + '_HELPER';
            if (hm[hk]) put(row.getCell(hm[hk]), helperResult(tree, node, lvl, hs));
          });
          put(row.getCell(hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE), u.code);
          put(row.getCell(hm.HCM_ADMIN_CONSOLE_USER_NAME), u.name);
          if (hm.HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER) putPhone(row.getCell(hm.HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER), u.phone);
          const roles = Array.from(new Set((u.roles && u.roles.length ? u.roles : [u.role]).filter(Boolean)));
          roleKeys.forEach((k, i) => put(row.getCell(hm[k]), roles[i] || ''));
          if (roles.length > roleKeys.length) log.roleOverflow = (log.roleOverflow || 0) + 1;
          if (hm.HCM_ADMIN_CONSOLE_USER_EMPLOYMENT_TYPE && plan.employmentType) put(row.getCell(hm.HCM_ADMIN_CONSOLE_USER_EMPLOYMENT_TYPE), pickAllowed(empVals, new RegExp('^' + plan.employmentType + '$', 'i'), plan.employmentType));
          if (hm.HCM_ADMIN_CONSOLE_USER_USAGE) put(row.getCell(hm.HCM_ADMIN_CONSOLE_USER_USAGE), activeVal);
          log.usersWritten++;
        }
        log.sheets.push({ sheet: ws.name, kind: 'users', rows: log.usersWritten });
      }
    }
    log.mandatoryBlank = mandatoryBlanks(wb);
    normaliseValidations(wb);
    return log;
  }

  /** Phones go in as numbers (no text-stored digits, no apostrophe); the leading 0 is dropped by design. */
  function putPhone(cell, phone) {
    const d = String(phone == null ? '' : phone).replace(/\D/g, '');
    if (!d) { put(cell, ''); return; }
    if (d.length <= 15) { put(cell, Number(d)); cell.numFmt = '0'; } else put(cell, d);
  }
  const isMandatory = (label) => /mandatory/i.test(label || '');
  /** Target columns a demo must fill: those labelled mandatory, or every target column when none is labelled. */
  function demoTargetKeys(ws, hm) {
    const t = Object.keys(hm).filter((k) => /TARGET/i.test(k));
    const m = t.filter((k) => isMandatory(s(ws.getRow(2).getCell(hm[k]).value)));
    return m.length ? m : t;
  }
  function demoValue(key) { let h = 2166136261; for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); } return 50 + ((h >>> 0) % 451); }
  /** Mandatory columns (row-2 label says "Mandatory") left blank on rows in use — the console rejects these. */
  function mandatoryBlanks(wb) {
    const out = [];
    for (const ws of wb.worksheets) {
      const hm = headerMap(ws); if (!hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE) continue;
      const keys = Object.keys(hm).filter((k) => isMandatory(s(ws.getRow(2).getCell(hm[k]).value)) && !/_HELPER$/.test(k));
      if (!keys.length) continue;
      const inUse = hm.HCM_ADMIN_CONSOLE_USER_NAME ? (r) => peek(ws, r, hm.HCM_ADMIN_CONSOLE_USER_NAME) || peek(ws, r, hm.HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER) : (r) => peek(ws, r, hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE);
      const last = preparedEnd(ws);
      for (const k of keys) {
        const rows = []; for (let r = 3; r <= last; r++) if (ws.findRow(r) && inUse(r) && peek(ws, r, hm[k]) === '') rows.push(r);
        if (rows.length) out.push({ sheet: ws.name, key: k, label: s(ws.getRow(2).getCell(hm[k]).value), count: rows.length, rows: rows.slice(0, 5) });
      }
    }
    return out;
  }

  /** ExcelJS stores validations per cell and re-emits them as overlapping ranges (C3:C1002 + C10:C1002); in the
   *  second copy a relative formula such as INDIRECT(B3&"_LIST") then points 7 rows up, breaking the cascade.
   *  Rebuild each sheet's model as clean contiguous ranges, shifting relative formulas for any run that does not
   *  start where the original range did. */
  function normaliseValidations(wb) {
    for (const ws of wb.worksheets) {
      const m = ws.dataValidations && ws.dataValidations.model;
      if (!m || !Object.keys(m).length) continue;
      const groups = new Map();
      const keyOf = new Map();
      for (const [addr, dv] of Object.entries(m)) {
        if (!keyOf.has(dv)) keyOf.set(dv, JSON.stringify(dv));
        const dvKey = keyOf.get(dv);
        for (const piece of addr.split(' ')) {
          const [p1, p2] = piece.split(':');
          const a = p1.match(/^\$?([A-Z]+)\$?(\d+)$/), b = (p2 || p1).match(/^\$?([A-Z]+)\$?(\d+)$/);
          if (!a || !b) continue;
          for (let c = colNum(a[1]); c <= colNum(b[1]); c++) {
            const col = MP.colLetter(c - 1);
            const key = col + '|' + dvKey;
            if (!groups.has(key)) groups.set(key, { col, dv, spans: [] });
            groups.get(key).spans.push([+a[2], +b[2]]);
          }
        }
      }
      const out = {};
      for (const g of groups.values()) {
        // merge overlapping / touching spans into contiguous runs
        const spans = g.spans.sort((x, y) => x[0] - y[0]); const runs = [];
        for (const [a, b] of spans) { const last = runs[runs.length - 1]; if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b); else runs.push([a, b]); }
        const base = runs[0][0];
        for (const [st, en] of runs) {
          const dv = st === base ? g.dv : Object.assign({}, g.dv, { formulae: (g.dv.formulae || []).map((f) => (typeof f === 'string' ? shiftFormula(f, st - base) : f)) });
          out[st === en ? g.col + st : g.col + st + ':' + g.col + en] = dv;
        }
      }
      ws.dataValidations.model = out;
    }
  }

  /** Info the UI needs before filling: target keys + labels, role and employment options, existing users. */
  function templateFacts(wb) {
    const facts = { targetKeys: [], roleOptions: [], employmentOptions: [], userSheet: null, roleSlots: 0, existingUsers: [], facilityCount: 0, facilityActive: 0, facilities: [] };
    for (const ws of wb.worksheets) {
      const hm = headerMap(ws);
      if (!hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE) continue;
      if (hm.HCM_ADMIN_CONSOLE_USER_NAME) {
        facts.userSheet = ws.name;
        if (hm.HCM_ADMIN_CONSOLE_USER_ROLE_MULTISELECT_1) facts.roleOptions = allowedValues(wb, ws, hm.HCM_ADMIN_CONSOLE_USER_ROLE_MULTISELECT_1);
        if (hm.HCM_ADMIN_CONSOLE_USER_EMPLOYMENT_TYPE) facts.employmentOptions = allowedValues(wb, ws, hm.HCM_ADMIN_CONSOLE_USER_EMPLOYMENT_TYPE);
        facts.roleSlots = Object.keys(hm).filter((k) => /^HCM_ADMIN_CONSOLE_USER_ROLE_MULTISELECT_\d+$/.test(k)).length;
        facts.existingUsers = readUsers(ws);
      } else if (hm.HCM_ADMIN_CONSOLE_FACILITY_CODE) {
        for (let r = 3; r <= ws.rowCount; r++) {
          const code = peek(ws, r, hm.HCM_ADMIN_CONSOLE_BOUNDARY_CODE); if (!code) continue;
          const usage = peek(ws, r, hm.HCM_ADMIN_CONSOLE_FACILITY_USAGE);
          facts.facilityCount++; if (/^active$/i.test(usage)) facts.facilityActive++;
          facts.facilities.push({ code, name: peek(ws, r, hm.HCM_ADMIN_CONSOLE_FACILITY_NAME), usage });
        }
      } else {
        for (const [k, col] of Object.entries(hm)) if (/TARGET/i.test(k) && !facts.targetKeys.find((t) => t.key === k)) { const label = s(ws.getRow(2).getCell(col).value) || k; facts.targetKeys.push({ key: k, label, sheet: ws.name, mandatory: isMandatory(label) }); }
      }
    }
    return facts;
  }

  /** Boundary codes a set of codes depends on: each code and all of its ancestors (stores up the chain). */
  function withAncestors(tree, codes) {
    const out = new Set();
    for (const c of codes) { let n = tree.nodes.get(c); while (n && !out.has(n.code)) { out.add(n.code); n = n.parent ? tree.nodes.get(n.parent) : null; } }
    return out;
  }

  /* ---------- package-level fixes around ExcelJS ----------
   * Newer console templates (Apache POI) write data-validation formulas as CDATA and booleans as "true"; ExcelJS
   * drops CDATA text (the cascading boundary dropdowns lose their formula) and reads sheet="true" as unprotected.
   * Normalise the XML before ExcelJS loads it, and put each sheet's original <sheetProtection> back afterwards
   * (ExcelJS cannot write the legacy password hash). */
  const XL = () => root.XLSX || (typeof require !== 'undefined' ? require('xlsx') : null);
  const td = () => new TextDecoder('utf-8'), te = () => new TextEncoder();
  const escXml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function zipEntries(u8) {
    const C = XL().CFB; const cfb = C.read(u8, { type: 'array' }); const out = new Map();
    cfb.FileIndex.forEach((fi, i) => { if (fi.type === 2 && fi.content && !/\u0001Sh33tJ5$/.test(cfb.FullPaths[i])) out.set(cfb.FullPaths[i].replace(/^Root Entry\//, ''), fi.content); });
    return { cfb, out };
  }
  function zipWrite(entries) {
    const C = XL().CFB; const cfb = C.utils.cfb_new();
    for (const [p, content] of entries) C.utils.cfb_add(cfb, p, content);
    C.utils.cfb_del(cfb, '\u0001Sh33tJ5');
    const res = C.write(cfb, { fileType: 'zip', type: 'array', compression: true });
    return res instanceof Uint8Array ? res : new Uint8Array(res);
  }
  const isSheetXml = (p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p);
  /** Map sheet name → worksheet part path. */
  function sheetParts(entries) {
    const wbx = td().decode(entries.get('xl/workbook.xml')); const rels = td().decode(entries.get('xl/_rels/workbook.xml.rels'));
    const target = {}; rels.replace(/<Relationship\b[^>]*>/g, (tag) => { const id = (tag.match(/\bId="([^"]+)"/) || [])[1], t = (tag.match(/\bTarget="([^"]+)"/) || [])[1]; if (id && t) target[id] = t.replace(/^\/?(xl\/)?/, 'xl/'); return tag; });
    const out = {}; wbx.replace(/<sheet\b[^>]*>/g, (tag) => { const n = (tag.match(/\bname="([^"]*)"/) || [])[1], id = (tag.match(/\br:id="([^"]+)"/) || [])[1]; if (n != null && target[id]) out[n.replace(/&amp;/g, '&')] = target[id]; return tag; });
    return out;
  }
  function prepareTemplate(u8) {
    let changed = false; const { out } = zipEntries(u8);
    for (const [p, c] of out) {
      if (!isSheetXml(p)) continue;
      let x = td().decode(c); const before = x;
      x = x.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (m, t) => escXml(t));
      x = x.replace(/(<(?:sheetProtection|col|row|dataValidation|sheetView|pageSetup|sheetFormatPr|pane|selection)\b[^>]*>)/g, (tag) => tag.replace(/="true"/g, '="1"').replace(/="false"/g, '="0"'));
      if (x !== before) { out.set(p, te().encode(x)); changed = true; }
    }
    return changed ? zipWrite(out) : u8;
  }
  function finishTemplate(origU8, outU8) {
    const a = zipEntries(origU8).out, b = zipEntries(outU8).out;
    const pa = sheetParts(a), pb = sheetParts(b); let changed = false;
    for (const [name, part] of Object.entries(pa)) {
      const ox = td().decode(a.get(part)); const prot = (ox.match(/<sheetProtection\b[^>]*\/>/) || [])[0];
      if (!prot || !pb[name] || !b.get(pb[name])) continue;
      let x = td().decode(b.get(pb[name]));
      if (/<sheetProtection\b[^>]*\/>/.test(x)) x = x.replace(/<sheetProtection\b[^>]*\/>/, prot);
      else x = x.replace(/(<\/sheetData>|<sheetData\/>)/, '$1' + prot);
      b.set(pb[name], te().encode(x)); changed = true;
    }
    return changed ? zipWrite(b) : outU8;
  }

  /** Load a template buffer into an ExcelJS workbook (with the POI fixes) and save it back. */
  async function loadTemplate(ExcelJSLib, buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const wb = new ExcelJSLib.Workbook(); await wb.xlsx.load(prepareTemplate(u8)); wb.__orig = u8; return wb;
  }
  async function saveTemplate(wb) {
    normaliseValidations(wb);
    const out = new Uint8Array(await wb.xlsx.writeBuffer());
    return wb.__orig ? finishTemplate(wb.__orig, out) : out;
  }

  root.MPW = { loadTemplate, saveTemplate, prepareTemplate, finishTemplate, levelCols, fillTemplate, templateFacts, guessRole, roleKind, allowedValues, headerMap, readUsers, withAncestors, shiftFormula, cellText: s };
  if (typeof module !== 'undefined') module.exports = root.MPW;
})(typeof window !== 'undefined' ? window : globalThis);
