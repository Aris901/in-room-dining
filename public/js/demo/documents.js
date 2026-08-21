/* Receipts and reports for the browser demo.

   The server build renders PDFs with pdfkit and an embedded Cyrillic font.
   That cannot run in the browser, so receipts here open as a print-ready
   page and the browser's own "Save as PDF" produces the file. The layout,
   figures and wording match the server receipt. */
(function () {
  'use strict';

  const M = window.DiningMoney;
  const T = window.DiningTime;
  const TZ = 'Europe/Moscow';

  const STRINGS = {
    en: {
      title: 'Payment Receipt', voucherTitle: 'Pending Order Voucher',
      orderId: 'Order ID', room: 'Room', guest: 'Guest',
      serviceDate: 'Service date', meal: 'Meal', method: 'Payment method',
      methodCard: 'Credit card', methodCash: 'Cash at reception',
      card: 'Card', authCode: 'Authorisation code', voucherToken: 'Voucher code',
      issued: 'Issued', paidAt: 'Paid at',
      item: 'Item', qty: 'Qty', unitPrice: 'Unit price', lineTotal: 'Total',
      subtotal: 'Subtotal (net)', vat: 'VAT', total: 'Total paid', totalDue: 'Total due',
      cashInstruction: 'Order submitted. Please present your Room Number at Reception to complete payment.',
      cashPending: 'This order is NOT yet confirmed. The kitchen begins preparation only after Reception records your payment.',
      demo: 'DEMO DOCUMENT — simulated payment, no funds were transferred.',
      thanks: 'Thank you for dining with us.',
      print: 'Save as PDF / Print',
      meals: { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' },
    },
    ru: {
      title: 'Чек об оплате', voucherTitle: 'Ваучер на неоплаченный заказ',
      orderId: 'Номер заказа', room: 'Номер комнаты', guest: 'Гость',
      serviceDate: 'Дата обслуживания', meal: 'Приём пищи', method: 'Способ оплаты',
      methodCard: 'Банковская карта', methodCash: 'Наличными на ресепшн',
      card: 'Карта', authCode: 'Код авторизации', voucherToken: 'Код ваучера',
      issued: 'Выдан', paidAt: 'Оплачено',
      item: 'Блюдо', qty: 'Кол-во', unitPrice: 'Цена', lineTotal: 'Сумма',
      subtotal: 'Сумма без НДС', vat: 'НДС', total: 'Итого оплачено', totalDue: 'Итого к оплате',
      cashInstruction: 'Заказ отправлен. Пожалуйста, назовите номер вашей комнаты на ресепшн для завершения оплаты.',
      cashPending: 'Этот заказ ЕЩЁ НЕ подтверждён. Кухня начнёт приготовление только после того, как ресепшн зафиксирует оплату.',
      demo: 'ДЕМО-ДОКУМЕНТ — оплата смоделирована, средства не списывались.',
      thanks: 'Благодарим за то, что обедаете с нами.',
      print: 'Сохранить в PDF / Печать',
      meals: { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин' },
    },
  };

  const esc = (v) =>
    String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const fmtInstant = (iso, lang) =>
    iso
      ? new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', {
          timeZone: TZ, dateStyle: 'medium', timeStyle: 'short',
        }).format(new Date(iso))
      : '—';

  function receiptHtml(order) {
    const lang = order.lang === 'ru' ? 'ru' : 'en';
    const L = STRINGS[lang];
    const isPaid = order.status === 'paid';
    const isCash = order.payment_method === 'cash';
    const meal = T.MEALS[order.meal];

    const meta = [
      [L.orderId, order.public_id],
      [L.room, order.room_number],
      [L.guest, order.guest_name],
      [L.serviceDate, order.service_date],
      [L.meal, `${L.meals[order.meal]} (${meal.serviceStart}–${meal.serviceEnd})`],
      [L.method, isCash ? L.methodCash : L.methodCard],
    ];
    if (!isCash && order.card_last4) {
      meta.push([L.card, `•••• ${order.card_last4}`]);
      if (order.auth_code) meta.push([L.authCode, order.auth_code]);
    }
    if (isCash && order.voucher_token) meta.push([L.voucherToken, order.voucher_token]);
    meta.push([isPaid ? L.paidAt : L.issued, fmtInstant(isPaid ? order.paid_at : order.created_at, lang)]);

    const rows = order.items.map((i) => `
      <tr>
        <td>${esc(lang === 'ru' ? i.title_ru : i.title_en)}</td>
        <td class="num">${i.qty}</td>
        <td class="num">${esc(M.formatKopecks(i.unit_price_kopecks))}</td>
        <td class="num strong">${esc(M.formatKopecks(i.line_total_kopecks))}</td>
      </tr>`).join('');

    return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8">
<title>${esc(order.public_id)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
         color: #101828; margin: 0; padding: 28px; line-height: 1.55; }
  .sheet { max-width: 720px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 1px solid #d8dce5; padding-bottom: 16px; margin-bottom: 20px; }
  .hotel { font-size: 21px; font-weight: 700; color: #1b2a4a; }
  .addr { font-size: 11px; color: #667085; }
  .doctype { font-size: 16px; font-weight: 700; text-align: right;
             color: ${isPaid ? '#101828' : '#b8860b'}; }
  table.meta td { padding: 3px 0; font-size: 12px; vertical-align: top; }
  table.meta td:first-child { color: #667085; width: 190px; }
  table.meta td:last-child { font-weight: 600; }
  table.items { width: 100%; border-collapse: collapse; margin: 22px 0 6px; font-size: 12px; }
  table.items th { text-align: left; color: #667085; font-size: 10px;
                   text-transform: uppercase; letter-spacing: .06em;
                   border-bottom: 1px solid #d8dce5; padding: 0 0 7px; }
  table.items td { padding: 7px 0; border-bottom: 1px solid #f0f1f4; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .strong { font-weight: 700; }
  .totals { margin-left: auto; width: 300px; font-size: 12px; margin-top: 12px; }
  .totals tr td { padding: 3px 0; }
  .totals td:first-child { color: #667085; }
  .totals td:last-child { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .totals tr.grand td { border-top: 1px solid #d8dce5; padding-top: 9px;
                        font-size: 15px; font-weight: 700; color: #1b2a4a; }
  .cash { border: 1px solid #e6d5a8; background: #fdf6e4; border-radius: 6px;
          padding: 14px 16px; margin-top: 24px; }
  .cash .lead { color: #a9670a; font-weight: 700; font-size: 13px; }
  .cash .sub { color: #667085; font-size: 11px; margin-top: 5px; }
  .code { font-family: ui-monospace, Menlo, monospace; font-size: 20px;
          letter-spacing: .3em; margin-top: 10px; color: #1b2a4a; }
  .foot { border-top: 1px solid #d8dce5; margin-top: 34px; padding-top: 12px;
          font-size: 11px; color: #667085; }
  .demo { color: #b8860b; font-weight: 700; font-size: 10px; margin-top: 5px; }
  .bar { margin-top: 10px; height: 40px; display: flex; gap: 2px; align-items: stretch; }
  .bar i { display: block; background: #101828; }
  .print { position: fixed; top: 14px; right: 14px; background: #b8860b; color: #fff;
           border: none; border-radius: 7px; padding: 10px 18px; font-size: 13px;
           font-weight: 600; cursor: pointer; }
  @media print { .print { display: none; } body { padding: 0; } }
</style></head><body>
<button class="print" onclick="window.print()">${esc(L.print)}</button>
<div class="sheet">
  <div class="head">
    <div>
      <div class="hotel">Aurora Grand Hotel</div>
      <div class="addr">Tverskaya Street 12, Moscow<br>+7 495 000-00-00</div>
    </div>
    <div class="doctype">${esc(isPaid ? L.title : L.voucherTitle)}</div>
  </div>

  <table class="meta">${meta.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>

  <table class="items">
    <thead><tr>
      <th>${esc(L.item)}</th><th class="num">${esc(L.qty)}</th>
      <th class="num">${esc(L.unitPrice)}</th><th class="num">${esc(L.lineTotal)}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals">
    <tr><td>${esc(L.subtotal)}</td><td>${esc(M.formatKopecks(order.subtotal_kopecks))}</td></tr>
    <tr><td>${esc(L.vat)} ${order.vat_percent}%</td><td>${esc(M.formatKopecks(order.vat_kopecks))}</td></tr>
    <tr class="grand"><td>${esc(isPaid ? L.total : L.totalDue)}</td><td>${esc(M.formatKopecks(order.total_kopecks))}</td></tr>
  </table>

  ${isCash && !isPaid ? `<div class="cash">
      <div class="lead">${esc(L.cashInstruction)}</div>
      <div class="sub">${esc(L.cashPending)}</div>
      ${order.voucher_token ? `<div class="bar">${barcode(order.voucher_token)}</div>
      <div class="code">${esc(order.voucher_token)}</div>` : ''}
    </div>` : ''}

  <div class="foot">${esc(L.thanks)}<div class="demo">${esc(L.demo)}</div></div>
</div></body></html>`;
  }

  /** Deterministic bar pattern from the token, matching the server receipt. */
  function barcode(token) {
    let out = '';
    for (let i = 0; i < token.length; i++) {
      const code = token.charCodeAt(i);
      for (let bit = 0; bit < 4; bit++) {
        const wide = (code >> bit) & 1;
        out += `<i style="width:${wide ? 3 : 1.4}px"></i><i style="width:1.6px;background:transparent"></i>`;
      }
    }
    return out;
  }

  function openReceipt(publicId) {
    const order = window.DemoApi.orderByPublicId(publicId);
    if (!order) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(receiptHtml(order));
    win.document.close();
  }

  // ---- Excel report ------------------------------------------------------

  function exportReport(serviceDate, meal) {
    const orders = window.DemoStore.get().orders.filter(
      (o) => o.service_date === serviceDate && o.meal === meal && o.status !== 'cancelled'
    );

    const mealDef = T.MEALS[meal];
    const S = (v, s) => ({ v, t: 's', s });
    const N = (v, s) => ({ v, t: 'n', s });

    const rows = [
      [S('Aurora Grand Hotel — In-Room Dining', 1)],
      [S(`${meal.toUpperCase()} · ${serviceDate} · served ${mealDef.serviceStart}–${mealDef.serviceEnd} (${TZ})`)],
      [S(`Generated ${fmtInstant(new Date().toISOString(), 'en')}`)],
      [],
      [
        S('Room', 2), S('Guest name', 2), S('Ordered items', 2), S('Items', 2),
        S('Payment method', 2), S('Payment status', 2), S('Total (₽)', 2),
        S('Ordered at', 2), S('Paid at', 2),
      ],
    ];

    let paid = 0;
    let pending = 0;

    for (const o of orders) {
      const isPaid = o.status === 'paid';
      if (isPaid) paid += o.total_kopecks; else pending += o.total_kopecks;
      rows.push([
        S(o.room_number), S(o.guest_name),
        S(o.items.map((i) => `${i.qty} × ${i.title_en}`).join(', ')),
        N(o.items.reduce((n, i) => n + i.qty, 0)),
        S(o.payment_method === 'card' ? 'Card (online)' : 'Cash at reception'),
        S(isPaid ? 'PAID' : 'PENDING RECEPTION'),
        N(M.kopecksToNumber(o.total_kopecks), 3),
        S(fmtInstant(o.created_at, 'en')), S(fmtInstant(o.paid_at, 'en')),
      ]);
    }

    if (orders.length === 0) {
      rows.push([S('—'), S('No orders for this service window')]);
    }

    rows.push([]);
    const totalRow = (label, kopecks, style) => {
      const r = new Array(4).fill(null);
      r.push(S(label), null, N(M.kopecksToNumber(kopecks), style));
      rows.push(r);
    };
    totalRow('Collected (card)', paid, 3);
    totalRow('Awaiting reception (cash)', pending, 3);
    totalRow('Total revenue', paid + pending, 4);
    rows.push([]);
    rows.push([S('Demo data — payments are simulated; no funds were transferred.')]);

    const blob = window.DemoXlsx.build(`${meal} ${serviceDate}`, rows);
    triggerDownload(blob, `orders-${serviceDate}-${meal}.xlsx`);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ---- wire up the app's download affordances ----------------------------

  /** The staff export button routes through this instead of navigating. */
  window.__demoDownload = function (url) {
    const parsed = new URL(url, window.location.href);
    if (parsed.pathname.endsWith('.xlsx')) {
      exportReport(parsed.searchParams.get('date'), parsed.searchParams.get('meal'));
      return;
    }
    const receipt = parsed.pathname.match(/\/orders\/([\w-]+)\/receipt\.pdf$/);
    if (receipt) openReceipt(receipt[1]);
  };

  // Receipt links are plain anchors in the real app; intercept them here.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href*="/receipt.pdf"]');
    if (link) {
      event.preventDefault();
      window.__demoDownload(link.getAttribute('href'));
      return;
    }

    if (event.target.closest('#demoReset')) {
      event.preventDefault();
      window.DemoStore.reset();
      window.location.reload();
    }
  }, true);

  window.DemoDocuments = { openReceipt, exportReport, receiptHtml };
})();
