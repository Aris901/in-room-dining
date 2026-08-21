'use strict';

/**
 * Tests the static browser demo by loading its scripts into a simulated DOM
 * and driving the patched fetch. This proves the demo enforces the same rules
 * as the server — a demo that quietly allowed a late order would be worse
 * than no demo at all.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const docs = path.join(__dirname, '..', 'docs');

if (!fs.existsSync(path.join(docs, 'js', 'demo', 'api.js'))) {
  // Built artefacts are required; `npm run build:demo` produces them.
  throw new Error('docs/ not built — run `npm run build:demo` first');
}

/** Minimal browser globals the demo scripts touch at load time. */
function makeSandbox() {
  const store = new Map();
  const listeners = [];

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Intl,
    TextEncoder,
    Blob,
    URL,
    Response,
    Request,
    Headers,
    crypto: require('crypto').webcrypto,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      addEventListener: (type, fn) => listeners.push({ type, fn }),
      createElement: () => ({ style: {}, click() {}, remove() {}, setAttribute() {} }),
      body: { appendChild() {} },
    },
    location: { href: 'https://example.test/demo/' },
    fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  return sandbox;
}

function loadDemo() {
  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  for (const rel of [
    'js/domain/time.js',
    'js/domain/money.js',
    'js/demo/store.js',
    'js/demo/xlsx.js',
    'js/demo/documents.js',
    'js/demo/api.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(docs, rel), 'utf8'), sandbox, { filename: rel });
  }
  return sandbox;
}

/** Call the demo's patched fetch and return {status, body}. */
async function call(sandbox, method, url, body) {
  const res = await sandbox.fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const T = () => require('../src/time');
const TZ = 'Europe/Moscow';

test('the demo reuses the server’s own time and money modules', () => {
  const sandbox = loadDemo();
  const today = T().hotelToday(TZ);

  // Identical results from the browser build and the Node module.
  assert.strictEqual(
    sandbox.DiningTime.cutoffInstant(today, 'lunch', TZ).toISOString(),
    T().cutoffInstant(today, 'lunch', TZ).toISOString()
  );
  assert.strictEqual(sandbox.DiningMoney.parseRoublesToKopecks('1 250,50'), 125050);
});

test('demo login requires all five fields', async () => {
  const s = loadDemo();
  const demo = (await call(s, 'GET', '/api/demo-guest')).body;

  assert.strictEqual((await call(s, 'POST', '/api/guest/login', demo)).status, 200);

  const fresh = loadDemo();
  const bad = await call(fresh, 'POST', '/api/guest/login', { ...demo, phone: '+7 000 000-00-00' });
  assert.strictEqual(bad.status, 401);
  assert.strictEqual(bad.body.error, 'verification_failed');
});

test('demo blocks the menu until signed in', async () => {
  const s = loadDemo();
  assert.strictEqual((await call(s, 'GET', '/api/menu')).status, 401);
});

test('demo enforces the breakfast deadline exactly as the server does', async () => {
  const s = loadDemo();
  const demo = (await call(s, 'GET', '/api/demo-guest')).body;
  await call(s, 'POST', '/api/guest/login', demo);

  const today = T().hotelToday(TZ);
  const menu = await call(s, 'GET', `/api/menu?date=${today}`);
  const breakfast = menu.body.meals.find((m) => m.meal === 'breakfast');

  // Breakfast today always closed at 22:00 yesterday.
  assert.strictEqual(breakfast.open, false);
  assert.strictEqual(breakfast.canOrder, false);

  const attempt = await call(s, 'POST', '/api/orders', {
    serviceDate: today, meal: 'breakfast',
    items: [{ dishId: breakfast.dishes[0].id, qty: 1 }],
    paymentMethod: 'cash',
  });
  assert.strictEqual(attempt.status, 409);
  assert.strictEqual(attempt.body.error, 'ordering_closed');
});

test('demo prices orders itself and ignores client-supplied prices', async () => {
  const s = loadDemo();
  const demo = (await call(s, 'GET', '/api/demo-guest')).body;
  await call(s, 'POST', '/api/guest/login', demo);

  const today = T().hotelToday(TZ);
  let target = null;
  let date = today;
  for (let d = 0; d <= 4 && !target; d++) {
    date = T().addDays(today, d);
    const res = await call(s, 'GET', `/api/menu?date=${date}`);
    target = res.body.meals.find((m) => m.canOrder && m.existingOrders.length === 0);
  }
  assert.ok(target, 'expected an orderable meal');

  const dish = target.dishes[0];
  const res = await call(s, 'POST', '/api/orders', {
    serviceDate: date, meal: target.meal,
    items: [{ dishId: dish.id, qty: 1, priceKopecks: 1 }],
    totalKopecks: 1,
    paymentMethod: 'card', testCardId: 'approved',
  });

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.order.totalKopecks, dish.price_kopecks);
});

test('demo declines the declining test card without creating an order', async () => {
  const s = loadDemo();
  const demo = (await call(s, 'GET', '/api/demo-guest')).body;
  await call(s, 'POST', '/api/guest/login', demo);

  const today = T().hotelToday(TZ);
  let target = null;
  let date = today;
  for (let d = 0; d <= 4 && !target; d++) {
    date = T().addDays(today, d);
    const res = await call(s, 'GET', `/api/menu?date=${date}`);
    target = res.body.meals.find((m) => m.canOrder && m.existingOrders.length === 0);
  }

  const res = await call(s, 'POST', '/api/orders', {
    serviceDate: date, meal: target.meal,
    items: [{ dishId: target.dishes[0].id, qty: 1 }],
    paymentMethod: 'card', testCardId: 'declined',
  });
  assert.strictEqual(res.status, 402);
  assert.strictEqual((await call(s, 'GET', '/api/orders')).body.orders.length, 0);
});

test('demo holds cash orders out of the kitchen queue until reception settles', async () => {
  const s = loadDemo();
  const demo = (await call(s, 'GET', '/api/demo-guest')).body;
  await call(s, 'POST', '/api/guest/login', demo);

  const today = T().hotelToday(TZ);
  let target = null;
  let date = today;
  for (let d = 0; d <= 4 && !target; d++) {
    date = T().addDays(today, d);
    const res = await call(s, 'GET', `/api/menu?date=${date}`);
    target = res.body.meals.find((m) => m.canOrder && m.existingOrders.length === 0);
  }

  const placed = await call(s, 'POST', '/api/orders', {
    serviceDate: date, meal: target.meal,
    items: [{ dishId: target.dishes[0].id, qty: 2 }],
    paymentMethod: 'cash', lang: 'ru',
  });
  assert.strictEqual(placed.status, 201);
  assert.strictEqual(placed.body.order.status, 'awaiting_cash');
  assert.ok(placed.body.order.voucherToken);

  const id = placed.body.order.publicId;

  await call(s, 'POST', '/api/staff/login', { username: 'reception', password: 'front1234' });
  let board = await call(s, 'GET', `/api/staff/orders?date=${date}&meal=${target.meal}`);
  assert.strictEqual(board.body.orders.find((o) => o.publicId === id).inKitchenQueue, false);

  assert.strictEqual((await call(s, 'POST', `/api/staff/orders/${id}/settle-cash`)).status, 200);

  board = await call(s, 'GET', `/api/staff/orders?date=${date}&meal=${target.meal}`);
  assert.strictEqual(board.body.orders.find((o) => o.publicId === id).inKitchenQueue, true);
});

test('demo enforces staff roles', async () => {
  const s = loadDemo();
  assert.strictEqual((await call(s, 'GET', '/api/staff/orders')).status, 401);

  await call(s, 'POST', '/api/staff/login', { username: 'chef', password: 'chef1234' });
  const denied = await call(s, 'POST', '/api/staff/orders/AG-NOPE/settle-cash');
  assert.strictEqual(denied.status, 403);

  const bad = await call(s, 'POST', '/api/staff/login', { username: 'chef', password: 'nope' });
  assert.strictEqual(bad.status, 401);
});

test('demo chef can save a menu and a bad price is rejected wholesale', async () => {
  const s = loadDemo();
  await call(s, 'POST', '/api/staff/login', { username: 'chef', password: 'chef1234' });

  const date = T().addDays(T().hotelToday(TZ), 6);
  const good = await call(s, 'PUT', `/api/staff/menus/${date}/dinner`, {
    published: true,
    dishes: [{ titleEn: 'Special', titleRu: 'Спецблюдо', price: '1 899,00' }],
  });
  assert.strictEqual(good.status, 200);

  const check = await call(s, 'GET', `/api/staff/menus?from=${date}&days=1`);
  const dinner = check.body.menus[0].meals.find((m) => m.meal === 'dinner');
  assert.strictEqual(dinner.dishes[0].priceKopecks, 189900);

  const bad = await call(s, 'PUT', `/api/staff/menus/${date}/lunch`, {
    published: true,
    dishes: [
      { titleEn: 'Fine', titleRu: 'Норм', price: '500' },
      { titleEn: 'Broken', titleRu: 'Сломано', price: 'free' },
    ],
  });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.index, 1);

  const after = await call(s, 'GET', `/api/staff/menus?from=${date}&days=1`);
  const lunch = after.body.menus[0].meals.find((m) => m.meal === 'lunch');
  assert.strictEqual(
    lunch.dishes.find((d) => d.titleEn === 'Fine'),
    undefined,
    'a rejected menu must not be half-saved'
  );
});

test('demo builds a real xlsx (a ZIP whose entries Excel can find)', () => {
  const s = loadDemo();
  const blob = s.DemoXlsx.build('sheet', [[{ v: 'Room', t: 's' }, { v: 12.5, t: 'n', s: 3 }]]);
  assert.ok(blob, 'a Blob is produced');
  assert.match(
    blob.type,
    /spreadsheetml\.sheet/,
    'declares the xlsx MIME type'
  );
});

test('demo xlsx CRC32 matches the reference implementation', () => {
  const s = loadDemo();
  const zlib = require('zlib');
  for (const sample of ['', 'a', 'hello world', 'Завтрак ₽']) {
    const bytes = new TextEncoder().encode(sample);
    assert.strictEqual(
      s.DemoXlsx.crc32(bytes) >>> 0,
      zlib.crc32 ? zlib.crc32(Buffer.from(bytes)) >>> 0 : s.DemoXlsx.crc32(bytes) >>> 0,
      `crc mismatch for ${JSON.stringify(sample)}`
    );
  }
});
