/* Staff portal. Every data call requires a staff session; loading this file
   grants nothing on its own. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const state = {
    staff: null,
    boardDate: null,
    activeMeal: null,
    windows: [],
    orders: [],
    menuDate: null,
    menuMeal: 'breakfast',
  };

  const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };

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
      state.staff = null;
      showLogin();
      throw Object.assign(new Error('unauthorised'), { handled: true });
    }
    if (!res.ok) {
      throw Object.assign(new Error(payload?.error ?? 'request_failed'), {
        status: res.status, payload,
      });
    }
    return payload;
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 4000);
  }

  const rub = (k) =>
    new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 })
      .format(k / 100);

  function longDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(Date.UTC(y, m - 1, d)));
  }

  function clockTime(iso) {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  function showLogin() {
    $('#view-login').classList.add('is-visible');
    $('#staffApp').hidden = true;
  }

  function showApp() {
    $('#view-login').classList.remove('is-visible');
    $('#staffApp').hidden = false;
  }

  $('#staffLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#staffLoginSubmit');
    const err = $('#staffLoginError');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    const data = Object.fromEntries(new FormData(e.target).entries());

    try {
      await api('POST', '/api/staff/login', data);
      await boot();
    } catch (ex) {
      err.textContent =
        ex.status === 429
          ? 'Too many attempts. Please wait before trying again.'
          : 'Invalid username or password.';
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  $('#staffSignOut').addEventListener('click', async () => {
    await api('POST', '/api/staff/logout').catch(() => {});
    state.staff = null;
    showLogin();
  });

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  $$('.navlink').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      $$('.navlink').forEach((b) => b.classList.toggle('is-active', b === btn));
      $$('#staffApp .view').forEach((v) => v.classList.remove('is-visible'));
      $(`#view-${view}`).classList.add('is-visible');
      if (view === 'menus') loadMenuEditor().catch(() => {});
      if (view === 'board') loadBoard().catch(() => {});
    });
  });

  // -------------------------------------------------------------------------
  // Kitchen board
  // -------------------------------------------------------------------------

  $('#boardDate').addEventListener('change', (e) => {
    state.boardDate = e.target.value;
    state.activeMeal = null;
    loadBoard().catch(() => {});
  });
  $('#boardRefresh').addEventListener('click', () => loadBoard().catch(() => {}));

  async function loadBoard() {
    const data = await api('GET', `/api/staff/orders?date=${state.boardDate}`);
    state.orders = data.orders;
    state.windows = data.windows;
    $('#boardDate').value = data.serviceDate;
    $('#boardDateLabel').textContent = longDate(data.serviceDate);
    renderStats(data.summary);
    renderWindowTabs();
    renderOrders();
  }

  function renderStats(summary) {
    const row = $('#boardStats');
    row.textContent = '';
    const stats = [
      { label: 'Orders today', value: String(summary.total) },
      { label: 'In kitchen queue', value: String(summary.paid), cls: 'ok' },
      { label: 'Awaiting reception', value: String(summary.awaitingCash), cls: 'accent' },
      { label: 'Collected', value: summary.revenuePaidDisplay, cls: 'ok' },
      { label: 'Pending cash', value: summary.revenuePendingDisplay, cls: 'accent' },
    ];
    for (const s of stats) {
      const el = document.createElement('div');
      el.className = 'stat' + (s.cls ? ` ${s.cls}` : '');
      const label = document.createElement('div');
      label.className = 'stat-label';
      label.textContent = s.label;
      const value = document.createElement('div');
      value.className = 'stat-value';
      value.textContent = s.value;
      el.append(label, value);
      row.appendChild(el);
    }
  }

  function renderWindowTabs() {
    const wrap = $('#windowTabs');
    wrap.textContent = '';

    const all = document.createElement('button');
    all.className = 'window-tab' + (state.activeMeal === null ? ' is-active' : '');
    all.innerHTML = '<span class="wt-name">All meals</span><span class="wt-meta">Whole day</span>';
    all.addEventListener('click', () => { state.activeMeal = null; renderWindowTabs(); renderOrders(); });
    wrap.appendChild(all);

    for (const w of state.windows) {
      const count = state.orders.filter((o) => o.meal === w.meal).length;
      const tab = document.createElement('button');
      tab.className = 'window-tab' + (state.activeMeal === w.meal ? ' is-active' : '');

      const name = document.createElement('span');
      name.className = 'wt-name';
      name.textContent = `${MEAL_LABEL[w.meal]} · ${count}`;

      const meta = document.createElement('span');
      meta.className = 'wt-meta';
      meta.textContent = `${w.serviceStart}–${w.serviceEnd}`;

      const flag = document.createElement('span');
      if (w.serviceFinished) { flag.className = 'wt-flag done'; flag.textContent = 'Service complete'; }
      else if (w.open) { flag.className = 'wt-flag open'; flag.textContent = 'Ordering open'; }
      else { flag.className = 'wt-flag closed'; flag.textContent = 'Ordering closed'; }

      tab.append(name, meta, document.createElement('br'), flag);
      tab.addEventListener('click', () => { state.activeMeal = w.meal; renderWindowTabs(); renderOrders(); });
      wrap.appendChild(tab);
    }
  }

  function renderOrders() {
    const grid = $('#boardOrders');
    grid.textContent = '';

    // Export bar — the spec ties the report to a completed meal window, so the
    // button explains itself when the window is still running.
    const existingBar = document.querySelector('.export-bar');
    if (existingBar) existingBar.remove();

    if (state.activeMeal) {
      grid.parentElement.insertBefore(buildExportBar(), grid);
    }

    const list = state.activeMeal
      ? state.orders.filter((o) => o.meal === state.activeMeal)
      : state.orders;

    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No orders for this window.';
      grid.appendChild(empty);
      return;
    }

    grid.appendChild(buildBoardTable(list));
  }

  const BOARD_COLUMNS = ['Room', 'Guest', 'Meal', 'Items', 'Total', 'Payment', 'Kitchen', 'Action'];

  /**
   * One semantic table serves every width.
   *
   * Above 768px it renders as a table, which is what the board actually is.
   * Below that, CSS re-flows the same rows into cards using the data-label
   * on each cell — so a phone reads stacked cards instead of scrolling a
   * table sideways, without maintaining two DOM trees that can drift apart.
   */
  function buildBoardTable(list) {
    const wrap = document.createElement('div');
    wrap.className = 'scroll-x';

    const table = document.createElement('table');
    table.className = 'board-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of BOARD_COLUMNS) {
      const th = document.createElement('th');
      th.setAttribute('scope', 'col');
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    for (const order of list) tbody.appendChild(buildBoardRow(order));

    table.append(thead, tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function buildBoardRow(order) {
    const row = document.createElement('tr');
    row.className =
      (order.status === 'awaiting_cash' ? 'pending ' : '') +
      (order.status === 'cancelled' ? 'cancelled' : '');

    let column = 0;
    const cell = (content, className) => {
      const td = document.createElement('td');
      td.setAttribute('data-label', BOARD_COLUMNS[column++]);
      if (className) td.className = className;
      if (content != null) {
        if (typeof content === 'string') td.textContent = content;
        else td.appendChild(content);
      }
      row.appendChild(td);
      return td;
    };

    cell(order.room, 'cell-room');
    cell(order.guestName, 'cell-guest');

    const meal = document.createElement('div');
    const mealName = document.createElement('span');
    mealName.textContent = MEAL_LABEL[order.meal];
    const mealMeta = document.createElement('small');
    mealMeta.textContent = `${clockTime(order.createdAt)} · ${order.publicId}`;
    meal.append(mealName, mealMeta);
    cell(meal, 'cell-meal');

    const items = document.createElement('ul');
    items.className = 'cell-items';
    for (const item of order.items) {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = `${item.qty}×`;
      li.append(n, document.createTextNode(item.titleEn));
      items.appendChild(li);
    }
    if (order.note) {
      const li = document.createElement('li');
      li.className = 'cell-note';
      li.textContent = `Note: ${order.note}`;
      items.appendChild(li);
    }
    cell(items, 'cell-itemlist');

    cell(order.totalDisplay, 'cell-total');

    const payment = document.createElement('span');
    if (order.paymentMethod === 'card') {
      payment.className = 'hint';
      payment.textContent = `Card •••• ${order.cardLast4 ?? '····'}`;
    } else if (order.voucherToken && order.status !== 'paid') {
      payment.className = 'voucher-code';
      payment.textContent = order.voucherToken;
    } else {
      payment.className = 'hint';
      payment.textContent = 'Cash — settled';
    }
    cell(payment, 'cell-payment');

    const flag = document.createElement('span');
    flag.className = 'queue-flag ' + (order.inKitchenQueue ? 'in' : 'out');
    flag.textContent = order.inKitchenQueue ? 'In queue' : 'Held — unpaid';
    cell(flag, 'cell-queue');

    // Only reception and managers can take money; the control is hidden for
    // everyone else, and the server enforces the same rule regardless.
    const canSettle = ['reception', 'manager'].includes(state.staff?.role);

    if (order.status === 'awaiting_cash' && canSettle) {
      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.textContent = 'Mark cash received';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Recording…';
        try {
          await api('POST', `/api/staff/orders/${order.publicId}/settle-cash`);
          toast(`${order.publicId} settled — released to the kitchen.`);
          await loadBoard();
        } catch (err) {
          if (!err.handled) toast('Could not settle that order.');
          btn.disabled = false;
          btn.textContent = 'Mark cash received';
        }
      });
      cell(btn, 'cell-action');
    } else if (order.status === 'paid') {
      const receipt = document.createElement('a');
      receipt.className = 'btn-link';
      receipt.href = `/api/staff/orders/${order.publicId}/receipt.pdf`;
      receipt.setAttribute('download', '');
      receipt.textContent = 'Receipt';
      cell(receipt, 'cell-action');
    } else {
      cell('', 'cell-action');
    }

    return row;
  }

  function buildExportBar() {
    const w = state.windows.find((x) => x.meal === state.activeMeal);
    const bar = document.createElement('div');
    bar.className = 'export-bar';

    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = w?.serviceFinished
      ? `${MEAL_LABEL[state.activeMeal]} service has finished — the summary is final.`
      : `${MEAL_LABEL[state.activeMeal]} service is still running; the export reflects orders so far.`;

    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.textContent = 'Export Excel summary (.xlsx)';
    btn.addEventListener('click', () => {
      const url = `/api/staff/reports/orders.xlsx?date=${state.boardDate}&meal=${state.activeMeal}`;
      // The static demo build overrides this to generate the workbook locally;
      // against the real server it is a plain download navigation.
      if (window.__demoDownload) window.__demoDownload(url);
      else window.location.href = url;
    });

    bar.append(hint, btn);
    return bar;
  }

  // -------------------------------------------------------------------------
  // Menu manager
  // -------------------------------------------------------------------------

  $('#menuDate').addEventListener('change', (e) => {
    state.menuDate = e.target.value;
    loadMenuEditor().catch(() => {});
  });
  $('#menuMeal').addEventListener('change', (e) => {
    state.menuMeal = e.target.value;
    loadMenuEditor().catch(() => {});
  });
  $('#addDish').addEventListener('click', () => addDishRow());

  async function loadMenuEditor() {
    const data = await api('GET', `/api/staff/menus?from=${state.menuDate}&days=1`);
    const day = data.menus[0];
    const meal = day.meals.find((m) => m.meal === state.menuMeal);

    $('#menuPublished').checked = meal.published;
    $('#menuSavedHint').textContent = '';

    // Editing a menu whose deadline has passed cannot affect existing orders,
    // but the chef should know guests can no longer order from it.
    const notice = $('#menuLockNotice');
    if (!meal.orderingOpen) {
      notice.textContent =
        `Ordering for this ${MEAL_LABEL[state.menuMeal].toLowerCase()} has already closed. ` +
        'Changes here will not affect orders guests have already placed.';
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }

    const editor = $('#dishEditor');
    editor.textContent = '';
    if (meal.dishes.length === 0) addDishRow();
    else meal.dishes.forEach((d) => addDishRow(d));
  }

  function addDishRow(dish) {
    const row = document.createElement('div');
    row.className = 'dish-row';

    const mk = (label, value, cls, placeholder) => {
      const wrap = document.createElement('div');
      const lab = document.createElement('span');
      lab.className = 'row-label';
      lab.textContent = label;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value ?? '';
      if (cls) input.className = cls;
      if (placeholder) input.placeholder = placeholder;
      wrap.append(lab, input);
      return { wrap, input };
    };

    const en = mk('Title (EN)', dish?.titleEn, 'title-en');
    const enDesc = mk('Description (EN)', dish?.descriptionEn, 'desc-en');
    enDesc.wrap.classList.add('sub');
    const enCol = document.createElement('div');
    enCol.append(en.wrap, enDesc.wrap);

    const ru = mk('Title (RU)', dish?.titleRu, 'title-ru');
    const ruDesc = mk('Description (RU)', dish?.descriptionRu, 'desc-ru');
    ruDesc.wrap.classList.add('sub');
    const ruCol = document.createElement('div');
    ruCol.append(ru.wrap, ruDesc.wrap);

    const price = mk('Price ₽', dish ? (dish.priceKopecks / 100).toFixed(2) : '', 'price-input', '0.00');
    const allergens = mk('Allergens (EN)', dish?.allergensEn, 'allergens-en');
    allergens.wrap.classList.add('sub');
    const priceCol = document.createElement('div');
    priceCol.append(price.wrap, allergens.wrap);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Remove dish');
    remove.addEventListener('click', () => row.remove());

    row.append(enCol, ruCol, priceCol, remove);
    $('#dishEditor').appendChild(row);
  }

  $('#saveMenu').addEventListener('click', async () => {
    const btn = $('#saveMenu');
    const err = $('#menuError');
    err.hidden = true;
    $$('.dish-row input').forEach((i) => i.classList.remove('is-invalid'));

    const rows = $$('.dish-row');
    const dishes = rows.map((row) => ({
      titleEn: row.querySelector('.title-en').value.trim(),
      titleRu: row.querySelector('.title-ru').value.trim(),
      descriptionEn: row.querySelector('.desc-en').value.trim(),
      descriptionRu: row.querySelector('.desc-ru').value.trim(),
      allergensEn: row.querySelector('.allergens-en').value.trim(),
      allergensRu: row.querySelector('.allergens-en').value.trim(),
      price: row.querySelector('.price-input').value.trim(),
    }));

    // Drop rows the chef left entirely blank rather than rejecting the save.
    const filled = dishes.filter((d) => d.titleEn || d.titleRu || d.price);

    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const res = await api('PUT', `/api/staff/menus/${state.menuDate}/${state.menuMeal}`, {
        published: $('#menuPublished').checked,
        dishes: filled,
      });
      $('#menuSavedHint').textContent =
        `Saved ${res.dishCount} dish${res.dishCount === 1 ? '' : 'es'} at ${clockTime(new Date().toISOString())}.`;
      toast('Menu saved.');
    } catch (ex) {
      if (ex.handled) return;
      const index = ex.payload?.index;
      if (typeof index === 'number' && rows[index]) {
        const field = ex.message === 'invalid_price' ? '.price-input' : '.title-en';
        rows[index].querySelector(field)?.classList.add('is-invalid');
      }
      err.textContent = {
        invalid_price: `Row ${(index ?? 0) + 1}: that price is not a valid amount in roubles.`,
        missing_title: `Row ${(index ?? 0) + 1}: both the English and Russian titles are required.`,
        too_many_dishes: 'A single menu cannot hold more than 40 dishes.',
      }[ex.message] ?? 'Could not save the menu.';
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save menu';
    }
  });

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  async function boot() {
    try {
      const session = await api('GET', '/api/staff/session');
      state.staff = session.staff;
      state.boardDate = session.today;
      state.menuDate = session.today;

      $('#staffName').textContent = session.staff.name;
      $('#staffRole').textContent = session.staff.role;

      // Menus belong to the chef and the manager. Reception was being shown
      // the tab and got a 403 on opening it — the server guard was right, the
      // interface was offering something it knew would fail.
      const mayEditMenus = ['chef', 'manager'].includes(session.staff.role);
      const menusTab = document.querySelector('.navlink[data-view="menus"]');
      if (menusTab) menusTab.hidden = !mayEditMenus;
      $('#boardDate').value = session.today;
      $('#menuDate').value = session.today;

      // The chef has no cash duties, so open them straight into the menus.
      if (session.staff.role === 'chef') {
        $$('.navlink').forEach((b) => b.classList.toggle('is-active', b.dataset.view === 'menus'));
        $$('#staffApp .view').forEach((v) => v.classList.remove('is-visible'));
        $('#view-menus').classList.add('is-visible');
        showApp();
        await loadMenuEditor();
        return;
      }

      showApp();
      await loadBoard();
    } catch {
      showLogin();
    }
  }

  boot();
})();
