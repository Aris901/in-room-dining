#!/usr/bin/env node
/**
 * Prove the Turso connection actually holds data — before a deploy depends on it.
 *
 * "It connected" is not the thing worth checking. The requirement is that an
 * order survives the instance it was created on, so this writes through one
 * embedded replica, then opens a *second* replica backed by a different local
 * file and reads the row back. The second replica has never seen the first
 * one's disk, so if the row is there it came down from Turso, which is exactly
 * what happens when a free instance is redeployed and starts with an empty
 * filesystem.
 *
 * Reads the same variables the application does, so a pass here means the
 * application will work with that environment — not something adjacent to it.
 *
 *   TURSO_SYNC_URL=libsql://<db>.turso.io TURSO_AUTH_TOKEN=... node scripts/check-turso.js
 *
 * Touches only its own table (_deploy_check) and drops it at the end. It never
 * reads or writes application data.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SYNC_URL = process.env.TURSO_SYNC_URL || '';
const DB_URL = process.env.TURSO_DATABASE_URL || '';
const TOKEN = process.env.TURSO_AUTH_TOKEN || '';

const ok = (m) => console.log('  ok    ' + m);
const bad = (m, d) => { console.log('  FAIL  ' + m + (d ? '\n          ' + d : '')); process.exitCode = 1; };

if (!SYNC_URL && !DB_URL) {
  console.error('Set TURSO_SYNC_URL (embedded replica) or TURSO_DATABASE_URL (direct).');
  process.exit(2);
}
if (SYNC_URL && DB_URL) {
  console.error('Set one of TURSO_SYNC_URL / TURSO_DATABASE_URL, not both.');
  process.exit(2);
}
if (!TOKEN) {
  console.error('TURSO_AUTH_TOKEN is required.  turso db tokens create <database>');
  process.exit(2);
}

let Database;
try {
  Database = require('libsql');
} catch {
  console.error('libsql is not installed.  npm i libsql');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'turso-check-'));
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let first = null;
let second = null;

try {
  console.log(`\n  target   ${(SYNC_URL || DB_URL).replace(/^libsql:\/\//, '')}`);
  console.log(`  mode     ${SYNC_URL ? 'embedded replica' : 'direct'}\n`);

  // ---- open ---------------------------------------------------------------
  const t0 = Date.now();
  first = SYNC_URL
    ? new Database(path.join(tmp, 'a.db'), { syncUrl: SYNC_URL, authToken: TOKEN })
    : new Database(DB_URL, { authToken: TOKEN });
  ok(`connected in ${Date.now() - t0}ms`);

  // ---- write --------------------------------------------------------------
  first.exec('CREATE TABLE IF NOT EXISTS _deploy_check (id INTEGER PRIMARY KEY, stamp TEXT NOT NULL, at TEXT NOT NULL)');
  first.prepare('INSERT INTO _deploy_check (stamp, at) VALUES (?, ?)').run(stamp, new Date().toISOString());
  ok('wrote a row');

  const here = first.prepare('SELECT stamp FROM _deploy_check WHERE stamp = ?').get(stamp);
  if (here) ok('read it back locally');
  else bad('read it back locally', 'the row was not there');

  // An embedded replica's write is local until it is pushed. Without this the
  // second replica would be reading a database the row never reached.
  if (SYNC_URL && typeof first.sync === 'function') {
    first.sync();
    ok('pushed to Turso');
  }

  // ---- the part that matters ---------------------------------------------
  // A replica on a different file, with no access to the first one's disk.
  if (SYNC_URL) {
    second = new Database(path.join(tmp, 'b.db'), { syncUrl: SYNC_URL, authToken: TOKEN });
    if (typeof second.sync === 'function') second.sync();
    const there = second.prepare('SELECT stamp FROM _deploy_check WHERE stamp = ?').get(stamp);
    if (there) ok('a fresh replica, empty filesystem, sees the row — this is what survives a redeploy');
    else bad('a fresh replica sees the row', 'the write did not reach Turso; data would be lost on redeploy');
  }

  // ---- how much of the free tier this costs -------------------------------
  const rows = first.prepare('SELECT COUNT(*) AS n FROM _deploy_check').get();
  if (rows.n > 1) console.log(`  note    ${rows.n} check rows accumulated; dropping the table clears them`);
} catch (e) {
  bad('the connection failed', e.message);
  if (/UNAUTHORIZED|401|auth/i.test(e.message)) {
    console.log('          The token is wrong or expired.  turso db tokens create <database>');
  } else if (/ENOTFOUND|dns|getaddrinfo/i.test(e.message)) {
    console.log('          The hostname does not resolve. Check it with: turso db show <database> --url');
  } else if (/404|not found/i.test(e.message)) {
    console.log('          Turso answers every *.turso.io name, so a 404 here means the database');
    console.log('          name is wrong rather than the host being down.  turso db list');
  }
} finally {
  try { if (first) { first.exec('DROP TABLE IF EXISTS _deploy_check'); if (SYNC_URL && typeof first.sync === 'function') first.sync(); } } catch {}
  try { if (second) second.close(); } catch {}
  try { if (first) first.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

console.log(process.exitCode ? '\n  Not ready to deploy.\n' : '\n  Turso is holding data. Safe to deploy against it.\n');
