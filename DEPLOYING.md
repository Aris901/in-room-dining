# Deploying this backend

This is a real server, not a static site. It writes to a database, signs
session cookies, generates PDFs and holds state between requests. That rules
out GitHub Pages, Netlify and Vercel's static hosting, and it puts one
requirement above every other choice you make:

> **The host must give the container a persistent disk.**

The database is SQLite — a single file. If the host has no disk, that file
lives in the container's temporary filesystem and is destroyed on every
redeploy, every restart and every idle spin-down. A visitor places an order,
the container recycles an hour later, and the order is gone. A demo that
forgets is worse than no demo, because it looks broken rather than absent.

---

## 1. What has to be true before you deploy

| Requirement | Why | Where it is handled |
|---|---|---|
| Persistent disk mounted at `/data` | SQLite is a file; no disk means no memory | `Dockerfile` (`VOLUME`), host config |
| `DB_PATH` points into that disk | Otherwise it writes to the ephemeral layer | `DB_PATH=/data/dining.db` |
| Two session secrets set | The app refuses to boot in production without them | `src/config.js` → `assertSecrets()` |
| HTTPS | Session cookies are set `secure` in production | Every host below terminates TLS for you |
| Exactly one instance | Two containers means two SQLite files and split data | single-instance settings in the host config |
| Node 22+ | `fetch`, `node:test`, and the code assume it | `engines` in `package.json`, `node:22` base image |

### The database is three files, not one

SQLite runs in WAL mode here, so `/data` holds `dining.db`, `dining.db-wal`
and `dining.db-shm`. Recent writes live in the `-wal` file until they are
checkpointed into the main one. Copying only `dining.db` gives you a database
that is missing its most recent orders — I did exactly that while testing this
and lost a paid order from the copy. Back up or move the whole directory.

---

## 2. Choosing a host

I checked the free tiers before writing this, because the disk requirement
eliminates the obvious answer.

| Host | Free tier | Persistent disk on free? | Verdict |
|---|---|---|---|
| **Render** | Yes | **No** — disks are a paid feature | Free plan **cannot** run this. Paid Starter can. |
| **Fly.io** | **No free tier** (withdrawn) | Volumes, paid | Works well, but it is a paid deploy. |
| **Northflank** | Sandbox: 2 services, 1 database, 2 cron jobs | **Yes** | Best free option for this shape. |
| **Koyeb** | 1 service, 512 MB RAM, 2 GB SSD | **Yes**, but sleeps when idle | Works free; expect cold starts. |
| **Railway** | Trial credit, then paid | Volumes | Fine if you already pay for it. |

Sources: [Render free tier docs](https://render.com/docs/free),
[Fly.io pricing changes](https://www.saaspricepulse.com/tools/flyio),
[free-host roundup, 2026](https://appwrite.io/blog/post/best-free-hosting-platforms-you-probably-havent-tried-in-2026).

Free tiers change often. Rather than betting the project on one platform,
everything here is packaged as a **Dockerfile**, which all five accept. Moving
hosts means changing the config file, not the application.

- **Free and reliable:** Northflank.
- **Free, and a cold start is acceptable:** Koyeb, with `HOST_SLEEPS=on`.
- **A few dollars a month, no cold starts:** Fly.io or Render Starter.

---

## 3. Environment variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `PORT` | no | `3000` | Port to bind. Most hosts inject this. |
| `DB_PATH` | **yes on a host** | `data/dining.db` | Must point at the mounted disk: `/data/dining.db`. |
| `SESSION_SECRET` | **yes in production** | — | Signs guest session cookies. |
| `STAFF_SESSION_SECRET` | **yes in production** | — | Signs staff session cookies. Must differ from the guest one. |
| `HOTEL_TZ` | no | `Europe/Moscow` | Timezone all ordering deadlines are judged in. |
| `VAT_PERCENT` | no | `20` | VAT extracted from the VAT-inclusive menu prices. |
| `DEMO_MODE` | no | `on` | `on` exposes `/api/demo-guest`, which hands out a seeded guest's login so a visitor can get in. **Correct for a portfolio demo. Must be `off` for a real hotel.** |
| `DEMO_RESET` | no | `off` | `on` wipes and re-seeds the database once a day. |
| `DEMO_RESET_HOUR` | no | `4` | Hour (hotel time) the reset runs. |
| `HOST_SLEEPS` | no | `off` | `on` shows visitors a cold-start notice. Set it only if your host actually sleeps. |
| `NODE_ENV` | — | — | Set to `production` by the Dockerfile. |

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Run it twice. Set them as **secrets** in the host's dashboard, not as plain
environment variables, and never in the repository. If either leaks, rotating
it is safe — it only invalidates open sessions.

---

## 4. Deploying

### Northflank (free, recommended)

1. New Project → **Service** → **Build from Git repository** → this repo.
2. Build type **Dockerfile**, path `/Dockerfile`.
3. Resources: 0.2 vCPU / 512 MB is enough.
4. **Add a persistent volume** — 1 GB, mount path `/data`. *Do not skip this.*
5. Networking: expose port `3000`, public.
6. Environment variables: everything from §3. Mark the two secrets as secret.
7. Health check: HTTP `GET /health`, port 3000.
8. Deploy.

### Koyeb (free, sleeps when idle)

1. Create Service → GitHub → this repo → builder **Dockerfile**.
2. Instance `free`, region of your choice.
3. **Volumes** → attach 1 GB at `/data`.
4. Health check: HTTP `/health` on port 3000.
5. Env vars from §3, plus `HOST_SLEEPS=on` so the cold start is explained.
6. Deploy.

### Fly.io (paid)

`fly.toml` is in the repo and already declares the volume, the health check
and single-instance operation.

```bash
fly launch --no-deploy                       # keeps the committed fly.toml
fly volume create dining_data --size 1 --region cdg
fly secrets set SESSION_SECRET=... STAFF_SESSION_SECRET=...
fly deploy
```

### Render (paid — Starter or above)

`render.yaml` is in the repo. Point a new Blueprint at it. It declares a 1 GB
disk at `/data` and generates both secrets automatically. It specifies the
**Starter** plan deliberately: on Free, Render gives no disk and the data
disappears on each deploy.

---

## 5. First boot

`scripts/start-production.js` runs before the port is bound and does three
things, in order:

1. **`assertSecrets()`** — fails immediately if the secrets are missing, so a
   misconfigured deploy dies at startup instead of serving broken sessions.
2. **`seedIfEmpty()`** — if the database is empty, it seeds the hotel: staff
   accounts, guests, and menus for the days around today. It also re-seeds if
   the seeded menus have run out, so a demo left alone for a month still has
   something on the menu instead of an empty page.
3. **`resetJob.start()`** — schedules the daily wipe if `DEMO_RESET=on`.

Existing data is never touched on restart. Only an empty database is seeded.

Seeded staff logins are printed in the deploy log on first boot. Change the
staff passwords immediately if the deployment is anything other than a demo.

---

## 6. Checking it actually worked

Run these against the live URL. The last one is the one that matters.

```bash
BASE=https://your-app.example.com

# 1. the server is up
curl -s $BASE/health
# {"ok":true,"time":"..."}

# 2. it knows how it is configured
curl -s $BASE/api/runtime
# {"demo":true,"paymentsSimulated":true,"hostSleeps":false,...}

# 3. the guest app loads
curl -s -o /dev/null -w '%{http_code}\n' $BASE/

# 4. the staff portal loads
curl -s -o /dev/null -w '%{http_code}\n' $BASE/staff-portal
```

Then, by hand:

5. Open the guest app, **Fill demo guest**, sign in, order a meal, pay with a
   test card, download the PDF receipt.
6. Open `/staff-portal`, sign in as reception, confirm the order is on the board.
7. **Redeploy the service. Sign in again. The order must still be there.**

Step 7 is the whole point. If the order is gone, the disk is not mounted, or
`DB_PATH` is not pointing at it. Nothing else in this document matters until
that check passes.

---

## 7. Things that are deliberately not here

- **Real payments.** The gateway in `src/services/payment-gateway.js` is
  simulated and labelled as such in the interface. A public demo must never be
  wired to a live payment provider.
- **A managed database.** Postgres would remove the disk requirement, but
  SQLite is the right size for one hotel, and swapping it out to make hosting
  easier would be solving the wrong problem. If this ever needs more than one
  instance, that is when it becomes Postgres.
- **Card data.** No column in the schema stores a card number, expiry or CVV —
  only the last four digits and an authorisation code. That is deliberate and
  should stay that way.

---

## 8. Local check before you push

```bash
npm test          # 52 tests
npm run seed
npm start
```

To rehearse the production path locally:

```bash
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") \
STAFF_SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") \
NODE_ENV=production DB_PATH=./data/prod-rehearsal.db \
npm run start:prod
```

If Docker is installed:

```bash
docker build -t in-room-dining .
docker run --rm -p 3000:3000 -v dining_data:/data \
  -e SESSION_SECRET=dev -e STAFF_SESSION_SECRET=dev2 \
  in-room-dining
```
