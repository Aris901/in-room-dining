'use strict';

/**
 * Server-side strings. The browser has its own copy for the UI chrome; these
 * are the ones that must be correct on generated documents (receipts,
 * vouchers) where the language is fixed at the moment the order is placed.
 */

const STRINGS = {
  en: {
    'meal.breakfast': 'Breakfast',
    'meal.lunch': 'Lunch',
    'meal.dinner': 'Dinner',

    'receipt.title': 'Payment Receipt',
    'receipt.voucherTitle': 'Pending Order Voucher',
    'receipt.orderId': 'Order ID',
    'receipt.room': 'Room',
    'receipt.guest': 'Guest',
    'receipt.serviceDate': 'Service date',
    'receipt.meal': 'Meal',
    'receipt.servedBetween': 'Served between',
    'receipt.issued': 'Issued',
    'receipt.paidAt': 'Paid at',
    'receipt.item': 'Item',
    'receipt.qty': 'Qty',
    'receipt.unitPrice': 'Unit price',
    'receipt.lineTotal': 'Total',
    'receipt.subtotal': 'Subtotal (net)',
    'receipt.vat': 'VAT',
    'receipt.total': 'Total paid',
    'receipt.totalDue': 'Total due',
    'receipt.method': 'Payment method',
    'receipt.methodCard': 'Credit card',
    'receipt.methodCash': 'Cash at reception',
    'receipt.card': 'Card',
    'receipt.authCode': 'Authorisation code',
    'receipt.voucherToken': 'Voucher code',
    'receipt.cashInstruction':
      'Order submitted. Please present your Room Number at Reception to complete payment.',
    'receipt.cashPending':
      'This order is NOT yet confirmed. The kitchen begins preparation only after Reception records your payment.',
    'receipt.demoNotice':
      'DEMO DOCUMENT — simulated payment, no funds were transferred.',
    'receipt.thanks': 'Thank you for dining with us.',
  },
  ru: {
    'meal.breakfast': 'Завтрак',
    'meal.lunch': 'Обед',
    'meal.dinner': 'Ужин',

    'receipt.title': 'Чек об оплате',
    'receipt.voucherTitle': 'Ваучер на неоплаченный заказ',
    'receipt.orderId': 'Номер заказа',
    'receipt.room': 'Номер комнаты',
    'receipt.guest': 'Гость',
    'receipt.serviceDate': 'Дата обслуживания',
    'receipt.meal': 'Приём пищи',
    'receipt.servedBetween': 'Подача',
    'receipt.issued': 'Выдан',
    'receipt.paidAt': 'Оплачено',
    'receipt.item': 'Блюдо',
    'receipt.qty': 'Кол-во',
    'receipt.unitPrice': 'Цена',
    'receipt.lineTotal': 'Сумма',
    'receipt.subtotal': 'Сумма без НДС',
    'receipt.vat': 'НДС',
    'receipt.total': 'Итого оплачено',
    'receipt.totalDue': 'Итого к оплате',
    'receipt.method': 'Способ оплаты',
    'receipt.methodCard': 'Банковская карта',
    'receipt.methodCash': 'Наличными на ресепшн',
    'receipt.card': 'Карта',
    'receipt.authCode': 'Код авторизации',
    'receipt.voucherToken': 'Код ваучера',
    'receipt.cashInstruction':
      'Заказ отправлен. Пожалуйста, назовите номер вашей комнаты на ресепшн для завершения оплаты.',
    'receipt.cashPending':
      'Этот заказ ЕЩЁ НЕ подтверждён. Кухня начнёт приготовление только после того, как ресепшн зафиксирует оплату.',
    'receipt.demoNotice':
      'ДЕМО-ДОКУМЕНТ — оплата смоделирована, средства не списывались.',
    'receipt.thanks': 'Благодарим за то, что обедаете с нами.',
  },
};

const SUPPORTED = Object.keys(STRINGS);

function normaliseLang(lang) {
  const value = String(lang ?? '').toLowerCase().slice(0, 2);
  return SUPPORTED.includes(value) ? value : 'en';
}

function t(lang, key) {
  const dict = STRINGS[normaliseLang(lang)];
  return dict[key] ?? STRINGS.en[key] ?? key;
}

module.exports = { STRINGS, SUPPORTED, normaliseLang, t };
