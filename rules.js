/* Microplan Matcher — validation rules.
 * One rules object drives the checks in every mode: phone format, target range, name rules, output casing and the
 * severity of each check. Rules can come from the built-in console defaults, a console's MDMS (HCM-ADMIN-CONSOLE
 * schemas), the DST team's validation_config.yaml, or a rules file exported from this tool. Runs in the browser and Node. */
(function (root) {
  'use strict';

  /** Console defaults, taken from project-factory: targets must be 1–1,000,000 (validateTargetFromTargetConfigs),
   *  user names up to 128 characters (user schema), phones digits-only of PHONE_NUMBER_LENGTH. */
  const DEFAULT_ALLOWED = "-_ '/.(),&áàãâäéèêëíìîïóòôõöúùûüçñÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ";
  const CASINGS = { none: 'Keep as written', title: 'Title Case', upper: 'UPPER CASE', lower: 'lower case', sentence: 'Sentence case' };

  /** Every check the tool can raise, with its default severity. `dst` names the matching rule in DST's YAML. */
  const CATALOG = [
    { rule: 'Duplicate rows', sev: 'error', group: 'Boundaries', what: 'Two rows point at the same boundary', dst: ['unique_names'] },
    { rule: 'Missing name', sev: 'error', group: 'Boundaries', what: 'A row has targets but no name at its level', dst: ['no_missing_entries'] },
    { rule: 'Incomplete path', sev: 'error', group: 'Boundaries', what: 'A level is blank between two filled levels', dst: ['hierarchy_check'] },
    { rule: 'Targets at two levels', sev: 'error', group: 'Boundaries', what: 'A parent row and the rows under it both carry targets' },
    { rule: 'Near-duplicate names', sev: 'warn', group: 'Boundaries', what: 'Same boundary written two ways (“Ung. Ali” / “Ung Ali”)' },
    { rule: 'Special characters', sev: 'warn', group: 'Boundaries', what: 'Boundary names with characters outside the allowed list', dst: ['special_characters'] },
    { rule: 'Target out of range', sev: 'error', group: 'Targets', what: 'Target below the minimum (0) or above the maximum — the console rejects it', dst: ['non_zero_targets'] },
    { rule: 'Missing target', sev: 'warn', group: 'Targets', what: 'A lowest-level row with no target', dst: ['no_missing_entries'] },
    { rule: 'Not a number', sev: 'error', group: 'Targets', what: 'Text where a target number is expected' },
    { rule: 'Bad number', sev: 'error', group: 'Targets', what: 'Negative target' },
    { rule: 'Decimal targets', sev: 'warn', group: 'Targets', what: 'Targets with decimals (rounded when written)' },
    { rule: 'Total does not add up', sev: 'warn', group: 'Targets', what: 'A total column differs from the columns that make it up' },
    { rule: 'Targets on one child per parent', sev: 'warn', group: 'Targets', what: 'Only one row under each parent carries targets' },
    { rule: 'Phone', sev: 'error', group: 'Users', what: 'Phone number in the wrong format' },
    { rule: 'Duplicate phone', sev: 'error', group: 'Users', what: 'Same phone used by two people' },
    { rule: 'Phone already in template', sev: 'error', group: 'Users', what: 'Phone already used in the template' },
    { rule: 'Blank name', sev: 'error', group: 'Users', what: 'Person without a name', dst: ['no_missing_entries'] },
    { rule: 'Name too long', sev: 'error', group: 'Users', what: 'Person name longer than the console allows' },
    { rule: 'No role', sev: 'error', group: 'Users', what: 'Designation that maps to no console role' },
    { rule: 'User boundary', sev: 'error', group: 'Users', what: 'Person placed at a facility that is not in the microplan', dst: ['boundary_alignment'] },
    { rule: 'HF without OIC', sev: 'warn', group: 'Users', what: 'Health facility with no officer in charge' },
    { rule: 'HF without CDD', sev: 'warn', group: 'Users', what: 'Health facility with no distributor' },
    { rule: 'Duplicate OIC', sev: 'warn', group: 'Users', what: 'More than one officer in charge at a facility' },
  ];
  const SEV = { error: 'Must fix', warn: 'Check', off: 'Off' };

  function defaults() {
    return {
      v: 1,
      phone: { preset: 'ng', auto: true },
      targets: { min: 1, max: 1000000 },
      names: { maxLen: 128, allowed: DEFAULT_ALLOWED, casing: 'none' },
      sev: {},
      source: { kind: 'default', label: 'Console defaults', at: '' },
      notes: [],
    };
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function sevOf(rules, rule) {
    const c = CATALOG.find((x) => x.rule === rule);
    return (rules && rules.sev && rules.sev[rule]) || (c ? c.sev : null);
  }
  /** Apply the rules' severities to issues: drop the ones switched off, re-grade the rest. */
  function grade(rules, issues) {
    const out = [];
    for (const i of issues) {
      const s = rules && rules.sev && rules.sev[i.rule];
      if (s === 'off') continue;
      out.push(s && s !== i.severity ? Object.assign({}, i, { severity: s }) : i);
    }
    return out;
  }
  /** Characters outside the allowed list (letters and digits are always allowed). */
  function badChars(name, allowed) {
    const ok = new Set(Array.from(allowed == null ? DEFAULT_ALLOWED : allowed));
    return Array.from(String(name)).filter((ch) => !/[A-Za-z0-9]/.test(ch) && !ok.has(ch));
  }
  function applyCasing(name, mode) {
    const s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (mode === 'upper') return s.toUpperCase();
    if (mode === 'lower') return s.toLowerCase();
    if (mode === 'title') return s.toLowerCase().replace(/(^|[\s\-\/(.'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    if (mode === 'sentence') return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    return s;
  }

  // ───────── DST validation_config.yaml ─────────
  /** Enough YAML for config files: nested maps by indentation, scalars, quoted strings, [flow, lists], "- item" lists, comments. */
  function parseYaml(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    const rootObj = {}; const stack = [{ indent: -1, obj: rootObj }];
    const scalar = (v) => {
      v = v.trim();
      if (!v.length) return null;
      if (/^".*"$/.test(v)) return JSON.parse(v);
      if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
      if (/^\[.*\]$/.test(v)) return splitFlow(v.slice(1, -1)).map(scalar);
      if (/^(true|yes|on)$/i.test(v)) return true;
      if (/^(false|no|off)$/i.test(v)) return false;
      if (/^(null|~)$/i.test(v)) return null;
      if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
      return v;
    };
    function splitFlow(s) { const out = []; let cur = '', q = null; for (const ch of s) { if (q) { cur += ch; if (ch === q) q = null; } else if (ch === '"' || ch === "'") { q = ch; cur += ch; } else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur); return out; }
    const stripComment = (l) => { let q = null; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '#' && (i === 0 || /\s/.test(l[i - 1]))) return l.slice(0, i); } return l; };
    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li]; const line = stripComment(raw); if (!line.trim()) continue;
      const indent = line.match(/^ */)[0].length; const t = line.trim();
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1];
      if (t.startsWith('- ')) { if (!Array.isArray(parent.obj)) continue; parent.obj.push(scalar(t.slice(2))); continue; }
      const m = t.match(/^("[^"]*"|'[^']*'|[^:]+):(\s+(.*))?$/); if (!m || Array.isArray(parent.obj)) continue;
      const key = scalar(m[1]); const rest = (m[3] || '').trim();
      if (rest) parent.obj[key] = scalar(rest);
      else { // a map or a "- item" list follows
        const nxt = lines.slice(li + 1).find((l) => stripComment(l).trim());
        const child = nxt && stripComment(nxt).trim().startsWith('- ') ? [] : {};
        parent.obj[key] = child; stack.push({ indent, obj: child });
      }
    }
    return rootObj;
  }
  /** DST's validation_config.yaml → a rules patch. */
  function fromDstYaml(text) {
    const y = parseYaml(text); const vr = y.validation_rules || {};
    const patch = { sev: {} }; const notes = [];
    const sev = (r) => (r && r.enabled === false ? 'off' : r && /^warn/i.test(String(r.severity || '')) ? 'warn' : 'error');
    for (const c of CATALOG) for (const k of c.dst || []) if (vr[k]) {
      // no_missing_entries covers several of ours; a missing target stays a warning unless the YAML says error for targets
      patch.sev[c.rule] = sev(vr[k]);
    }
    if (vr.special_characters && Array.isArray(vr.special_characters.allowed_special_chars)) patch.names = { allowed: vr.special_characters.allowed_special_chars.join('') };
    if (y.name_casing && CASINGS[y.name_casing]) { patch.names = Object.assign(patch.names || {}, { casing: y.name_casing }); notes.push(`Names are written in ${CASINGS[y.name_casing]} in the prepared microplan and boundary list.`); }
    if (vr.non_zero_targets) notes.push('Zero targets follow non_zero_targets; decimals stay a warning, as in the DST script.');
    if (vr.naming_convention) notes.push('naming_convention (mixed case) is not checked here; use name casing to write names one way instead.');
    const used = new Set(CATALOG.flatMap((c) => c.dst || []).concat(['naming_convention']));
    const unknown = Object.keys(vr).filter((k) => !used.has(k)); if (unknown.length) notes.push('Not used: ' + unknown.join(', ') + '.');
    return { patch, notes };
  }

  // ───────── console MDMS ─────────
  const MDMS_SCHEMAS = ['HCM-ADMIN-CONSOLE.schemas', 'HCM-ADMIN-CONSOLE.adminSchema', 'HCM-ADMIN-CONSOLE.targetConfigs'];
  /** MDMS v2 search request (the same call project-factory makes). */
  /** paging: send limit+offset together (some MDMS v2 builds fail with a limit and no offset); false sends neither,
   *  exactly like project-factory. */
  function mdmsRequest(base, tenantId, schemaCode, ids, token, path, paging) {
    const url = String(base || '').replace(/\/+$/, '') + (path || '/mdms-v2/v2/_search');
    const MdmsCriteria = { tenantId, schemaCode };
    if (paging !== false) Object.assign(MdmsCriteria, { limit: 100, offset: 0 });
    if (ids && ids.length) MdmsCriteria.uniqueIdentifiers = ids;
    return { url, body: { MdmsCriteria, RequestInfo: { apiId: 'Rainmaker', msgId: Date.now() + '|en_NG', authToken: token || undefined } } };
  }
  /** Pull the property list out of a console schema, old (properties object) or new (string/number/enum arrays). */
  function propsOf(data) {
    const p = data && data.properties; if (!p) return [];
    if (Array.isArray(p.stringProperties) || Array.isArray(p.numberProperties) || Array.isArray(p.enumProperties)) {
      return [].concat((p.stringProperties || []).map((x) => Object.assign({ type: 'string' }, x)), (p.numberProperties || []).map((x) => Object.assign({ type: 'number' }, x)), (p.enumProperties || []).map((x) => Object.assign({ type: 'enum' }, x)));
    }
    return Object.entries(p).map(([name, x]) => Object.assign({ name }, x));
  }
  /** Records from an MDMS v2 response ({mdms:[…]}), a v1 response ({MdmsRes:{module:{master:[…]}}}), several of those
   *  in an array, or a bare schema object. Each record: { schemaCode, id, data }. */
  function mdmsRecords(json) {
    const out = [];
    const walk = (j) => {
      if (!j) return;
      if (Array.isArray(j)) { j.forEach(walk); return; }
      if (Array.isArray(j.mdms)) { for (const r of j.mdms) if (r && r.data) out.push({ schemaCode: r.schemaCode || '', id: r.uniqueIdentifier || '', data: r.data, active: r.isActive !== false }); return; }
      if (j.MdmsRes) { for (const [mod, masters] of Object.entries(j.MdmsRes)) for (const [master, list] of Object.entries(masters || {})) for (const d of list || []) out.push({ schemaCode: mod + '.' + master, id: d.title || d.name || d.code || '', data: d, active: true }); return; }
      if (j.properties || j.beneficiaries) out.push({ schemaCode: '', id: j.title || j.name || '', data: j, active: true });
    };
    walk(json);
    return out.filter((r) => r.active);
  }
  /** Console rules from MDMS: phone digits and name length from the user schema, target range from target columns. */
  /** Server errors inside responses ({Errors:[{code,message}]}), as short text. */
  function mdmsErrors(json) {
    const out = []; const walk = (j) => { if (!j) return; if (Array.isArray(j)) { j.forEach(walk); return; } if (Array.isArray(j.Errors)) for (const e of j.Errors) out.push([e.code, e.message].filter(Boolean).join(': ')); };
    walk(json); return Array.from(new Set(out));
  }
  function fromMdms(json, opts) {
    opts = opts || {};
    const recs = mdmsRecords(json); const patch = {}; const notes = []; const found = [];
    const errs = mdmsErrors(json);
    if (!recs.length) return { patch, notes: [errs.length ? 'The console returned an error instead of rules: ' + errs.join('; ') + '.' : 'No MDMS records found in that response.'], found, errors: errs };
    if (errs.length) notes.push('Some searches failed on the console: ' + errs.join('; ') + '.');
    const isUser = (r) => /(^|\.)user$/i.test(r.id) || /user/i.test(r.data.title || '') || propsOf(r.data).some((x) => /PHONE_NUMBER/i.test(x.name || ''));
    const user = recs.find((r) => /schemas$/i.test(r.schemaCode) && isUser(r)) || recs.find(isUser);
    if (user) {
      found.push('user schema' + (user.id ? ' (' + user.id + ')' : ''));
      const props = propsOf(user.data);
      const ph = props.find((x) => /PHONE_NUMBER/i.test(x.name || ''));
      if (ph) {
        let max = 0, min = 0;
        if (ph.maximum != null) max = String(Math.trunc(Math.abs(ph.maximum))).length;
        if (ph.minimum != null) min = String(Math.trunc(Math.abs(ph.minimum))).length;
        if (ph.maxLength) max = Number(ph.maxLength); if (ph.minLength) min = Number(ph.minLength);
        const pm = String(ph.pattern || '').match(/\{(\d+)(?:,(\d+))?\}/); if (pm) { min = Number(pm[1]); max = Number(pm[2] || pm[1]); }
        if (max) {
          patch.phone = { preset: 'custom', auto: false, label: 'Console', digits: max, alt: [], cc: opts.cc || '', trunk0: true };
          notes.push(`Phone: ${max} digits, from ${ph.name}` + (min && min !== max ? ` (the schema accepts ${min}–${max}; ${max} is used because the console's length check is exact)` : '') + '.');
        }
      }
      const nm = props.find((x) => /USER_NAME|NAME_OF_(THE_)?PERSON/i.test(x.name || '') && x.maxLength);
      if (nm) { patch.names = { maxLen: Number(nm.maxLength) }; notes.push(`Person names: up to ${nm.maxLength} characters (${nm.name}).`); }
    }
    // target min/max: number properties that look like targets
    const tprops = recs.flatMap((r) => propsOf(r.data)).filter((x) => /TARGET/i.test(x.name || '') && (x.minimum != null || x.maximum != null));
    if (tprops.length) {
      const mins = tprops.map((x) => x.minimum).filter((v) => v != null), maxs = tprops.map((x) => x.maximum).filter((v) => v != null);
      patch.targets = {}; if (mins.length) patch.targets.min = Math.min(...mins); if (maxs.length) patch.targets.max = Math.max(...maxs);
      notes.push(`Targets: ${patch.targets.min != null ? patch.targets.min : '1'} to ${(patch.targets.max != null ? patch.targets.max : 1000000).toLocaleString('en')} (from ${tprops.length} target column${tprops.length > 1 ? 's' : ''}).`);
      found.push('target schema');
    }
    const tc = recs.filter((r) => /targetConfigs$/i.test(r.schemaCode) || Array.isArray(r.data.beneficiaries));
    if (tc.length) {
      const cols = tc.flatMap((r) => (r.data.beneficiaries || []).flatMap((b) => (b.columns || []).map((c) => (typeof c === 'string' ? c : c.name || c.code || '')))).filter(Boolean);
      found.push('target config' + (tc.length > 1 ? 's' : '') + ' (' + tc.map((r) => r.id || r.data.campaignType || '?').join(', ') + ')');
      if (cols.length) { patch.targetColumns = Array.from(new Set(cols)); notes.push('Target columns for this project type: ' + patch.targetColumns.join(', ') + '.'); }
    }
    if (!found.length) notes.push('The response has MDMS records, but no user schema or target settings in them.');
    return { patch, notes, found };
  }

  // ───────── merge, files ─────────
  function merge(rules, patch) {
    const r = clone(rules || defaults());
    for (const k of ['phone', 'targets', 'names']) if (patch[k]) r[k] = Object.assign({}, k === 'phone' && patch.phone.preset ? {} : r[k], patch[k]);
    if (patch.sev) r.sev = Object.assign({}, r.sev, patch.sev);
    if (patch.targetColumns) r.targetColumns = patch.targetColumns;
    return r;
  }
  function toFile(rules) {
    const r = clone(rules); delete r.notes;
    return JSON.stringify({ microplanMatcherRules: 1, exported: new Date().toISOString(), rules: r }, null, 2);
  }
  /** A rules file from this tool, DST YAML, or an MDMS response — whichever the text is. */
  function fromText(text, name) {
    const t = String(text).trim();
    if (/^[\[{]/.test(t)) {
      let j; try { j = JSON.parse(t); } catch (e) { throw new Error('That file is not valid JSON.'); }
      if (j && j.microplanMatcherRules && j.rules) return { kind: 'file', rules: Object.assign(defaults(), j.rules), notes: ['Rules file' + (j.exported ? ' exported ' + j.exported.slice(0, 10) : '') + '.'] };
      const m = fromMdms(j); return { kind: 'mdms', patch: m.patch, notes: m.notes };
    }
    if (/validation_rules\s*:|name_casing\s*:/.test(t)) { const d = fromDstYaml(t); return { kind: 'dst', patch: d.patch, notes: d.notes }; }
    throw new Error('Not a rules file, an MDMS response or a validation_config.yaml' + (name ? ' (' + name + ')' : '') + '.');
  }

  const api = { DEFAULT_ALLOWED, CASINGS, CATALOG, SEV, MDMS_SCHEMAS, defaults, sevOf, grade, badChars, applyCasing, parseYaml, fromDstYaml, mdmsRequest, mdmsRecords, mdmsErrors, fromMdms, merge, toFile, fromText };
  root.MPR = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
