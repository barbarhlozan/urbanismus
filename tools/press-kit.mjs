// Saves every piece of press-kit.html (the twin church, houses, trees, chat
// bubbles, the village scene) to press/ as an SVG and a transparent PNG, in
// headless Chrome (tools/perf/chrome.mjs).
//
//   node tools/press-kit.mjs [query] [folder]   e.g. "scale=14&scheme=1" black
//
// The page's query sets the scale, pen weight, scheme and view; see the
// note at the top of press-kit.html. With a folder: press/<folder>/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, server } from './perf/chrome.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const query = process.argv[2] ?? '';
const OUT = join(ROOT, 'press', process.argv[3] ?? '');

const origin = await server(process.env.ORIGIN);
const b = await launch({ port: 9341, dpr: 1 });
try {
  await b.send('Page.navigate', { url: `${origin}/press-kit.html${query ? `?${query}` : ''}` });
  for (let i = 0; i < 100 && !(await b.evaluate('!!window.press').catch(() => false)); i++) await new Promise((r) => setTimeout(r, 200));
  const names = await b.evaluate('press.pieces');
  mkdirSync(OUT, { recursive: true });
  for (const name of names) {
    writeFileSync(join(OUT, `${name}.svg`), await b.evaluate(`press.svg(${JSON.stringify(name)})`));
    const png = await b.evaluate(`press.png(${JSON.stringify(name)})`);
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    console.log(name);
  }
} finally {
  b.close();
  process.exit(0);
}
