'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const { config } = require('../config');
const { db, audit } = require('../db');
const auth = require('../auth');
const timeUtil = require('../time');
const money = require('../money');
const { buildOrderSummary } = require('../services/report-xlsx');
const { loadOrder } = require('./guest');

const router = express.Router();

const staffLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.rateLimits.staffLogin,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts' },
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

router.post('/login', staffLoginLimiter, (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });

  const user = db.prepare('SELECT * FROM staff WHERE username = ?').get(String(username).trim());

  // Compare against a dummy hash when the user is unknown so that a wrong
  // username and a wrong password take the same time to reject.
  const hash = user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = bcrypt.compareSync(String(password), hash);

  if (!user || !ok) {
    audit(String(username).slice(0, 40), 'staff.login_failed');
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  auth.setStaffCookie(res, auth.issueStaffToken(user));
  audit(user.username, 'staff.login');
  res.json({ staff: { username: user.username, name: user.display_name, role: user.role } });
});

router.post('/logout', (req, res) => {
  auth.clearStaffCookie(res);
  res.json({ ok: true });
});

router.get('/session', auth.requireStaff(), (req, res) => {
  res.json({
    staff: {
      username: req.staff.username,
      name: req.staff.display_name,
      role: req.staff.role,
    },
    hotel: config.hotel.name,
    timeZone: config.hotelTimeZone,
    today: timeUtil.hotelToday(config.hotelTimeZone),
    vatPercent: config.vatPercent,
  });
});

// ---------------------------------------------------------------------------
// Daily menu manager  (chef / manager)
// ---------------------------------------------------------------------------

router.get('/menus', auth.requireStaff('chef', 'manager'), (req, res) => {
  const from = timeUtil.isValidDateString(req.query.from)
    ? req.query.from
    : timeUtil.hotelToday(config.hotelTimeZone);
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);

  const dates = Array.from({ length: days }, (_, i) => timeUtil.addDays(from, i));

  const result = dates.map((date) => ({
    serviceDate: date,
    meals: timeUtil.MEAL_KEYS.map((meal) => {
      const menu = db
        .prepare('SELECT * FROM menus WHERE service_date = ? AND meal = ?')
        .get(date, meal);
      const dishes = menu
        ? db
            .prepare('SELECT * FROM dishes WHERE menu_id = ? ORDER BY sort_order, id')
            .all(menu.id)
        : [];
      const status = timeUtil.mealStatus(date, meal, config.hotelTimeZone);
      return {
        meal,
        published: Boolean(menu?.published),
        orderingOpen: status.open,
        cutoffAt: status.cutoffAt,
        dishes: dishes.map((d) => ({
          id: d.id,
          titleEn: d.title_en,
          titleRu: d.title_ru,
          descriptionEn: d.description_en,
          descriptionRu: d.description_ru,
          allergensEn: d.allergens_en,
          allergensRu: d.allergens_ru,
          priceKopecks: d.price_kopecks,
          priceDisplay: money.formatKopecks(d.price_kopecks),
          available: Boolean(d.available),
        })),
      };
    }),
  }));

  res.json({ from, days, menus: result });
});

/**
 * Replace the dish list for one service date + meal.
 * The chef owns both the menu contents and the prices.
 */
router.put('/menus/:date/:meal', auth.requireStaff('chef', 'manager'), (req, res) => {
  const { date, meal } = req.params;
  const { dishes, published } = req.body ?? {};

  if (!timeUtil.isValidDateString(date)) return res.status(400).json({ error: 'invalid_date' });
  if (!timeUtil.MEAL_KEYS.includes(meal)) return res.status(400).json({ error: 'invalid_meal' });
  if (!Array.isArray(dishes)) return res.status(400).json({ error: 'invalid_dishes' });
  if (dishes.length > 40) return res.status(400).json({ error: 'too_many_dishes' });

  // Parse and validate every price before touching the database, so a single
  // bad row cannot leave the menu half-written.
  const parsed = [];
  for (const [index, dish] of dishes.entries()) {
    const titleEn = String(dish?.titleEn ?? '').trim();
    const titleRu = String(dish?.titleRu ?? '').trim();
    if (!titleEn || !titleRu) {
      return res.status(400).json({ error: 'missing_title', index });
    }

    const priceKopecks = money.parseRoublesToKopecks(dish?.price);
    if (priceKopecks === null) {
      return res.status(400).json({ error: 'invalid_price', index, value: dish?.price });
    }

    parsed.push({
      titleEn: titleEn.slice(0, 120),
      titleRu: titleRu.slice(0, 120),
      descriptionEn: String(dish?.descriptionEn ?? '').slice(0, 400),
      descriptionRu: String(dish?.descriptionRu ?? '').slice(0, 400),
      allergensEn: String(dish?.allergensEn ?? '').slice(0, 200),
      allergensRu: String(dish?.allergensRu ?? '').slice(0, 200),
      priceKopecks,
      available: dish?.available === false ? 0 : 1,
      sortOrder: index,
    });
  }

  const save = db.transaction(() => {
    db.prepare(
      `INSERT INTO menus (service_date, meal, published, updated_at)
            VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(service_date, meal)
       DO UPDATE SET published = excluded.published, updated_at = datetime('now')`
    ).run(date, meal, published ? 1 : 0);

    const menu = db
      .prepare('SELECT id FROM menus WHERE service_date = ? AND meal = ?')
      .get(date, meal);

    // Existing orders keep their own snapshot of title and price in
    // order_items, so replacing the menu never rewrites a past receipt.
    db.prepare('DELETE FROM dishes WHERE menu_id = ?').run(menu.id);

    const insert = db.prepare(
      `INSERT INTO dishes
         (menu_id, title_en, title_ru, description_en, description_ru,
          allergens_en, allergens_ru, price_kopecks, available, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    for (const d of parsed) {
      insert.run(
        menu.id, d.titleEn, d.titleRu, d.descriptionEn, d.descriptionRu,
        d.allergensEn, d.allergensRu, d.priceKopecks, d.available, d.sortOrder
      );
    }
  });

  save();
  audit(req.staff.username, 'menu.update', `${date} ${meal} (${parsed.length} dishes)`);
  res.json({ ok: true, serviceDate: date, meal, dishCount: parsed.length });
});

// ---------------------------------------------------------------------------
// Kitchen order board
// ---------------------------------------------------------------------------

/**
 * Orders for one service window.
 *
 * The kitchen list is deliberately separate from the full list: a cash order
 * is not kitchen work until reception has taken the money.
 */
router.get('/orders', auth.requireStaff(), (req, res) => {
  const date = timeUtil.isValidDateString(req.query.date)
    ? req.query.date
    : timeUtil.hotelToday(config.hotelTimeZone);
  const meal = timeUtil.MEAL_KEYS.includes(req.query.meal) ? req.query.meal : null;

  const rows = meal
    ? db
        .prepare(
          `SELECT * FROM orders WHERE service_date = ? AND meal = ? AND status != 'cancelled'
            ORDER BY room_number`
        )
        .all(date, meal)
    : db
        .prepare(
          `SELECT * FROM orders WHERE service_date = ? AND status != 'cancelled'
            ORDER BY meal, room_number`
        )
        .all(date);

  for (const row of rows) {
    row.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.id);
  }

  const mapped = rows.map((row) => ({
    publicId: row.public_id,
    room: row.room_number,
    guestName: row.guest_name,
    meal: row.meal,
    serviceDate: row.service_date,
    status: row.status,
    paymentMethod: row.payment_method,
    totalKopecks: row.total_kopecks,
    totalDisplay: money.formatKopecks(row.total_kopecks),
    voucherToken: row.voucher_token,
    cardLast4: row.card_last4,
    note: row.note,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    settledBy: row.settled_by,
    // Only paid work reaches the pass.
    inKitchenQueue: row.status === 'paid',
    items: row.items.map((i) => ({
      titleEn: i.title_en,
      titleRu: i.title_ru,
      qty: i.qty,
      lineTotalDisplay: money.formatKopecks(i.line_total_kopecks),
    })),
  }));

  const summary = {
    total: mapped.length,
    paid: mapped.filter((o) => o.status === 'paid').length,
    awaitingCash: mapped.filter((o) => o.status === 'awaiting_cash').length,
    revenuePaidKopecks: mapped
      .filter((o) => o.status === 'paid')
      .reduce((sum, o) => sum + o.totalKopecks, 0),
    revenuePendingKopecks: mapped
      .filter((o) => o.status === 'awaiting_cash')
      .reduce((sum, o) => sum + o.totalKopecks, 0),
  };
  summary.revenuePaidDisplay = money.formatKopecks(summary.revenuePaidKopecks);
  summary.revenuePendingDisplay = money.formatKopecks(summary.revenuePendingKopecks);

  const windows = timeUtil.MEAL_KEYS.map((m) => ({
    ...timeUtil.mealStatus(date, m, config.hotelTimeZone),
    serviceFinished: timeUtil.serviceHasFinished(date, m, config.hotelTimeZone),
  }));

  res.json({ serviceDate: date, orders: mapped, summary, windows });
});

/**
 * Reception records a cash payment. This is the gate that releases the order
 * to the kitchen, so it is restricted and audited.
 */
router.post('/orders/:publicId/settle-cash', auth.requireStaff('reception', 'manager'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE public_id = ?').get(req.params.publicId);
  if (!order) return res.status(404).json({ error: 'not_found' });
  if (order.payment_method !== 'cash') return res.status(409).json({ error: 'not_a_cash_order' });
  if (order.status === 'paid') return res.status(409).json({ error: 'already_settled' });
  if (order.status === 'cancelled') return res.status(409).json({ error: 'order_cancelled' });

  db.prepare(
    `UPDATE orders SET status = 'paid', paid_at = ?, settled_by = ? WHERE id = ?`
  ).run(new Date().toISOString(), req.staff.username, order.id);

  audit(
    req.staff.username,
    'order.cash_settled',
    `${order.public_id} room ${order.room_number} ${money.formatKopecks(order.total_kopecks)}`
  );

  res.json({ ok: true, publicId: order.public_id, status: 'paid' });
});

router.post('/orders/:publicId/cancel', auth.requireStaff('reception', 'manager'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE public_id = ?').get(req.params.publicId);
  if (!order) return res.status(404).json({ error: 'not_found' });
  if (order.status === 'cancelled') return res.status(409).json({ error: 'already_cancelled' });

  db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`).run(order.id);
  audit(req.staff.username, 'order.cancelled', `${order.public_id} (was ${order.status})`);
  res.json({ ok: true, publicId: order.public_id, status: 'cancelled' });
});

// ---------------------------------------------------------------------------
// Excel export
// ---------------------------------------------------------------------------

router.get('/reports/orders.xlsx', auth.requireStaff(), async (req, res, next) => {
  try {
    const date = timeUtil.isValidDateString(req.query.date)
      ? req.query.date
      : timeUtil.hotelToday(config.hotelTimeZone);
    const meal = req.query.meal;

    if (!timeUtil.MEAL_KEYS.includes(meal)) {
      return res.status(400).json({ error: 'invalid_meal' });
    }

    const rows = db
      .prepare(
        `SELECT * FROM orders
          WHERE service_date = ? AND meal = ? AND status != 'cancelled'
          ORDER BY room_number`
      )
      .all(date, meal);

    for (const row of rows) {
      row.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.id);
    }

    const buffer = await buildOrderSummary({ serviceDate: date, meal, orders: rows });

    audit(req.staff.username, 'report.exported', `${date} ${meal} (${rows.length} orders)`);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="orders-${date}-${meal}.xlsx"`
    );
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

/** Staff can re-issue a guest's receipt, e.g. when reception is asked for a copy. */
router.get('/orders/:publicId/receipt.pdf', auth.requireStaff(), (req, res) => {
  const order = loadOrder(req.params.publicId);
  if (!order) return res.status(404).json({ error: 'not_found' });
  const { buildReceipt } = require('../services/receipt-pdf');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${order.public_id}.pdf"`);
  buildReceipt(order).pipe(res);
});

module.exports = router;
