# Deploying this backend

This is a real server, not a static site. It writes to a database, signs
session cookies, generates PDFs and holds state between requests. That rules
out GitHub Pages, Netlify and Vercel's static hosting, and it puts one
requirement above every other choice you make:

> **The database has to outlive the container.**

SQLite is a single file. On a host with no disk that file lives in the
container's temporary filesystem and is destroyed on every redeploy, restart
and idle spin-down. A visitor places an order, the container recycles an hour
later, and the order is gone. A demo that forgets is worse than no demo,
because it looks broken rather than absent.

There are two ways to satisfy that, and only one of them is free:

1. **A persistent volume** mounted at `/data`. Every host that offers one
   charges for it — §2b.
2. **Turso**, which hosts the SQLite file remotely. The container then keeps
   nothing that matters, so any free tier will do — §2a.

---

## 1. What has to be true before you deploy

| Requirement | Why | Where it is handled |
|---|---|---|
| The database survives a redeploy | Otherwise every order vanishes | A volume (§2b) or Turso (§2a) |
| Two session secrets set | The app refuses to boot in production without them | `src/config.js` → `assertSecrets()` |
| HTTPS | Session cookies are set `secure` in production | Every host below terminates TLS for you |
| Exactly one instance | SQLite has a single writer | single-instance settings in the host config |
| Node 22+ | `fetch`, `node:test`, and the code assume it | `engines` in `package.json`, `node:22` base image |

### On a volume, the database is three files

SQLite runs in WAL mode when it is a local file, so `/data` holds `dining.db`,
`dining.db-wal` and `dining.db-shm`. Recent writes live in the `-wal` file
until they are checkpointed. Copying only `dining.db` gives you a database
missing its most recent orders — I did exactly that while testing and lost a
paid order from the copy. Back up the whole directory.

This does not apply to the Turso route, where the durable copy is remote.

---

## 2. Choosing a host

I checked the free tiers rather than assuming, because the storage
requirement eliminates the obvious answers.

| Host | Free tier | Volume on the free tier? | Verdict |
|---|---|---|---|
| **Render** | Yes | **No** — disks are a paid feature | Free plan cannot hold data. Starter (~$7/mo) can. |
| **Koyeb** | 1 service, 512 MB, 2 GB SSD | **No.** Their docs: *"You cannot attach a volume to `eco-*` or `free` Instance."* | Free plan cannot hold data — that 2 GB is ephemeral. |
| **Fly.io** | **None** (withdrawn) | Paid: $3.32/mo machine + $0.15/mo per GB | Cheapest way to get a real volume. |
| **Northflank** | Sandbox, always-on | Not confirmed on the free plan | Do not rely on it without checking. |
| **Railway** | Trial credit, then paid | Volumes | Fine if you already pay for it. |

Sources: [Koyeb volumes reference](https://www.koyeb.com/docs/reference/volumes),
[Koyeb instance types](https://www.koyeb.com/docs/reference/instances),
[Render free tier](https://render.com/docs/free),
[Fly.io pricing](https://fly.io/docs/about/pricing/).

**An earlier version of this document was wrong about this.** It recommended
Koyeb's free tier on the strength of its "2 GB SSD". That storage is
ephemeral, and Koyeb's own documentation says the free instance cannot attach
a volume at all. Following that advice would have produced a deployment that
forgot every order — the precise failure this page opens by warning about.
The correction is why §2a exists.

**There is no free tier with a persistent volume.** That leaves two honest
routes.

---

## 2a. Free: Turso holds the database

Turso hosts the SQLite file remotely, so the container needs no disk and any
free tier works.

The application code does not change. [`libsql`](https://github.com/tursodatabase/libsql-js)
is a better-sqlite3-compatible API with the same **synchronous** calls, so
swapping drivers is one environment variable rather than a rewrite. The full
suite passes on both drivers, and `tests/driver.test.js` keeps it that way. It
also guards the one real difference between them: libsql attaches a
`_metadata` field to rows returned by `.get()`, which must never reach a
response.

```bash
curl -sSfL https://get.tur.so/install.sh | bash   # or: npm i -g @tursodatabase/turso-cli
turso auth signup                                 # no card required
turso db create in-room-dining
turso db show in-room-dining --url                # -> TURSO_SYNC_URL
turso db tokens create in-room-dining             # -> TURSO_AUTH_TOKEN
```

Then set on any free host:

```
DB_DRIVER=libsql
TURSO_SYNC_URL=libsql://in-room-dining-<org>.turso.io
TURSO_AUTH_TOKEN=<token>
```

That is embedded-replica mode: a local cache for read speed, with the durable
copy at Turso, pulled every `TURSO_SYNC_SECONDS`. Set `TURSO_DATABASE_URL`
instead of `TURSO_SYNC_URL` to skip the local file and query Turso directly —
simpler, but a network round trip per query, and this app makes several per
request.

Free plan at the time of writing: 5 GB storage, 500 M row reads and 10 M
writes a month. This demo will not come close.

---

## 2b. Paid: a real volume

If you would rather keep everything on one machine, Fly.io is cheapest —
$3.32/mo for a shared-cpu-1x with 512 MB, plus $0.15/mo for a 1 GB volume.
`fly.toml` is committed and already declares the volume, the health check and
single-instance operation.

Everything here is packaged as a **Dockerfile**, so moving between hosts
changes a config file rather than the application.

---

## 3. Environment variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `PORT` | no | `3000` | Port to bind. Most hosts inject this. |
| `SESSION_SECRET` | **yes in production** | — | Signs guest session cookies. |
| `STAFF_SESSION_SECRET` | **yes in production** | — | Signs staff session cookies. Must differ from the guest one. |
| `DB_DRIVER` | no | `better-sqlite3` | `libsql` to use Turso. |
| `TURSO_SYNC_URL` | for the free route | — | Embedded replica. Durable copy at Turso. |
| `TURSO_DATABASE_URL` | alternative | — | Query Turso directly, no local file. Set this **or** `TURSO_SYNC_URL`. |
| `TURSO_AUTH_TOKEN` | with either of the above | — | Turso database token. |
| `TURSO_SYNC_SECONDS` | no | `60` | How often the replica pulls. `0` disables. |
| `DB_PATH` | on a volume | `data/dining.db` | Must point at the mounted disk: `/data/dining.db`. |
| `HOTEL_TZ` | no | `Europe/Moscow` | Timezone all ordering deadlines are judged in. |
| `VAT_PERCENT` | no | `20` | VAT extracted from the VAT-inclusive menu prices. |
| `DEMO_MODE` | no | `on` | `on` exposes `/api/demo-guest`, which hands out a seeded guest's login so a visitor can get in. **Correct for a portfolio demo. Must be `off` for a real hotel.** |
| `DEMO_RESET` | no | `off` | `on` wipes and re-seeds the database once a day. |
| `DEMO_RESET_HOUR` | no | `4` | Hour (hotel time) the reset runs. |
| `HOST_SLEEPS` | no | `off` | `on` shows visitors a cold-start notice. Set it only if your host actually sleeps. |
| `MAX_ORDERS` | no | `200` | Ceiling on stored orders; the oldest beyond it are dropped. `0` disables the cap, which is the correct setting for a real hotel. |
| `NODE_ENV` | — | — | Set to `production` by the Dockerfile. |

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Run it twice. Set them as **secrets** in the host's dashboard, never in the
repository. Rotating either is safe — it only invalidates open sessions.

---

## 4. Deploying

### Any free host + Turso (recommended)

1. Do §2a first and keep the URL and token to hand.
2. Check the pair actually holds data before anything depends on it:

   ```bash
   TURSO_SYNC_URL=libsql://<db>.turso.io TURSO_AUTH_TOKEN=... npm run check:turso
   ```

   It writes through one embedded replica and reads the row back through a
   second one on a different local file. The second has never seen the first's
   disk, so a pass means the row genuinely reached Turso — which is the same
   thing that has to happen for an order to survive a redeploy. It drops its
   own table afterwards and never touches application data.
3. Create a service from this repository, builder **Dockerfile**.
4. Expose port `3000`, public.
5. Health check: HTTP `GET /health`.
6. Environment: everything from §3, including `DB_DRIVER=libsql`, the Turso
   pair, and `HOST_SLEEPS=on` if the host sleeps when idle.
7. **No volume needed.** That is the point.

### Fly.io, with a volume

```bash
fly launch --no-deploy                       # keeps the committed fly.toml
fly volume create dining_data --size 1 --region cdg
fly secrets set SESSION_SECRET=... STAFF_SESSION_SECRET=...
fly deploy
```

### Render, free, with Turso

`render.yaml` is in the repo and is written for the free plan. Point a new
Blueprint at it. It sets `DB_DRIVER=libsql`, puts the embedded replica's cache
at `/tmp` (throwaway on purpose — the durable copy is at Turso), generates both
session secrets, and declares **no disk**, because the free plan cannot have
one.

Two values are marked `sync: false` and Render will prompt for them on the
first deploy. Do §2a first so you have them:

| Prompt | Value |
| --- | --- |
| `TURSO_SYNC_URL` | `libsql://<your-database>.turso.io` |
| `TURSO_AUTH_TOKEN` | output of `turso db tokens create <your-database>` |

The blueprint also sets `HOST_SLEEPS=on`, which is true of Render's free plan:
it sleeps after roughly 15 minutes idle and takes about 40 seconds to wake. The
UI says so, so a cold start reads as starting up rather than broken.

If you would rather pay and keep SQLite on a real disk, use Starter (~$7/mo)
and follow §2b instead — drop the Turso variables, set `DB_PATH=/data/dining.db`
and attach a 1 GB disk at `/data`.

---

## 5. First boot

`scripts/start-production.js` runs before the port is bound and does three
things, in order:

1. **`assertSecrets()`** — fails immediately if the secrets are missing, so a
   misconfigured deploy dies at startup instead of serving broken sessions.
2. **`seedIfEmpty()`** — if the database is empty, it seeds the hotel: staff
   accounts, guests, and menus around today. It also re-seeds if the seeded
   menus have run out, so a demo left alone for a month still has a menu.
3. **`resetJob.start()`** — schedules the daily wipe if `DEMO_RESET=on`.

Existing data is never touched on restart. Only an empty database is seeded.

Seeded staff logins are printed in the deploy log on first boot. Change the
staff passwords immediately if this is anything other than a demo.

---

## 6. Checking it actually worked

```bash
BASE=https://your-app.example.com

curl -s $BASE/health          # {"ok":true,"time":"..."}
curl -s $BASE/api/runtime     # {"demo":true,"paymentsSimulated":true,...}
curl -s -o /dev/null -w '%{http_code}\n' $BASE/
curl -s -o /dev/null -w '%{http_code}\n' $BASE/staff-portal
```

Then by hand:

5. Guest app → **Fill demo guest** → sign in → order a meal → pay with a test
   card → download the PDF receipt.
6. `/staff-portal` → sign in as reception → confirm the order is on the board.
7. **Redeploy the service. Sign in again. The order must still be there.**

Step 7 is the whole point. If the order is gone, the database did not outlive
the container — either the volume is not mounted and `DB_PATH` is not pointing
at it, or `DB_DRIVER`/`TURSO_*` are not set. Nothing else here matters until
that passes.

---

## 6a. Leaving it open to strangers

The public instance is reachable by anyone, so four things hold it steady.

**Payments are simulated and say so.** `src/services/payment-gateway.js` has no
provider behind it, the guest app carries a permanent banner reading *"Demo ·
Simulated payments — never enter real card details"*, and the test cards are
listed on the payment step. No column in the schema stores a card number,
expiry or CVV.

**Credentials are published, deliberately.** The staff login lists all three
accounts, and the guest form fills itself from `/api/demo-guest`. That is the
point of a demo — but it is also why `DEMO_MODE=off` is not optional for a
real hotel. With it off, `/api/demo-guest` returns 404.

**Order creation is rate limited** to `20` per minute per address
(`src/routes/guest.js`), alongside `10` guest logins per ten minutes and `8`
staff logins per fifteen.

**Orders are capped.** Past `MAX_ORDERS` the oldest are dropped, line items
following them by `ON DELETE CASCADE`. The prune runs *after* the order
commits, never inside its transaction — a housekeeping failure must not roll
back a guest's order. `tests/order-cap.test.js` covers it.

Every seeded guest is invented. The demo hands one guest's details to anyone
who clicks "Fill demo guest", so no real person's name or number is in there.

`audit_log` is not capped. With `DEMO_RESET=on` the daily wipe bounds it; with
the reset off it grows. **TODO:** cap it too if this ever runs without the
daily reset.

---

## 7. Things that are deliberately not here

- **Real payments.** The gateway in `src/services/payment-gateway.js` is
  simulated and labelled as such in the interface. A public demo must never be
  wired to a live payment provider.
- **Postgres.** It would also solve the storage problem, but SQLite is the
  right size for one hotel and Turso keeps it that way. If this ever needs
  more than one instance, that is when it becomes Postgres.
- **Card data.** No column stores a card number, expiry or CVV — only the last
  four digits and an authorisation code. Deliberate, and it should stay.

---

## 8. Local check before you push

```bash
npm test                  # 63 tests
DB_DRIVER=libsql npm test # the same 63, on the Turso driver
npm run seed
npm start
```

Rehearse the production path:

```bash
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") \
STAFF_SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") \
NODE_ENV=production DB_PATH=./data/prod-rehearsal.db \
npm run start:prod
```

If Docker is installed:

```bash
docker build -t in-room-dining .
docker run --rm -p 3000:3000 \
  -e SESSION_SECRET=dev -e STAFF_SESSION_SECRET=dev2 \
  -e DB_DRIVER=libsql -e TURSO_SYNC_URL=... -e TURSO_AUTH_TOKEN=... \
  in-room-dining
```
