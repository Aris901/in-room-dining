'use strict';

/**
 * End-to-end API tests against a live server instance.
 *
 * Runs on an isolated database file so it never touches demo data.
 */

// Declared here rather than in the npm script so the suite behaves the same
// on every platform. NODE_ENV=test only raises the brute-force limits, which
// would otherwise reject the repeated logins these tests perform.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = require('path').join(__dirname, 'tmp-test.db');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

// Start from a clean database on every run.
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch { /* not present */ }
}

const app = require('../server');
const { db } = require('../src/db');
const { seed } = require('../src/seed');
const timeUtil = require('../src/time');
const { config } = require('../src/config');

seed();

const today = timeUtil.hotelToday(config.hotelTimeZone);
let baseUrl;
let server;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => {
  server?.close();
  db.close();
});

/** Minimal cookie jar so sessions persist across requests. */
function makeClient() {
  const jar = new Map();
  return async function call(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    if (jar.size) {
      headers.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (value === '') jar.delete(name);
      else jar.set(name, value);
    }
    const type = res.headers.get('content-type') ?? '';
    const payload = type.includes('application/json')
      ? await res.json()
      : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: payload, headers: res.headers };
  };
}

const ARIEL = {
  fullName: 'Ariel Kalambay',
  roomNumber: '412',
  phone: '+7 495 555-01-42',
  checkIn: timeUtil.addDays(today, -1),
  checkOut: timeUtil.addDays(today, 4),
};

async function loginGuest(overrides = {}) {
  const call = makeClient();
  const res = await call('POST', '/api/guest/login', { ...ARIEL, ...overrides });
  return { call, res };
}

async function loginStaff(username, password) {
  const call = makeClient();
  const res = await call('POST', '/api/staff/login', { username, password });
  return { call, res };
}

/**
 * A meal this guest can still order and has not already ordered.
 * Skipping meals with an existing order keeps tests independent of each other,
 * since a second order for the same meal is legitimately refused as a duplicate.
 */
async function findOpenMeal(call) {
  for (let offset = 0; offset <= 6; offset++) {
    const date = timeUtil.addDays(today, offset);
    const res = await call('GET', `/api/menu?date=${date}`);
    const meal = res.body.meals?.find(
      (m) => m.canOrder && (m.existingOrders?.length ?? 0) === 0
    );
    if (meal) return { date, meal };
  }
  throw new Error('no orderable, un-ordered meal found in the next week');
}

// ---------------------------------------------------------------------------

test('guest login requires all five fields to match', async () => {
  const ok = await loginGuest();
  assert.strictEqual(ok.res.status, 200);
  assert.strictEqual(ok.res.body.guest.room, '412');

  // Four of five correct is still a rejection.
  const wrongPhone = await loginGuest({ phone: '+7 495 555-99-99' });
  assert.strictEqual(wrongPhone.res.status, 401);

  const wrongRoom = await loginGuest({ roomNumber: '999' });
  assert.strictEqual(wrongRoom.res.status, 401);

  const wrongDates = await loginGuest({ checkOut: timeUtil.addDays(today, 9) });
  assert.strictEqual(wrongDates.res.status, 401);
});

test('login failures are indistinguishable from one another', async () => {
  const unknownRoom = await loginGuest({ roomNumber: '888' });
  const knownRoomWrongName = await loginGuest({ fullName: 'Someone Else' });
  assert.deepStrictEqual(unknownRoom.res.body, knownRoomWrongName.res.body);
});

test('phone formatting differences do not block a valid guest', async () => {
  const spaced = await loginGuest({ phone: '8 (495) 555-01-42' });
  assert.strictEqual(spaced.res.status, 200, 'the 8XXX form of the same number must work');
});

test('a stay that already ended cannot log in', async () => {
  const { res } = await loginGuest({
    fullName: 'Elena Morozova',
    roomNumber: '301',
    phone: '+7 495 555-30-11',
    checkIn: timeUtil.addDays(today, -9),
    checkOut: timeUtil.addDays(today, -2),
  });
  assert.strictEqual(res.status, 401);
});

test('protected endpoints reject anonymous callers', async () => {
  const call = makeClient();
  assert.strictEqual((await call('GET', '/api/menu')).status, 401);
  assert.strictEqual((await call('GET', '/api/orders')).status, 401);
  assert.strictEqual((await call('POST', '/api/orders', {})).status, 401);
});

test('menu reports a server-computed open/closed state per meal', async () => {
  const { call } = await loginGuest();
  const res = await call('GET', `/api/menu?date=${today}`);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.meals.length, 3);
  for (const meal of res.body.meals) {
    assert.ok(['breakfast', 'lunch', 'dinner'].includes(meal.meal));
    assert.strictEqual(typeof meal.open, 'boolean');
    assert.ok(meal.cutoffAt, 'every meal exposes its deadline');
  }
});

test('breakfast today is always closed — its deadline was 22:00 yesterday', async () => {
  const { call } = await loginGuest();
  const res = await call('GET', `/api/menu?date=${today}`);
  const breakfast = res.body.meals.find((m) => m.meal === 'breakfast');
  assert.strictEqual(breakfast.open, false);
  assert.strictEqual(breakfast.canOrder, false);
});

test('a card order is paid immediately and returns a receipt', async () => {
  const { call } = await loginGuest();
  const { date, meal } = await findOpenMeal(call);

  const res = await call('POST', '/api/orders', {
    serviceDate: date,
    meal: meal.meal,
    items: [{ dishId: meal.dishes[0].id, qty: 2 }],
    paymentMethod: 'card',
    testCardId: 'approved',
    lang: 'en',
  });

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.order.status, 'paid');
  assert.strictEqual(res.body.order.cardLast4, '4242');
  assert.ok(res.body.order.authCode);

  const pdf = await call('GET', res.body.receiptUrl);
  assert.strictEqual(pdf.status, 200);
  assert.strictEqual(pdf.body.subarray(0, 4).toString(), '%PDF');
});

test('the server prices the order itself and ignores client-supplied prices', async () => {
  const { call } = await loginGuest({
    fullName: 'Maria Ivanova',
    roomNumber: '507',
    phone: '+7 495 555-07-19',
    checkIn: today,
    checkOut: timeUtil.addDays(today, 2),
  });
  const { date, meal } = await findOpenMeal(call);
  const dish = meal.dishes[0];

  const res = await call('POST', '/api/orders', {
    serviceDate: date,
    meal: meal.meal,
    // A tampered client sends its own price and total. Both must be ignored.
    items: [{ dishId: dish.id, qty: 1, price: 1, priceKopecks: 1 }],
    totalKopecks: 1,
    paymentMethod: 'card',
    testCardId: 'approved',
  });

  assert.strictEqual(res.status, 201);
  assert.strictEqual(
    res.body.order.totalKopecks,
    dish.price_kopecks,
    'total must come from the database price, not the request'
  );
});

test('a declined card produces no order', async () => {
  const { call } = await loginGuest({
    fullName: 'James Whitfield',
    roomNumber: '218',
    phone: '+7 495 555-22-08',
    checkIn: timeUtil.addDays(today, -3),
    checkOut: timeUtil.addDays(today, 1),
  });
  const { date, meal } = await findOpenMeal(call);

  const before = await call('GET', '/api/orders');
  const res = await call('POST', '/api/orders', {
    serviceDate: date,
    meal: meal.meal,
    items: [{ dishId: meal.dishes[0].id, qty: 1 }],
    paymentMethod: 'card',
    testCardId: 'declined',
  });

  assert.strictEqual(res.status, 402);
  const after = await call('GET', '/api/orders');
  assert.strictEqual(
    after.body.orders.length,
    before.body.orders.length,
    'a declined payment must not leave an order behind'
  );
});

test('ordering past the deadline is refused', async () => {
  const { call } = await loginGuest();
  // Breakfast today closed at 22:00 yesterday.
  const menu = await call('GET', `/api/menu?date=${today}`);
  const breakfast = menu.body.meals.find((m) => m.meal === 'breakfast');

  const res = await call('POST', '/api/orders', {
    serviceDate: today,
    meal: 'breakfast',
    items: [{ dishId: breakfast.dishes[0].id, qty: 1 }],
    paymentMethod: 'cash',
  });

  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error, 'ordering_closed');
});

test('a guest cannot order for a date outside their own stay', async () => {
  const { call } = await loginGuest();
  const farFuture = timeUtil.addDays(today, 8); // stay ends at +4
  const menu = await call('GET', `/api/menu?date=${farFuture}`);
  const dinner = menu.body.meals.find((m) => m.meal === 'dinner');

  const res = await call('POST', '/api/orders', {
    serviceDate: farFuture,
    meal: 'dinner',
    items: [{ dishId: dinner.dishes[0].id, qty: 1 }],
    paymentMethod: 'cash',
  });

  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error, 'outside_stay');
});

test('a dish from another day’s menu is rejected', async () => {
  const { call } = await loginGuest();
  const { date, meal } = await findOpenMeal(call);

  const otherDay = await call('GET', `/api/menu?date=${timeUtil.addDays(date, 1)}`);
  const foreignDish = otherDay.body.meals.find((m) => m.meal === meal.meal).dishes[0];

  const res = await call('POST', '/api/orders', {
    serviceDate: date,
    meal: meal.meal,
    items: [{ dishId: foreignDish.id, qty: 1 }],
    paymentMethod: 'cash',
  });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'unknown_dish');
});

test('cash order waits for reception before reaching the kitchen', async () => {
  const guest = await loginGuest();
  const { date, meal } = await findOpenMeal(guest.call);

  // Use a meal this guest has not already ordered.
  const later = timeUtil.addDays(date, 1);
  const menu = await guest.call('GET', `/api/menu?date=${later}`);
  const target = menu.body.meals.find((m) => m.canOrder);
  assert.ok(target, 'expected an orderable meal tomorrow');

  const placed = await guest.call('POST', '/api/orders', {
    serviceDate: later,
    meal: target.meal,
    items: [{ dishId: target.dishes[0].id, qty: 1 }],
    paymentMethod: 'cash',
    lang: 'ru',
  });

  assert.strictEqual(placed.status, 201);
  assert.strictEqual(placed.body.order.status, 'awaiting_cash');
  assert.ok(placed.body.order.voucherToken, 'a cash order must carry a voucher token');

  const publicId = placed.body.order.publicId;

  // Kitchen must not see it yet.
  const reception = await loginStaff('reception', 'front1234');
  assert.strictEqual(reception.res.status, 200);

  let board = await reception.call('GET', `/api/staff/orders?date=${later}&meal=${target.meal}`);
  let entry = board.body.orders.find((o) => o.publicId === publicId);
  assert.strictEqual(entry.inKitchenQueue, false, 'unpaid cash order must stay out of the queue');

  // Reception takes the money.
  const settle = await reception.call('POST', `/api/staff/orders/${publicId}/settle-cash`);
  assert.strictEqual(settle.status, 200);

  board = await reception.call('GET', `/api/staff/orders?date=${later}&meal=${target.meal}`);
  entry = board.body.orders.find((o) => o.publicId === publicId);
  assert.strictEqual(entry.status, 'paid');
  assert.strictEqual(entry.inKitchenQueue, true, 'settled cash order joins the queue');

  // Settling twice is refused rather than double-counted.
  const again = await reception.call('POST', `/api/staff/orders/${publicId}/settle-cash`);
  assert.strictEqual(again.status, 409);
});

test('a guest cannot read another guest’s order', async () => {
  const maria = await loginGuest({
    fullName: 'Maria Ivanova',
    roomNumber: '507',
    phone: '+7 495 555-07-19',
    checkIn: today,
    checkOut: timeUtil.addDays(today, 2),
  });
  const hers = await maria.call('GET', '/api/orders');
  assert.ok(hers.body.orders.length > 0, 'Maria should have an order from an earlier test');
  const publicId = hers.body.orders[0].publicId;

  const ariel = await loginGuest();
  const stolen = await ariel.call('GET', `/api/orders/${publicId}/receipt.pdf`);
  assert.strictEqual(stolen.status, 404, 'another guest’s receipt must not be readable');
});

test('staff endpoints reject guests and anonymous callers', async () => {
  const anon = makeClient();
  assert.strictEqual((await anon('GET', '/api/staff/orders')).status, 401);
  assert.strictEqual((await anon('GET', '/api/staff/menus')).status, 401);

  const { call } = await loginGuest();
  assert.strictEqual(
    (await call('GET', '/api/staff/orders')).status,
    401,
    'a guest session must not unlock the staff API'
  );
});

test('staff roles are enforced', async () => {
  const chef = await loginStaff('chef', 'chef1234');
  // A chef may edit menus but must not settle cash.
  const menus = await chef.call('GET', '/api/staff/menus');
  assert.strictEqual(menus.status, 200);

  const settle = await chef.call('POST', '/api/staff/orders/AG-NOPE/settle-cash');
  assert.strictEqual(settle.status, 403, 'chef must not be able to take payment');
});

test('bad staff credentials are rejected', async () => {
  const bad = await loginStaff('chef', 'wrong-password');
  assert.strictEqual(bad.res.status, 401);
  const unknown = await loginStaff('nobody', 'whatever');
  assert.strictEqual(unknown.res.status, 401);
});

test('chef can publish a menu and set prices', async () => {
  const chef = await loginStaff('chef', 'chef1234');
  const date = timeUtil.addDays(today, 5);

  const res = await chef.call('PUT', `/api/staff/menus/${date}/dinner`, {
    published: true,
    dishes: [
      { titleEn: 'Test Dish', titleRu: 'Тестовое блюдо', price: '1 234,56' },
      { titleEn: 'Second', titleRu: 'Второе', price: 900 },
    ],
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.dishCount, 2);

  const check = await chef.call('GET', `/api/staff/menus?from=${date}&days=1`);
  const dinner = check.body.menus[0].meals.find((m) => m.meal === 'dinner');
  assert.strictEqual(dinner.dishes[0].priceKopecks, 123456);
  assert.strictEqual(dinner.dishes[1].priceKopecks, 90000);
});

test('an invalid price is rejected without partially writing the menu', async () => {
  const chef = await loginStaff('chef', 'chef1234');
  const date = timeUtil.addDays(today, 6);

  const res = await chef.call('PUT', `/api/staff/menus/${date}/lunch`, {
    published: true,
    dishes: [
      { titleEn: 'Good', titleRu: 'Хорошо', price: '500' },
      { titleEn: 'Bad', titleRu: 'Плохо', price: 'free' },
    ],
  });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'invalid_price');
  assert.strictEqual(res.body.index, 1, 'the failing row is identified');

  // The valid first row must not have been written.
  const check = await chef.call('GET', `/api/staff/menus?from=${date}&days=1`);
  const lunch = check.body.menus[0].meals.find((m) => m.meal === 'lunch');
  const written = lunch.dishes.find((d) => d.titleEn === 'Good');
  assert.strictEqual(written, undefined, 'a rejected menu must not be half-saved');
});

test('Excel export produces a real workbook', async () => {
  const manager = await loginStaff('manager', 'manage1234');
  const res = await manager.call('GET', `/api/staff/reports/orders.xlsx?date=${today}&meal=dinner`);

  assert.strictEqual(res.status, 200);
  assert.match(
    res.headers.get('content-type'),
    /spreadsheetml\.sheet/,
    'must be served as a real .xlsx MIME type'
  );
  // XLSX files are ZIP archives — check the local file header magic.
  assert.strictEqual(res.body.subarray(0, 2).toString(), 'PK');
});
