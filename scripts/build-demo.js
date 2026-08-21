'use strict';

/**
 * Builds the static browser demo in docs/.
 *
 * The demo reuses the *same* domain logic as the server: this script reads
 * src/time.js and src/money.js, strips their CommonJS export, and re-emits
 * them as browser globals. There is no second implementation of the deadline
 * or money rules to drift out of sync — the tested files are the only source.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const docs = path.join(root, 'docs');

const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const write = (rel, content) => {
  const target = path.join(docs, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};

/** Strip `'use strict'` and the trailing module.exports block. */
function toBrowserGlobal(source, globalName) {
  const withoutExports = source
    .replace(/^'use strict';\s*/m, '')
    .replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/m, '');

  // Recover the exported names so the global exposes the same surface.
  const exportBlock = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
  if (!exportBlock) throw new Error(`no module.exports found for ${globalName}`);
  const names = exportBlock[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(':')[0].trim());

  return `/* AUTO-GENERATED from src/${globalName === 'DiningTime' ? 'time' : 'money'}.js — do not edit.
   Regenerate with: npm run build:demo */
window.${globalName} = (function () {
  'use strict';
${withoutExports}
  return { ${names.join(', ')} };
})();
`;
}

fs.rmSync(docs, { recursive: true, force: true });
fs.mkdirSync(docs, { recursive: true });

// ---- shared domain logic -------------------------------------------------
write('js/domain/time.js', toBrowserGlobal(read('src', 'time.js'), 'DiningTime'));
write('js/domain/money.js', toBrowserGlobal(read('src', 'money.js'), 'DiningMoney'));

// ---- assets carried over verbatim ---------------------------------------
// app.js and staff.js are copied unchanged: the demo works by patching fetch,
// not by forking the front end.
const VERBATIM = [
  'css/app.css',
  'css/staff.css',
  'js/i18n.js',
  'js/app.js',
  'js/staff.js',
  'js/demo/store.js',
  'js/demo/api.js',
  'js/demo/documents.js',
  'js/demo/xlsx.js',
];
for (const rel of VERBATIM) write(rel, read('public', rel));

// ---- HTML shells ---------------------------------------------------------
// Both pages load the demo runtime *before* the app, so window.fetch is
// already patched by the time the app makes its first call.
const DEMO_SCRIPTS = `<script src="js/domain/time.js"></script>
<script src="js/domain/money.js"></script>
<script src="js/demo/store.js"></script>
<script src="js/demo/documents.js"></script>
<script src="js/demo/xlsx.js"></script>
<script src="js/demo/api.js"></script>`;

const DEMO_BANNER = `<div class="demo-ribbon" role="note">
  <strong>Browser demo</strong> · runs entirely on this page — no server, no real payments ·
  <a href="https://github.com/Aris901/in-room-dining" target="_blank" rel="noopener">full-stack source</a>
  · <a href="staff.html">staff portal</a>
  · <button type="button" id="demoReset">reset demo</button>
</div>`;

let guest = read('public', 'index.html');
guest = guest
  .replace(/<div class="demo-ribbon"[\s\S]*?<\/div>/, DEMO_BANNER)
  .replace(/href="\/css\//g, 'href="css/')
  .replace(/src="\/js\//g, 'src="js/')
  .replace('<script src="js/i18n.js"></script>', `${DEMO_SCRIPTS}\n<script src="js/i18n.js"></script>`);
write('index.html', guest);

let staff = read('views', 'staff.html');
staff = staff
  .replace(/href="\/css\//g, 'href="css/')
  .replace(/src="\/js\//g, 'src="js/')
  .replace('<body class="staff">', `<body class="staff">\n${DEMO_BANNER}`)
  .replace('<script src="js/staff.js"></script>', `${DEMO_SCRIPTS}\n<script src="js/staff.js"></script>`)
  // The demo has no server route, so the portal is a plain page here.
  .replace('href="/staff-portal"', 'href="staff.html"');
write('staff.html', staff);

// ---- Pages needs this so /js/domain/ etc. are served as-is ---------------
write('.nojekyll', '');

console.log('Built docs/ demo:');
for (const f of ['index.html', 'staff.html', 'js/domain/time.js', 'js/domain/money.js']) {
  console.log(`  ${f}  ${(fs.statSync(path.join(docs, f)).size / 1024).toFixed(1)} KB`);
}
