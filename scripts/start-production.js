'use strict';

/**
 * Production entrypoint.
 *
 * Between a fresh container and the first visitor there are three things to
 * settle, in this order:
 *
 *   1. the database exists and holds demo data, so someone arriving cold
 *      sees a working hotel rather than an empty menu;
 *   2. the daily reset is scheduled, so the demo does not fill with junk;
 *   3. the server binds.
 *
 * Doing this here rather than in server.js keeps `npm start` — and the test
 * suite, which imports the app — free of seeding side effects.
 */

const { config, assertSecrets } = require('../src/config');

// Fails fast, before binding a port, if production secrets are missing.
assertSecrets();

const resetJob = require('../src/reset-job');

console.log(`\n  Starting in ${config.isProd ? 'production' : 'development'} mode`);

// 1. seed on first boot, or when the seeded menus have run out
const seeded = resetJob.seedIfEmpty();
if (!seeded) console.log('  Database      existing data kept');

// 2. schedule the daily wipe (no-op unless DEMO_RESET=on)
resetJob.start();

// 3. bind
const server = require('../server').start();

/** Containers are stopped with SIGTERM; close cleanly so no request is cut. */
function shutdown(signal) {
  console.log(`\n[${signal}] shutting down`);
  resetJob.stop();
  server.close(() => process.exit(0));
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(0), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
