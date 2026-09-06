'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { config, assertSecrets } = require('./src/config');
const guestRoutes = require('./src/routes/guest');
const staffRoutes = require('./src/routes/staff');

assertSecrets();

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

/**
 * Security headers. The CSP is strict: no inline script, no external origins.
 * Styles allow 'unsafe-inline' only because the Google Fonts stylesheet and a
 * handful of computed style attributes need it; scripts do not.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// --- API ------------------------------------------------------------------
app.use('/api', guestRoutes.router);
app.use('/api/staff', staffRoutes);

// --- Static + pages -------------------------------------------------------

/**
 * The staff portal lives on its own route and is never linked from the guest
 * app. Its HTML sits in views/, outside the static tree, so /staff-portal is
 * the only URL that serves it. The shell is only a shell in any case — every
 * piece of data behind it requires a staff session.
 */
app.get('/staff-portal', (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(config.paths.root, 'views', 'staff.html'));
});

app.use(
  express.static(config.paths.public, {
    index: 'index.html',
    // The staff shell is served only by the explicit route above.
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  })
);

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/**
 * Public runtime facts the UI needs before anyone signs in — chiefly whether
 * this host sleeps when idle, so the page can say so rather than leaving a
 * visitor staring at a cold start wondering if it is broken.
 */
app.get('/api/runtime', (req, res) => {
  res.json({
    demo: config.isDemo,
    paymentsSimulated: config.paymentsAreSimulated,
    hostSleeps: config.hostSleeps,
    resetsDaily: config.demoReset,
    resetHour: config.demoResetHour,
    timeZone: config.hotelTimeZone,
  });
});

// --- Errors ---------------------------------------------------------------

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not_found' });
  res.status(404).sendFile(path.join(config.paths.public, 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  const payload = { error: 'server_error' };
  if (!config.isProd) payload.detail = err.message;
  res.status(500).json(payload);
});

/**
 * Bind and report. Exported so the production entrypoint can seed the
 * database and start the reset scheduler before the first request lands.
 */
function start() {
  return app.listen(config.port, '0.0.0.0', () => {
    console.log(`\n  ${config.hotel.name} — In-Room Dining`);
    console.log(`  Listening     0.0.0.0:${config.port}`);
    console.log(`  Guest app     http://localhost:${config.port}/`);
    console.log(`  Staff portal  http://localhost:${config.port}/staff-portal`);
    console.log(`  Timezone      ${config.hotelTimeZone}`);
    console.log(`  Database      ${config.paths.db}`);
    if (config.paymentsAreSimulated) {
      console.log('  Payments      SIMULATED — no gateway, no real cards');
    }
    if (config.hostSleeps) {
      console.log('  Host          sleeps when idle (disclosed in the UI)');
    }
    console.log('');
  });
}

if (require.main === module) start();

module.exports = app;
module.exports.start = start;
