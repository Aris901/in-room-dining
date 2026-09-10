'use strict';

/**
 * The cap on stored orders, which exists because the deployed instance is
 * open to strangers.
 *
 * Two things have to hold and neither is obvious from reading the SQL: that
 * it drops the OLDEST rather than whatever the database hands back first, and
 * that the line items go with them. The second relies on ON DELETE CASCADE
 * plus `PRAGMA foreign_keys = ON`, and SQLite silently ignores the cascade if
 * that pragma is off — which is exactly the kind of thing that leaves an
 * orphaned table growing quietly on a free tier.
 *
 *   node --test tests/order-cap.test.js
 */

process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.MAX_ORDERS = '5';

const test = require('node:test');
const assert = require('node:assert');

const { db } = require('../src/db');
const { config } = require('../src/config');
const orderCap = require('../src/order-cap');

let seq = 0;

// orders.stay_id is a real foreign key and foreign keys are enabled, so an
// order cannot exist without a stay. That the first draft of this test failed
// on exactly that is the proof the cascade below will actually fire.
const STAY_ID = db
  .prepare(
    `INSERT INTO stays (full_name, room_number, phone, phone_digits, check_in, check_out)
     VALUES (?,?,?,?,?,?)`
  )
  .run('Test Guest', '412', '+7 495 555-00-00', '74955550000', '2026-01-01', '2026-12-31')
  .lastInsertRowid;

function makeOrder(items = 1) {
  seq++;
  const info = db
    .prepare(
      `INSERT INTO orders (
         public_id, stay_id, room_number, guest_name, service_date, meal,
         status, payment_method, subtotal_kopecks, vat_kopecks, total_kopecks,
         vat_percent, lang, created_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      `AG-TEST${String(seq).padStart(4, '0')}`, STAY_ID, '412', 'Test Guest',
      '2026-01-01', 'dinner', 'paid', 'card', 1000, 200, 1200, 20, 'en',
      new Date().toISOString()
    );

  const insertItem = db.prepare(
    `INSERT INTO order_items
       (order_id, dish_id, title_en, title_ru, unit_price_kopecks, qty, line_total_kopecks)
     VALUES (?,?,?,?,?,?,?)`
  );
  for (let i = 0; i < items; i++) {
    insertItem.run(info.lastInsertRowid, null, 'Dish', 'Блюдо', 1000, 1, 1000);
  }
  return { id: info.lastInsertRowid, publicId: `AG-TEST${String(seq).padStart(4, '0')}` };
}

const clear = () => db.exec('DELETE FROM order_items; DELETE FROM orders;');

test('the cap is read from the environment', () => {
  assert.equal(config.maxOrders, 5);
});

test('under the cap, nothing is dropped', () => {
  clear();
  for (let i = 0; i < 5; i++) makeOrder();
  assert.equal(orderCap.pruneOldOrders(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 5);
});

test('over the cap, the oldest go and the newest stay', () => {
  clear();
  const made = [];
  for (let i = 0; i < 8; i++) made.push(makeOrder());

  const removed = orderCap.pruneOldOrders();
  assert.equal(removed, 3, 'three over a cap of five');

  const left = db.prepare('SELECT public_id FROM orders ORDER BY id').all().map((r) => r.public_id);
  assert.equal(left.length, 5);
  assert.deepEqual(left, made.slice(3).map((m) => m.publicId), 'the five newest survive, in order');
  for (const gone of made.slice(0, 3)) {
    assert.ok(!left.includes(gone.publicId), `${gone.publicId} should have been dropped`);
  }
});

test('the line items go with the order they belonged to', () => {
  clear();
  const made = [];
  for (let i = 0; i < 8; i++) made.push(makeOrder(3));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM order_items').get().n, 24);

  orderCap.pruneOldOrders();

  // Five orders left, three lines each. If the cascade were not firing this
  // would still read 24, with nine rows pointing at orders that no longer
  // exist.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM order_items').get().n, 15);

  const orphans = db
    .prepare('SELECT COUNT(*) n FROM order_items WHERE order_id NOT IN (SELECT id FROM orders)')
    .get().n;
  assert.equal(orphans, 0, 'no order_items left pointing at a deleted order');
});

test('running it twice in a row changes nothing the second time', () => {
  clear();
  for (let i = 0; i < 9; i++) makeOrder();
  assert.equal(orderCap.pruneOldOrders(), 4);
  assert.equal(orderCap.pruneOldOrders(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 5);
});

test('a cap of zero disables it, which is the setting for a real hotel', () => {
  clear();
  for (let i = 0; i < 12; i++) makeOrder();
  const real = config.maxOrders;
  config.maxOrders = 0;
  try {
    assert.equal(orderCap.pruneOldOrders(), 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 12);
  } finally {
    config.maxOrders = real;
  }
});

test('pruneQuietly never throws, whatever the database does', () => {
  clear();
  const real = config.maxOrders;
  // A cap of NaN is the shape a bad env var takes; it must not reach a caller
  // who has already committed a guest's order.
  config.maxOrders = Number('not-a-number');
  try {
    assert.doesNotThrow(() => orderCap.pruneQuietly());
  } finally {
    config.maxOrders = real;
  }
});
