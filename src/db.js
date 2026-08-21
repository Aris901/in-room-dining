'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { config } = require('./config');

fs.mkdirSync(config.paths.data, { recursive: true });

const db = new Database(config.paths.db);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Schema.
 *
 * Notes on a few deliberate choices:
 *  - Money is INTEGER kopecks everywhere. No REAL columns touch prices.
 *  - order_items snapshots the dish title and unit price at order time, so
 *    editing tomorrow's menu can never rewrite yesterday's receipt.
 *  - No card number, expiry or CVV column exists. Only last4 + an auth code
 *    are retained, which is all a receipt legitimately needs.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS stays (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT    NOT NULL,
  room_number   TEXT    NOT NULL,
  phone         TEXT    NOT NULL,
  phone_digits  TEXT    NOT NULL,
  check_in      TEXT    NOT NULL,
  check_out     TEXT    NOT NULL,
  cancelled     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stays_lookup ON stays (room_number, check_in, check_out);

CREATE TABLE IF NOT EXISTS staff (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('chef','reception','manager')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS menus (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  service_date  TEXT    NOT NULL,
  meal          TEXT    NOT NULL CHECK (meal IN ('breakfast','lunch','dinner')),
  published     INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (service_date, meal)
);

CREATE TABLE IF NOT EXISTS dishes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id        INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  title_en       TEXT    NOT NULL,
  title_ru       TEXT    NOT NULL,
  description_en TEXT    NOT NULL DEFAULT '',
  description_ru TEXT    NOT NULL DEFAULT '',
  allergens_en   TEXT    NOT NULL DEFAULT '',
  allergens_ru   TEXT    NOT NULL DEFAULT '',
  price_kopecks  INTEGER NOT NULL CHECK (price_kopecks >= 0),
  available      INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dishes_menu ON dishes (menu_id);

CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id         TEXT    NOT NULL UNIQUE,
  stay_id           INTEGER NOT NULL REFERENCES stays(id),
  room_number       TEXT    NOT NULL,
  guest_name        TEXT    NOT NULL,
  service_date      TEXT    NOT NULL,
  meal              TEXT    NOT NULL CHECK (meal IN ('breakfast','lunch','dinner')),
  status            TEXT    NOT NULL CHECK (status IN ('awaiting_cash','paid','cancelled')),
  payment_method    TEXT    NOT NULL CHECK (payment_method IN ('card','cash')),
  subtotal_kopecks  INTEGER NOT NULL,
  vat_kopecks       INTEGER NOT NULL,
  total_kopecks     INTEGER NOT NULL,
  vat_percent       INTEGER NOT NULL,
  lang              TEXT    NOT NULL DEFAULT 'en',
  card_last4        TEXT,
  auth_code         TEXT,
  voucher_token     TEXT,
  note              TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL,
  paid_at           TEXT,
  settled_by        TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_service ON orders (service_date, meal);
CREATE INDEX IF NOT EXISTS idx_orders_stay ON orders (stay_id);

CREATE TABLE IF NOT EXISTS order_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id            INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  dish_id             INTEGER,
  title_en            TEXT    NOT NULL,
  title_ru            TEXT    NOT NULL,
  unit_price_kopecks  INTEGER NOT NULL,
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  line_total_kopecks  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items (order_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/** Append-only trail for staff actions that move money or change the menu. */
function audit(actor, action, detail = '') {
  db.prepare('INSERT INTO audit_log (actor, action, detail) VALUES (?, ?, ?)').run(
    actor,
    action,
    typeof detail === 'string' ? detail : JSON.stringify(detail)
  );
}

module.exports = { db, audit };
