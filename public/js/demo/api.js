/* Browser demo API.
   Patches window.fetch so the unmodified guest and staff apps run with no
   server. It implements the same contract and the same checks — deadlines,
   stay bounds, duplicate orders, server-side pricing, role gates — because
   the demo is worth nothing if it behaves differently from the real thing. */
(function () {
  'use strict';

  const T = window.DiningTime;
  const M = window.DiningMoney;
  const S = window.DemoStore;
  const TZ = S.TZ;

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const ok = (body) => json(body, 200);
  const fail = (error, status, extra = {}) => json({ error, ...extra }, status);

  // ---- helpers -----------------------------------------------------------

  const normName = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normRoom = (v) => String(v ?? '').trim().toUpperCase();
  function normPhone(v) {
    const digits = String(v ?? '').replace(/\D/g, '');
    if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) return '7' + digits.slice(1);
    return digits;
  }

  const state = () => S.get();
  const guest = () => {
    const sid = state().session;
    return sid ? state().stays.find((s) => s.id === sid && !s.cancelled) : null;
  };
  const staff = () => state().staffSession;

  function publicStay(stay) {
    return {
      name: stay.full_name,
      room: stay.room_number,
      checkIn: stay.check_in,
      checkOut: stay.check_out,
      hotel: 'Aurora Grand Hotel',
      timeZone: TZ,
      today: T.hotelToday(TZ),
    };
  }

  function orderWithItems(order) {
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
      totalDisplay: M.formatKopecks(order.total_kopecks),
      cardLast4: order.card_last4,
      authCode: order.auth_code,
      voucherToken: order.voucher_token,
      createdAt: order.created_at,
      paidAt: order.paid_at,
      note: order.note,
      items: order.items.map((i) => ({
        titleEn: i.title_en,
        titleRu: i.title_ru,
        qty: i.qty,
        unitPriceKopecks: i.unit_price_kopecks,
        lineTotalKopecks: i.line_total_kopecks,
        lineTotalDisplay: M.formatKopecks(i.line_total_kopecks),
      })),
    };
  }

  const TEST_CARDS = {
    approved: { last4: '4242', approved: true, en: 'Approved', ru: 'Успешно' },
    challenge: { last4: '3155', approved: true, en: 'Approved after 3-D Secure', ru: 'Успешно после 3-D Secure' },
    declined: { last4: '0002', approved: false, en: 'Declined', ru: 'Отклонено' },
    insufficient: { last4: '9995', approved: false, en: 'Insufficient funds', ru: 'Недостаточно средств' },
  };

  // ---- route table -------------------------------------------------------

  const routes = [
    // ------------------------------------------------ guest session
    ['POST', /^\/api\/guest\/login$/, (m, body) => {
      const { fullName, roomNumber, phone, checkIn, checkOut } = body ?? {};
      if (!fullName || !roomNumber || !phone || !checkIn || !checkOut) {
        return fail('missing_fields', 400);
      }
      if (!T.isValidDateString(checkIn) || !T.isValidDateString(checkOut)) {
        return fail('verification_failed', 401);
      }

      const today = T.hotelToday(TZ);
      const stay = state().stays.find(
        (s) =>
          !s.cancelled &&
          s.room_number === normRoom(roomNumber) &&
          s.check_in === checkIn &&
          s.check_out === checkOut &&
          normName(s.full_name) === normName(fullName) &&
          s.phone_digits === normPhone(phone)
      );

      // One generic failure for every cause, exactly as the server does.
      if (!stay) return fail('verification_failed', 401);
      if (T.diffDays(today, stay.check_in) > 0) return fail('verification_failed', 401);
      if (T.diffDays(stay.check_out, today) > 0) return fail('verification_failed', 401);

      state().session = stay.id;
      S.save();
      return ok({ guest: publicStay(stay) });
    }],

    ['POST', /^\/api\/guest\/logout$/, () => {
      state().session = null;
      S.save();
      return ok({ ok: true });
    }],

    ['GET', /^\/api\/guest\/session$/, () => {
      const stay = guest();
      return stay ? ok({ guest: publicStay(stay) }) : fail('session_expired', 401);
    }],

    ['GET', /^\/api\/demo-guest$/, () => {
      const today = T.hotelToday(TZ);
      const stay = state().stays.find(
        (s) => !s.cancelled && T.diffDays(today, s.check_in) <= 0 && T.diffDays(s.check_out, today) <= 0
      );
      if (!stay) return fail('no_active_stay', 404);
      return ok({
        fullName: stay.full_name,
        roomNumber: stay.room_number,
        phone: stay.phone,
        checkIn: stay.check_in,
        checkOut: stay.check_out,
      });
    }],

    // ------------------------------------------------ menu
    ['GET', /^\/api\/menu$/, (m, body, url) => {
      const stay = guest();
      if (!stay) return fail('session_expired', 401);

      const date = url.searchParams.get('date') || T.hotelToday(TZ);
      if (!T.isValidDateString(date)) return fail('invalid_date', 400);

      const withinStay =
        T.diffDays(stay.check_in, date) >= 0 && T.diffDays(date, stay.check_out) >= 0;

      const meals = T.MEAL_KEYS.map((meal) => {
        const status = T.mealStatus(date, meal, TZ);
        const menu = S.menuFor(date, meal);
        const dishes = menu ? S.dishesFor(menu.id) : [];
        const existing = state()
          .orders.filter(
            (o) => o.stay_id === stay.id && o.service_date === date &&
                   o.meal === meal && o.status !== 'cancelled'
          )
          .map((o) => ({
            public_id: o.public_id, status: o.status,
            payment_method: o.payment_method, total_kopecks: o.total_kopecks,
          }));

        return {
          ...status,
          published: Boolean(menu),
          withinStay,
          canOrder: status.open && Boolean(menu) && withinStay && dishes.some((d) => d.available),
          dishes,
          existingOrders: existing,
        };
      });

      return ok({
        serviceDate: date,
        today: T.hotelToday(TZ),
        timeZone: TZ,
        serverTime: new Date().toISOString(),
        stay: { checkIn: stay.check_in, checkOut: stay.check_out },
        vatPercent: S.VAT,
        meals,
      });
    }],

    ['GET', /^\/api\/payment\/test-cards$/, () => {
      if (!guest()) return fail('session_expired', 401);
      return ok({
        simulated: true,
        cards: Object.entries(TEST_CARDS).map(([id, c]) => ({
          id, last4: c.last4, requires3ds: id === 'challenge',
          label_en: c.en, label_ru: c.ru,
        })),
      });
    }],

    // ------------------------------------------------ orders
    ['POST', /^\/api\/orders$/, (m, body) => {
      const stay = guest();
      if (!stay) return fail('session_expired', 401);

      const { serviceDate, meal, items, paymentMethod, testCardId, note, lang } = body ?? {};

      if (!T.isValidDateString(serviceDate)) return fail('invalid_date', 400);
      if (!T.MEAL_KEYS.includes(meal)) return fail('invalid_meal', 400);
      if (!Array.isArray(items) || items.length === 0) return fail('empty_order', 400);
      if (!['card', 'cash'].includes(paymentMethod)) return fail('invalid_payment_method', 400);

      // The deadline is re-checked here, not trusted from whenever the page loaded.
      const status = T.mealStatus(serviceDate, meal, TZ);
      if (!status.open) return fail('ordering_closed', 409, { meal, cutoffAt: status.cutoffAt });

      if (T.diffDays(stay.check_in, serviceDate) < 0 || T.diffDays(serviceDate, stay.check_out) < 0) {
        return fail('outside_stay', 403);
      }

      const menu = S.menuFor(serviceDate, meal);
      if (!menu) return fail('menu_unavailable', 409);

      const duplicate = state().orders.find(
        (o) => o.stay_id === stay.id && o.service_date === serviceDate &&
               o.meal === meal && o.status !== 'cancelled'
      );
      if (duplicate) return fail('already_ordered', 409, { publicId: duplicate.public_id });

      // Priced from the store, never from the request body.
      const menuDishes = S.dishesFor(menu.id);
      const lines = [];
      for (const raw of items) {
        const qty = Number(raw?.qty);
        if (!Number.isInteger(qty) || qty < 1 || qty > 20) return fail('invalid_quantity', 400);
        const dish = menuDishes.find((d) => d.id === Number(raw?.dishId));
        if (!dish) return fail('unknown_dish', 400);
        if (!dish.available) return fail('dish_unavailable', 409, { dish: dish.title_en });
        lines.push({
          dish_id: dish.id,
          title_en: dish.title_en,
          title_ru: dish.title_ru,
          unit_price_kopecks: dish.price_kopecks,
          qty,
          line_total_kopecks: dish.price_kopecks * qty,
        });
      }

      const totals = M.totalsFor(
        lines.map((l) => ({ lineTotalKopecks: l.line_total_kopecks })),
        S.VAT
      );

      let orderStatus = 'awaiting_cash';
      let cardLast4 = null;
      let authCode = null;
      let voucherToken = null;
      let paidAt = null;

      if (paymentMethod === 'card') {
        const card = TEST_CARDS[testCardId];
        if (!card) return fail('payment_declined', 402, { reason: 'invalid_card' });
        if (!card.approved) return fail('payment_declined', 402, { reason: testCardId });
        orderStatus = 'paid';
        cardLast4 = card.last4;
        authCode = randomHex(3).toUpperCase();
        paidAt = new Date().toISOString();
      } else {
        voucherToken = randomToken(12);
      }

      const id = state().nextOrderId++;
      const publicId = `AG-${Date.now().toString(36).toUpperCase().slice(-5)}${randomHex(2).toUpperCase()}`;

      const order = {
        id, public_id: publicId, stay_id: stay.id,
        room_number: stay.room_number, guest_name: stay.full_name,
        service_date: serviceDate, meal,
        status: orderStatus, payment_method: paymentMethod,
        subtotal_kopecks: totals.subtotalKopecks,
        vat_kopecks: totals.vatKopecks,
        total_kopecks: totals.totalKopecks,
        vat_percent: S.VAT,
        lang: lang === 'ru' ? 'ru' : 'en',
        card_last4: cardLast4, auth_code: authCode, voucher_token: voucherToken,
        note: String(note ?? '').slice(0, 300),
        created_at: new Date().toISOString(), paid_at: paidAt, settled_by: null,
        items: lines,
      };

      state().orders.push(order);
      S.save();

      return json(
        { order: orderWithItems(order), receiptUrl: `/api/orders/${publicId}/receipt.pdf` },
        201
      );
    }],

    ['GET', /^\/api\/orders$/, () => {
      const stay = guest();
      if (!stay) return fail('session_expired', 401);
      const mine = state()
        .orders.filter((o) => o.stay_id === stay.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return ok({ orders: mine.map(orderWithItems) });
    }],

    // ------------------------------------------------ staff
    ['POST', /^\/api\/staff\/login$/, (m, body) => {
      const { username, password } = body ?? {};
      const user = S.STAFF.find((s) => s.username === String(username ?? '').trim());
      if (!user || user.password !== String(password)) return fail('invalid_credentials', 401);
      state().staffSession = { username: user.username, name: user.name, role: user.role };
      S.save();
      return ok({ staff: state().staffSession });
    }],

    ['POST', /^\/api\/staff\/logout$/, () => {
      state().staffSession = null;
      S.save();
      return ok({ ok: true });
    }],

    ['GET', /^\/api\/staff\/session$/, () => {
      const s = staff();
      if (!s) return fail('not_authenticated', 401);
      return ok({
        staff: s, hotel: 'Aurora Grand Hotel', timeZone: TZ,
        today: T.hotelToday(TZ), vatPercent: S.VAT,
      });
    }],

    ['GET', /^\/api\/staff\/menus$/, (m, body, url) => {
      const s = staff();
      if (!s) return fail('not_authenticated', 401);
      if (!['chef', 'manager'].includes(s.role)) return fail('forbidden', 403);

      const from = T.isValidDateString(url.searchParams.get('from'))
        ? url.searchParams.get('from') : T.hotelToday(TZ);
      const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 7, 1), 30);

      const menus = Array.from({ length: days }, (_, i) => T.addDays(from, i)).map((date) => ({
        serviceDate: date,
        meals: T.MEAL_KEYS.map((meal) => {
          const menu = state().menus.find((x) => x.service_date === date && x.meal === meal);
          const dishes = menu ? S.dishesFor(menu.id) : [];
          const status = T.mealStatus(date, meal, TZ);
          return {
            meal,
            published: Boolean(menu?.published),
            orderingOpen: status.open,
            cutoffAt: status.cutoffAt,
            dishes: dishes.map((d) => ({
              id: d.id,
              titleEn: d.title_en, titleRu: d.title_ru,
              descriptionEn: d.description_en, descriptionRu: d.description_ru,
              allergensEn: d.allergens_en, allergensRu: d.allergens_ru,
              priceKopecks: d.price_kopecks,
              priceDisplay: M.formatKopecks(d.price_kopecks),
              available: Boolean(d.available),
            })),
          };
        }),
      }));

      return ok({ from, days, menus });
    }],

    ['PUT', /^\/api\/staff\/menus\/(\d{4}-\d{2}-\d{2})\/(\w+)$/, (m, body) => {
      const s = staff();
      if (!s) return fail('not_authenticated', 401);
      if (!['chef', 'manager'].includes(s.role)) return fail('forbidden', 403);

      const [, date, meal] = m;
      if (!T.isValidDateString(date)) return fail('invalid_date', 400);
      if (!T.MEAL_KEYS.includes(meal)) return fail('invalid_meal', 400);
      const dishes = body?.dishes;
      if (!Array.isArray(dishes)) return fail('invalid_dishes', 400);
      if (dishes.length > 40) return fail('too_many_dishes', 400);

      // Validate everything before writing, so a bad row cannot half-save.
      const parsed = [];
      for (let i = 0; i < dishes.length; i++) {
        const d = dishes[i];
        const titleEn = String(d?.titleEn ?? '').trim();
        const titleRu = String(d?.titleRu ?? '').trim();
        if (!titleEn || !titleRu) return fail('missing_title', 400, { index: i });
        const price = M.parseRoublesToKopecks(d?.price);
        if (price === null) return fail('invalid_price', 400, { index: i, value: d?.price });
        parsed.push({
          title_en: titleEn.slice(0, 120), title_ru: titleRu.slice(0, 120),
          description_en: String(d?.descriptionEn ?? '').slice(0, 400),
          description_ru: String(d?.descriptionRu ?? '').slice(0, 400),
          allergens_en: String(d?.allergensEn ?? '').slice(0, 200),
          allergens_ru: String(d?.allergensRu ?? '').slice(0, 200),
          price_kopecks: price,
          available: d?.available === false ? 0 : 1,
          sort_order: i,
        });
      }

      const st = state();
      let menu = st.menus.find((x) => x.service_date === date && x.meal === meal);
      if (!menu) {
        menu = { id: Math.max(0, ...st.menus.map((x) => x.id)) + 1, service_date: date, meal, published: 0 };
        st.menus.push(menu);
      }
      menu.published = body?.published ? 1 : 0;

      // Existing orders keep their own item snapshots, so this cannot rewrite history.
      st.dishes = st.dishes.filter((d) => d.menu_id !== menu.id);
      let nextId = Math.max(0, ...st.dishes.map((d) => d.id)) + 1;
      for (const p of parsed) st.dishes.push({ id: nextId++, menu_id: menu.id, ...p });

      S.save();
      return ok({ ok: true, serviceDate: date, meal, dishCount: parsed.length });
    }],

    ['GET', /^\/api\/staff\/orders$/, (m, body, url) => {
      const s = staff();
      if (!s) return fail('not_authenticated', 401);

      const date = T.isValidDateString(url.searchParams.get('date'))
        ? url.searchParams.get('date') : T.hotelToday(TZ);
      const mealFilter = url.searchParams.get('meal');

      const rows = state()
        .orders.filter(
          (o) => o.service_date === date && o.status !== 'cancelled' &&
                 (!T.MEAL_KEYS.includes(mealFilter) || o.meal === mealFilter)
        )
        .sort((a, b) => a.room_number.localeCompare(b.room_number));

      const orders = rows.map((o) => ({
        publicId: o.public_id, room: o.room_number, guestName: o.guest_name,
        meal: o.meal, serviceDate: o.service_date, status: o.status,
        paymentMethod: o.payment_method, totalKopecks: o.total_kopecks,
        totalDisplay: M.formatKopecks(o.total_kopecks),
        voucherToken: o.voucher_token, cardLast4: o.card_last4,
        note: o.note, createdAt: o.created_at, paidAt: o.paid_at,
        settledBy: o.settled_by,
        inKitchenQueue: o.status === 'paid',
        items: o.items.map((i) => ({
          titleEn: i.title_en, titleRu: i.title_ru, qty: i.qty,
          lineTotalDisplay: M.formatKopecks(i.line_total_kopecks),
        })),
      }));

      const paidSum = orders.filter((o) => o.status === 'paid')
        .reduce((n, o) => n + o.totalKopecks, 0);
      const pendingSum = orders.filter((o) => o.status === 'awaiting_cash')
        .reduce((n, o) => n + o.totalKopecks, 0);

      return ok({
        serviceDate: date,
        orders,
        summary: {
          total: orders.length,
          paid: orders.filter((o) => o.status === 'paid').length,
          awaitingCash: orders.filter((o) => o.status === 'awaiting_cash').length,
          revenuePaidKopecks: paidSum,
          revenuePendingKopecks: pendingSum,
          revenuePaidDisplay: M.formatKopecks(paidSum),
          revenuePendingDisplay: M.formatKopecks(pendingSum),
        },
        windows: T.MEAL_KEYS.map((meal) => ({
          ...T.mealStatus(date, meal, TZ),
          serviceFinished: T.serviceHasFinished(date, meal, TZ),
        })),
      });
    }],

    ['POST', /^\/api\/staff\/orders\/([\w-]+)\/settle-cash$/, (m) => {
      const s = staff();
      if (!s) return fail('not_authenticated', 401);
      if (!['reception', 'manager'].includes(s.role)) return fail('forbidden', 403);

      const order = state().orders.find((o) => o.public_id === m[1]);
      if (!order) return fail('not_found', 404);
      if (order.payment_method !== 'cash') return fail('not_a_cash_order', 409);
      if (order.status === 'paid') return fail('already_settled', 409);
      if (order.status === 'cancelled') return fail('order_cancelled', 409);

      order.status = 'paid';
      order.paid_at = new Date().toISOString();
      order.settled_by = s.username;
      S.save();
      return ok({ ok: true, publicId: order.public_id, status: 'paid' });
    }],

    ['POST', /^\/api\/staff\/orders\/([\w-]+)\/cancel$/, (m) => {
      const s = staff();
      if (!s) return fail('not_authenticated', 401);
      if (!['reception', 'manager'].includes(s.role)) return fail('forbidden', 403);
      const order = state().orders.find((o) => o.public_id === m[1]);
      if (!order) return fail('not_found', 404);
      if (order.status === 'cancelled') return fail('already_cancelled', 409);
      order.status = 'cancelled';
      S.save();
      return ok({ ok: true, publicId: order.public_id, status: 'cancelled' });
    }],
  ];

  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function randomToken(len) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = new Uint8Array(len);
    crypto.getRandomValues(a);
    return [...a].map((b) => alphabet[b % alphabet.length]).join('');
  }

  // ---- fetch patch -------------------------------------------------------

  const realFetch = window.fetch.bind(window);

  window.fetch = async function (input, init = {}) {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, window.location.href);

    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);

    const method = (init.method ?? 'GET').toUpperCase();
    let body = null;
    if (init.body) {
      try { body = JSON.parse(init.body); } catch { body = null; }
    }

    // A touch of latency so loading states are actually visible.
    await new Promise((r) => setTimeout(r, 90));

    for (const [routeMethod, pattern, handler] of routes) {
      if (routeMethod !== method) continue;
      const match = url.pathname.match(pattern);
      if (match) {
        try {
          return handler(match, body, url);
        } catch (err) {
          console.error('[demo api]', err);
          return fail('server_error', 500);
        }
      }
    }

    return fail('not_found', 404);
  };

  window.DemoApi = { orderByPublicId: (id) => state().orders.find((o) => o.public_id === id) };
})();
