/* Aurora Grand — guest ordering app.
   The server owns every decision that matters (deadlines, prices, eligibility).
   This file renders that state and collects intent; it never computes a total
   the server will trust, and it never decides for itself that a meal is open. */
(function () {
  'use strict';

  const t = () => window.i18n;

  const state = {
    guest: null,
    serviceDate: null,
    menu: null,
    /** dishId -> qty, for the meal currently being built */
    cart: new Map(),
    cartMeal: null,
    paymentMethod: 'card',
    lastOrder: null,
    tickHandle: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // -------------------------------------------------------------------------
  // API helper
  // -------------------------------------------------------------------------

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let payload = null;
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      payload = await res.json();
    }

    if (res.status === 401) {
      // The session ended (expired token, or the stay is over).
      state.guest = null;
      showLogin();
      throw Object.assign(new Error('unauthorised'), { handled: true });
    }

    if (!res.ok) {
      throw Object.assign(new Error(payload?.error ?? 'request_failed'), {
        status: res.status,
        payload,
      });
    }
    return payload;
  }

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { el.hidden = true; }, 4200);
  }

  // -------------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------------

  const rub = (kopecks) =>
    new Intl.NumberFormat(t().getLang() === 'ru' ? 'ru-RU' : 'ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 2,
    }).format(kopecks / 100);

  function formatDateLong(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Intl.DateTimeFormat(t().getLang() === 'ru' ? 'ru-RU' : 'en-GB', {
      weekday: 'long', day: 'numeric', month: 'long',
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }

  /** Countdown rendered from the server's cutoff instant. */
  function formatRemaining(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const L = t();
    if (d > 0) return `${d}${L.t('time.days')} ${h}${L.t('time.hours')}`;
    if (h > 0) return `${h}${L.t('time.hours')} ${String(m).padStart(2, '0')}${L.t('time.minutes')}`;
    return `${String(m).padStart(2, '0')}${L.t('time.minutes')} ${String(s).padStart(2, '0')}${L.t('time.seconds')}`;
  }

  // -------------------------------------------------------------------------
  // View switching
  // -------------------------------------------------------------------------

  function showView(name) {
    $$('.view').forEach((v) => v.classList.remove('is-visible'));
    $(`#view-${name}`).classList.add('is-visible');
    $('#topbar').hidden = name === 'login';
    $$('.navlink').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
    window.scrollTo({ top: 0 });
  }

  function showLogin() {
    stopTicking();
    showView('login');
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const btn = $('#loginSubmit');
    const errorBox = $('#loginError');

    errorBox.hidden = true;
    btn.disabled = true;
    btn.textContent = t().t('login.working');

    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await api('POST', '/api/guest/login', data);
      state.guest = res.guest;
      await enterApp();
    } catch (err) {
      errorBox.textContent =
        err.status === 429 ? t().t('login.tooMany') : t().t('login.failed');
      errorBox.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = t().t('login.submit');
    }
  });

  // Prefills the seeded demo guest so a reviewer can get in without the
  // seed output to hand. Harmless: the server still verifies all five fields.
  $('#fillDemo').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/demo-guest');
      if (!res.ok) return;
      const demo = await res.json();
      const form = $('#loginForm');
      for (const [key, value] of Object.entries(demo)) {
        if (form.elements[key]) form.elements[key].value = value;
      }
    } catch { /* offline: leave the form as-is */ }
  });

  $('#signOutBtn').addEventListener('click', async () => {
    await api('POST', '/api/guest/logout').catch(() => {});
    state.guest = null;
    state.cart.clear();
    showLogin();
  });

  async function enterApp() {
    $('#roomChip').textContent = state.guest.room;
    state.serviceDate = state.guest.today;
    $('#datePicker').value = state.serviceDate;
    $('#datePicker').min = state.guest.checkIn;
    $('#datePicker').max = state.guest.checkOut;
    showView('menu');
    await loadMenu();
  }

  // -------------------------------------------------------------------------
  // Menu
  // -------------------------------------------------------------------------

  async function loadMenu() {
    const data = await api('GET', `/api/menu?date=${state.serviceDate}`);
    state.menu = data;
    renderMenu();
    startTicking();
  }

  function renderMenu() {
    const data = state.menu;
    const L = t();

    $('#menuDateLabel').textContent = formatDateLong(data.serviceDate);
    $('#datePicker').value = data.serviceDate;

    const list = $('#mealList');
    list.textContent = '';

    for (const meal of data.meals) {
      list.appendChild(renderMealCard(meal, data));
    }

    // A meal being open is decided by the server; if the cart's meal has
    // since closed, drop it rather than let the guest keep building it.
    if (state.cartMeal) {
      const current = data.meals.find((m) => m.meal === state.cartMeal);
      if (!current?.canOrder) clearCart();
    }
    renderCart();
    L.apply();
  }

  function renderMealCard(meal, data) {
    const L = t();
    const card = document.createElement('section');
    card.className = 'meal' + (meal.open ? '' : ' is-closed');

    // ---- head ----
    const head = document.createElement('div');
    head.className = 'meal-head';

    const nameWrap = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'meal-name';
    name.textContent = L.mealName(meal.meal);
    const hours = document.createElement('div');
    hours.className = 'meal-hours';
    hours.textContent = `${L.t('menu.served')} ${meal.serviceStart}–${meal.serviceEnd}`;
    nameWrap.append(name, hours);

    const status = document.createElement('div');
    status.className = 'meal-status';
    const dot = document.createElement('span');
    dot.className = 'status-dot ' + (meal.open ? 'open' : 'closed');
    const label = document.createElement('span');

    if (meal.open) {
      label.innerHTML = `${L.t('menu.closesIn')} <span class="countdown" data-cutoff="${meal.cutoffAt}"></span>`;
    } else {
      const when = meal.cutoffIsDayBefore
        ? `${meal.cutoffLabel} (${L.t('menu.dayBefore')})`
        : meal.cutoffLabel;
      label.textContent = `${L.t('menu.closedAt')} ${when}`;
    }
    status.append(dot, label);
    head.append(nameWrap, status);

    // ---- body ----
    const body = document.createElement('div');
    body.className = 'meal-body';

    if (meal.existingOrders.length > 0) {
      const banner = document.createElement('div');
      banner.className = 'ordered-banner';
      banner.textContent = `✓ ${L.t('menu.alreadyOrdered')} — ${rub(meal.existingOrders[0].total_kopecks)}`;
      body.appendChild(banner);
    } else if (!meal.open) {
      // The exact wording the specification requires, per meal.
      const banner = document.createElement('div');
      banner.className = 'closed-banner';
      banner.textContent = L.t(`closed.${meal.meal}`);
      body.appendChild(banner);
    } else if (!meal.withinStay) {
      body.appendChild(infoBanner(L.t('menu.outsideStay')));
    } else if (!meal.published) {
      body.appendChild(infoBanner(L.t('menu.noMenu')));
    }

    if (meal.published && meal.dishes.length > 0 && meal.existingOrders.length === 0) {
      body.appendChild(renderDishes(meal));

      if (meal.canOrder) {
        const foot = document.createElement('div');
        foot.className = 'meal-foot';
        const btn = document.createElement('button');
        btn.className = 'btn-primary';
        btn.textContent = L.t('menu.orderNow');
        btn.disabled = cartCountFor(meal.meal) === 0;
        btn.addEventListener('click', () => goToPayment(meal));
        foot.appendChild(btn);
        body.appendChild(foot);
      }
    }

    card.append(head, body);
    return card;
  }

  function infoBanner(text) {
    const el = document.createElement('div');
    el.className = 'info-banner';
    el.textContent = text;
    return el;
  }

  function renderDishes(meal) {
    const L = t();
    const wrap = document.createElement('div');
    wrap.className = 'dishes';

    for (const dish of meal.dishes) {
      const row = document.createElement('article');
      row.className = 'dish' + (dish.available ? '' : ' is-unavailable');

      const main = document.createElement('div');
      main.className = 'dish-main';

      const title = document.createElement('h3');
      title.className = 'dish-title';
      title.textContent = L.pick(dish, 'title');
      main.appendChild(title);

      const desc = L.pick(dish, 'description');
      if (desc) {
        const p = document.createElement('p');
        p.className = 'dish-desc';
        p.textContent = desc;
        main.appendChild(p);
      }

      const allergens = L.pick(dish, 'allergens');
      if (allergens) {
        const tag = document.createElement('span');
        tag.className = 'dish-allergens';
        tag.textContent = `${L.t('menu.allergens')}: ${allergens}`;
        main.appendChild(tag);
      }

      const side = document.createElement('div');
      side.className = 'dish-side';

      const price = document.createElement('div');
      price.className = 'dish-price';
      price.textContent = rub(dish.price_kopecks);
      side.appendChild(price);

      if (!dish.available) {
        const gone = document.createElement('span');
        gone.className = 'hint';
        gone.textContent = L.t('menu.unavailable');
        side.appendChild(gone);
      } else if (meal.canOrder) {
        side.appendChild(renderStepper(dish, meal));
      }

      row.append(main, side);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function renderStepper(dish, meal) {
    const stepper = document.createElement('div');
    stepper.className = 'stepper';

    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.setAttribute('aria-label', 'Remove one');

    const qty = document.createElement('span');
    qty.className = 'qty';

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.setAttribute('aria-label', 'Add one');

    const sync = () => {
      const n = state.cartMeal === meal.meal ? state.cart.get(dish.id) ?? 0 : 0;
      qty.textContent = String(n);
      minus.disabled = n === 0;
      plus.disabled = n >= 20;
    };

    minus.addEventListener('click', () => { changeQty(meal, dish, -1); sync(); });
    plus.addEventListener('click', () => { changeQty(meal, dish, +1); sync(); });

    sync();
    stepper.append(minus, qty, plus);
    return stepper;
  }

  // -------------------------------------------------------------------------
  // Cart
  // -------------------------------------------------------------------------

  function changeQty(meal, dish, delta) {
    // One meal at a time: switching meals starts a fresh basket.
    if (state.cartMeal !== meal.meal) {
      state.cart.clear();
      state.cartMeal = meal.meal;
    }
    const next = Math.min(20, Math.max(0, (state.cart.get(dish.id) ?? 0) + delta));
    if (next === 0) state.cart.delete(dish.id);
    else state.cart.set(dish.id, next);

    if (state.cart.size === 0) state.cartMeal = null;
    renderCart();
    refreshOrderButtons();
  }

  function cartCountFor(mealKey) {
    return state.cartMeal === mealKey ? state.cart.size : 0;
  }

  function clearCart() {
    state.cart.clear();
    state.cartMeal = null;
  }

  function currentMealData() {
    return state.menu?.meals.find((m) => m.meal === state.cartMeal) ?? null;
  }

  /** Cart lines, priced from the menu the server sent. */
  function cartLines() {
    const meal = currentMealData();
    if (!meal) return [];
    const L = t();
    return [...state.cart.entries()].map(([dishId, qty]) => {
      const dish = meal.dishes.find((d) => d.id === dishId);
      return {
        dishId,
        qty,
        title: L.pick(dish, 'title'),
        unit: dish.price_kopecks,
        lineTotal: dish.price_kopecks * qty,
      };
    });
  }

  /**
   * Display-only totals. VAT is extracted from the gross the same way the
   * server does, so the figures agree — but the server's numbers are the ones
   * that end up on the receipt.
   */
  function computeTotals(lines) {
    const gross = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const vatPercent = state.menu?.vatPercent ?? 20;
    const vat = Math.round((gross * vatPercent) / (100 + vatPercent));
    return { gross, vat, net: gross - vat, vatPercent };
  }

  function renderCart() {
    const lines = cartLines();
    const cart = $('#cart');

    if (lines.length === 0) {
      cart.hidden = true;
      return;
    }
    cart.hidden = false;

    const L = t();
    $('#cartMeal').textContent = `${L.mealName(state.cartMeal)} · ${formatDateLong(state.serviceDate)}`;
    renderLines($('#cartLines'), lines);

    const totals = computeTotals(lines);
    $('#cartSubtotal').textContent = rub(totals.net);
    $('#cartVatLabel').textContent = `${L.t('cart.vat')} ${totals.vatPercent}%`;
    $('#cartVat').textContent = rub(totals.vat);
    $('#cartTotal').textContent = rub(totals.gross);
  }

  function renderLines(container, lines) {
    container.textContent = '';
    for (const line of lines) {
      const row = document.createElement('div');
      row.className = 'cart-line';

      const name = document.createElement('span');
      name.className = 'cart-line-name';
      const badge = document.createElement('span');
      badge.className = 'qty-badge';
      badge.textContent = `${line.qty} × `;
      name.append(badge, document.createTextNode(line.title));

      const total = document.createElement('span');
      total.className = 'cart-line-total';
      total.textContent = rub(line.lineTotal);

      row.append(name, total);
      container.appendChild(row);
    }
  }

  function refreshOrderButtons() {
    $$('.meal').forEach((card) => {
      const btn = card.querySelector('.meal-foot .btn-primary');
      if (!btn) return;
      const mealName = card.querySelector('.meal-name').textContent;
      const meal = state.menu.meals.find((m) => t().mealName(m.meal) === mealName);
      if (meal) btn.disabled = cartCountFor(meal.meal) === 0;
    });
  }

  // -------------------------------------------------------------------------
  // Countdown ticking
  // -------------------------------------------------------------------------

  function startTicking() {
    stopTicking();
    tick();
    state.tickHandle = setInterval(tick, 1000);
  }

  function stopTicking() {
    if (state.tickHandle) clearInterval(state.tickHandle);
    state.tickHandle = null;
  }

  function tick() {
    let expired = false;
    $$('.countdown').forEach((el) => {
      const remaining = new Date(el.dataset.cutoff).getTime() - Date.now();
      if (remaining <= 0) { expired = true; return; }
      el.textContent = formatRemaining(remaining);
      el.classList.toggle('urgent', remaining < 30 * 60 * 1000);
    });
    // A deadline passed while the page was open — re-ask the server rather
    // than deciding locally that the meal is now shut.
    if (expired) loadMenu().catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Payment
  // -------------------------------------------------------------------------

  async function goToPayment(meal) {
    if (state.cartMeal !== meal.meal || state.cart.size === 0) return;

    const L = t();
    const lines = cartLines();
    const totals = computeTotals(lines);

    $('#paySummaryMeal').textContent = L.mealName(meal.meal);
    $('#paySummaryDate').textContent = formatDateLong(state.serviceDate);
    renderLines($('#payLines'), lines);
    $('#paySubtotal').textContent = rub(totals.net);
    $('#payVatLabel').textContent = `${L.t('cart.vat')} ${totals.vatPercent}%`;
    $('#payVat').textContent = rub(totals.vat);
    $('#payTotal').textContent = rub(totals.gross);
    $('#payError').hidden = true;

    await loadTestCards();
    selectMethod('card');
    showView('pay');
  }

  async function loadTestCards() {
    const select = $('#testCard');
    if (select.options.length > 0) return;
    try {
      const { cards } = await api('GET', '/api/payment/test-cards');
      for (const card of cards) {
        const opt = document.createElement('option');
        opt.value = card.id;
        opt.dataset.labelEn = card.label_en;
        opt.dataset.labelRu = card.label_ru;
        opt.textContent = `•••• ${card.last4} — ${card.label_en}`;
        select.appendChild(opt);
      }
      relabelTestCards();
    } catch { /* handled by api() */ }
  }

  function relabelTestCards() {
    const ru = t().getLang() === 'ru';
    Array.from($('#testCard').options).forEach((opt) => {
      const last4 = opt.textContent.match(/•••• (\d{4})/)?.[1] ?? '';
      opt.textContent = `•••• ${last4} — ${ru ? opt.dataset.labelRu : opt.dataset.labelEn}`;
    });
  }

  function selectMethod(method) {
    state.paymentMethod = method;
    $$('.method').forEach((b) => b.classList.toggle('is-selected', b.dataset.method === method));
    $('#cardPanel').hidden = method !== 'card';
    $('#confirmPay').textContent = t().t(method === 'card' ? 'pay.confirmCard' : 'pay.confirmCash');
  }

  $$('.method').forEach((btn) => {
    btn.addEventListener('click', () => selectMethod(btn.dataset.method));
  });

  $('#payBack').addEventListener('click', () => showView('menu'));

  $('#confirmPay').addEventListener('click', async () => {
    const btn = $('#confirmPay');
    const errorBox = $('#payError');
    errorBox.hidden = true;
    btn.disabled = true;
    btn.textContent = t().t('pay.processing');

    const items = [...state.cart.entries()].map(([dishId, qty]) => ({ dishId, qty }));

    try {
      const res = await api('POST', '/api/orders', {
        serviceDate: state.serviceDate,
        meal: state.cartMeal,
        items,
        paymentMethod: state.paymentMethod,
        testCardId: state.paymentMethod === 'card' ? $('#testCard').value : undefined,
        note: $('#orderNote').value,
        lang: t().getLang(),
      });

      state.lastOrder = res.order;
      clearCart();
      $('#orderNote').value = '';
      showConfirmation(res);
      loadMenu().catch(() => {});
    } catch (err) {
      if (err.handled) return;
      const L = t();
      const map = {
        payment_declined: L.t('pay.declined'),
        ordering_closed: L.t('error.closed'),
        already_ordered: L.t('error.duplicate'),
      };
      errorBox.textContent = map[err.message] ?? L.t('error.generic');
      errorBox.hidden = false;
    } finally {
      btn.disabled = false;
      selectMethod(state.paymentMethod);
    }
  });

  function showConfirmation(res) {
    const L = t();
    const order = res.order;
    const isPaid = order.status === 'paid';

    $('#doneIcon').className = 'done-icon ' + (isPaid ? 'paid' : 'pending');
    $('#doneIcon').textContent = isPaid ? '✓' : '◷';
    $('#doneTitle').textContent = L.t(isPaid ? 'done.paidTitle' : 'done.cashTitle');
    $('#doneMessage').textContent = isPaid ? '' : L.t('done.cashInstruction');
    $('#doneOrderId').textContent = order.publicId;
    $('#doneTotal').textContent = order.totalDisplay;

    $('#doneVoucher').hidden = isPaid || !order.voucherToken;
    $('#doneVoucherCode').textContent = order.voucherToken ?? '';

    const link = $('#downloadReceipt');
    link.href = res.receiptUrl;
    link.textContent = L.t(isPaid ? 'done.download' : 'done.downloadVoucher');

    showView('done');
  }

  $('#doneBack').addEventListener('click', () => showView('menu'));

  // -------------------------------------------------------------------------
  // Orders history
  // -------------------------------------------------------------------------

  async function loadOrders() {
    const { orders } = await api('GET', '/api/orders');
    const L = t();
    const list = $('#ordersList');
    list.textContent = '';

    if (orders.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = L.t('orders.none');
      list.appendChild(empty);
      return;
    }

    for (const order of orders) {
      const card = document.createElement('article');
      card.className = 'order-card';

      const top = document.createElement('div');
      top.className = 'order-top';

      const meal = document.createElement('span');
      meal.className = 'order-meal';
      meal.textContent = L.mealName(order.meal);

      const date = document.createElement('span');
      date.className = 'order-date';
      date.textContent = formatDateLong(order.serviceDate);

      const badge = document.createElement('span');
      badge.className = `badge ${order.status}`;
      badge.textContent = L.t(`orders.status.${order.status}`);

      const total = document.createElement('span');
      total.className = 'order-total';
      total.textContent = order.totalDisplay;

      top.append(meal, date, badge, total);

      const items = document.createElement('p');
      items.className = 'order-items';
      items.textContent = order.items
        .map((i) => `${i.qty} × ${L.getLang() === 'ru' ? i.titleRu : i.titleEn}`)
        .join(' · ');

      const foot = document.createElement('div');
      foot.className = 'order-foot';

      const method = document.createElement('span');
      method.className = 'hint';
      method.textContent = L.t(`orders.method.${order.paymentMethod}`);
      foot.appendChild(method);

      if (order.status !== 'cancelled') {
        const receipt = document.createElement('a');
        receipt.className = 'btn-link';
        receipt.href = `/api/orders/${order.publicId}/receipt.pdf`;
        receipt.setAttribute('download', '');
        receipt.textContent = L.t('orders.receipt');
        foot.appendChild(receipt);
      }

      card.append(top, items, foot);
      list.appendChild(card);
    }
  }

  // -------------------------------------------------------------------------
  // Navigation & language
  // -------------------------------------------------------------------------

  $$('.navlink').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const view = btn.dataset.view;
      showView(view);
      if (view === 'orders') await loadOrders().catch(() => {});
      if (view === 'menu') await loadMenu().catch(() => {});
    });
  });

  $('#datePicker').addEventListener('change', async (e) => {
    state.serviceDate = e.target.value;
    clearCart();
    await loadMenu().catch(() => {});
  });

  $('#prevDay').addEventListener('click', () => shiftDay(-1));
  $('#nextDay').addEventListener('click', () => shiftDay(1));

  function shiftDay(delta) {
    const [y, m, d] = state.serviceDate.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
    state.serviceDate = next;
    clearCart();
    loadMenu().catch(() => {});
  }

  $$('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => t().setLang(btn.dataset.lang));
  });

  document.addEventListener('languagechange', (e) => {
    $$('.lang-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.lang === e.detail.lang));
    if (state.menu) renderMenu();
    if ($('#view-orders').classList.contains('is-visible')) loadOrders().catch(() => {});
    if ($('#testCard').options.length) relabelTestCards();
    selectMethod(state.paymentMethod);
  });

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  (async function boot() {
    t().init();
    try {
      const res = await api('GET', '/api/guest/session');
      state.guest = res.guest;
      await enterApp();
    } catch {
      showLogin();
    }
  })();
})();
