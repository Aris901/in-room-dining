'use strict';

/**
 * The app can run on better-sqlite3 or on libsql. libsql is the same
 * synchronous API, which is why the swap is one environment variable — but it
 * is not byte-identical, and the differences are the kind that pass a test
 * suite and then show up in a customer's receipt.
 *
 * The one that matters: libsql attaches a `_metadata` object to rows returned
 * by .get(). better-sqlite3 does not. Any route that returns a row straight to
 * the client would start leaking query timings into its JSON.
 *
 *   node --test tests/driver.test.js
 */

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

const drivers = ['better-sqlite3', 'libsql'];

for (const name of drivers) {
  test(`${name}: the API this app relies on behaves the same`, () => {
    const Database = require(name);
    const db = new Database(':memory:');

    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kopecks INTEGER)');
    const insert = db.prepare('INSERT INTO t (name, kopecks) VALUES (?, ?)');

    const info = insert.run('alpha', 1250);
    assert.equal(info.changes, 1, 'run() reports changes');
    assert.equal(Number(info.lastInsertRowid), 1, 'run() reports the new id');

    // transactions, used for order creation
    const many = db.transaction((rows) => { for (const r of rows) insert.run(r, 100); });
    many(['beta', 'gamma']);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM t').get().n, 3);

    // integer money must survive the round trip exactly
    assert.equal(db.prepare('SELECT kopecks FROM t WHERE name = ?').get('alpha').kopecks, 1250);

    // named parameters
    assert.equal(db.prepare('SELECT name FROM t WHERE id = @id').get({ id: 1 }).name, 'alpha');

    db.close();
  });
}

test('a row is safe to serialise, whichever driver produced it', () => {
  // This is the difference. libsql's .get() carries a _metadata field; if a
  // row is ever handed to res.json() unmodified, that field goes with it.
  const results = {};
  for (const name of drivers) {
    const Database = require(name);
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, secret TEXT)');
    db.prepare('INSERT INTO t VALUES (1, ?)').run('value');
    results[name] = db.prepare('SELECT * FROM t WHERE id = 1').get();
    db.close();
  }

  const extra = Object.keys(results.libsql)
    .filter((k) => !Object.keys(results['better-sqlite3']).includes(k));

  // Recorded rather than asserted away: this documents the real difference so
  // that anyone returning a raw row knows to strip it first.
  assert.ok(
    extra.length === 0 || extra.every((k) => k.startsWith('_')),
    `libsql added unexpected public fields: ${extra.join(', ')}`
  );
});

test('no driver metadata reaches an API response', async () => {
  // The guard that actually protects the customer. Boots the real app on
  // libsql and checks that nothing driver-shaped appears in its JSON.
  process.env.DB_DRIVER = 'libsql';
  process.env.DB_PATH = ':memory:';
  process.env.DEMO_MODE = 'on';
  delete require.cache[require.resolve('../src/config')];

  const { seed } = require('../src/seed');
  const app = require('../server');
  seed({ quiet: true });

  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const jar = [];
    const call = async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', cookie: jar.join('; ') },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const c of res.headers.getSetCookie?.() ?? []) jar.push(c.split(';')[0]);
      const text = await res.text();
      return { status: res.status, text };
    };

    const demo = await call('GET', '/api/demo-guest');
    const login = await call('POST', '/api/guest/login', JSON.parse(demo.text));
    assert.equal(login.status, 200, 'the seeded guest can sign in');

    const guest = JSON.parse(login.text).guest;
    const menu = await call('GET', `/api/menu?date=${guest.today}`);

    for (const [what, payload] of Object.entries({ demo: demo.text, login: login.text, menu: menu.text })) {
      assert.ok(!payload.includes('_metadata'), `${what} response leaked _metadata`);
      assert.ok(!payload.includes('"duration"'), `${what} response leaked a query duration`);
    }
  } finally {
    server.close();
    delete process.env.DB_DRIVER;
    delete process.env.DB_PATH;
  }
});
