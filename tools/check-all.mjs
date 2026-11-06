// Runs every check in this repository that needs nothing but the repository
// itself, and says plainly which passed and which did not.
//
// Left out on purpose: tools/hr-files-check.mjs, which reads a folder of the
// company's own spreadsheets that is deliberately not in this repository. Run
// it by hand: npm run check:hr-files -- <folder>
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const checks = [
  ['pages parse', 'tools/check-pages.js'],
  ['shared navigation', 'tools/navigation-check.mjs'],
  ['account passwords', 'tools/account-password-check.mjs'],
  ['banking access', 'tools/banking-access-check.mjs'],
  ['Daewoo portal', 'tools/daewoo-portal-check.mjs'],
  ['banking', 'tools/banking-check.mjs'],
  ['banking report', 'tools/banking-report-check.mjs'],
  ['banking setup', 'tools/banking-setup-check.mjs'],
  ['banking history', 'tools/banking-history-check.mjs'],
  ['banking sheets', 'tools/banking-sheets-check.mjs'],
  ['banking archive', 'tools/banking-archive-check.mjs'],
  ['banking schedule', 'tools/banking-schedule-check.mjs'],
  ['banking ui', 'tools/banking-ui-check.mjs'],
  ['internal messages', 'tools/messages-check.mjs'],
  ['M&P payments', 'tools/mnp-payments-check.mjs'],
  ['M&P store', 'tools/mnp-store-check.mjs'],
  ['PostEx audit', 'tools/postex-audit-check.mjs'],
  ['HR formulas', 'tools/hr-check.mjs'],
  ['compute meter', 'tools/compute-check.mjs'],
  ['relay body', 'tools/relay-body-check.mjs'],
  ['M&P settled', 'tools/mnp-settled-check.mjs'],
  ['Trax receipts', 'tools/trax-receipts-check.mjs'],
  ['M&P receipts', 'tools/mnp-receipts-check.mjs'],
];

const run = (file) => new Promise((done) => {
  const out = [];
  const kid = spawn(process.execPath, [path.join(root, file)], { cwd: root });
  kid.stdout.on('data', (d) => out.push(String(d)));
  kid.stderr.on('data', (d) => out.push(String(d)));
  kid.on('error', (e) => done({ code: 1, text: String(e.message) }));
  kid.on('close', (code) => done({ code, text: out.join('') }));
});

let failed = 0;
for (const [name, file] of checks) {
  const { code, text } = await run(file);
  if (code === 0) {
    console.log('ok   ' + name);
  } else {
    failed++;
    console.log('FAIL ' + name + '  (' + file + ')');
    console.log(text.trim().split('\n').map((l) => '     ' + l).join('\n'));
  }
}

console.log('');
console.log(failed === 0
  ? checks.length + ' checks passed. hr-files-check was not run: it needs the owner\'s own folder.'
  : failed + ' of ' + checks.length + ' checks failed.');
process.exit(failed === 0 ? 0 : 1);
