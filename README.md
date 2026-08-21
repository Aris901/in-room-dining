# Aurora Grand — In-Room Dining

A full-stack in-room dining platform for hotel guests: verified guest sign-in,
time-gated fixed menus, dual payment paths, PDF receipts, and a staff-only
portal with Excel reporting.

> **This is a portfolio demo.** The hotel, its guests, and its staff are
> fictional. **Payments are simulated** — there is no gateway, no card data is
> ever accepted or stored, and no money moves.

**▶ Try it live: <https://aris901.github.io/in-room-dining/>**
· [staff portal](https://aris901.github.io/in-room-dining/staff.html)

---

## Two builds

| | Full-stack app | Browser demo (`docs/`) |
| --- | --- | --- |
| Runs on | Node + SQLite | GitHub Pages, no server |
| Purpose | The real architecture | A clickable link |
| Auth | HMAC session cookies | Same checks, held in `localStorage` |
| Deadlines & money | `src/time.js`, `src/money.js` | **The same two files**, re-emitted for the browser |
| Receipts | PDF via pdfkit + embedded Cyrillic font | Print-ready page → browser "Save as PDF" |
| Excel | `exceljs` | Hand-written minimal `.xlsx` writer |

The demo exists because GitHub Pages cannot run Node. It is **not** a
reimplementation: `npm run build:demo` reads `src/time.js` and `src/money.js`,
strips their CommonJS export, and re-emits them as browser globals, so the
deadline and rounding rules cannot drift between the two builds. The guest and
staff front ends are copied **byte-for-byte** — the demo works by patching
`window.fetch`, not by forking the UI.

`tests/demo.test.js` runs the demo in a sandboxed DOM and asserts it enforces
the same rules: late orders refused, prices taken from the store rather than the
request, cash held out of the kitchen queue, staff roles honoured.

> The demo trusts the browser, because in a static build there is nowhere else
> to put the logic. That is exactly why the real build exists — and why the
> server re-checks every one of these rules server-side.

---

## Running it

```bash
npm install
npm run seed     # creates and populates data/dining.db
npm start        # http://localhost:3000
```

| Surface | URL |
| --- | --- |
| Guest app | <http://localhost:3000/> |
| Staff portal | <http://localhost:3000/staff-portal> |

`npm run seed` prints the demo logins. The guest form also has a
**Fill demo guest** button.

**Staff logins**

| Username | Password | Role | Can do |
| --- | --- | --- | --- |
| `chef` | `chef1234` | chef | Menus and prices |
| `reception` | `front1234` | reception | Take cash, cancel orders |
| `manager` | `manage1234` | manager | Everything |

```bash
npm test          # 52 tests: domain, API integration, and the browser demo
npm run build:demo   # regenerate docs/ (the static GitHub Pages demo)
```

---

## How the pieces fit

```
server.js                 express app, security headers, static + route wiring
src/
  config.js               timezone, VAT, secrets, rate limits, demo flag
  time.js                 meal windows and deadline maths      (pure, tested)
  money.js                integer-kopeck arithmetic            (pure, tested)
  db.js                   SQLite schema + audit log
  auth.js                 guest verification, HMAC sessions, role gates
  i18n.js                 EN/RU strings for generated documents
  seed.js                 fictional demo data
  routes/guest.js         login, menu, orders, receipts
  routes/staff.js         menu manager, kitchen board, cash, Excel
  services/
    payment-gateway.js    SIMULATED authorisation — swap this one file
    receipt-pdf.js        PDF receipts and cash vouchers
    report-xlsx.js        Excel order summary
  js/demo/                browser-demo runtime (mock API, docs, xlsx writer)
public/                   guest app (vanilla JS, no build step)
views/staff.html          staff shell, deliberately outside the static tree
scripts/build-demo.js     generates docs/ from src/ + public/
docs/                     GENERATED — the static demo GitHub Pages serves
```

---

## 1. Guest authentication

Five fields — full name, room number, phone, check-in, check-out — are matched
against an active stay. All five must match; four of five is a rejection.

- Phone comparison is digits-only and treats `8XXX…` and `+7XXX…` as the same
  number, so formatting never locks a legitimate guest out.
- Every failure returns one identical error, so the form cannot be used to
  discover which rooms are occupied.
- Success issues an **HMAC-signed session token** in an `httpOnly` cookie,
  scoped to that stay and expiring at the end of the check-out day.
- The stay is **re-read from the database on every request**, so a cancelled or
  ended stay loses access immediately rather than whenever the token lapses.

> The spec calls for verification against a PMS. There is no PMS here; the
> `stays` table stands in for one. Swapping in a real Opera/Fidelio/Bnovo
> integration means replacing `findMatchingStay()` in `src/auth.js`.

## 2. Time-gated menus

| Meal | Served | Ordering closes |
| --- | --- | --- |
| Breakfast / Завтрак | 08:00–10:00 | **22:00 the day before** |
| Lunch / Обед | 13:00–15:00 | **11:00 same day** |
| Dinner / Ужин | 18:00–20:00 | **16:00 same day** |

Past the deadline the order button locks and the meal shows exactly the
required wording, e.g. *"Breakfast ordering closed. Please contact or visit
Reception for late requests."*

Two things this build is careful about:

- **All deadlines are evaluated in the hotel's timezone** (`Europe/Moscow` by
  default, configurable). A guest whose phone is set to London still gets the
  kitchen's real cutoff, not their own. `src/time.js` converts hotel wall-clock
  time to real instants, and handles DST for zones that observe it.
- **The browser never decides whether a meal is open.** It renders the server's
  verdict and runs a countdown; when the countdown hits zero it re-asks the
  server. The deadline is checked again at the moment of submission, so an
  order cannot slip through on a page that was loaded before the cutoff.

## 3. Localisation, pricing, design

- **EN | RU toggle** in the header, persisted, covering dish titles, allergen
  notes, timers, status banners, and generated PDFs. The language chosen at
  order time is stored on the order so the receipt stays consistent.
- **All prices in roubles (₽)**, stored as **integer kopecks** — no floating
  point touches a price, a subtotal, or a VAT figure.
- VAT is *extracted* from the VAT-inclusive menu price, matching Russian
  consumer pricing: the guest pays the shelf price and the receipt shows how
  much of it was tax. Net + VAT reconstructs the gross exactly (tested).
- **Design tokens** follow the 60 / 30 / 10 split: warm slate ground, midnight
  blue branding, and gold reserved strictly for primary actions. Dish titles are
  set in a serif (Cormorant Garamond); every timer, price, and status banner is
  high-contrast sans (Inter) with tabular figures.

## 4. Payments

**Card** — authorised through `services/payment-gateway.js`, then the order is
`paid` immediately and a PDF receipt is generated with order ID, room, itemised
dishes in ₽, VAT, and timestamp.

**Cash** — the order is created as `awaiting_cash` with a voucher token and
barcode, and the guest is told to present their room number at Reception. It
**does not reach the kitchen queue** until reception records payment. That
transition is role-restricted and written to an audit log.

### What "simulated" means here

The demo offers a set of **test cards** rather than a card-number field, so real
card details cannot be entered anywhere. A production build must differ in ways
worth being explicit about:

- Card data should never reach this server. Collect it in a PSP-hosted iframe or
  SDK so the server only ever sees a token — that is what keeps the app out of
  PCI-DSS scope. The moment raw PANs touch your server you inherit the full
  SAQ-D burden.
- Real 3-D Secure 2.0 needs a challenge redirect and a signed callback.
- Authorisation results must be reconciled by webhook, never trusted from the
  browser.

The database has no column for a card number, expiry, or CVV. Only the last four
digits and an auth code are kept, which is all a receipt legitimately needs.

## 5. Staff portal

Served only at `/staff-portal`, never linked from the guest app, `noindex`, and
with its HTML held outside the static tree. Loading the shell grants nothing —
every data endpoint requires a staff session.

- **Menu manager** — the chef sets the rotating fixed menu and its prices for
  any upcoming day, bilingually. Prices accept `1250`, `1250.50` or `1 250,50`.
  A malformed price rejects the whole save and names the offending row, so a
  menu can never be left half-written.
- **Kitchen board** — live orders by room, meal window, and payment status, with
  a clear held/queued flag. Cash orders show their voucher code for reception.
- **Excel export** (`.xlsx`) — one click per meal window. Room, guest, itemised
  dishes, quantities, payment status, totals, and timestamps. Money is written
  as real numbers with a ₽ format, so the sheet can be summed and pivoted
  directly rather than being text that looks like money.

---

## Notes worth knowing

- **Orders snapshot their line items.** `order_items` stores the title and unit
  price at the time of ordering, so editing tomorrow's menu can never rewrite
  yesterday's receipt.
- **One order per meal per stay**, enforced server-side.
- **Guests cannot order outside their own stay dates**, or from another day's
  menu, or for a dish marked unavailable — each is checked server-side.
- **The server prices every order itself.** A tampered client that posts its own
  prices is ignored; there is a test for exactly this.
- **Cyrillic PDFs need an embedded font.** PDF base fonts are Latin-only, so
  DejaVu Sans is bundled in `assets/fonts/`. If it is ever missing, receipts
  fall back to English rather than rendering blank boxes.
- **`npm audit`** flags a transitive `uuid` advisory via `exceljs`. It concerns
  `uuid` v3/v5/v6 buffer writes, which exceljs does not use; fixing it would
  force a breaking exceljs downgrade.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOTEL_TZ` | `Europe/Moscow` | Timezone all deadlines are evaluated in |
| `VAT_PERCENT` | `20` | VAT rate shown on receipts |
| `SESSION_SECRET` | dev default | Guest token signing key |
| `STAFF_SESSION_SECRET` | dev default | Staff token signing key |
| `DB_PATH` | `data/dining.db` | SQLite file |
| `DEMO_MODE` | `on` | `off` disables the demo-guest prefill endpoint |

The app **refuses to start** with `NODE_ENV=production` unless both session
secrets are set.

### Not built

Out of scope for a portfolio demo, and dishonest to claim: real PMS integration,
a real payment gateway, SMS/email receipt delivery (receipts download in-app),
and multi-property support.
