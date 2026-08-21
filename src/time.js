'use strict';

/**
 * Meal windows and deadline enforcement.
 *
 * Every calculation happens in the *hotel's* timezone, never the server's and
 * never the guest's browser. A guest in another timezone must still see the
 * same cutoff the kitchen works to, so all comparisons are done on instants
 * derived from hotel-local wall time.
 */

/**
 * Service windows and ordering deadlines.
 * `cutoff.dayOffset` is relative to the service date: -1 means "the day before".
 */
const MEALS = {
  breakfast: {
    key: 'breakfast',
    order: 1,
    serviceStart: '08:00',
    serviceEnd: '10:00',
    cutoff: { dayOffset: -1, time: '22:00' },
  },
  lunch: {
    key: 'lunch',
    order: 2,
    serviceStart: '13:00',
    serviceEnd: '15:00',
    cutoff: { dayOffset: 0, time: '11:00' },
  },
  dinner: {
    key: 'dinner',
    order: 3,
    serviceStart: '18:00',
    serviceEnd: '20:00',
    cutoff: { dayOffset: 0, time: '16:00' },
  },
};

const MEAL_KEYS = Object.keys(MEALS);

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

/** Offset (ms) between the given zone and UTC at that instant. */
function zoneOffsetMs(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(instant)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - instant.getTime();
}

/**
 * Convert a hotel-local wall-clock time into a real instant.
 * Applied twice so DST transitions resolve correctly (Moscow has no DST, but
 * the hotel timezone is configurable).
 */
function wallTimeToInstant({ year, month, day, hour = 0, minute = 0 }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ts = naive - zoneOffsetMs(new Date(naive), timeZone);
  ts = naive - zoneOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** Hotel-local calendar date + time for an instant. */
function hotelParts(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(instant)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** Today's date in the hotel's timezone, as YYYY-MM-DD. */
function hotelToday(timeZone, now = new Date()) {
  return hotelParts(now, timeZone).date;
}

// ---------------------------------------------------------------------------
// Date string helpers (YYYY-MM-DD, timezone-free calendar arithmetic)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

function parseDateString(value) {
  if (!isValidDateString(value)) throw new Error(`Invalid date: ${value}`);
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function addDays(dateString, days) {
  const { year, month, day } = parseDateString(dateString);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
function diffDays(a, b) {
  const pa = parseDateString(a);
  const pb = parseDateString(b);
  const ta = Date.UTC(pa.year, pa.month - 1, pa.day);
  const tb = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((tb - ta) / 86400000);
}

// ---------------------------------------------------------------------------
// Meal window logic
// ---------------------------------------------------------------------------

function parseHm(hm) {
  const [hour, minute] = hm.split(':').map(Number);
  return { hour, minute };
}

/** The instant ordering closes for a given service date + meal. */
function cutoffInstant(serviceDate, mealKey, timeZone) {
  const meal = MEALS[mealKey];
  if (!meal) throw new Error(`Unknown meal: ${mealKey}`);
  const cutoffDate = addDays(serviceDate, meal.cutoff.dayOffset);
  const { year, month, day } = parseDateString(cutoffDate);
  const { hour, minute } = parseHm(meal.cutoff.time);
  return wallTimeToInstant({ year, month, day, hour, minute }, timeZone);
}

/** The instant a meal's service window opens / closes. */
function serviceWindowInstants(serviceDate, mealKey, timeZone) {
  const meal = MEALS[mealKey];
  const { year, month, day } = parseDateString(serviceDate);
  const start = parseHm(meal.serviceStart);
  const end = parseHm(meal.serviceEnd);
  return {
    start: wallTimeToInstant({ year, month, day, ...start }, timeZone),
    end: wallTimeToInstant({ year, month, day, ...end }, timeZone),
  };
}

/**
 * Full ordering status for one meal on one date.
 *
 * `open` is the single source of truth the API and UI both use — the browser
 * never decides this for itself, it only renders what the server reports.
 */
function mealStatus(serviceDate, mealKey, timeZone, now = new Date()) {
  const meal = MEALS[mealKey];
  if (!meal) throw new Error(`Unknown meal: ${mealKey}`);

  const cutoffAt = cutoffInstant(serviceDate, mealKey, timeZone);
  const service = serviceWindowInstants(serviceDate, mealKey, timeZone);
  const msRemaining = cutoffAt.getTime() - now.getTime();

  let reason = null;
  if (msRemaining <= 0) {
    reason = now >= service.end ? 'service_finished' : 'cutoff_passed';
  }

  return {
    meal: mealKey,
    serviceDate,
    serviceStart: meal.serviceStart,
    serviceEnd: meal.serviceEnd,
    cutoffAt: cutoffAt.toISOString(),
    cutoffLabel: meal.cutoff.time,
    cutoffIsDayBefore: meal.cutoff.dayOffset < 0,
    serviceStartAt: service.start.toISOString(),
    serviceEndAt: service.end.toISOString(),
    open: msRemaining > 0,
    msRemaining: Math.max(0, msRemaining),
    reason,
  };
}

/** True when the meal's service window has fully elapsed (report is final). */
function serviceHasFinished(serviceDate, mealKey, timeZone, now = new Date()) {
  return now >= serviceWindowInstants(serviceDate, mealKey, timeZone).end;
}

module.exports = {
  MEALS,
  MEAL_KEYS,
  zoneOffsetMs,
  wallTimeToInstant,
  hotelParts,
  hotelToday,
  isValidDateString,
  parseDateString,
  addDays,
  diffDays,
  cutoffInstant,
  serviceWindowInstants,
  mealStatus,
  serviceHasFinished,
};
