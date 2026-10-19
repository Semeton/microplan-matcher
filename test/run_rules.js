// Unit checks for rules.js and the phone rules in engine.js.
const assert = require('assert');
const MPR = require('../rules.js');
const MP = require('../engine.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// DST validation_config.yaml (copied from salaudeenn-egov/microplan-ingestion core/validation_config.yaml)
const yaml = `validation_rules:
  non_zero_targets:
    enabled: true
    severity: "error"

  naming_convention:
    enabled: true
    severity: "warning"

  boundary_alignment:
    enabled: true
    severity: "error"

  unique_names:
    enabled: false
    severity: "error"

  special_characters:
    enabled: true
    severity: "warning"
    allowed_special_chars: ["-", "_", " ", "'", "/", ".", "(", ")", "á", "ç", "ñ"]

  hierarchy_check:
    enabled: true
    severity: "error"
    auto_detect_root: true
    root_threshold_rows: 5

# Name casing applied to all boundary and facility names during transform.
name_casing: "lower"`;
const y = MPR.parseYaml(yaml);
ok(y.validation_rules.special_characters.allowed_special_chars.length === 11, 'flow list');
ok(y.validation_rules.hierarchy_check.root_threshold_rows === 5 && y.name_casing === 'lower', 'scalars');
const d = MPR.fromText(yaml);
ok(d.kind === 'dst', 'detect yaml');
ok(d.patch.sev['Duplicate rows'] === 'off' && d.patch.sev['Special characters'] === 'warn' && d.patch.sev['Target out of range'] === 'error', 'severities ' + JSON.stringify(d.patch.sev));
ok(d.patch.names.allowed.includes('ç') && d.patch.names.casing === 'lower', 'names');
const r1 = MPR.merge(MPR.defaults(), d.patch);
ok(r1.names.maxLen === 128 && r1.names.casing === 'lower', 'merge keeps defaults');
ok(MPR.grade(r1, [{ rule: 'Duplicate rows', severity: 'error' }, { rule: 'Phone', severity: 'error' }]).length === 1, 'off drops');

// MDMS v2 response: user schema in the new layout
const mdms = { mdms: [
  { schemaCode: 'HCM-ADMIN-CONSOLE.schemas', uniqueIdentifier: 'user', isActive: true, data: { title: 'user', properties: {
    stringProperties: [{ name: 'HCM_ADMIN_CONSOLE_USER_NAME', maxLength: 128, minLength: 1 }],
    numberProperties: [{ name: 'HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER', minimum: 100000000, maximum: 999999999 }] } } },
  { schemaCode: 'HCM-ADMIN-CONSOLE.adminSchema', uniqueIdentifier: 'boundary.MR-DN', isActive: true, data: { properties: {
    numberProperties: [{ name: 'HCM_ADMIN_CONSOLE_TARGET', minimum: 1, maximum: 1000000 }, { name: 'HCM_ADMIN_CONSOLE_TARGET_AZM_1', minimum: 1, maximum: 500000 }] } } },
  { schemaCode: 'HCM-ADMIN-CONSOLE.targetConfigs', uniqueIdentifier: 'MR-DN', isActive: true, data: { beneficiaries: [{ type: 'INDIVIDUAL', columns: ['HCM_ADMIN_CONSOLE_TARGET_AZM_1', 'HCM_ADMIN_CONSOLE_TARGET_AZM_2'] }] } },
] };
const m = MPR.fromMdms(mdms);
ok(m.patch.phone.digits === 9, 'phone digits from maximum');
ok(m.patch.names.maxLen === 128, 'name length');
ok(!m.patch.targets, 'target range stays at the upload check');
ok(m.patch.projectTypes['MR-DN'].columns.length === 2, 'target columns per project type');
// shape of a real console (Sierra Leone UAT, Oct 2026): current user schema with patterns, older user.all with min/max
const real = [{ mdms: [{ tenantId: 'si', schemaCode: 'HCM-ADMIN-CONSOLE.schemas', uniqueIdentifier: 'user', isActive: true, data: { title: 'user', properties: { stringProperties: [
  { name: 'HCM_ADMIN_CONSOLE_USER_NAME', pattern: '^[A-Za-z0-9 \\-]{2,128}$', errorMessage: 'Name must be alphanumeric' },
  { name: 'HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER', pattern: '^[0-9]{9}$' }, { name: 'HCM_ADMIN_CONSOLE_USER_PAYEE_PHONE_NUMBER' }, { name: 'UserName', pattern: '^[a-zA-Z][a-zA-Z0-9._-]{2,29}$' }] } } }] },
  { mdms: [{ tenantId: 'si', schemaCode: 'HCM-ADMIN-CONSOLE.adminSchema', uniqueIdentifier: 'user.all', isActive: true, data: { properties: { numberProperties: [{ name: 'HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER', minimum: 1000000000, maximum: 9999999999 }] } } },
    { tenantId: 'si', schemaCode: 'HCM-ADMIN-CONSOLE.adminSchema', uniqueIdentifier: 'boundaryWithTarget.MR-DN', isActive: true, data: { properties: { numberProperties: [{ name: 'HCM_ADMIN_CONSOLE_TARGET_SMC_AGE_3_TO_11', minimum: 0, maximum: 100000000, isRequired: true }] } } }] },
  { mdms: [{ tenantId: 'si', schemaCode: 'HCM-ADMIN-CONSOLE.targetConfigs', uniqueIdentifier: 'MR-DN', isActive: true, data: { campaignType: 'MR-DN', beneficiaries: [{ columns: ['HCM_ADMIN_CONSOLE_TARGET_SMC_AGE_3_TO_11', 'HCM_ADMIN_CONSOLE_TARGET_SMC_AGE_12_TO_59'] }] } },
    { tenantId: 'si', schemaCode: 'HCM-ADMIN-CONSOLE.targetConfigs', uniqueIdentifier: 'POLIO', isActive: true, data: { campaignType: 'POLIO', beneficiaries: [{ columns: ['HCM_ADMIN_CONSOLE_TARGET_POLIO_AGE'] }] } }] }];
const rm = MPR.fromMdms(real);
ok(rm.patch.phone.digits === 9 && rm.patch.phone.presetHint === 'sl' && rm.patch.tenant === 'si', 'current user schema wins, tenant si → sl');
ok(rm.notes.some((n) => /older user schema/.test(n)), 'older schema conflict noted');
ok(rm.patch.names.personPattern === '^[A-Za-z0-9 \\-]{2,128}$' && rm.patch.names.maxLen === 128, 'name pattern');
ok(!rm.patch.targets && rm.patch.projectTypes['MR-DN'].required.length === 1 && rm.patch.projectTypes['MR-DN'].range[1] === 100000000 && !rm.patch.projectType, 'project types, none picked');
ok(MPR.fromMdms(real, { projectType: 'POLIO' }).patch.projectType === 'POLIO', 'pick project type');
ok(MPR.fromText(JSON.stringify(mdms)).kind === 'mdms', 'detect mdms');
// v1 response and a pattern-based phone
const v1 = { MdmsRes: { 'HCM-ADMIN-CONSOLE': { schemas: [{ title: 'user', properties: { HCM_ADMIN_CONSOLE_USER_PHONE_NUMBER: { type: 'string', pattern: '^[0-9]{8}$' } } }] } } };
ok(MPR.fromMdms(v1).patch.phone.digits === 8, 'v1 + pattern');
ok(MPR.fromMdms({ mdms: [] }).notes.length === 1, 'empty response explains');
// rules file round trip
const f = MPR.fromText(MPR.toFile(r1));
ok(f.kind === 'file' && f.rules.names.casing === 'lower' && f.rules.sev['Duplicate rows'] === 'off', 'rules file');
// request shape
const q = MPR.mdmsRequest('https://unified-uat.digit.org/', 'ng', 'HCM-ADMIN-CONSOLE.schemas', ['user'], 'tok');
ok(q.url === 'https://unified-uat.digit.org/mdms-v2/v2/_search' && q.body.MdmsCriteria.uniqueIdentifiers[0] === 'user' && q.body.RequestInfo.authToken === 'tok', 'request');
// casing, special characters
ok(MPR.applyCasing("ung. ali-BABA (north)", 'title') === 'Ung. Ali-Baba (North)', 'title case');
ok(MPR.badChars('Kofar Na’isa #2', MPR.DEFAULT_ALLOWED).join('') === '’#', 'bad chars');
ok(MPR.badChars('São Tomé', MPR.DEFAULT_ALLOWED).length === 0, 'accents allowed');
// phones
ok(MP.normPhone('08031234567', 'ng').value === '8031234567', 'ng');
ok(MP.normPhone('+258 84 123 4567', 'mz').ok, 'mz');
ok(!MP.normPhone('80312345', 'ng').ok, 'ng short');
ok(MP.normPhone('0123456789', { digits: 9, alt: [], cc: '', trunk0: true }).value === '123456789', 'custom');
const errResp = { ResponseInfo: null, Errors: [{ code: 'QUERY_EXECUTION_ERROR', message: 'Database operation failed' }] };
const e1 = MPR.fromText(JSON.stringify(errResp)); ok(e1.kind === 'mdms' && !Object.keys(e1.patch).length && /QUERY_EXECUTION_ERROR/.test(e1.notes[0]), 'error response explained: ' + e1.notes[0]);
const e2 = MPR.fromMdms([errResp, mdms]); ok(e2.patch.phone.digits === 9 && /Some searches failed/.test(e2.notes.join(' ')), 'partial errors kept');
const q2 = MPR.mdmsRequest('https://x.org', 'sl', 'HCM-ADMIN-CONSOLE.schemas', ['user'], '', null, false); ok(q2.body.MdmsCriteria.limit === undefined && q2.body.MdmsCriteria.offset === undefined, 'unpaged like the backend');
ok(q.body.MdmsCriteria.limit === 100 && q.body.MdmsCriteria.offset === 0, 'paged sends offset');
console.log('rules: ' + n + ' checks passed');
{ const users = ['Alh. Musa Kamara', 'Fatmata Sesay', "Mary O'Neil"].map((n, i) => ({ person: { name: n, phone: '076123456' }, phoneNorm: { ok: true, value: '7612345' + i }, ref: 'S!' + (i + 2), code: null }));
  const iss = MP.validate({ tree: { nodes: new Map(), roots: [], levelLabels: [] }, matched: [], agg: null, valueCols: [], valueLabels: {}, users, namePattern: '^[A-Za-z0-9 \\-]{2,128}$' });
  if (iss.filter((i) => i.rule === 'Name not allowed').length !== 2) throw new Error('name pattern check'); console.log('name pattern check ok'); }
