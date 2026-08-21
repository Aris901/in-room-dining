'use strict';

/**
 * Demo data.
 *
 * Everything here is fictional: invented guests, invented phone numbers
 * (Russia's +7 495 555-xx-xx range is not assigned to real subscribers), and
 * a fictional property. Running this wipes and repopulates the database.
 */

const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { config } = require('./config');
const timeUtil = require('./time');
const money = require('./money');

const today = timeUtil.hotelToday(config.hotelTimeZone);

const STAFF = [
  { username: 'chef', password: 'chef1234', display_name: 'Ivan Petrov', role: 'chef' },
  { username: 'reception', password: 'front1234', display_name: 'Olga Sokolova', role: 'reception' },
  { username: 'manager', password: 'manage1234', display_name: 'Dmitry Volkov', role: 'manager' },
];

const STAYS = [
  {
    full_name: 'Ariel Kalambay',
    room_number: '412',
    phone: '+7 495 555-01-42',
    check_in: timeUtil.addDays(today, -1),
    check_out: timeUtil.addDays(today, 4),
  },
  {
    full_name: 'Maria Ivanova',
    room_number: '507',
    phone: '+7 495 555-07-19',
    check_in: today,
    check_out: timeUtil.addDays(today, 2),
  },
  {
    full_name: 'James Whitfield',
    room_number: '218',
    phone: '+7 495 555-22-08',
    check_in: timeUtil.addDays(today, -3),
    check_out: timeUtil.addDays(today, 1),
  },
  {
    // A stay that has already ended — useful for testing session expiry.
    full_name: 'Elena Morozova',
    room_number: '301',
    phone: '+7 495 555-30-11',
    check_in: timeUtil.addDays(today, -9),
    check_out: timeUtil.addDays(today, -2),
  },
];

const MENUS = {
  breakfast: [
    {
      titleEn: 'Syrniki with Sour Cream',
      titleRu: 'Сырники со сметаной',
      descriptionEn: 'Farmer’s cheese pancakes, wild berry preserve, crème fraîche.',
      descriptionRu: 'Творожные оладьи, варенье из лесных ягод, крем-фреш.',
      allergensEn: 'Milk, eggs, gluten',
      allergensRu: 'Молоко, яйца, глютен',
      price: '780',
    },
    {
      titleEn: 'Buckwheat Porridge with Wild Mushrooms',
      titleRu: 'Гречневая каша с лесными грибами',
      descriptionEn: 'Slow-cooked buckwheat, porcini, caramelised onion.',
      descriptionRu: 'Томлёная гречка, белые грибы, карамелизированный лук.',
      allergensEn: 'Milk',
      allergensRu: 'Молоко',
      price: '640',
    },
    {
      titleEn: 'Smoked Salmon & Poached Eggs',
      titleRu: 'Копчёный лосось и яйца пашот',
      descriptionEn: 'Two poached eggs, Baltic salmon, dill hollandaise, rye toast.',
      descriptionRu: 'Два яйца пашот, балтийский лосось, голландез с укропом, ржаной тост.',
      allergensEn: 'Fish, eggs, milk, gluten',
      allergensRu: 'Рыба, яйца, молоко, глютен',
      price: '1150',
    },
    {
      titleEn: 'Seasonal Fruit Plate',
      titleRu: 'Тарелка сезонных фруктов',
      descriptionEn: 'Chef’s selection of fruit, mint, honey.',
      descriptionRu: 'Фруктовая подборка от шефа, мята, мёд.',
      allergensEn: '',
      allergensRu: '',
      price: '520',
    },
  ],
  lunch: [
    {
      titleEn: 'Borscht with Beef Brisket',
      titleRu: 'Борщ с говяжьей грудинкой',
      descriptionEn: 'Beetroot broth, slow-braised brisket, smetana, garlic pampushka.',
      descriptionRu: 'Свекольный бульон, томлёная грудинка, сметана, чесночная пампушка.',
      allergensEn: 'Milk, gluten, celery',
      allergensRu: 'Молоко, глютен, сельдерей',
      price: '890',
    },
    {
      titleEn: 'Pelmeni in Bone Broth',
      titleRu: 'Пельмени в костном бульоне',
      descriptionEn: 'Handmade veal dumplings, clarified broth, black pepper.',
      descriptionRu: 'Пельмени ручной лепки с телятиной, осветлённый бульон, чёрный перец.',
      allergensEn: 'Gluten, eggs, celery',
      allergensRu: 'Глютен, яйца, сельдерей',
      price: '960',
    },
    {
      titleEn: 'Pike-Perch with Fennel',
      titleRu: 'Судак с фенхелем',
      descriptionEn: 'Pan-roasted pike-perch, braised fennel, lemon beurre blanc.',
      descriptionRu: 'Обжаренный судак, тушёный фенхель, лимонный бёр-блан.',
      allergensEn: 'Fish, milk, sulphites',
      allergensRu: 'Рыба, молоко, сульфиты',
      price: '1480',
    },
    {
      titleEn: 'Olivier Salad',
      titleRu: 'Салат Оливье',
      descriptionEn: 'The classic, with veal tongue and quail egg.',
      descriptionRu: 'Классический, с телячьим языком и перепелиным яйцом.',
      allergensEn: 'Eggs, milk, mustard',
      allergensRu: 'Яйца, молоко, горчица',
      price: '740',
    },
    {
      titleEn: 'Honey Cake (Medovik)',
      titleRu: 'Медовик',
      descriptionEn: 'Twelve layers, sour cream custard, burnt honey.',
      descriptionRu: 'Двенадцать слоёв, сметанный крем, жжёный мёд.',
      allergensEn: 'Milk, eggs, gluten, honey',
      allergensRu: 'Молоко, яйца, глютен, мёд',
      price: '560',
    },
  ],
  dinner: [
    {
      titleEn: 'Beef Stroganoff',
      titleRu: 'Бефстроганов',
      descriptionEn: 'Tenderloin strips, wild mushroom cream, potato purée.',
      descriptionRu: 'Полоски вырезки, сливки с лесными грибами, картофельное пюре.',
      allergensEn: 'Milk, gluten',
      allergensRu: 'Молоко, глютен',
      price: '1690',
    },
    {
      titleEn: 'Lamb Shoulder, Eight Hours',
      titleRu: 'Баранья лопатка, восемь часов',
      descriptionEn: 'Slow-roasted shoulder, pearl barley, pickled ramson.',
      descriptionRu: 'Медленно запечённая лопатка, перловка, маринованная черемша.',
      allergensEn: 'Gluten, celery',
      allergensRu: 'Глютен, сельдерей',
      price: '2140',
    },
    {
      titleEn: 'Roast Duck with Cranberry',
      titleRu: 'Утка с клюквой',
      descriptionEn: 'Duck breast, cranberry gastrique, braised cabbage.',
      descriptionRu: 'Утиная грудка, клюквенный гастрик, тушёная капуста.',
      allergensEn: 'Sulphites',
      allergensRu: 'Сульфиты',
      price: '1870',
    },
    {
      titleEn: 'Wild Mushroom Risotto',
      titleRu: 'Ризотто с лесными грибами',
      descriptionEn: 'Carnaroli rice, porcini, aged Kostroma cheese.',
      descriptionRu: 'Рис карнароли, белые грибы, выдержанный костромской сыр.',
      allergensEn: 'Milk, sulphites',
      allergensRu: 'Молоко, сульфиты',
      price: '1290',
    },
    {
      titleEn: 'Napoleon Cake',
      titleRu: 'Торт Наполеон',
      descriptionEn: 'Puff pastry, vanilla custard, sixty layers.',
      descriptionRu: 'Слоёное тесто, ванильный заварной крем, шестьдесят слоёв.',
      allergensEn: 'Milk, eggs, gluten',
      allergensRu: 'Молоко, яйца, глютен',
      price: '610',
    },
  ],
};

function seed() {
  const run = db.transaction(() => {
    db.exec(`
      DELETE FROM order_items;
      DELETE FROM orders;
      DELETE FROM dishes;
      DELETE FROM menus;
      DELETE FROM stays;
      DELETE FROM staff;
      DELETE FROM audit_log;
    `);

    const insertStaff = db.prepare(
      'INSERT INTO staff (username, password_hash, display_name, role) VALUES (?,?,?,?)'
    );
    for (const s of STAFF) {
      insertStaff.run(s.username, bcrypt.hashSync(s.password, 10), s.display_name, s.role);
    }

    const insertStay = db.prepare(
      `INSERT INTO stays (full_name, room_number, phone, phone_digits, check_in, check_out)
       VALUES (?,?,?,?,?,?)`
    );
    for (const g of STAYS) {
      insertStay.run(
        g.full_name,
        g.room_number,
        g.phone,
        g.phone.replace(/\D/g, '').replace(/^8/, '7'),
        g.check_in,
        g.check_out
      );
    }

    // Publish menus for the next 10 days so every meal window is orderable.
    const insertMenu = db.prepare(
      'INSERT INTO menus (service_date, meal, published) VALUES (?,?,1)'
    );
    const insertDish = db.prepare(
      `INSERT INTO dishes
         (menu_id, title_en, title_ru, description_en, description_ru,
          allergens_en, allergens_ru, price_kopecks, available, sort_order)
       VALUES (?,?,?,?,?,?,?,?,1,?)`
    );

    for (let dayOffset = -2; dayOffset <= 10; dayOffset++) {
      const date = timeUtil.addDays(today, dayOffset);
      for (const meal of timeUtil.MEAL_KEYS) {
        const info = insertMenu.run(date, meal);
        MENUS[meal].forEach((dish, index) => {
          insertDish.run(
            info.lastInsertRowid,
            dish.titleEn, dish.titleRu,
            dish.descriptionEn, dish.descriptionRu,
            dish.allergensEn, dish.allergensRu,
            money.parseRoublesToKopecks(dish.price),
            index
          );
        });
      }
    }
  });

  run();

  const counts = {
    staff: db.prepare('SELECT COUNT(*) n FROM staff').get().n,
    stays: db.prepare('SELECT COUNT(*) n FROM stays').get().n,
    menus: db.prepare('SELECT COUNT(*) n FROM menus').get().n,
    dishes: db.prepare('SELECT COUNT(*) n FROM dishes').get().n,
  };

  console.log('\n  Seeded demo data');
  console.log(`  ${counts.staff} staff · ${counts.stays} stays · ${counts.menus} menus · ${counts.dishes} dishes`);
  console.log('\n  Guest logins (all five fields must match):');
  for (const g of STAYS) {
    console.log(
      `    ${g.full_name.padEnd(18)} room ${g.room_number}  ${g.phone}  ${g.check_in} → ${g.check_out}`
    );
  }
  console.log('\n  Staff logins:');
  for (const s of STAFF) console.log(`    ${s.username.padEnd(10)} / ${s.password}  (${s.role})`);
  console.log('');
}

if (require.main === module) seed();

module.exports = { seed, STAYS, STAFF };
