'use strict';

/**
 * A ceiling on how many orders the database keeps.
 *
 * This exists because the deployed instance is open to strangers. The daily
 * reset already stops it filling up over weeks, but between resets a single
 * determined visitor could still make the kitchen board unusable, and on the
 * free tier the database is not somewhere to be careless with rows.
 *
 * Oldest first, by id — the column is AUTOINCREMENT, so it is monotonic and
 * indexed as the primary key. created_at is a text timestamp and would sort
 * lexically, which is correct for ISO-8601 but slower and easy to break.
 *
 * order_items is declared ON DELETE CASCADE and foreign keys are enabled in
 * db.js, so the lines go with the order. Nothing else references orders.
 */

const { config } = require('./config');
const { db } = require('./db');

const countOrders = db.prepare('SELECT COUNT(*) AS n FROM orders');
const deleteOldest = db.prepare(
  'DELETE FROM orders WHERE id IN (SELECT id FROM orders ORDER BY id ASC LIMIT ?)'
);

/**
 * Drops the oldest orders beyond the cap.
 *
 * Deliberately not inside the order-creation transaction: a failure to prune
 * must never roll back a guest's order. Losing the cap for one request is a
 * housekeeping problem; losing the order is the guest's problem.
 *
 * @returns {number} how many orders were removed
 */
function pruneOldOrders() {
  if (!config.maxOrders || config.maxOrders <= 0) return 0;

  const { n } = countOrders.get();
  if (n <= config.maxOrders) return 0;

  const excess = n - config.maxOrders;
  const info = deleteOldest.run(excess);
  return info.changes;
}

/** Never let housekeeping break a request that has already succeeded. */
function pruneQuietly() {
  try {
    const removed = pruneOldOrders();
    if (removed > 0) {
      console.log(`[cap] dropped ${removed} order(s) over the ${config.maxOrders} limit`);
    }
    return removed;
  } catch (err) {
    console.error('[cap] prune failed:', err.message);
    return 0;
  }
}

module.exports = { pruneOldOrders, pruneQuietly };
