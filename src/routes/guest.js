'use strict';

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const { config } = require('../config');
const { db } = require('../db');
const auth = require('../auth');
const timeUtil = require('../time');
const money = require('../money');
const i18n = require('../i18n');
const gateway = require('../services/payment-gateway');
const { buildReceipt } = require('../services/receipt-pdf');

const router = express.Router();

/** Login is the one unauthenticated write endpoint, so it is rate limited. */
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: config.rateLimits.guestLogin,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts' },
});

const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: config.rateLimits.orders });

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

router.post('/guest/login', loginLimiter, (req, res) => {
  const { fullName, roomNumber, phone, checkIn, checkOut } = req.body ?? {};

  if (!fullName || !roomNumber || !phone || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const result = auth.findMatchingStay({ fullName, roomNumber, phone, checkIn, checkOut });

  if (!result.ok) {
    // One generic failure for every cause, so the form cannot be used to
    // discover which rooms are occupied or which names are registered.
    return res.status(401).json({ error: 'verification_failed' });
  }

  const { stay } = result;
  const token = auth.issueGuestToken(stay);
  auth.setGuestCookie(res, token, auth.guestSessionExpiry(stay.check_out));

  res.json({ guest: publicStay(stay) });
});

router.post('/guest/logout', (req, res) => {
  auth.clearGuestCookie(res);
  res.json({ ok: true });
});

/**
 * Demo convenience: hand the login form a seeded guest's details.
 *
 * This deliberately leaks one guest's data and therefore exists ONLY in demo
 * mode. A real deployment runs with DEMO_MODE=off and this returns 404.
 */
router.get('/demo-guest', (req, res) => {
  if (!config.isDemo) return res.status(404).json({ error: 'not_found' });

  const today = timeUtil.hotelToday(config.hotelTimeZone);
  const stay = db
    .prepare(
      `SELECT * FROM stays
        WHERE cancelled = 0 AND check_in <= ? AND check_out >= ?
        ORDER BY id LIMIT 1`
    )
    .get(today, today);

  if (!stay) return res.status(404).json({ error: 'no_active_stay' });

  res.json({
    fullName: stay.full_name,
    roomNumber: stay.room_number,
    phone: stay.phone,
    checkIn: stay.check_in,
    checkOut: stay.check_out,
  });
});

router.get('/guest/session', auth.requireGuest, (req, res) => {
  res.json({ guest: publicStay(req.stay) });
});

function publicStay(stay) {
  return {
    name: stay.full_name,
    room: stay.room_number,
    checkIn: stay.check_in,
    checkOut: stay.check_out,
    hotel: config.hotel.name,
    timeZone: config.hotelTimeZone,
    today: timeUtil.hotelToday(config.hotelTimeZone),
  };
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

/**
 * The menu for one service date, with an ordering status per meal.
 *
 * `open` is computed here, server-side, from the hotel clock. The browser
 * renders that verdict but never decides it — a guest with a wrong device
 * clock still gets the kitchen's real deadline.
 */
router.get('/menu', auth.requireGuest, (req, res) => {
  const date = req.query.date || timeUtil.hotelToday(config.hotelTimeZone);
  if (!timeUtil.isValidDateString(date)) {
    return res.status(400).json({ error: 'invalid_date' });
  }

  const stay = req.stay;
  const withinStay =
    timeUtil.diffDays(stay.check_in, date) >= 0 && timeUtil.diffDays(date, stay.check_out) >= 0;

  const meals = timeUtil.MEAL_KEYS.map((mealKey) => {
    const status = timeUtil.mealStatus(date, mealKey, config.hotelTimeZone);
    const menu = db
      .prepare('SELECT * FROM menus WHERE service_date = ? AND meal = ? AND published = 1')
      .get(date, mealKey);

    const dishes = menu
      ? db
          .prepare(
            `SELECT id, title_en, title_ru, description_en, description_ru,
                    allergens_en, allergens_ru, price_kopecks, available
               FROM dishes WHERE menu_id = ? ORDER BY sort_order, id`
          )
          .all(menu.id)
      : [];

    const existing = db
      .prepare(
        `SELECT public_id, status, payment_method, total_kopecks
           FROM orders
          WHERE stay_id = ? AND service_date = ? AND meal = ? AND status != 'cancelled'`
      )
      .all(stay.id, date, mealKey);

    return {
      ...status,
      published: Boolean(menu),
      withinStay,
      // Ordering needs a published menu, an open deadline, and a date inside
      // the guest's own stay. All three are enforced again at order time.
      canOrder: status.open && Boolean(menu) && withinStay && dishes.some((d) => d.available),
      dishes,
      existingOrders: existing,
    };
  });

  res.json({
    serviceDate: date,
    today: timeUtil.hotelToday(config.hotelTimeZone),
    timeZone: config.hotelTimeZone,
    serverTime: new Date().toISOString(),
    stay: { checkIn: stay.check_in, checkOut: stay.check_out },
    vatPercent: config.vatPercent,
    meals,
  });
});

router.get('/payment/test-cards', auth.requireGuest, (req, res) => {
  res.json({ simulated: config.paymentsAreSimulated, cards: gateway.listTestCards() });
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function publicOrderId() {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `AG-${stamp}${rand}`;
}

/** Load an order plus its line items, scoped to one stay unless staff. */
function loadOrder(publicId, stayId = null) {
  const order = stayId
    ? db.prepare('SELECT * FROM orders WHERE public_id = ? AND stay_id = ?').get(publicId, stayId)
    : db.prepare('SELECT * FROM orders WHERE public_id = ?').get(publicId);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(order.id);
  return order;
}

router.post('/orders', auth.requireGuest, orderLimiter, (req, res) => {
  const stay = req.stay;
  const { serviceDate, meal, items, paymentMethod, testCardId, note } = req.body ?? {};
  const lang = i18n.normaliseLang(req.body?.lang);

  // ---- shape validation ------------------------------------------------
  if (!timeUtil.isValidDateString(serviceDate)) {
    return res.status(400).json({ error: 'invalid_date' });
  }
  if (!timeUtil.MEAL_KEYS.includes(meal)) {
    return res.status(400).json({ error: 'invalid_meal' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'empty_order' });
  }
  if (!['card', 'cash'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'invalid_payment_method' });
  }

  // ---- the deadline, re-checked at the moment of submission -------------
  // The button may have been enabled when the page loaded; what matters is
  // whether the window is still open now.
  const status = timeUtil.mealStatus(serviceDate, meal, config.hotelTimeZone);
  if (!status.open) {
    return res.status(409).json({ error: 'ordering_closed', meal, cutoffAt: status.cutoffAt });
  }

  // ---- the date must fall inside this guest's own stay -------------------
  if (
    timeUtil.diffDays(stay.check_in, serviceDate) < 0 ||
    timeUtil.diffDays(serviceDate, stay.check_out) < 0
  ) {
    return res.status(403).json({ error: 'outside_stay' });
  }

  const menu = db
    .prepare('SELECT * FROM menus WHERE service_date = ? AND meal = ? AND published = 1')
    .get(serviceDate, meal);
  if (!menu) return res.status(409).json({ error: 'menu_unavailable' });

  const duplicate = db
    .prepare(
      `SELECT public_id FROM orders
        WHERE stay_id = ? AND service_date = ? AND meal = ? AND status != 'cancelled'`
    )
    .get(stay.id, serviceDate, meal);
  if (duplicate) {
    return res.status(409).json({ error: 'already_ordered', publicId: duplicate.public_id });
  }

  // ---- price the order from the database, never from the request --------
  const lines = [];
  for (const raw of items) {
    const qty = Number(raw?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      return res.status(400).json({ error: 'invalid_quantity' });
    }
    const dish = db
      .prepare('SELECT * FROM dishes WHERE id = ? AND menu_id = ?')
      .get(Number(raw?.dishId), menu.id);
    if (!dish) return res.status(400).json({ error: 'unknown_dish' });
    if (!dish.available) {
      return res.status(409).json({ error: 'dish_unavailable', dish: dish.title_en });
    }

    lines.push({
      dishId: dish.id,
      titleEn: dish.title_en,
      titleRu: dish.title_ru,
      unitPriceKopecks: dish.price_kopecks,
      qty,
      lineTotalKopecks: dish.price_kopecks * qty,
    });
  }

  const totals = money.totalsFor(lines, config.vatPercent);

  // ---- payment ---------------------------------------------------------
  let orderStatus = 'awaiting_cash';
  let cardLast4 = null;
  let authCode = null;
  let voucherToken = null;
  let paidAt = null;

  if (paymentMethod === 'card') {
    const result = gateway.authorise({ testCardId, amountKopecks: totals.totalKopecks });
    if (!result.approved) {
      return res.status(402).json({ error: 'payment_declined', reason: result.declineReason });
    }
    orderStatus = 'paid';
    cardLast4 = result.last4;
    authCode = result.authCode;
    paidAt = new Date().toISOString();
  } else {
    voucherToken = gateway.createVoucherToken();
  }

  // ---- persist atomically ---------------------------------------------
  const publicId = publicOrderId();
  const createdAt = new Date().toISOString();

  const write = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO orders (
           public_id, stay_id, room_number, guest_name, service_date, meal,
           status, payment_method, subtotal_kopecks, vat_kopecks, total_kopecks,
           vat_percent, lang, card_last4, auth_code, voucher_token, note,
           created_at, paid_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        publicId, stay.id, stay.room_number, stay.full_name, serviceDate, meal,
        orderStatus, paymentMethod, totals.subtotalKopecks, totals.vatKopecks,
        totals.totalKopecks, config.vatPercent, lang, cardLast4, authCode,
        voucherToken, String(note ?? '').slice(0, 300), createdAt, paidAt
      );

    const insertItem = db.prepare(
      `INSERT INTO order_items
         (order_id, dish_id, title_en, title_ru, unit_price_kopecks, qty, line_total_kopecks)
       VALUES (?,?,?,?,?,?,?)`
    );
    for (const line of lines) {
      insertItem.run(
        info.lastInsertRowid, line.dishId, line.titleEn, line.titleRu,
        line.unitPriceKopecks, line.qty, line.lineTotalKopecks
      );
    }
    return info.lastInsertRowid;
  });

  write();

  res.status(201).json({
    order: serialiseOrder(loadOrder(publicId, stay.id)),
    receiptUrl: `/api/orders/${publicId}/receipt.pdf`,
  });
});

router.get('/orders', auth.requireGuest, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM orders WHERE stay_id = ? ORDER BY created_at DESC')
    .all(req.stay.id);
  for (const row of rows) {
    row.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.id);
  }
  res.json({ orders: rows.map(serialiseOrder) });
});

router.get('/orders/:publicId/receipt.pdf', auth.requireGuest, (req, res) => {
  const order = loadOrder(req.params.publicId, req.stay.id);
  if (!order) return res.status(404).json({ error: 'not_found' });

  const filename = `${order.status === 'paid' ? 'receipt' : 'voucher'}-${order.public_id}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  buildReceipt(order).pipe(res);
});

/** Shape sent to the browser: kopecks plus a preformatted display string. */
function serialiseOrder(order) {
  if (!order) return null;
  return {
    publicId: order.public_id,
    room: order.room_number,
    guestName: order.guest_name,
    serviceDate: order.service_date,
    meal: order.meal,
    status: order.status,
    paymentMethod: order.payment_method,
    subtotalKopecks: order.subtotal_kopecks,
    vatKopecks: order.vat_kopecks,
    totalKopecks: order.total_kopecks,
    vatPercent: order.vat_percent,
    totalDisplay: money.formatKopecks(order.total_kopecks),
    cardLast4: order.card_last4,
    authCode: order.auth_code,
    voucherToken: order.voucher_token,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    items: (order.items ?? []).map((i) => ({
      titleEn: i.title_en,
      titleRu: i.title_ru,
      qty: i.qty,
      unitPriceKopecks: i.unit_price_kopecks,
      lineTotalKopecks: i.line_total_kopecks,
      lineTotalDisplay: money.formatKopecks(i.line_total_kopecks),
    })),
  };
}

module.exports = { router, loadOrder, serialiseOrder };
