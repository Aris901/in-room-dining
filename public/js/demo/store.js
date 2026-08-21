/* Browser demo data store.
   Stands in for SQLite. State lives in localStorage so an order survives a
   refresh; "Reset demo" clears it. Seeded to mirror src/seed.js. */
(function () {
  'use strict';

  const T = window.DiningTime;
  const M = window.DiningMoney;
  const KEY = 'dining-demo-state-v1';
  const TZ = 'Europe/Moscow';
  const VAT = 20;

  const MENUS = {
    breakfast: [
      ['Syrniki with Sour Cream', 'Сырники со сметаной',
       'Farmer’s cheese pancakes, wild berry preserve, crème fraîche.',
       'Творожные оладьи, варенье из лесных ягод, крем-фреш.',
       'Milk, eggs, gluten', 'Молоко, яйца, глютен', '780'],
      ['Buckwheat Porridge with Wild Mushrooms', 'Гречневая каша с лесными грибами',
       'Slow-cooked buckwheat, porcini, caramelised onion.',
       'Томлёная гречка, белые грибы, карамелизированный лук.',
       'Milk', 'Молоко', '640'],
      ['Smoked Salmon & Poached Eggs', 'Копчёный лосось и яйца пашот',
       'Two poached eggs, Baltic salmon, dill hollandaise, rye toast.',
       'Два яйца пашот, балтийский лосось, голландез с укропом, ржаной тост.',
       'Fish, eggs, milk, gluten', 'Рыба, яйца, молоко, глютен', '1150'],
      ['Seasonal Fruit Plate', 'Тарелка сезонных фруктов',
       'Chef’s selection of fruit, mint, honey.',
       'Фруктовая подборка от шефа, мята, мёд.', '', '', '520'],
    ],
    lunch: [
      ['Borscht with Beef Brisket', 'Борщ с говяжьей грудинкой',
       'Beetroot broth, slow-braised brisket, smetana, garlic pampushka.',
       'Свекольный бульон, томлёная грудинка, сметана, чесночная пампушка.',
       'Milk, gluten, celery', 'Молоко, глютен, сельдерей', '890'],
      ['Pelmeni in Bone Broth', 'Пельмени в костном бульоне',
       'Handmade veal dumplings, clarified broth, black pepper.',
       'Пельмени ручной лепки с телятиной, осветлённый бульон, чёрный перец.',
       'Gluten, eggs, celery', 'Глютен, яйца, сельдерей', '960'],
      ['Pike-Perch with Fennel', 'Судак с фенхелем',
       'Pan-roasted pike-perch, braised fennel, lemon beurre blanc.',
       'Обжаренный судак, тушёный фенхель, лимонный бёр-блан.',
       'Fish, milk, sulphites', 'Рыба, молоко, сульфиты', '1480'],
      ['Olivier Salad', 'Салат Оливье',
       'The classic, with veal tongue and quail egg.',
       'Классический, с телячьим языком и перепелиным яйцом.',
       'Eggs, milk, mustard', 'Яйца, молоко, горчица', '740'],
      ['Honey Cake (Medovik)', 'Медовик',
       'Twelve layers, sour cream custard, burnt honey.',
       'Двенадцать слоёв, сметанный крем, жжёный мёд.',
       'Milk, eggs, gluten, honey', 'Молоко, яйца, глютен, мёд', '560'],
    ],
    dinner: [
      ['Beef Stroganoff', 'Бефстроганов',
       'Tenderloin strips, wild mushroom cream, potato purée.',
       'Полоски вырезки, сливки с лесными грибами, картофельное пюре.',
       'Milk, gluten', 'Молоко, глютен', '1690'],
      ['Lamb Shoulder, Eight Hours', 'Баранья лопатка, восемь часов',
       'Slow-roasted shoulder, pearl barley, pickled ramson.',
       'Медленно запечённая лопатка, перловка, маринованная черемша.',
       'Gluten, celery', 'Глютен, сельдерей', '2140'],
      ['Roast Duck with Cranberry', 'Утка с клюквой',
       'Duck breast, cranberry gastrique, braised cabbage.',
       'Утиная грудка, клюквенный гастрик, тушёная капуста.',
       'Sulphites', 'Сульфиты', '1870'],
      ['Wild Mushroom Risotto', 'Ризотто с лесными грибами',
       'Carnaroli rice, porcini, aged Kostroma cheese.',
       'Рис карнароли, белые грибы, выдержанный костромской сыр.',
       'Milk, sulphites', 'Молоко, сульфиты', '1290'],
      ['Napoleon Cake', 'Торт Наполеон',
       'Puff pastry, vanilla custard, sixty layers.',
       'Слоёное тесто, ванильный заварной крем, шестьдесят слоёв.',
       'Milk, eggs, gluten', 'Молоко, яйца, глютен', '610'],
    ],
  };

  const STAFF = [
    { username: 'chef', password: 'chef1234', name: 'Ivan Petrov', role: 'chef' },
    { username: 'reception', password: 'front1234', name: 'Olga Sokolova', role: 'reception' },
    { username: 'manager', password: 'manage1234', name: 'Dmitry Volkov', role: 'manager' },
  ];

  function buildSeed() {
    const today = T.hotelToday(TZ);

    const stays = [
      ['Ariel Kalambay', '412', '+7 495 555-01-42', T.addDays(today, -1), T.addDays(today, 4)],
      ['Maria Ivanova', '507', '+7 495 555-07-19', today, T.addDays(today, 2)],
      ['James Whitfield', '218', '+7 495 555-22-08', T.addDays(today, -3), T.addDays(today, 1)],
    ].map((s, i) => ({
      id: i + 1,
      full_name: s[0], room_number: s[1], phone: s[2],
      phone_digits: s[2].replace(/\D/g, '').replace(/^8/, '7'),
      check_in: s[3], check_out: s[4], cancelled: 0,
    }));

    const menus = [];
    const dishes = [];
    let menuId = 0;
    let dishId = 0;

    for (let d = -2; d <= 10; d++) {
      const date = T.addDays(today, d);
      for (const meal of T.MEAL_KEYS) {
        menuId += 1;
        menus.push({ id: menuId, service_date: date, meal, published: 1 });
        MENUS[meal].forEach((row, index) => {
          dishId += 1;
          dishes.push({
            id: dishId, menu_id: menuId,
            title_en: row[0], title_ru: row[1],
            description_en: row[2], description_ru: row[3],
            allergens_en: row[4], allergens_ru: row[5],
            price_kopecks: M.parseRoublesToKopecks(row[6]),
            available: 1, sort_order: index,
          });
        });
      }
    }

    return { seededOn: today, stays, menus, dishes, orders: [], nextOrderId: 1, session: null, staffSession: null };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // The seed is date-relative; if the demo is reopened on a later day the
        // old menus would be stale, so rebuild while keeping nothing.
        if (parsed.seededOn === T.hotelToday(TZ)) return parsed;
      }
    } catch { /* corrupt or unavailable storage — reseed */ }
    return buildSeed();
  }

  let state = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota / private mode */ }
  }

  function reset() {
    state = buildSeed();
    save();
  }

  window.DemoStore = {
    TZ, VAT, STAFF,
    get: () => state,
    save,
    reset,
    dishesFor: (menuId) => state.dishes.filter((d) => d.menu_id === menuId),
    menuFor: (date, meal) =>
      state.menus.find((m) => m.service_date === date && m.meal === meal && m.published),
  };
})();
