'use strict';

const crypto = require('crypto');
const { config } = require('./config');
const { db } = require('./db');
const timeUtil = require('./time');

/**
 * Session tokens.
 *
 * A compact HMAC-signed token (payload.signature, both base64url). Nothing
 * secret lives in the payload — it is signed, not encrypted — so it carries
 * only identifiers the server re-validates against the database on every
 * request. Tampering with the room number invalidates the signature.
 */

const GUEST_COOKIE = 'guest_session';
const STAFF_COOKIE = 'staff_session';

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payload, secret) {
  const body = b64urlEncode(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number') return null;
  if (Date.now() >= payload.exp) return null;
  return payload;
}

// ---------------------------------------------------------------------------
// Guest identity
// ---------------------------------------------------------------------------

/** Phone numbers are compared on digits only, so formatting never blocks login. */
function normalisePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  // Russian numbers are written as both 8XXX and +7XXX for the same line.
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) {
    return '7' + digits.slice(1);
  }
  return digits;
}

/** Names are compared case- and spacing-insensitively, but must otherwise match. */
function normaliseName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normaliseRoom(value) {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * Verify all five login fields against an active stay.
 *
 * Every field must match; matching four of five is a failure. The same generic
 * error is returned for every kind of mismatch so the form cannot be used to
 * enumerate which room numbers or guest names exist.
 */
function findMatchingStay({ fullName, roomNumber, phone, checkIn, checkOut }, now = new Date()) {
  if (!timeUtil.isValidDateString(checkIn) || !timeUtil.isValidDateString(checkOut)) {
    return { ok: false, reason: 'invalid_dates' };
  }

  const today = timeUtil.hotelToday(config.hotelTimeZone, now);

  const candidates = db
    .prepare(
      `SELECT * FROM stays
        WHERE room_number = ? AND check_in = ? AND check_out = ? AND cancelled = 0`
    )
    .all(normaliseRoom(roomNumber), checkIn, checkOut);

  const wantedName = normaliseName(fullName);
  const wantedPhone = normalisePhone(phone);

  const stay = candidates.find(
    (row) =>
      normaliseName(row.full_name) === wantedName && row.phone_digits === wantedPhone
  );

  if (!stay) return { ok: false, reason: 'no_match' };

  // The stay must be current: not a future booking, not a past one.
  if (timeUtil.diffDays(today, stay.check_in) > 0) return { ok: false, reason: 'not_started' };
  if (timeUtil.diffDays(stay.check_out, today) > 0) return { ok: false, reason: 'ended' };

  return { ok: true, stay };
}

/** Session dies at the end of the guest's check-out day, in hotel time. */
function guestSessionExpiry(checkOutDate) {
  const { year, month, day } = timeUtil.parseDateString(checkOutDate);
  return timeUtil
    .wallTimeToInstant({ year, month, day, hour: 23, minute: 59 }, config.hotelTimeZone)
    .getTime();
}

function issueGuestToken(stay) {
  return sign(
    {
      sid: stay.id,
      room: stay.room_number,
      out: stay.check_out,
      exp: guestSessionExpiry(stay.check_out),
    },
    config.sessionSecret
  );
}

const cookieOptions = (maxAgeMs) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  maxAge: maxAgeMs,
  path: '/',
});

function setGuestCookie(res, token, payloadExp) {
  res.cookie(GUEST_COOKIE, token, cookieOptions(Math.max(0, payloadExp - Date.now())));
}

function clearGuestCookie(res) {
  res.clearCookie(GUEST_COOKIE, { path: '/' });
}

/**
 * Guest gate.
 *
 * A valid signature is necessary but not sufficient — the stay is re-read from
 * the database every request, so a cancelled or checked-out stay loses access
 * immediately rather than when the token happens to expire.
 */
function requireGuest(req, res, next) {
  const payload = verify(req.cookies?.[GUEST_COOKIE], config.sessionSecret);
  if (!payload) {
    clearGuestCookie(res);
    return res.status(401).json({ error: 'session_expired' });
  }

  const stay = db.prepare('SELECT * FROM stays WHERE id = ? AND cancelled = 0').get(payload.sid);
  if (!stay) {
    clearGuestCookie(res);
    return res.status(401).json({ error: 'session_expired' });
  }

  const today = timeUtil.hotelToday(config.hotelTimeZone);
  if (timeUtil.diffDays(stay.check_out, today) > 0) {
    clearGuestCookie(res);
    return res.status(401).json({ error: 'stay_ended' });
  }

  req.stay = stay;
  next();
}

// ---------------------------------------------------------------------------
// Staff identity
// ---------------------------------------------------------------------------

function issueStaffToken(user) {
  return sign(
    {
      uid: user.id,
      role: user.role,
      exp: Date.now() + config.staffSessionHours * 3600 * 1000,
    },
    config.staffSessionSecret
  );
}

function setStaffCookie(res, token) {
  res.cookie(STAFF_COOKIE, token, cookieOptions(config.staffSessionHours * 3600 * 1000));
}

function clearStaffCookie(res) {
  res.clearCookie(STAFF_COOKIE, { path: '/' });
}

function requireStaff(...allowedRoles) {
  return function staffGate(req, res, next) {
    const payload = verify(req.cookies?.[STAFF_COOKIE], config.staffSessionSecret);
    if (!payload) {
      clearStaffCookie(res);
      return res.status(401).json({ error: 'not_authenticated' });
    }

    const user = db.prepare('SELECT * FROM staff WHERE id = ?').get(payload.uid);
    if (!user) {
      clearStaffCookie(res);
      return res.status(401).json({ error: 'not_authenticated' });
    }

    // Role is re-read from the database, not trusted from the token, so a
    // demotion takes effect on the next request.
    if (allowedRoles.length && !allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    req.staff = user;
    next();
  };
}

module.exports = {
  GUEST_COOKIE,
  STAFF_COOKIE,
  sign,
  verify,
  normalisePhone,
  normaliseName,
  normaliseRoom,
  findMatchingStay,
  guestSessionExpiry,
  issueGuestToken,
  setGuestCookie,
  clearGuestCookie,
  requireGuest,
  issueStaffToken,
  setStaffCookie,
  clearStaffCookie,
  requireStaff,
};
