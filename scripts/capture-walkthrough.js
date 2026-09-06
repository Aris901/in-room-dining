'use strict';

/**
 * Captures the walkthrough the foundation document asks for:
 *
 *   guest orders -> the order hits the kitchen board -> reception records the
 *   cash -> the receipt downloads
 *
 * It drives the real application in a real browser and screenshots what
 * actually happens. Nothing here is mocked up, and the captions describe the
 * behaviour on screen rather than selling it.
 *
 *   node scripts/capture-walkthrough.js
 *
 * Writes docs/walkthrough.html — a self-contained page that plays the frames
 * back with captions, roughly sixty seconds end to end. It is a stand-in for
 * a screen recording, and says so on itself.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'walkthrough.html');
const PORT = 3921;
const DBG = 9381;
const VIEW = { width: 1280, height: 860 };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP
async function connect(wsUrl) {
  const sock = new WebSocket(wsUrl);
  await new Promise((r) => { sock.onopen = r; });
  let id = 1;
  const waiting = new Map();
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { const { resolve } = waiting.get(m.id); waiting.delete(m.id); resolve(m); }
  };
  const send = (method, params = {}) => new Promise((r) => {
    const n = id++; waiting.set(n, { resolve: r });
    sock.send(JSON.stringify({ id: n, method, params }));
  });
  const ev = async (fn, ...args) => {
    const r = await send('Runtime.evaluate', {
      expression: `(${fn})(${args.map((x) => JSON.stringify(x)).join(',')})`,
      awaitPromise: true, returnByValue: true,
    });
    if (r.result.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description || 'page error');
    }
    return r.result.result.value;
  };
  const shot = async () => (await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 })).result.data;
  return { send, ev, shot, close: () => sock.close() };
}

async function pageWs(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (r.ok) { const p = (await r.json()).find((t) => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; }
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not expose a page target');
}

// ---------------------------------------------------------------- main
(async () => {
  if (!CHROME) { console.error('Chrome not found'); process.exit(2); }

  process.env.NODE_ENV = 'development';
  process.env.PORT = String(PORT);
  process.env.DB_PATH = path.join(ROOT, 'data', 'walkthrough.db');
  process.env.DEMO_MODE = 'on';
  for (const f of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + f); } catch {}
  }

  const { seed } = require('../src/seed');
  seed({ quiet: true });
  const server = require('../server').listen(PORT);
  console.log(`server on ${PORT}, fresh database`);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${DBG}`, '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu',
    `--window-size=${VIEW.width},${VIEW.height}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });

  const frames = [];
  const add = async (cdp, caption, holdMs = 3400) => {
    await sleep(450);
    frames.push({ img: await cdp.shot(), caption, hold: holdMs });
    console.log(`  [${String(frames.length).padStart(2)}] ${caption}`);
  };

  let cdp;
  try {
    cdp = await connect(await pageWs(DBG));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });

    const goto = async (url, readySelector) => {
      await cdp.send('Page.navigate', { url });
      for (let i = 0; i < 100; i++) {
        const ok = await cdp.ev((s) => !!document.querySelector(s), readySelector);
        if (ok) break;
        await sleep(120);
      }
      await sleep(700);
    };

    const base = `http://127.0.0.1:${PORT}`;

    // ---- 1. the guest arrives ------------------------------------------
    await goto(`${base}/`, '#loginForm');
    await add(cdp, 'A guest opens the hotel’s in-room dining page.');

    await cdp.ev(async () => {
      const demo = await (await fetch('/api/demo-guest')).json();
      const f = document.getElementById('loginForm');
      for (const [k, v] of Object.entries(demo)) if (f.elements[k]) f.elements[k].value = v;
    });
    await add(cdp, 'Five fields from the reservation — name, room, phone, both dates. All five must match, or no menu appears.');

    await cdp.ev(() => document.getElementById('loginForm').requestSubmit());
    for (let i = 0; i < 80; i++) {
      if (await cdp.ev(() => !document.getElementById('view-menu').hidden
        && document.querySelectorAll('.meal').length > 0)) break;
      await sleep(150);
    }
    await add(cdp, 'Verified. Today’s menu, with the kitchen’s real deadlines on each meal.', 4200);

    // ---- 2. ordering ----------------------------------------------------
    const ADD = '.meal:not(.is-closed) .stepper button[aria-label="Add one"]:not([disabled])';
    let picked = null;
    for (let day = 0; day < 4 && !picked; day++) {
      if (day > 0) {
        // Nothing open at this hour — look at the next day of the stay.
        await cdp.ev(() => document.getElementById('nextDay').click());
        for (let i = 0; i < 60; i++) {
          if (await cdp.ev(() => document.querySelectorAll('.meal').length > 0)) break;
          await sleep(150);
        }
        await sleep(500);
      }
      picked = await cdp.ev((sel) => {
        const btn = document.querySelector(sel);
        if (!btn) return null;
        const card = btn.closest('.meal');
        const name = card.querySelector('.meal-name').textContent.trim();
        btn.click();
        const second = card.querySelectorAll(sel.replace('.meal:not(.is-closed) ', ''))[1];
        if (second) second.click();
        card.scrollIntoView({ block: 'center' });
        return { name, serviceDate: document.getElementById('datePicker').value };
      }, ADD);
    }
    if (!picked) throw new Error('no orderable meal in the next four days of the stay');
    const serviceDate = picked.serviceDate;
    await add(cdp, `Two dishes chosen from ${picked.name}. The total is built from prices held on the server, never sent by the browser.`, 4000);

    await cdp.ev(() => { document.getElementById('cart').scrollIntoView({ block: 'center' }); });
    await add(cdp, 'Net, VAT and total kept separate — because someone files the VAT at the end of the month.', 4200);

    // ---- 3. paying cash -------------------------------------------------
    await cdp.ev(() => document.getElementById('toPayment').click());
    await sleep(600);
    await cdp.ev(() => document.querySelector('.method[data-method="cash"]').click());
    await add(cdp, 'This guest pays cash at Reception. Card is the other option, with simulated test cards.', 4200);

    await cdp.ev(() => document.getElementById('confirmPay').click());
    for (let i = 0; i < 100; i++) {
      if (await cdp.ev(() => !document.getElementById('view-done').hidden)) break;
      await sleep(150);
    }
    let ref = '';
    for (let i = 0; i < 60; i++) {
      ref = await cdp.ev(() => document.getElementById('doneOrderId').textContent.trim());
      if (/^AG-/.test(ref)) break;
      await sleep(150);
    }
    if (!/^AG-/.test(ref)) throw new Error(`order reference never rendered (got "${ref}")`);
    await add(cdp, `Order ${ref} submitted — and held. Cash does not exist until a person touches it, so the kitchen has not started.`, 5000);

    // ---- 4. the staff side ---------------------------------------------
    await goto(`${base}/staff-portal`, '#staffLoginForm');
    await add(cdp, 'The other half most builders skip: the staff portal.');

    await cdp.ev(() => {
      const f = document.getElementById('staffLoginForm');
      f.elements.username.value = 'reception';
      f.elements.password.value = 'front1234';
      f.requestSubmit();
    });
    for (let i = 0; i < 100; i++) {
      if (await cdp.ev(() => {
        const b = document.getElementById('boardOrders');
        return !!b && b.children.length > 0;
      })) break;
      await sleep(150);
    }
    await sleep(600);
    await add(cdp, 'Reception signs in. Three roles exist, each with different powers — the chef edits menus and prices, the manager sees everything.', 4600);

    // The board opens on today. The order may be for tomorrow, so move it.
    await cdp.ev((d) => {
      const input = document.getElementById('boardDate');
      input.value = d;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, serviceDate);
    for (let i = 0; i < 80; i++) {
      if (await cdp.ev((r) => document.getElementById('boardOrders').textContent.includes(r), ref)) break;
      await sleep(150);
    }
    const onBoard = await cdp.ev((r) => document.getElementById('boardOrders').textContent.includes(r), ref);
    if (!onBoard) throw new Error(`order ${ref} never appeared on the board for ${serviceDate}`);
    await add(cdp, `Order ${ref} is on the board, marked awaiting payment. It is not in the kitchen queue yet.`, 4600);

    // ---- 5. reception records the cash ---------------------------------
    const settled = await cdp.ev(() => {
      const btn = [...document.querySelectorAll('#boardOrders button')]
        .find((b) => /mark cash received/i.test(b.textContent));
      if (!btn) return false;
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      return true;
    });
    if (!settled) throw new Error('the "Mark cash received" control was not on the board');
    await sleep(1800);
    const nowPaid = await cdp.ev((r) => {
      const row = [...document.querySelectorAll('#boardOrders tr, #boardOrders .order')]
        .find((e) => e.textContent.includes(r));
      return row ? !/awaiting/i.test(row.textContent) : false;
    }, ref);
    if (!nowPaid) throw new Error(`${ref} still reads as awaiting payment after settling`);
    await add(cdp, 'Reception records the cash. Only now does the order become paid and reach the kitchen.', 5000);

    // ---- 6. the paperwork ----------------------------------------------
    // The export bar belongs to one meal window, so pick the meal to reveal it.
    // Caption a screen only for what is actually on it.
    await cdp.ev(() => {
      // The meal windows are .window-tab buttons; "All meals" is the first.
      const tab = [...document.querySelectorAll('.window-tab')]
        .find((e) => /breakfast|lunch|dinner/i.test(e.textContent));
      if (tab) tab.click();
    });
    await sleep(1200);
    const exportShown = await cdp.ev(() => !!document.querySelector('.export-bar'));
    if (!exportShown) throw new Error('the export bar did not appear after selecting a meal');
    await add(cdp, 'And the paperwork. A receipt for the guest, and the service exported to Excel — so month-end is a download, not an evening.', 5200);

    console.log(`\ncaptured ${frames.length} frames`);
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  // ---------------------------------------------------------------- page
  const total = frames.reduce((n, f) => n + f.hold, 0);
  const html = buildPage(frames, total);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`wrote ${path.relative(ROOT, OUT)}  ${kb} KB  ~${Math.round(total / 1000)}s`);
})();

// ---------------------------------------------------------------- builder
function buildPage(frames, totalMs) {
  const data = JSON.stringify(frames.map((f) => ({ c: f.caption, h: f.hold })));
  const imgs = frames
    .map((f, i) => `<img class="fr" id="fr${i}" src="data:image/jpeg;base64,${f.img}" alt="">`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>In-Room Dining — a walkthrough</title>
<meta name="description" content="Sixty seconds of the In-Room Dining system: a guest orders, the order reaches the staff board, reception records the cash, the receipt downloads.">
<style>
  :root {
    --ink: #0b0a09; --panel: #141110; --line: rgba(247,241,237,.14);
    --text: #e0d3cb; --muted: #b8a69c; --accent: #c86b4a; --head: #f6ede8;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ink); color: var(--text);
    font-family: "Poppins", "Segoe UI", system-ui, sans-serif; line-height: 1.6;
  }
  .wrap { max-width: 1000px; margin: 0 auto; padding: clamp(1.2rem, 4vw, 2.5rem) clamp(1rem, 4vw, 2rem) 3rem; }
  header { margin-bottom: 1.4rem; }
  h1 { font-size: clamp(1.3rem, 4vw, 1.9rem); margin: 0 0 .4rem; color: var(--head); letter-spacing: -.01em; }
  .sub { margin: 0; color: var(--muted); font-size: .92rem; max-width: 62ch; }
  .note {
    display: inline-flex; align-items: center; gap: .5rem; margin-top: .9rem;
    padding: .45rem .8rem; border: 1px solid var(--line); border-radius: 999px;
    font-size: .76rem; color: var(--muted); background: rgba(247,241,237,.04);
  }
  .note b { color: var(--accent); font-weight: 700; }

  .stage {
    position: relative; border: 1px solid var(--line); border-radius: 14px;
    overflow: hidden; background: #000; aspect-ratio: ${VIEW.width} / ${VIEW.height};
  }
  .fr {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; opacity: 0; transition: opacity .45s ease;
  }
  .fr.on { opacity: 1; }

  .cap {
    margin: .9rem 0 0; min-height: 3.6em; color: var(--head);
    font-size: clamp(.95rem, 2.4vw, 1.08rem); max-width: 70ch;
  }

  .bar { display: flex; gap: 4px; margin-top: 1rem; }
  .seg { flex: 1; height: 3px; background: rgba(247,241,237,.16); border-radius: 2px; overflow: hidden; }
  .seg i { display: block; height: 100%; width: 0; background: var(--accent); }
  .seg.done i { width: 100%; }

  .controls { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; margin-top: 1.1rem; }
  button {
    font: inherit; font-size: .88rem; font-weight: 600; cursor: pointer;
    background: rgba(247,241,237,.06); color: var(--head);
    border: 1px solid var(--line); border-radius: 10px;
    padding: .55rem 1rem; min-height: 44px;
  }
  button:hover { border-color: var(--accent); }
  button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
  .count { color: var(--muted); font-size: .82rem; margin-left: auto; font-variant-numeric: tabular-nums; }
  :focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }

  footer { margin-top: 2rem; padding-top: 1.2rem; border-top: 1px solid var(--line); font-size: .84rem; color: var(--muted); }
  footer a { color: #e2926e; }
  @media (prefers-reduced-motion: reduce) { .fr { transition: none; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>In-Room Dining — sixty seconds</h1>
    <p class="sub">
      A guest orders. The order reaches the staff board. Reception records the cash,
      and only then does the kitchen start. Every frame below is the running
      application, captured from a real browser.
    </p>
    <p class="note"><b>Stand-in.</b> Captured frames with captions, not a screen recording — to be replaced by one.</p>
  </header>

  <div class="stage" id="stage">
${imgs}
  </div>

  <p class="cap" id="cap"></p>
  <div class="bar" id="bar"></div>

  <div class="controls">
    <button id="play" aria-pressed="true">Pause</button>
    <button id="prev">Back</button>
    <button id="next">Forward</button>
    <button id="restart">Restart</button>
    <span class="count" id="count"></span>
  </div>

  <footer>
    Built by Ariel Kalambay ·
    <a href="https://github.com/Aris901/in-room-dining">source</a> ·
    <a href="https://aris901.github.io/in-room-dining/">try the demo</a>
  </footer>
</div>

<script>
(function () {
  'use strict';
  var STEPS = ${data};
  var frames = [].slice.call(document.querySelectorAll('.fr'));
  var cap = document.getElementById('cap');
  var bar = document.getElementById('bar');
  var count = document.getElementById('count');
  var playBtn = document.getElementById('play');

  var segs = STEPS.map(function () {
    var s = document.createElement('span');
    s.className = 'seg';
    s.appendChild(document.createElement('i'));
    bar.appendChild(s);
    return s;
  });

  var i = 0, timer = null, playing = true;

  function show(n) {
    i = (n + STEPS.length) % STEPS.length;
    frames.forEach(function (f, k) { f.classList.toggle('on', k === i); });
    cap.textContent = STEPS[i].c;
    segs.forEach(function (s, k) {
      s.classList.toggle('done', k < i);
      s.firstChild.style.transition = 'none';
      s.firstChild.style.width = k === i ? '0' : '';
    });
    count.textContent = (i + 1) + ' / ' + STEPS.length;
    if (playing) {
      var fill = segs[i].firstChild;
      // next frame, so the transition is applied from a width of zero
      requestAnimationFrame(function () {
        fill.style.transition = 'width ' + STEPS[i].h + 'ms linear';
        fill.style.width = '100%';
      });
    }
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (!playing) return;
    timer = setTimeout(function () { show(i + 1); }, STEPS[i].h);
  }

  function setPlaying(on) {
    playing = on;
    playBtn.textContent = on ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-pressed', String(on));
    if (on) show(i); else clearTimeout(timer);
  }

  playBtn.addEventListener('click', function () { setPlaying(!playing); });
  document.getElementById('next').addEventListener('click', function () { setPlaying(false); show(i + 1); });
  document.getElementById('prev').addEventListener('click', function () { setPlaying(false); show(i - 1); });
  document.getElementById('restart').addEventListener('click', function () { setPlaying(true); show(0); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { setPlaying(false); show(i + 1); }
    if (e.key === 'ArrowLeft') { setPlaying(false); show(i - 1); }
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
  });

  show(0);
})();
</script>
</body>
</html>
`;
}
