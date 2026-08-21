/* Guest-app UI strings. EN is the fallback for any missing key. */
(function () {
  'use strict';

  const STRINGS = {
    en: {
      'brand.tagline': 'In-Room Dining',

      'login.title': 'Welcome',
      'login.intro': 'Please confirm your stay details to view today’s menu.',
      'login.fullName': 'Full name',
      'login.room': 'Room number',
      'login.phone': 'Phone number',
      'login.checkIn': 'Check-in date',
      'login.checkOut': 'Check-out date',
      'login.submit': 'View the menu',
      'login.working': 'Verifying…',
      'login.failed':
        'We could not match those details to an active stay. Please check each field, or contact Reception for assistance.',
      'login.tooMany': 'Too many attempts. Please wait a few minutes or contact Reception.',
      'login.help': 'All five fields must match your reservation exactly.',
      'login.demoTitle': 'Demo stay',
      'login.demoFill': 'Fill demo guest',

      'nav.menu': 'Menu',
      'nav.orders': 'My orders',
      'nav.signOut': 'Sign out',
      'nav.room': 'Room',

      'menu.title': 'Today’s Menu',
      'menu.for': 'Menu for',
      'menu.today': 'Today',
      'menu.tomorrow': 'Tomorrow',
      'menu.noMenu': 'The chef has not published this menu yet.',
      'menu.outsideStay': 'This date falls outside your stay.',
      'menu.served': 'Served',
      'menu.closesIn': 'Ordering closes in',
      'menu.closedAt': 'Ordering closed at',
      'menu.dayBefore': 'the day before',
      'menu.orderNow': 'Order this meal',
      'menu.alreadyOrdered': 'Order placed',
      'menu.viewOrder': 'View your order',
      'menu.allergens': 'Allergens',
      'menu.noAllergens': 'No declared allergens',
      'menu.unavailable': 'Unavailable',

      'closed.breakfast':
        'Breakfast ordering closed. Please contact or visit Reception for late requests.',
      'closed.lunch':
        'Lunch ordering closed. Please contact or visit Reception for late requests.',
      'closed.dinner':
        'Dinner ordering closed. Please contact or visit Reception for late requests.',

      'cart.title': 'Your order',
      'cart.empty': 'Select dishes to begin.',
      'cart.subtotal': 'Subtotal (net)',
      'cart.vat': 'VAT',
      'cart.total': 'Total',
      'cart.note': 'Note for the kitchen (optional)',
      'cart.notePlaceholder': 'Allergies, timing preferences…',
      'cart.continue': 'Continue to payment',
      'cart.back': 'Back to menu',

      'pay.title': 'Payment',
      'pay.chooseMethod': 'How would you like to pay?',
      'pay.card': 'Pay by card',
      'pay.cardHint': 'Secured by 3-D Secure 2.0. Instant confirmation and receipt.',
      'pay.cash': 'Pay cash at Reception',
      'pay.cashHint':
        'We hold your order until Reception records payment. The kitchen starts only after that.',
      'pay.testCard': 'Test card',
      'pay.confirmCard': 'Pay now',
      'pay.confirmCash': 'Submit order',
      'pay.processing': 'Processing…',
      'pay.declined': 'Payment declined. Please try another card or pay cash at Reception.',
      'pay.demoBanner':
        'Demo — payments are simulated. Never enter real card details. Choose a test card below.',

      'done.paidTitle': 'Payment confirmed',
      'done.cashTitle': 'Order submitted',
      'done.cashInstruction':
        'Order submitted. Please present your Room Number at Reception to complete payment.',
      'done.orderId': 'Order',
      'done.download': 'Download receipt (PDF)',
      'done.downloadVoucher': 'Download voucher (PDF)',
      'done.backToMenu': 'Back to menu',
      'done.voucherCode': 'Voucher code',

      'orders.title': 'My orders',
      'orders.none': 'You have not placed any orders yet.',
      'orders.status.paid': 'Paid',
      'orders.status.awaiting_cash': 'Awaiting payment at Reception',
      'orders.status.cancelled': 'Cancelled',
      'orders.method.card': 'Card',
      'orders.method.cash': 'Cash at Reception',
      'orders.receipt': 'Receipt',

      'error.session': 'Your session has ended. Please sign in again.',
      'error.generic': 'Something went wrong. Please try again.',
      'error.closed': 'That meal closed while you were ordering. Please contact Reception.',
      'error.duplicate': 'You already have an order for this meal.',

      'time.days': 'd',
      'time.hours': 'h',
      'time.minutes': 'm',
      'time.seconds': 's',
    },

    ru: {
      'brand.tagline': 'Обслуживание в номерах',

      'login.title': 'Добро пожаловать',
      'login.intro': 'Подтвердите данные проживания, чтобы посмотреть меню.',
      'login.fullName': 'Полное имя',
      'login.room': 'Номер комнаты',
      'login.phone': 'Номер телефона',
      'login.checkIn': 'Дата заезда',
      'login.checkOut': 'Дата выезда',
      'login.submit': 'Смотреть меню',
      'login.working': 'Проверяем…',
      'login.failed':
        'Не удалось сопоставить эти данные с активным проживанием. Проверьте каждое поле или обратитесь на ресепшн.',
      'login.tooMany': 'Слишком много попыток. Подождите несколько минут или обратитесь на ресепшн.',
      'login.help': 'Все пять полей должны точно совпадать с вашей бронью.',
      'login.demoTitle': 'Демо-проживание',
      'login.demoFill': 'Заполнить демо-данные',

      'nav.menu': 'Меню',
      'nav.orders': 'Мои заказы',
      'nav.signOut': 'Выйти',
      'nav.room': 'Номер',

      'menu.title': 'Меню на сегодня',
      'menu.for': 'Меню на',
      'menu.today': 'Сегодня',
      'menu.tomorrow': 'Завтра',
      'menu.noMenu': 'Шеф-повар ещё не опубликовал это меню.',
      'menu.outsideStay': 'Эта дата вне периода вашего проживания.',
      'menu.served': 'Подача',
      'menu.closesIn': 'Приём заказов закроется через',
      'menu.closedAt': 'Приём заказов закрыт в',
      'menu.dayBefore': 'накануне',
      'menu.orderNow': 'Заказать',
      'menu.alreadyOrdered': 'Заказ оформлен',
      'menu.viewOrder': 'Посмотреть заказ',
      'menu.allergens': 'Аллергены',
      'menu.noAllergens': 'Аллергены не заявлены',
      'menu.unavailable': 'Недоступно',

      'closed.breakfast':
        'Приём заказов на завтрак закрыт. Пожалуйста, свяжитесь с ресепшн или подойдите туда.',
      'closed.lunch':
        'Приём заказов на обед закрыт. Пожалуйста, свяжитесь с ресепшн или подойдите туда.',
      'closed.dinner':
        'Приём заказов на ужин закрыт. Пожалуйста, свяжитесь с ресепшн или подойдите туда.',

      'cart.title': 'Ваш заказ',
      'cart.empty': 'Выберите блюда, чтобы начать.',
      'cart.subtotal': 'Сумма без НДС',
      'cart.vat': 'НДС',
      'cart.total': 'Итого',
      'cart.note': 'Пожелание кухне (необязательно)',
      'cart.notePlaceholder': 'Аллергии, пожелания по времени…',
      'cart.continue': 'Перейти к оплате',
      'cart.back': 'Назад к меню',

      'pay.title': 'Оплата',
      'pay.chooseMethod': 'Как вы хотите оплатить?',
      'pay.card': 'Оплатить картой',
      'pay.cardHint': 'Защищено 3-D Secure 2.0. Мгновенное подтверждение и чек.',
      'pay.cash': 'Оплатить наличными на ресепшн',
      'pay.cashHint':
        'Мы удерживаем заказ, пока ресепшн не зафиксирует оплату. Только после этого кухня начнёт готовить.',
      'pay.testCard': 'Тестовая карта',
      'pay.confirmCard': 'Оплатить',
      'pay.confirmCash': 'Отправить заказ',
      'pay.processing': 'Обрабатываем…',
      'pay.declined': 'Платёж отклонён. Попробуйте другую карту или оплатите наличными на ресепшн.',
      'pay.demoBanner':
        'Демо — оплата смоделирована. Никогда не вводите реальные данные карты. Выберите тестовую карту ниже.',

      'done.paidTitle': 'Оплата подтверждена',
      'done.cashTitle': 'Заказ отправлен',
      'done.cashInstruction':
        'Заказ отправлен. Пожалуйста, назовите номер вашей комнаты на ресепшн для завершения оплаты.',
      'done.orderId': 'Заказ',
      'done.download': 'Скачать чек (PDF)',
      'done.downloadVoucher': 'Скачать ваучер (PDF)',
      'done.backToMenu': 'Назад к меню',
      'done.voucherCode': 'Код ваучера',

      'orders.title': 'Мои заказы',
      'orders.none': 'Вы ещё не сделали ни одного заказа.',
      'orders.status.paid': 'Оплачено',
      'orders.status.awaiting_cash': 'Ожидает оплаты на ресепшн',
      'orders.status.cancelled': 'Отменён',
      'orders.method.card': 'Карта',
      'orders.method.cash': 'Наличные на ресепшн',
      'orders.receipt': 'Чек',

      'error.session': 'Сессия завершена. Пожалуйста, войдите снова.',
      'error.generic': 'Что-то пошло не так. Попробуйте ещё раз.',
      'error.closed': 'Приём заказов закрылся, пока вы оформляли. Обратитесь на ресепшн.',
      'error.duplicate': 'У вас уже есть заказ на этот приём пищи.',

      'time.days': 'д',
      'time.hours': 'ч',
      'time.minutes': 'м',
      'time.seconds': 'с',
    },
  };

  const MEAL_NAMES = {
    en: { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' },
    ru: { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин' },
  };

  const STORAGE_KEY = 'dining-lang';
  let current = 'en';

  function setLang(lang) {
    current = STRINGS[lang] ? lang : 'en';
    try { localStorage.setItem(STORAGE_KEY, current); } catch { /* private mode */ }
    document.documentElement.setAttribute('lang', current);
    apply();
    document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: current } }));
  }

  function getLang() { return current; }

  function t(key) {
    return STRINGS[current][key] ?? STRINGS.en[key] ?? key;
  }

  function mealName(meal) {
    return MEAL_NAMES[current][meal] ?? meal;
  }

  /** Pick the field for the active language from an API object. */
  function pick(obj, base) {
    const suffix = current === 'ru' ? 'Ru' : 'En';
    const snake = current === 'ru' ? '_ru' : '_en';
    return obj[base + suffix] ?? obj[base + snake] ?? '';
  }

  /** Re-render every element carrying a data-i18n attribute. */
  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const value = t(el.getAttribute('data-i18n'));
      const attr = el.getAttribute('data-i18n-attr');
      if (attr) el.setAttribute(attr, value);
      else el.textContent = value;
    });
  }

  function init() {
    let saved = 'en';
    try { saved = localStorage.getItem(STORAGE_KEY) || 'en'; } catch { /* ignore */ }
    setLang(saved);
  }

  window.i18n = { t, setLang, getLang, mealName, pick, apply, init };
})();
