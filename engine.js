/* Microplan → DIGIT HCM unified template engine.
 * Pure functions over 2-D arrays (one per sheet). No DOM. Runs in browser and Node.
 */
(function (root) {
  'use strict';

  // ───────────────────────── text normalisation ─────────────────────────
  const FACILITY_SYNONYMS = [
    [/\bprimary health care cent(re|er)s?\b/g, 'phc'],
    [/\bprimary health cent(re|er)s?\b/g, 'phc'],
    [/\bprimary health care clinic\b/g, 'phc'],
    [/\bprimary health clinic\b/g, 'phc'],
    [/\bprimary healthcare cent(re|er)\b/g, 'phc'],
    [/\bmodel primary health care cent(re|er)\b/g, 'model phc'],
    [/\bphcc\b/g, 'phc'],
    [/\bcomprehensive health cent(re|er)\b/g, 'chc'],
    [/\bbasic health cent(re|er)\b/g, 'bhc'],
    [/\bbasic health clinic\b/g, 'bhc'],
    [/\bhealth care cent(re|er)\b/g, 'hc'],
    [/\bhealth cent(re|er)\b/g, 'hc'],
    [/\bhealth clinic\b/g, 'hc'],
    [/\bhealth post\b/g, 'hp'],
    [/\bdispensary\b/g, 'disp'],
    [/\bgeneral hospital\b/g, 'gh'],
    [/\bcottage hospital\b/g, 'ch'],
    [/\bmaternity\b/g, 'mat'],
    [/\bmillenn?ium development goals?\b/g, 'mdg'],
    [/\bcent(re|er)\b/g, 'ctr'],
    [/\bsaint\b/g, 'st'],
    [/\bmount\b/g, 'mt'],
  ];
  const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
  const STOP = new Set(['the', 'of', 'and', 'ward', 'lga', 'community', 'village', 'settlement', 'area']);

  function basicNorm(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[‘’'`´]/g, '')       // Ja'afar → jaafar
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function canon(s) {
    let t = ' ' + basicNorm(s) + ' ';
    for (const [re, rep] of FACILITY_SYNONYMS) t = t.replace(re, rep);
    t = t.replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, (m) => ROMAN[m]);
    t = t.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2'); // odeloba1 → odeloba 1
    t = t.replace(/\b0+(\d)/g, '$1');                                      // adm 01 → adm 1
    return t.replace(/\s+/g, ' ').trim();
  }

  // Variants we try when scoring: canonical, without a leading 2-letter state prefix ("oy", "ko"),
  // and with generic stop-words removed.
  function variants(s) {
    const c = canon(s);
    const out = new Set([c, basicNorm(s).replace(/\b0+(\d)/g, '$1')]);
    const toks = c.split(' ');
    if (toks.length >= 2 && /^[a-z]{2}$/.test(toks[0]) && !['st', 'mt', 'hc', 'hp', 'gh', 'ch'].includes(toks[0])) out.add(toks.slice(1).join(' '));
    for (const v of Array.from(out)) {
      const st = v.split(' ').filter((w) => !STOP.has(w)).join(' ');
      if (st) out.add(st);
    }
    return Array.from(out);
  }

  // ───────────────────────── similarity ─────────────────────────
  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  const ratio = (a, b) => (!a.length && !b.length ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length));

  function jaroWinkler(a, b) {
    if (a === b) return 1;
    const la = a.length, lb = b.length;
    if (!la || !lb) return 0;
    const md = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
    const am = new Array(la).fill(false), bm = new Array(lb).fill(false);
    let m = 0;
    for (let i = 0; i < la; i++) {
      const lo = Math.max(0, i - md), hi = Math.min(i + md + 1, lb);
      for (let j = lo; j < hi; j++) if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; m++; break; }
    }
    if (!m) return 0;
    let t = 0, k = 0;
    for (let i = 0; i < la; i++) if (am[i]) { while (!bm[k]) k++; if (a[i] !== b[k]) t++; k++; }
    const j = (m / la + m / lb + (m - t / 2) / m) / 3;
    let p = 0; while (p < 4 && a[p] === b[p]) p++;
    return j + p * 0.1 * (1 - j);
  }

  const numsOf = (s) => (s.match(/\d+/g) || []).sort().join(',');
  const DISCRIM = new Set(['north', 'south', 'east', 'west', 'central', 'upper', 'lower', 'new', 'old', 'big', 'small', 'a', 'b', 'c', 'd', 'e', 'ta', 'na']);
  const discOf = (s) => s.split(' ').filter((w) => DISCRIM.has(w)).sort().join(',');

  function scorePair(x, y) {
    if (x === y) return 1;
    // numbers must agree: "Apa Meta 1" ≠ "Apa Meta 2", "Ward 3" ≠ "Ward 13"
    if (numsOf(x) !== numsOf(y)) return Math.min(0.5, ratio(x, y));
    // so must directional / sibling markers: "Komi East" ≠ "Komi West", "Bula A" ≠ "Bula B"
    if (discOf(x) !== discOf(y)) return Math.min(0.6, ratio(x, y));
    const sx = x.split(' ').sort().join(' '), sy = y.split(' ').sort().join(' ');
    if (sx === sy) return 0.98;                                 // word-order swap
    if (x.replace(/ /g, '') === y.replace(/ /g, '')) return 0.97; // "Mu allo" vs "Muallo"
    const r = Math.max(ratio(x, y), ratio(sx, sy));
    const jw = jaroWinkler(x, y);
    // token-set: shared words relative to the shorter name
    const tx = new Set(x.split(' ')), ty = new Set(y.split(' '));
    let inter = 0; tx.forEach((w) => { if (ty.has(w)) inter++; });
    const ts = inter / Math.max(1, Math.min(tx.size, ty.size));
    const tsAdj = ts === 1 && Math.min(tx.size, ty.size) >= 2 ? 0.93 : ts * 0.85;
    return Math.max(r, jw * 0.97, tsAdj);
  }

  function similarity(a, b) {
    const va = variants(a), vb = variants(b);
    let best = 0;
    for (const x of va) for (const y of vb) { const s = scorePair(x, y); if (s > best) best = s; if (best === 1) return 1; }
    return best;
  }

  // ───────────────────────── sheet helpers ─────────────────────────
  const cellStr = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const isNum = (v) => v !== '' && v !== null && v !== undefined && !isNaN(Number(String(v).replace(/,/g, '')));
  const toNum = (v) => (isNum(v) ? Number(String(v).replace(/,/g, '')) : null);
  // Console helper keys (H_ + sha256) sit next to paths in the lookup sheet too; they are not boundary codes.
  const isHelperHash = (s) => /^H_[0-9a-f]{64}$/i.test(s);
  const looksLikeCode = (s) => !!s && !isHelperHash(s) && !/\s/.test(s) && !s.includes('#') && /^[A-Za-z0-9_\-\.]+$/.test(s) && s.length >= 4;

  const ACRONYMS = new Set(['LGA', 'PHU', 'HF', 'DP', 'CDD', 'OIC', 'IDP', 'LGEA', 'CHC', 'PHC', 'MCHP', 'CHP', 'DH']);

  /** Some templates carry boundary codes where names should be (ITN_NI_01_01_BIU). Recover a readable name from the
   *  code: the words after the numbering ("BIU", "BO MANDARAGIRAU DH", "AUDI 5"). */
  function nameFromCode(code) {
    const toks = String(code).split('_');
    let i = toks.findIndex((t) => /^\d+$/.test(t));
    if (i < 0) return toks.length > 1 ? toks.slice(1).join(' ') : code;
    while (i < toks.length && /^\d+$/.test(toks[i])) i++;
    const tail = toks.slice(i);
    if (!tail.length) return code;
    return tail.map((w) => (w.length <= 3 || ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ');
  }
  const isCodeName = (name, code) => !!name && (name === code || (/^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(name) && /_\d/.test(name)));

  /** "ADMIN_KAMBIA_PHU" → "PHU", "ADMIN_STATE" → "State" (labels in some templates repeat the technical key). */
  function prettyLevels(keys, labels) {
    const stripped = keys.map((k) => k.replace(/^ADMIN_/, ''));
    labels = labels.map((l) => (l && keys.includes(l.replace(/\\_/g, '_')) ? '' : l));
    let pre = stripped[0] || '';
    for (const k of stripped) while (pre && !k.startsWith(pre)) pre = pre.slice(0, pre.lastIndexOf('_') > 0 ? pre.lastIndexOf('_') : 0);
    if (pre && !pre.endsWith('_')) pre = stripped.every((k) => k.startsWith(pre + '_')) ? pre + '_' : '';
    return labels.map((l, i) => {
      const raw = l && l.replace(/\\_/g, '_') !== keys[i] && !/^ADMIN_/.test(l) ? l : stripped[i].slice(pre.length) || stripped[i];
      return raw.replace(/_/g, ' ').split(' ').map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ');
    });
  }

  // ───────────────────────── template parsing ─────────────────────────
  /**
   * sheets: [{name, hidden, rows: any[][]}]
   * Returns the boundary tree, detected technical sheets and level metadata.
   */
  function parseTemplate(sheets) {
    const pathToCode = new Map();
    const pathToHash = new Map(); // name path → console helper key, when the template carries its own lookup
    const tech = { facility: null, user: null, targets: [], other: [] };
    let levelKeys = null, levelLabels = null;

    for (const sh of sheets) {
      const rows = sh.rows || [];
      const r0 = (rows[0] || []).map(cellStr);
      const keys = r0.map((k) => k.replace(/\\_/g, '_'));
      const has = (k) => keys.indexOf(k);
      if (has('HCM_ADMIN_CONSOLE_BOUNDARY_CODE') >= 0) {
        // Boundary level columns are everything left of the boundary code column (ADMIN_STATE, ITN_LGA, ...),
        // except the helper columns some console versions interleave.
        const bc = has('HCM_ADMIN_CONSOLE_BOUNDARY_CODE');
        const adminCols = keys.map((k, i) => [k, i]).filter(([k, i]) => i < bc && k && !/_HELPER$/.test(k) && !/^HCM_/.test(k));
        const helperCols = keys.map((k, i) => [k, i]).filter(([k, i]) => i < bc && /_HELPER$/.test(k));
        const info = { sheet: sh.name, keys, labels: (rows[1] || []).map(cellStr), adminCols, helperCols,
          boundaryCol: has('HCM_ADMIN_CONSOLE_BOUNDARY_CODE'), headerRows: 2 };
        if (!levelKeys && adminCols.length) { levelKeys = adminCols.map(([k]) => k); levelLabels = prettyLevels(levelKeys, adminCols.map(([, i]) => cellStr((rows[1] || [])[i]))); }
        if (has('HCM_ADMIN_CONSOLE_FACILITY_CODE') >= 0) tech.facility = info;
        else if (has('HCM_ADMIN_CONSOLE_USER_NAME') >= 0) tech.user = info;
        else if (keys.some((k) => /TARGET/i.test(k))) { info.targetCols = keys.map((k, i) => [k, i]).filter(([k]) => /TARGET/i.test(k)); tech.targets.push(info); }
        else tech.other.push(info);
        // rows of these sheets also teach us path→code
        for (let r = 2; r < rows.length; r++) {
          const row = rows[r] || [];
          const code = cellStr(row[info.boundaryCol]);
          if (!code) continue;
          const names = adminCols.map(([, i]) => cellStr(row[i]));
          let last = names.length - 1; while (last >= 0 && !names[last]) last--;
          if (last < 0) continue;
          const p = names.slice(0, last + 1);
          if (p.some((x) => !x)) continue;
          if (!pathToCode.has(p.join('#'))) pathToCode.set(p.join('#'), code);
        }
      }
      // hidden path→code sheets: any row with an "A#B#C" cell and a code-looking neighbour.
      // Once a column is known to hold paths, single-segment rows in it (the root) count too.
      // Single-segment rows (the root) count only when that name starts other paths in the same column,
      // so dropdown-list rows that happen to share these columns are not mistaken for boundaries.
      // A path column's neighbour counts as a code column only if its values look like codes (digits or
      // underscores) - newer templates keep "path -> child names" dropdown rows right next to path -> code.
      const pathCols = new Map(), hashCols = new Map(), firstSegs = new Set(), cand = new Map();
      for (const row of rows) {
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          const v = cellStr(row[c]);
          if (v.indexOf('#') <= 0) continue;
          const r = cellStr(row[c + 1]), l = cellStr(row[c - 1]);
          if (isHelperHash(r) || isHelperHash(l)) { const off = isHelperHash(r) ? 1 : -1; pathToHash.set(v, cellStr(row[c + off])); hashCols.set(c, off); firstSegs.add(v.split('#')[0]); continue; }
          for (const off of [1, -1]) {
            const val = cellStr(row[c + off]); if (!val || val.indexOf('#') >= 0) continue;
            const k = c + '|' + off; if (!cand.has(k)) cand.set(k, { c, off, pairs: [], codeish: 0 });
            const e = cand.get(k); e.pairs.push([v, val]); if (looksLikeCode(val) && /[\d_]/.test(val)) e.codeish++;
          }
        }
      }
      for (const e of cand.values()) {
        if (!e.pairs.length || e.codeish / e.pairs.length < 0.8) continue;
        pathCols.set(e.c, e.off);
        for (const [v, val] of e.pairs) if (looksLikeCode(val)) { pathToCode.set(v, val); firstSegs.add(v.split('#')[0]); }
      }
      for (const [c, off] of pathCols) for (const row of rows) {
        const v = cellStr((row || [])[c]), code = cellStr((row || [])[c + off]);
        if (v && v.indexOf('#') < 0 && firstSegs.has(v) && v !== code && looksLikeCode(code)) pathToCode.set(v, code);
      }
      for (const [c, off] of hashCols) for (const row of rows) {
        const v = cellStr((row || [])[c]), h = cellStr((row || [])[c + off]);
        if (v && v.indexOf('#') < 0 && firstSegs.has(v) && isHelperHash(h)) pathToHash.set(v, h);
      }
    }
    // single-segment paths (the root) are written without '#'; recover root from 2-segment paths
    const nodes = new Map(); // code → node
    const byPath = new Map();
    let codeNamed = 0;
    const paths = Array.from(pathToCode.keys()).sort((a, b) => a.split('#').length - b.split('#').length);
    for (const p of paths) {
      const segs = p.split('#');
      const code = pathToCode.get(p);
      if (nodes.has(code) && nodes.get(code).path.length <= segs.length) continue;
      const node = { code, name: segs[segs.length - 1], level: segs.length - 1, path: segs, parent: null, children: [] };
      nodes.set(code, node); byPath.set(p, node);
      codeNamed += isCodeName(node.name, code) ? 1 : 0;
    }
    // attach parents; synthesise missing ancestors so the tree is connected
    let synth = 0;
    const ensure = (segs) => {
      const p = segs.join('#');
      if (byPath.has(p)) return byPath.get(p);
      const code = '__MISSING_' + (++synth);
      const node = { code, name: segs[segs.length - 1], level: segs.length - 1, path: segs, parent: null, children: [], synthetic: true };
      nodes.set(code, node); byPath.set(p, node);
      if (segs.length > 1) { const par = ensure(segs.slice(0, -1)); node.parent = par.code; par.children.push(code); }
      return node;
    };
    for (const [p, node] of Array.from(byPath.entries())) {
      if (node.path.length > 1 && node.parent === null) {
        const par = ensure(node.path.slice(0, -1));
        node.parent = par.code; if (!par.children.includes(node.code)) par.children.push(node.code);
      }
    }
    // node.path holds the template's own values (written back as-is); node.name / node.dpath are for people.
    const namesAreCodes = nodes.size && codeNamed / nodes.size > 0.8;
    for (const n of nodes.values()) n.name = namesAreCodes ? nameFromCode(n.path[n.path.length - 1]) : n.name;
    for (const n of nodes.values()) n.dpath = namesAreCodes ? n.path.map((x) => nameFromCode(x)) : n.path;
    const roots = Array.from(nodes.values()).filter((n) => n.parent === null).map((n) => n.code);
    const depth = Math.max(0, ...Array.from(nodes.values()).map((n) => n.level));
    if (!levelLabels) { levelLabels = []; for (let i = 0; i <= depth; i++) levelLabels.push('Level ' + i); }
    return { nodes, roots, depth, levelKeys, levelLabels, tech, synthetic: synth, pathToHash, namesAreCodes };
  }

  // ───────────────────────── microplan parsing ─────────────────────────
  const LEVEL_PATTERNS = [
    ['country', /\bcountry\b|\bnation/],
    ['state', /\bstate\b|\bprovince\b|\bregion\b/],
    ['lga', /\blga\b|local gov|\bdistrict\b|\bcounty\b/],
    ['chiefdom', /\bchiefdom\b/],
    ['ward', /\bwards?\b/],
    ['hf', /health ?facilit|\bhf\b|\bphu\b|facility name|name of (the )?(health )?facility|\bclinic\b/],
    ['dp', /distribution point/],
    ['community', /communit|settlement|village|hamlet|locality|\bcatchment\b(?! settlements)/],
  ];
  const NOT_HIER = /number|count|no\.|total|target|population|%|dhis|\bid\b|code|uid|latitude|longitude|gps|phone|difficult|nomadic|riverine|idp|terrain|migrant/;

  function hierKind(label) {
    const l = basicNorm(label);
    if (!l || NOT_HIER.test(l)) return null;
    for (const [k, re] of LEVEL_PATTERNS) if (re.test(l)) return k;
    return null;
  }

  function detectHeader(rows, extraLevelNames) {
    let best = { idx: -1, score: 0 };
    const extra = (extraLevelNames || []).map(basicNorm).filter(Boolean);
    const lim = Math.min(rows.length, 40);
    for (let r = 0; r < lim; r++) {
      const row = rows[r] || [];
      let score = 0;
      const seen = new Set();
      for (const v of row) {
        const s = cellStr(v); if (!s || s.length > 80) continue;
        const k = hierKind(s) || (extra.includes(basicNorm(s)) ? 'x:' + basicNorm(s) : null);
        if (k && !seen.has(k)) { seen.add(k); score++; }
      }
      if (score > best.score) best = { idx: r, score };
    }
    return best.score >= 2 ? best.idx : -1;
  }

  /** Analyse one sheet: header row, hierarchy columns, numeric value columns, person columns. */
  function analyseSheet(sheet, templateLevelLabels) {
    const rows = sheet.rows || [];
    const h = detectHeader(rows, templateLevelLabels);
    if (h < 0) return null;
    const header = (rows[h] || []).map(cellStr);
    const above = (rows[h - 1] || []).map(cellStr);
    const body = rows.slice(h + 1);
    const ncol = Math.max(header.length, ...body.slice(0, 200).map((r) => (r || []).length));
    const cols = [];
    for (let c = 0; c < ncol; c++) {
      let label = header[c] || '';
      const vals = body.map((r) => (r || [])[c]).filter((v) => cellStr(v) !== '');
      const n = vals.length;
      const nNum = vals.filter(isNum).length;
      const kind = hierKind(label) || (templateLevelLabels || []).map(basicNorm).includes(basicNorm(label)) && 'x' || null;
      cols.push({ c, label: label || (above[c] ? above[c] + ' (col ' + colLetter(c) + ')' : 'Column ' + colLetter(c)), kind, n, nNum,
        numeric: n > 0 && nNum / n > 0.9, textual: n > 0 && nNum / n < 0.2 });
    }
    // unlabeled textual columns immediately after the last labeled hierarchy column = deeper levels
    // (DIGIT Master Data template: columns G/H are unlabeled settlement levels)
    let lastH = -1; cols.forEach((col) => { if (col.kind) lastH = col.c; });
    for (let c = lastH + 1; c < cols.length && lastH >= 0; c++) {
      const col = cols[c];
      if (col.kind) continue;
      const hl = basicNorm(header[c]);
      const boundaryish = !hl || /boundary|level|below|hamlet|locality|sub ?ward|cluster|zone|block|catchment/.test(hl);
      if (col.textual && col.n > 0 && boundaryish && !NOT_HIER.test(hl) && !/\bname\b(?!.*boundary)|phone|designation|role|cadre|bank|account/.test(hl)) { col.kind = 'deeper'; } else break;
    }
    // drop duplicate hierarchy columns (identical values) – keep the right-most
    const hier = cols.filter((x) => x.kind);
    for (let i = 0; i < hier.length - 1; i++) {
      const a = hier[i], b = hier[i + 1];
      let same = 0, tot = 0;
      for (const r of body.slice(0, 500)) { const va = cellStr((r || [])[a.c]), vb = cellStr((r || [])[b.c]); if (va || vb) { tot++; if (va === vb) same++; } }
      if (tot && same / tot > 0.95) a.duplicateOf = b.c;
    }
    const person = {
      name: cols.find((x) => /\bname\b/.test(basicNorm(x.label)) && !x.kind && !/facility|boundary|ward|lga|state|settlement|communit/.test(basicNorm(x.label)) && x.textual),
      phone: cols.find((x) => /phone|mobile|\btel\b|msisdn|contact/.test(basicNorm(x.label))),
      role: cols.find((x) => /designation|\brole\b|cadre|position|user type/.test(basicNorm(x.label))),
    };
    return { sheet: sheet.name, headerRow: h, cols, person, nRows: body.filter((r) => r && r.some((v) => cellStr(v) !== '')).length };
  }

  function colLetter(c) { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

  /**
   * Extract records from an analysed sheet.
   * levelMap: { [colIndex]: templateLevelIndex }  (columns not in map are ignored)
   * valueCols: [colIndex]  numeric columns to carry
   */
  function extractRecords(sheet, analysis, levelMap, valueCols, personCols) {
    const rows = sheet.rows || [];
    const hcols = Object.keys(levelMap).map(Number).sort((a, b) => levelMap[a] - levelMap[b]);
    const out = [];
    let prev = [];
    for (let r = analysis.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const names = hcols.map((c) => cellStr(row[c]));
      if (!names.some(Boolean)) continue;
      if (names.some((n) => /^(grand )?total\b|^sub ?total/i.test(n))) continue;
      let deepest = names.length - 1; while (deepest >= 0 && !names[deepest]) deepest--;
      // forward-fill blanks that sit above a filled deeper level (merged-cell style sheets)
      for (let i = 0; i < deepest; i++) if (!names[i] && prev[i]) names[i] = prev[i];
      if (names.slice(0, deepest + 1).some((n) => !n)) { out.push({ row: r + 1, sheet: sheet.name, broken: true, names }); continue; }
      prev = names.slice();
      const path = names.slice(0, deepest + 1).map((n, i) => ({ level: levelMap[hcols[i]], name: n, raw: row[hcols[i]] }));
      const values = {};
      for (const c of valueCols || []) { const v = row[c]; if (cellStr(v) !== '') values[c] = toNum(v); }
      const rec = { row: r + 1, sheet: sheet.name, path, values };
      if (personCols) {
        rec.person = {
          name: personCols.name != null ? cellStr(row[personCols.name]) : '',
          phone: personCols.phone != null ? cellStr(row[personCols.phone]) : '',
          role: personCols.role != null ? cellStr(row[personCols.role]) : '',
        };
      }
      out.push(rec);
    }
    return out;
  }

  // ───────────────────────── matching ─────────────────────────
  const DEFAULT_OPTS = { autoAccept: 0.9, margin: 0.03, suggest: 0.72 };

  function descendantsAtLevel(tree, code, level) {
    const n = tree.nodes.get(code);
    if (!n) return [];
    if (n.level === level) return [n];
    if (n.level > level) return [];
    const out = [];
    const stack = [...n.children];
    while (stack.length) {
      const c = tree.nodes.get(stack.pop());
      if (!c) continue;
      if (c.level === level) out.push(c); else if (c.level < level) stack.push(...c.children);
    }
    return out;
  }

  function aliasKey(parentCode, level, name) { return parentCode + '|' + level + '|' + canon(name); }

  /**
   * Match each record's path to template nodes, level by level, caching by (parent, level, name).
   * aliases: { aliasKey → code }  (user decisions, reusable across cycles)
   */
  function matchRecords(tree, records, aliases, opts) {
    opts = Object.assign({}, DEFAULT_OPTS, opts || {});
    aliases = aliases || {};
    const cache = new Map();
    const decisions = new Map(); // key → decision (one per unique boundary step, for review UI)

    function step(parentCodes, level, name) {
      const key = parentCodes.join(',') + '|' + level + '|' + canon(name);
      if (cache.has(key)) return cache.get(key);
      let res;
      const ak = parentCodes.length === 1 ? aliasKey(parentCodes[0], level, name) : null;
      if (ak && aliases[ak] && tree.nodes.has(aliases[ak])) {
        res = { status: 'alias', code: aliases[ak], score: 1 };
      } else if (ak && aliases[ak] === '__SKIP__') {
        res = { status: 'skipped', code: null, score: 0 };
      } else {
        let cands = [];
        for (const pc of parentCodes) cands.push(...descendantsAtLevel(tree, pc, level));
        const cn = canon(name);
        const exact = cands.filter((c) => canon(c.name) === cn);
        if (exact.length === 1) res = { status: 'exact', code: exact[0].code, score: 1 };
        else if (exact.length > 1) res = { status: 'ambiguous', code: null, score: 1, candidates: exact.map((c) => ({ code: c.code, name: c.name, score: 1 })) };
        else {
          const scored = cands.map((c) => ({ code: c.code, name: c.name, score: similarity(name, c.name) })).sort((a, b) => b.score - a.score);
          const top = scored[0], second = scored[1];
          const gap = second ? top.score - second.score : 1;
          if (top && ((top.score >= opts.autoAccept && gap >= opts.margin) || (top.score >= 0.85 && gap >= 0.12))) res = { status: 'fuzzy', code: top.code, score: top.score, candidates: scored.slice(0, 5) };
          else if (top && top.score >= opts.suggest) res = { status: 'review', code: null, score: top.score, candidates: scored.slice(0, 5) };
          else res = { status: 'unmatched', code: null, score: top ? top.score : 0, candidates: scored.slice(0, 5) };
        }
      }
      res.key = key; res.aliasKey = ak; res.level = level; res.name = name; res.parentCodes = parentCodes;
      cache.set(key, res);
      if (!decisions.has(key)) decisions.set(key, Object.assign({ count: 0, rows: [] }, res));
      return res;
    }

    const matched = [];
    for (const rec of records) {
      if (rec.broken) { matched.push(Object.assign({}, rec, { status: 'broken', code: null, steps: [] })); continue; }
      let parents = tree.roots.slice();
      const steps = [];
      let status = 'ok', code = null, failedAt = -1;
      for (let i = 0; i < rec.path.length; i++) {
        const p = rec.path[i];
        // the microplan may restate the root (Nigeria): accept if a root matches by name
        if (i === 0 && parents.some((rc) => tree.nodes.get(rc).level === p.level)) {
          const rootMatch = parents.map((rc) => tree.nodes.get(rc)).filter((n) => n.level === p.level);
          const r = rootMatch.length === 1 ? { status: 'exact', code: rootMatch[0].code, score: 1 } : step(parents, p.level, p.name);
          steps.push(r); if (!r.code) { status = r.status; failedAt = i; break; }
          parents = [r.code]; code = r.code; continue;
        }
        const r = step(parents, p.level, p.name);
        const d = decisions.get(r.key); d.count++; if (d.rows.length < 5) d.rows.push(rec.sheet + '!' + rec.row);
        steps.push(r);
        if (!r.code) { status = r.status; failedAt = i; break; }
        parents = [r.code]; code = r.code;
      }
      const worst = steps.reduce((w, s) => (s.status === 'fuzzy' || s.status === 'alias') && w === 'exact' ? s.status : w, 'exact');
      matched.push(Object.assign({}, rec, { status: status === 'ok' ? worst : status, code: status === 'ok' ? code : null, failedAt, steps }));
    }
    return { matched, decisions: Array.from(decisions.values()) };
  }

  // ───────────────────────── aggregation ─────────────────────────
  /** Sum values per matched node and roll up to ancestors. Returns {direct, rolled, levelsWithValues}. */
  function aggregate(tree, matched, valueCols, opts) {
    const direct = new Map();
    opts = opts || {};
    const conflicts = [];
    const seen = new Map();
    for (const m of matched) {
      if (!m.code) continue;
      const hasVals = valueCols.some((c) => m.values && m.values[c] !== undefined && m.values[c] !== null);
      if (!hasVals) continue;
      const prevRow = seen.get(m.code);
      if (prevRow) conflicts.push({ code: m.code, rows: [prevRow, m.sheet + '!' + m.row] });
      seen.set(m.code, m.sheet + '!' + m.row);
      const cur = direct.get(m.code) || {};
      for (const c of valueCols) { const v = m.values[c]; if (v !== undefined && v !== null) cur[c] = (cur[c] || 0) + v; }
      direct.set(m.code, cur);
    }
    // Optional: treat a value that sits on the only valued child of a parent as the parent's total
    // (MC master-data convention), so split rules can spread it across all the parent's children.
    let lifted = 0;
    if (opts.liftSingle) {
      const byParent = new Map();
      for (const code of direct.keys()) { const n = tree.nodes.get(code); if (n && n.parent) { if (!byParent.has(n.parent)) byParent.set(n.parent, []); byParent.get(n.parent).push(code); } }
      for (const [p, kids] of byParent) {
        const par = tree.nodes.get(p);
        if (kids.length === 1 && par.children.length > 1 && !direct.has(p)) { direct.set(p, direct.get(kids[0])); direct.delete(kids[0]); lifted++; }
      }
    }
    const rolled = new Map();
    for (const [code, vals] of direct) {
      let n = tree.nodes.get(code);
      while (n) {
        const cur = rolled.get(n.code) || {};
        for (const c of valueCols) if (vals[c] !== undefined) cur[c] = (cur[c] || 0) + vals[c];
        rolled.set(n.code, cur);
        n = n.parent ? tree.nodes.get(n.parent) : null;
      }
    }
    // values entered at two levels of the same branch (e.g. HF row AND its communities)
    const twoLevel = [];
    for (const code of direct.keys()) {
      let n = tree.nodes.get(code); n = n && n.parent ? tree.nodes.get(n.parent) : null;
      while (n) { if (direct.has(n.code)) { twoLevel.push({ child: code, ancestor: n.code }); break; } n = n.parent ? tree.nodes.get(n.parent) : null; }
    }
    const levels = new Set(Array.from(direct.keys()).map((c) => tree.nodes.get(c).level));
    return { direct, rolled, conflicts, twoLevel, lifted, levelsWithValues: Array.from(levels).sort() };
  }

  /** Value for a template row at `code`: own/rolled-up value, or a split of the parent's value if
   *  the microplan is coarser than the template row ('flag' | 'first' | 'even'). */
  function valueFor(tree, agg, code, col, splitMode) {
    const r = agg.rolled.get(code);
    if (r && r[col] !== undefined) return { v: r[col], how: agg.direct.has(code) ? 'direct' : 'rollup' };
    if (!splitMode || splitMode === 'flag') return { v: null, how: 'missing' };
    // walk up to the nearest ancestor that carries a direct value
    let n = tree.nodes.get(code), path = [];
    while (n && !(agg.direct.has(n.code) && agg.direct.get(n.code)[col] !== undefined)) { path.unshift(n.code); n = n.parent ? tree.nodes.get(n.parent) : null; }
    if (!n) return { v: null, how: 'missing' };
    let val = agg.direct.get(n.code)[col];
    let cur = n;
    for (const c of path) {
      const sibs = cur.children;
      const idx = sibs.indexOf(c);
      if (splitMode === 'first') val = idx === 0 ? val : 0;
      else { const base = Math.floor(val / sibs.length); val = base + (idx < val - base * sibs.length ? 1 : 0); }
      cur = tree.nodes.get(c);
    }
    return { v: val, how: splitMode === 'first' ? 'first-child' : 'split' };
  }

  // ───────────────────────── phones ─────────────────────────
  /** Phone formats: Nigeria '11' (08031234567) / '10' (8031234567) / 'intl' (+234…); Sierra Leone 'sl' (076123456) /
   *  'sl-intl' (+23276123456); 'raw' keeps the digits as typed (7–15 digits). */
  const PHONE_FORMATS = { '11': 'NG', '10': 'NG', intl: 'NG', sl: 'SL', 'sl-intl': 'SL', raw: '' };
  function phoneCountry(tree) {
    const r = tree && tree.nodes.get(tree.roots[0]); const t = r ? (r.code + ' ' + r.path[0] + ' ' + r.name).toUpperCase() : '';
    if (/SIERRA|SIERRALEONE|_SI\b|\bSL\b/.test(t)) return 'sl';
    if (/NIGERIA|_NI\b|\bNG\b|\bNI\b/.test(t)) return '11';
    return 'raw';
  }
  const placeholder = (d) => /^0?\d0{7,}$/.test(d) || /(\d)\1{7,}/.test(d) || /^0?123456789/.test(d);
  function normPhone(raw, fmt) {
    let d = cellStr(raw).replace(/\.0+$/, '').replace(/[^\d+]/g, '');
    if (!d) return { ok: false, value: '', reason: 'blank' };
    d = d.replace(/^\+/, '').replace(/^00/, '');
    if (fmt === 'raw') {
      const ok = d.length >= 7 && d.length <= 15;
      if (ok && placeholder(d)) return { ok: false, value: d, reason: 'placeholder number' };
      return { ok, value: d, reason: ok ? '' : 'phone should have 7–15 digits' };
    }
    if (fmt === 'sl' || fmt === 'sl-intl') {
      if (d.startsWith('232') && d.length === 11) d = '0' + d.slice(3);
      if (d.length === 8) d = '0' + d;
      const ok = /^0[2-9]\d{7}$/.test(d);
      if (ok && placeholder(d)) return { ok: false, value: d, reason: 'placeholder number' };
      return { ok, value: ok && fmt === 'sl-intl' ? '+232' + d.slice(1) : d, reason: ok ? '' : 'not a valid Sierra Leone number (0 + 8 digits)' };
    }
    if (d.startsWith('234') && d.length === 13) d = '0' + d.slice(3);
    if (d.length === 10 && /^[789]/.test(d)) d = '0' + d;
    const ok = /^0[789][01]\d{8}$/.test(d);
    let value = d;
    if (ok && fmt === '10') value = d.slice(1);
    if (ok && fmt === 'intl') value = '+234' + d.slice(1);
    let reason = ok ? '' : 'not a valid NG mobile number';
    if (ok && (/^0\d0{9}$/.test(d) || /(\d)\1{7,}/.test(d))) return { ok: false, value, reason: 'placeholder number' };
    return { ok, value, reason };
  }

  // ───────────────────────── validation ─────────────────────────
  function validate(ctx) {
    const { tree, matched, agg, valueCols, valueLabels, users, specialCharsCheck } = ctx;
    const issues = [];
    const add = (severity, rule, message, ref) => issues.push({ severity, rule, message, ref: ref || '' });

    for (const m of matched) {
      if (m.status === 'broken') add('error', 'Incomplete path', 'Row has a deeper boundary filled but a parent level blank: ' + m.names.join(' › '), m.sheet + '!' + m.row);
    }
    // near-duplicate siblings inside the microplan (variants carry the first row that uses them)
    const sib = new Map();
    for (const m of matched) {
      if (!m.path) continue;
      for (let i = 0; i < m.path.length; i++) {
        const parentKey = m.path.slice(0, i).map((p) => canon(p.name)).join('/');
        const k = parentKey + '|' + m.path[i].level;
        if (!sib.has(k)) sib.set(k, new Map());
        const squashed = canon(m.path[i].name).replace(/ /g, '');
        const g = sib.get(k);
        if (!g.has(squashed)) g.set(squashed, new Map());
        const v = g.get(squashed);
        if (!v.has(m.path[i].name)) v.set(m.path[i].name, { name: m.path[i].name, level: m.path[i].level, ref: m.sheet + '!' + m.row, count: 0 });
        v.get(m.path[i].name).count++;
      }
    }
    for (const g of sib.values()) for (const v of g.values()) if (v.size > 1) {
      const variants = Array.from(v.values());
      add('warn', 'Near-duplicate names', 'Same boundary written differently: ' + variants.map((x) => '"' + x.name + '"').join(' vs '), variants[0].ref);
      issues[issues.length - 1].variants = variants;
    }

    if (specialCharsCheck) {
      const bad = new Map();
      for (const m of matched) for (const p of m.path || []) if (/[^A-Za-z0-9 \-\/().,'&]/.test(p.name)) {
        if (!bad.has(p.name + '|' + p.level)) bad.set(p.name + '|' + p.level, { name: p.name, level: p.level, ref: m.sheet + '!' + m.row, count: 0 });
        bad.get(p.name + '|' + p.level).count++;
      }
      if (bad.size) {
        const variants = Array.from(bad.values()).sort((a, b) => a.name.localeCompare(b.name));
        add('warn', 'Special characters', bad.size + ' boundary names contain special characters (e.g. ' + variants.slice(0, 3).map((x) => '"' + x.name + '"').join(', ') + ')');
        Object.assign(issues[issues.length - 1], { variants, items: variants.map((x) => x.name) });
      }
    }

    if (agg) {
      const refOf = new Map(); for (const m of matched) if (m.code && m.values && Object.keys(m.values).length && !refOf.has(m.code)) refOf.set(m.code, m.sheet + '!' + m.row);
      for (const c of agg.conflicts) { add('error', 'Duplicate rows', 'Two microplan rows resolve to the same boundary ' + label(tree, c.code) + ' — values were summed', c.rows[1]); issues[issues.length - 1].refs = c.rows.slice(); }
      for (const t of agg.twoLevel.slice(0, 200)) { add('error', 'Targets at two levels', 'Targets given for ' + label(tree, t.child) + ' and also for its ancestor ' + label(tree, t.ancestor) + ' — totals will double count', refOf.get(t.child)); issues[issues.length - 1].refs = [refOf.get(t.ancestor), refOf.get(t.child)].filter(Boolean); }
      // facility totals parked on one child (MC master-data convention: target on the first community)
      const byParent = new Map();
      for (const code of agg.direct.keys()) { const n = tree.nodes.get(code); if (!n || !n.parent) continue; byParent.set(n.parent, (byParent.get(n.parent) || 0) + 1); }
      if (byParent.size >= 5) {
        let single = 0, siblingsTotal = 0;
        for (const [p, cnt] of byParent) { if (cnt === 1) single++; siblingsTotal += tree.nodes.get(p).children.length; }
        if (single / byParent.size >= 0.8 && siblingsTotal > byParent.size * 1.5) {
          const lvl = tree.levelLabels[tree.nodes.get(Array.from(agg.direct.keys())[0]).level];
          add('warn', 'Targets on one child per parent', `In ${single} of ${byParent.size} cases only one ${lvl} under a parent carries values. This usually means parent totals were written on the first ${lvl} row. Check with the programme before splitting or uploading — the other ${lvl} rows will be blank.`);
        }
      }
      for (const m of matched) {
        if (!m.values) continue;
        for (const c of valueCols) { const v = m.values[c]; if (v !== undefined && v !== null && (v < 0 || !Number.isInteger(v))) add(v < 0 ? 'error' : 'warn', 'Bad number', (valueLabels[c] || 'col ' + c) + ' = ' + v + (v < 0 ? ' (negative)' : ' (not a whole number — will be rounded)'), m.sheet + '!' + m.row); }
      }
    }

    // users
    if (users && users.length) {
      const phones = new Map();
      const perHF = new Map();
      for (const u of users) {
        const ref = u.sheet + '!' + u.row;
        if (!u.person.name) add('error', 'Blank name', 'User row without a name', ref);
        if (!u.phoneNorm.ok) add('error', 'Phone', (u.person.phone || '(blank)') + ' — ' + u.phoneNorm.reason, ref);
        else { const p = u.phoneNorm.value; if (phones.has(p)) { add('error', 'Duplicate phone', p + ' also used at ' + phones.get(p), ref); issues[issues.length - 1].refs = [phones.get(p), ref]; } else phones.set(p, ref); }
        if (!u.code) add('error', 'User boundary', 'User boundary not matched: ' + (u.path || []).map((p) => p.name).join(' › '), ref);
        if (u.code && u.roleKind) { const k = u.code; if (!perHF.has(k)) perHF.set(k, { oic: 0, cdd: 0 }); perHF.get(k)[u.roleKind]++; }
      }
      for (const [code, cnt] of perHF) if (cnt.oic > 1) add('warn', 'Duplicate OIC', label(tree, code) + ' has ' + cnt.oic + ' OIC / HF workers — the platform keeps only the first');
      if (ctx.hfLevel !== undefined && ctx.hfLevel !== null) {
        const hfs = new Set(); for (const m of matched) if (m.code) { let n = tree.nodes.get(m.code); while (n && n.level > ctx.hfLevel) n = tree.nodes.get(n.parent); if (n && n.level === ctx.hfLevel) hfs.add(n.code); }
        const exO = [], exC = [];
        for (const hf of hfs) { const cnt = perHF.get(hf) || { oic: 0, cdd: 0 }; if (!cnt.oic) exO.push(hf); if (!cnt.cdd) exC.push(hf); }
        const byLabel = (a, b) => label(tree, a).localeCompare(label(tree, b));
        if (exO.length) { exO.sort(byLabel); add('warn', 'HF without OIC', exO.length + ' facilities have no OIC / HF worker, e.g. ' + exO.slice(0, 3).map((c) => label(tree, c)).join('; ')); Object.assign(issues[issues.length - 1], { codes: exO, items: exO.map((c) => label(tree, c)), need: 'oic' }); }
        if (exC.length) { exC.sort(byLabel); add('warn', 'HF without CDD', exC.length + ' facilities have no distributor, e.g. ' + exC.slice(0, 3).map((c) => label(tree, c)).join('; ')); Object.assign(issues[issues.length - 1], { codes: exC, items: exC.map((c) => label(tree, c)), need: 'cdd' }); }
      }
    }
    return issues;
  }

  function label(tree, code) { const n = tree.nodes.get(code); return n ? (n.dpath || n.path).slice(1).join(' › ') : code; }

  // ───────────────────────── helper hash ─────────────────────────
  async function sha256hex(s) {
    const data = new TextEncoder().encode(s);
    let subtle = root.crypto && root.crypto.subtle;
    if (!subtle && typeof require === 'function') { try { subtle = require('crypto').webcrypto.subtle; } catch (e) { /* none */ } }
    if (subtle) { const buf = await subtle.digest('SHA-256', data); return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''); }
    return sha256js(data);
  }
  // Compact pure-JS SHA-256 for contexts without SubtleCrypto.
  function sha256js(bytes) {
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const l = bytes.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb);
    m.set(bytes); m[l] = 0x80; const dv = new DataView(m.buffer); dv.setUint32(nb - 4, l * 8); dv.setUint32(nb - 8, Math.floor(l / 0x20000000));
    const w = new Uint32Array(64), rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + (rot(a, 7) ^ rot(a, 18) ^ (a >>> 3)) + w[i - 7] + (rot(b, 17) ^ rot(b, 19) ^ (b >>> 10))) >>> 0; }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map((x) => x.toString(16).padStart(8, '0')).join('');
  }
  /** Helper value for level i (i ≥ 1) = 'H_' + sha256(codes of levels 0..i-1 joined by '#'). */
  async function helpersFor(tree, code) {
    const chain = []; let n = tree.nodes.get(code);
    while (n) { chain.unshift(n.code); n = n.parent ? tree.nodes.get(n.parent) : null; }
    const out = [];
    for (let i = 1; i <= chain.length; i++) out.push(i < chain.length || true ? 'H_' + (await sha256hex(chain.slice(0, i).join('#'))) : '');
    return { chain, helpers: out }; // helpers[k] goes in the helper column of level k+1
  }

  /** Map microplan hierarchy columns → template level index by meaning, then by order. */
  function autoLevelMap(analysis, tree) {
    const tKinds = tree.levelLabels.map((l, i) => ({ i, kind: hierKind(l) || (i === 0 ? 'country' : null), norm: basicNorm(l) }));
    const map = {};
    let lastLevel = -1;
    for (const col of analysis.cols) {
      if (!col.kind || col.duplicateOf !== undefined) continue;
      let lvl = -1;
      const norm = basicNorm(col.label);
      const byName = tKinds.find((t) => t.norm === norm && t.i > lastLevel);
      const byKind = tKinds.find((t) => t.kind && t.kind === col.kind && t.i > lastLevel);
      if (byName) lvl = byName.i; else if (byKind) lvl = byKind.i;
      else if (col.kind === 'deeper' || col.kind === 'x') lvl = lastLevel + 1;
      if (lvl < 0 || lvl > tree.depth) continue;
      map[col.c] = lvl; lastLevel = lvl;
    }
    return map;
  }

  /** Numeric columns worth carrying, with a suggested template target key per column. */
  function suggestValueCols(analysis, targetKeys) {
    const out = [];
    for (const col of analysis.cols) {
      if (!col.numeric || col.kind) continue;
      const l = basicNorm(col.label);
      if (/^s ?n$|serial|^sn$|\bid\b|latitude|longitude/.test(l)) continue;
      out.push({ c: col.c, label: col.label, guess: guessTargetKey(l, targetKeys, col.label) });
    }
    return out;
  }
  function guessTargetKey(l, targetKeys, rawLabel) {
    if (!targetKeys || !targetKeys.length) return null;
    if (/receive|stock|dose|quantity|commodit|blister|bale|buffer|procure/.test(l)) return null; // commodity, not population
    const raw = String(rawLabel || l);
    const am = raw.match(/(\d+)\s*(?:to|-|–|_)?\s*(<|\\<|lt)?\s*(\d+)/i);
    const ages = am ? { a: +am[1], b: +am[3], lt: !!am[2] } : null;
    let best = null, bs = 0;
    for (const t of targetKeys) {
      const tk = basicNorm(t.key + ' ' + (t.label || ''));
      const tnums = new Set((tk.match(/\d+/g) || []).map(Number));
      let s = 0;
      if (ages) {
        const hit = tnums.has(ages.a) && (tnums.has(ages.b) || tnums.has(ages.b - 1) || (ages.lt && tnums.has(ages.b - 1)));
        if (hit) s += 3; else if (tnums.size) s -= 2;
      }
      if (/total/.test(l) && /total/.test(tk)) s += 2;
      if (/total/.test(l) && !/total/.test(tk) && /\d/.test(tk)) s -= 1;
      if (!/\d/.test(tk) && !ages && /target|total|population/.test(l)) s += 1;
      for (const w of ['azm', 'smc', 'llin', 'net', 'vas', 'ors', 'zinc', 'spaq']) if (l.includes(w) && tk.includes(w)) s += 1.5;
      if (/target/.test(l)) s += 0.5;
      if (/cdd|team|supervisor|doses|card|form|sheet|apron|bag/.test(l)) s -= 3;
      if (s > bs) { bs = s; best = t.key; }
    }
    return bs >= 1 ? best : null;
  }

  // ───────────────────────── demo users ─────────────────────────
  /** Level a console role normally sits at, as a template level index. */
  function defaultRoleLevel(tree, role) {
    const r = basicNorm(role);
    const kinds = tree.levelLabels.map((l, i) => hierKind(l) || (i === 0 ? 'country' : null));
    const find = (...ks) => { for (const k of ks) { const i = kinds.indexOf(k); if (i >= 0) return i; } return -1; };
    let lvl = -1;
    if (/national|country|dashboard|campaign supervisor/.test(r)) lvl = 0;
    else if (/state|province|provincial/.test(r)) lvl = find('state');
    else if (/district|lga|county/.test(r)) lvl = find('lga');
    else if (/warehouse|store|logistic/.test(r)) lvl = find('lga', 'state');
    else if (/field supervisor|team supervisor|proximity|monitor|ward/.test(r)) lvl = find('ward', 'chiefdom', 'lga');
    else if (/facility|hf|oic|in charge/.test(r)) lvl = find('hf');
    else if (/distributor|dispenser|registrar|cdd|vaccinator|mobili/.test(r)) lvl = find('hf', 'dp', 'community');
    if (lvl < 0) lvl = find('hf');
    if (lvl < 0) lvl = Math.min(tree.depth, 4);
    return lvl;
  }

  /** Boundaries at a level, spread evenly across the sorted hierarchy (so picks land in different branches). */
  function spreadPick(tree, level, count) {
    const all = Array.from(tree.nodes.values()).filter((n) => n.level === level && !n.synthetic)
      .sort((a, b) => a.path.join('#').localeCompare(b.path.join('#')));
    if (!all.length || count <= 0) return [];
    if (count >= all.length) return all;
    const out = [];
    for (let i = 0; i < count; i++) out.push(all[Math.floor((i * all.length) / count + all.length / (2 * count))]);
    return out;
  }

  function nextPhone(start, i) {
    const digits = String(start || '').replace(/\D/g, '');
    if (!digits) return '';
    const n = (BigInt(digits) + BigInt(i)).toString();
    return n.padStart(digits.length, '0');
  }

  /**
   * Generate demo users.
   * plan = { roles: [{ role, level, count }], allRoles: { level, count } | null, phoneStart, prefix }
   * Returns [{ code, name, phone, roles: [..], path }]
   */
  function demoUsers(tree, plan) {
    const out = [];
    const prefix = (plan.prefix || 'Demo').trim();
    // role codes (HEALTH_FACILITY_WORKER) read better in a display name as “Health Facility Worker”
    const short = (role) => { const r = role.replace(/\s+/g, ' ').trim(); return /^[A-Z0-9_]+$/.test(r) ? r.split('_').filter(Boolean).map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') : r; };
    for (const r of plan.roles || []) {
      if (!r.role || !(r.count > 0)) continue;
      spreadPick(tree, Number(r.level), Number(r.count)).forEach((n, i) => {
        out.push({ code: n.code, roles: [r.role], path: n.path, name: `${prefix} ${short(r.role)} ${String(i + 1).padStart(2, '0')}` });
      });
    }
    if (plan.allRoles && plan.allRoles.count > 0) {
      // a user row holds at most `slots` roles; more ticked roles are shared over several multi-role users at the same place
      const roles = (plan.roles || []).filter((r) => r.role && r.include !== false).map((r) => r.role);
      const slots = plan.roleSlots > 0 ? plan.roleSlots : roles.length || 1;
      const chunks = []; for (let i = 0; i < roles.length; i += slots) chunks.push(roles.slice(i, i + slots));
      spreadPick(tree, Number(plan.allRoles.level), Number(plan.allRoles.count)).forEach((n, i) => {
        chunks.forEach((rs, j) => out.push({ code: n.code, roles: rs, path: n.path,
          name: `${prefix} ${chunks.length > 1 ? 'Multi Role' : 'All Roles'} ${String(i + 1).padStart(2, '0')}${chunks.length > 1 ? String.fromCharCode(65 + j) : ''}` }));
      });
    }
    out.forEach((u, i) => { u.phone = nextPhone(plan.phoneStart, i); u.label = label(tree, u.code) || (tree.nodes.get(u.code).dpath || u.path)[0]; });
    return out;
  }

  root.MP = { PHONE_FORMATS, phoneCountry, nameFromCode, isHelperHash, prettyLevels, defaultRoleLevel, spreadPick, demoUsers, nextPhone, autoLevelMap, suggestValueCols, basicNorm, canon, variants, similarity, parseTemplate, analyseSheet, extractRecords, matchRecords, aggregate,
    valueFor, normPhone, validate, label, helpersFor, sha256hex, colLetter, aliasKey, hierKind, cellStr, toNum };
  if (typeof module !== 'undefined') module.exports = root.MP;
})(typeof window !== 'undefined' ? window : globalThis);
