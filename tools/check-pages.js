/* Does every page's script actually parse?
 *
 * This exists because two pages shipped with a syntax error in them and
 * nobody found out for weeks. /shopify-log and /shopify-undo each had a real
 * newline inside a string or a regex literal - a `\n` that lost its backslash
 * somewhere between an editor and a shell - and every page here keeps its
 * whole script in one block, so one bad character takes the page with it.
 *
 * Nothing crashes, nothing is logged on the server and the page still draws:
 * the HTML is fine, so you get the headings, the tabs, the buttons and the
 * words the markup was written with - "Loading…", "Waiting…" - frozen there
 * for ever. It looks exactly like a slow database. It is not.
 *
 * So: parse every inline script and every file in public/, and fail loudly.
 * Run with `npm run check`, and before pushing anything that touched a page.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public';
const files = readdirSync(DIR).filter(f => /\.(html|js)$/i.test(f)).sort();

let bad = 0;
let looked = 0;

for (const f of files) {
  const path = join(DIR, f);
  const text = readFileSync(path, 'utf8');

  // a .js file is one script; an .html file is however many it carries
  const blocks = f.endsWith('.js')
    ? [{ code: text, at: 1 }]
    : [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
        // a <script src=...> has nothing of its own in it
        .filter(m => m[1].trim())
        .map(m => ({
          code: m[1],
          at: text.slice(0, m.index).split('\n').length
        }));

  for (const b of blocks) {
    looked++;
    try {
      new Function(b.code);
    } catch (e) {
      bad++;
      console.error(`${path}:${b.at}  ${e.message}`);

      // Point at the line, not just the file. Growing the source a line at a
      // time and asking where it stops being parseable is rough, but for the
      // two mistakes this catches - an unterminated string, a regex broken
      // over two lines - it lands on the right one.
      const lines = b.code.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const one = lines[i];
        if (/\/\[[^\]/]*$/.test(one)) {
          console.error(`  line ${b.at + i}: a regex character class is left open`);
          console.error(`    ${one.trim()}`);
          break;
        }
        const noEsc = one.replace(/\\['"]/g, '');
        if (!/^\s*(\/\/|\*|\/\*)/.test(noEsc) &&
            ((noEsc.split("'").length - 1) % 2 === 1)) {
          console.error(`  line ${b.at + i}: a string is left open`);
          console.error(`    ${one.trim()}`);
          break;
        }
      }
    }
  }
}

console.log(`${looked} script block${looked === 1 ? '' : 's'} in ${files.length} files`);

if (bad) {
  console.error(`\n${bad} of them will not parse. Those pages are dead in the ` +
                `browser: the markup draws and nothing on it works.`);
  process.exit(1);
}

console.log('All of them parse.');
