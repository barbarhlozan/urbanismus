// Draws a few buildings and trees as the Build menu draws them, and writes
// them as standalone SVG files next to this script (the browser tab's
// favicon.svg, and icons for whatever wants them).
//
//   node icons/make.js            Blue pen (npm run icons)
//   node icons/make.js 3          another colour scheme, numbered as in
//                                 src/theme.js (SCHEMES) and the Colours menu
//
// The drawing is the game's own, in headless Chrome: icons/make.html puts
// each icon where the menu puts it, so styles.css applies as in the game,
// and writes what it shows onto each line (the files need no stylesheet).
// To add an icon, add it to ICONS in make.html. Chrome is found as the
// perf tools find it (tools/perf/chrome.mjs: Playwright's Chrome for
// Testing, or $CHROME); the game is served by serve.py, started here if it
// isn't running.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, server } from '../tools/perf/chrome.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const scheme = process.argv[2] ?? 0;

const origin = await server();
const browser = await launch({ dpr: 1 });
try {
  await browser.send('Page.navigate', { url: `${origin}/icons/make.html?scheme=${encodeURIComponent(scheme)}` });
  let icons = null;
  for (let i = 0; i < 100 && !icons; i++) {
    icons = await browser.evaluate('window.icons ?? null').catch(() => null);
    if (!icons) await new Promise((r) => setTimeout(r, 100));
  }
  if (!icons) throw new Error('icons/make.html drew nothing (see it in the browser for why)');
  for (const [name, svg] of Object.entries(icons)) {
    writeFileSync(join(dir, `${name}.svg`), svg);
    console.log(`${name}.svg`);
  }
} finally {
  browser.close();
}
process.exit(0); // (serve.py, if started here, goes with it)
