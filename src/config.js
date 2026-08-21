'use strict';

/**
 * Central configuration. Everything that differs between the demo and a real
 * deployment lives here so nothing security-sensitive is hardcoded further in.
 */

const path = require('path');

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// A stable dev secret keeps sessions alive across restarts while developing.
// In production the app refuses to boot without a real one (see assertSecrets).
const DEV_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';

const config = {
  isProd,
  isTest,
  port: Number(process.env.PORT) || 3000,

  /**
   * Brute-force limits. Raised under `NODE_ENV=test` only, so the suite can
   * log in repeatedly without the protection itself becoming the failure —
   * the limits that ship are the ones in the first branch.
   */
  rateLimits: {
    guestLogin: isTest ? 10000 : 10,
    staffLogin: isTest ? 10000 : 8,
    orders: isTest ? 10000 : 20,
  },

  /** IANA zone the hotel operates in. All cutoffs are evaluated in this zone. */
  hotelTimeZone: process.env.HOTEL_TZ || 'Europe/Moscow',

  hotel: {
    name: 'Aurora Grand Hotel',
    // Fictional property used for this portfolio demo.
    address: 'Tverskaya Street 12, Moscow',
    phone: '+7 495 000-00-00',
  },

  currency: 'RUB',
  /** VAT applied to in-room dining, in percent. */
  vatPercent: Number(process.env.VAT_PERCENT ?? 20),

  sessionSecret: process.env.SESSION_SECRET || DEV_SECRET,
  staffSessionSecret: process.env.STAFF_SESSION_SECRET || DEV_SECRET + '-staff',

  /** Staff sessions are short-lived; guest sessions expire at check-out. */
  staffSessionHours: 8,

  paths: {
    root: path.join(__dirname, '..'),
    data: path.join(__dirname, '..', 'data'),
    db: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dining.db'),
    fonts: path.join(__dirname, '..', 'assets', 'fonts'),
    public: path.join(__dirname, '..', 'public'),
  },

  /**
   * Payments are SIMULATED. There is no gateway, no card data is ever stored,
   * and no money moves. Swapping in a real PSP means replacing
   * services/payment-gateway.js and nothing else.
   */
  paymentsAreSimulated: true,

  /**
   * Demo mode exposes conveniences that must never ship to a real property —
   * notably an endpoint that reveals a seeded guest's login details so a
   * reviewer can sign in. Set DEMO_MODE=off to disable.
   */
  isDemo: process.env.DEMO_MODE !== 'off',
};

/** Refuse to start in production with development secrets in place. */
function assertSecrets() {
  if (!config.isProd) return;
  const weak = [];
  if (!process.env.SESSION_SECRET) weak.push('SESSION_SECRET');
  if (!process.env.STAFF_SESSION_SECRET) weak.push('STAFF_SESSION_SECRET');
  if (weak.length) {
    throw new Error(
      `Refusing to start in production without: ${weak.join(', ')}. ` +
        'Set them to long random values.'
    );
  }
}

module.exports = { config, assertSecrets };
