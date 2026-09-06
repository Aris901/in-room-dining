'use strict';

/**
 * Daily demo reset.
 *
 * A public demo fills with junk orders within days, so the data is wiped and
 * re-seeded on a schedule. This runs in-process so a deployment needs no
 * external scheduler; on a host that provides cron, leave DEMO_RESET off and
 * point a job at `npm run reset` instead.
 *
 * The hour is interpreted in the hotel's timezone, not the server's, so the
 * reset lands overnight for the property rather than wherever the container
 * happens to run.
 */

const { config } = require('./config');
const timeUtil = require('./time');
const { db, audit } = require('./db');
const { seed } = require('./seed');

/** Milliseconds until the next occurrence of `hour` in hotel-local time. */
function msUntilNextRun(hour, now = new Date()) {
  const parts = timeUtil.hotelParts(now, config.hotelTimeZone);

  let target = timeUtil.wallTimeToInstant(
    { year: parts.year, month: parts.month, day: parts.day, hour, minute: 0 },
    config.hotelTimeZone
  );

  // Already past today — aim at tomorrow.
  if (target.getTime() <= now.getTime()) {
    const next = timeUtil.parseDateString(timeUtil.addDays(parts.date, 1));
    target = timeUtil.wallTimeToInstant(
      { year: next.year, month: next.month, day: next.day, hour, minute: 0 },
      config.hotelTimeZone
    );
  }

  return target.getTime() - now.getTime();
}

function runReset(reason = 'scheduled') {
  const before = db.prepare('SELECT COUNT(*) n FROM orders').get().n;
  seed();
  audit('system', 'demo.reset', `${reason}: cleared ${before} order(s)`);
  console.log(`[reset] demo data re-seeded (${reason}, cleared ${before} orders)`);
}

/** Seed on first boot so a visitor arriving cold sees a working hotel. */
function seedIfEmpty() {
  const staffCount = db.prepare('SELECT COUNT(*) n FROM staff').get().n;
  const menuCount = db.prepare('SELECT COUNT(*) n FROM menus').get().n;

  if (staffCount === 0 || menuCount === 0) {
    console.log('[reset] empty database — seeding demo data');
    runReset('first boot');
    return true;
  }

  // The seed builds menus relative to the day it ran. If the newest published
  // menu is in the past, the demo would show an empty menu to every visitor.
  const latest = db.prepare('SELECT MAX(service_date) d FROM menus').get().d;
  const today = timeUtil.hotelToday(config.hotelTimeZone);
  if (latest && timeUtil.diffDays(today, latest) < 1) {
    console.log('[reset] seeded menus have run out — re-seeding');
    runReset('menus exhausted');
    return true;
  }

  return false;
}

let timer = null;

function start() {
  if (!config.demoReset) return null;

  const schedule = () => {
    const wait = msUntilNextRun(config.demoResetHour);
    timer = setTimeout(() => {
      try {
        runReset();
      } catch (err) {
        console.error('[reset] failed', err);
      }
      schedule();
    }, wait);
    // Do not hold the process open purely for the reset timer.
    if (timer.unref) timer.unref();

    const hours = (wait / 3600000).toFixed(1);
    console.log(`  Demo reset  daily at ${String(config.demoResetHour).padStart(2, '0')}:00 ${config.hotelTimeZone} (next in ${hours}h)`);
  };

  schedule();
  return timer;
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { msUntilNextRun, runReset, seedIfEmpty, start, stop };

// `npm run reset` — for hosts that provide their own cron.
if (require.main === module) {
  runReset('manual');
  process.exit(0);
}
