/**
 * CLI tool to manage freda-auth users.
 *
 * Usage:
 *   node add-user.mjs add <username> <password> <market|customer|admin> [space1,space2]
 *   node add-user.mjs list
 *   node add-user.mjs remove <username> <market|customer|admin>
 *   node add-user.mjs pause  <username> <market|customer|admin>
 *   node add-user.mjs resume <username> <market|customer|admin>
 */

import { scryptSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const USERS_FILE  = process.env.FREDA_USERS_FILE || 'C:\\freda-auth\\users.json';
const VALID_TYPES = ['market', 'customer', 'admin'];

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function readUsers() {
  if (!existsSync(USERS_FILE)) return [];
  try { return JSON.parse(readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function writeUsers(users) {
  const dir = dirname(USERS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const [,, cmd, ...args] = process.argv;

if (cmd === 'add') {
  const [username, password, user_type, spacesArg] = args;
  if (!username || !password || !VALID_TYPES.includes(user_type)) {
    console.error('Usage: node add-user.mjs add <username> <password> <market|customer|admin> [NTM,ERIS]');
    process.exit(1);
  }
  const spaces = (user_type === 'customer' && spacesArg)
    ? spacesArg.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const users  = readUsers();
  const idx    = users.findIndex(u => u.username === username && u.user_type === user_type);
  const entry  = { username, password: hashPassword(password), user_type, active: true, spaces };
  if (idx >= 0) {
    users[idx] = { ...users[idx], ...entry };
    console.log(`Updated ${user_type} user: ${username}`);
  } else {
    users.push(entry);
    console.log(`Added ${user_type} user: ${username}${spaces.length ? ' [' + spaces.join(', ') + ']' : ''}`);
  }
  writeUsers(users);

} else if (cmd === 'list') {
  const users = readUsers();
  if (!users.length) { console.log('No users found.'); process.exit(0); }
  console.log('STATUS      TYPE        USERNAME              SPACES');
  console.log('─'.repeat(58));
  for (const u of users) {
    const status = u.active === false ? 'PAUSED    ' : 'active    ';
    const spaces = u.spaces && u.spaces.length ? u.spaces.join(', ') : '—';
    console.log(`${status}  ${u.user_type.padEnd(11)} ${u.username.padEnd(21)} ${spaces}`);
  }

} else if (cmd === 'remove') {
  const [username, user_type] = args;
  if (!username || !VALID_TYPES.includes(user_type)) {
    console.error('Usage: node add-user.mjs remove <username> <market|customer|admin>');
    process.exit(1);
  }
  const before = readUsers();
  const after  = before.filter(u => !(u.username === username && u.user_type === user_type));
  if (before.length === after.length) {
    console.error(`User not found: ${user_type}/${username}`); process.exit(1);
  }
  writeUsers(after);
  console.log(`Removed ${user_type} user: ${username}`);

} else if (cmd === 'pause') {
  const [username, user_type] = args;
  if (!username || !VALID_TYPES.includes(user_type)) {
    console.error('Usage: node add-user.mjs pause <username> <market|customer|admin>');
    process.exit(1);
  }
  const users = readUsers();
  const idx   = users.findIndex(u => u.username === username && u.user_type === user_type);
  if (idx === -1) { console.error(`User not found: ${user_type}/${username}`); process.exit(1); }
  users[idx].active = false;
  writeUsers(users);
  console.log(`Paused ${user_type} user: ${username}`);

} else if (cmd === 'resume') {
  const [username, user_type] = args;
  if (!username || !VALID_TYPES.includes(user_type)) {
    console.error('Usage: node add-user.mjs resume <username> <market|customer|admin>');
    process.exit(1);
  }
  const users = readUsers();
  const idx   = users.findIndex(u => u.username === username && u.user_type === user_type);
  if (idx === -1) { console.error(`User not found: ${user_type}/${username}`); process.exit(1); }
  users[idx].active = true;
  writeUsers(users);
  console.log(`Resumed ${user_type} user: ${username}`);

} else {
  console.log('Commands:');
  console.log('  node add-user.mjs add    <username> <password> <market|customer|admin> [NTM,ERIS]');
  console.log('  node add-user.mjs list');
  console.log('  node add-user.mjs remove <username> <market|customer|admin>');
  console.log('  node add-user.mjs pause  <username> <market|customer|admin>');
  console.log('  node add-user.mjs resume <username> <market|customer|admin>');
}
