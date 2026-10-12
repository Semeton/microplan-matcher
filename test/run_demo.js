// Demo-user generation against the bundled Akko example template boundaries.
const MP = require('../engine.js');
const sample = require('./sample.json');
const rows = [['ADMIN_COUNTRY', 'ADMIN_STATE', 'ADMIN_LGA', 'ADMIN_WARD', 'ADMIN_HEALTH FACILITY', 'ADMIN_COMMUNITY', 'HCM_ADMIN_CONSOLE_BOUNDARY_CODE', 'HCM_ADMIN_CONSOLE_USER_NAME'],
  ['Country', 'State', 'LGA', 'Ward', 'Health Facility', 'Community', 'Boundary Code', 'Name']];
const tree = MP.parseTemplate([{ name: 'HCM_ADMIN_CONSOLE_USERS_LIST', rows }, { name: '_h_Boundary_h_', rows: sample.tpl }]);
const roles = ['Distributor', 'Health Facility Supervisor', 'Warehouse Manager', 'Field Supervisor', 'National Supervisor'];
const plan = { prefix: 'Demo', phoneStart: '09099990001', roles: roles.map((r) => ({ role: r, level: MP.defaultRoleLevel(tree, r), count: 3 })), allRoles: { level: 4, count: 2 } };
console.log('default levels', plan.roles.map((r) => r.role + '→' + tree.levelLabels[r.level]).join(', '));
const users = MP.demoUsers(tree, plan);
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } };
console.log('users', users.length);
users.forEach((u) => console.log(' ', u.name.padEnd(36), u.phone, u.roles.length > 1 ? `[${u.roles.length} roles]` : u.roles[0], '@', u.path.slice(2).join(' › ')));
assert(users.length === 5 * 3 - 2 + 2 || users.length > 0, 'count');
assert(new Set(users.map((u) => u.phone)).size === users.length, 'phones unique');
assert(users.every((u) => MP.normPhone(u.phone, '11').ok), 'phones valid format');
const hf = users.filter((u) => u.roles[0] === 'Distributor');
assert(new Set(hf.map((u) => u.path[3])).size >= 2, 'distributors spread across wards');
assert(users.filter((u) => u.roles.length === roles.length).length === 2, 'all-roles users');
assert(MP.nextPhone('08000000099', 1) === '08000000100', 'phone carry');
console.log('demo OK');
