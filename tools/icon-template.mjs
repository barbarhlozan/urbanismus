// Writes the sheet for redrawing the UI's drawings by hand to
// drawings/icons/sablona.svg:
//   node tools/icon-template.mjs
// One cell for each file in icons/ui/ (the dev buttons' left out: they're
// temporary), in the README's groups. In each cell the file's box, its safe
// area an eighth in from the edge, and the drawing as it is now, all in pale
// blue; under the box a stroke of the pen that place draws its lines with,
// as wide as it comes out on screen at the size the drawing is shown there.
// Only dark ink inside a box becomes the drawing on import; the blue, the
// words and the pen samples under the boxes are left out.
// (Open the PNG in Procreate, draw on a layer above.)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// [file, where it's shown, px on screen, the pen there in px] (styles.css:
// .menu-art, .stat-icon, .opt-icon, .popup-icon, .setting-row .ctl-icon,
// .icon.sprite, the Build menu's --bar-h and --tile)
export const GROUPS = [
  ['Menu', [
    ['menu', 'tlačítko Menu, sbalené (≡)', 14, 1.3],
    ['menu-close', 'tlačítko Menu, rozbalené (×)', 14, 1.3],
    ['colors', 'Barvy (paleta, tři skvrny)', 22, 1.3],
    ['export', 'Uložit do souboru (šipka ven z krabice)', 22, 1.3],
    ['import', 'Otevřít ze souboru (šipka do krabice)', 22, 1.3],
    ['newmap', 'Nová mapa (prázdný list s plusem)', 22, 1.3],
    ['settings', 'Nastavení (tři posuvníky)', 22, 1.3],
    ['main-menu', 'Hlavní menu (titulní list, podtržené jméno)', 22, 1.3],
  ]],
  ['Vlevo nahoře', [
    ['rename', 'tužka u jména obce: přejmenovat', 13, 1.1],
    ['camera', 'fotografování, P (skicák a tužka); i na mapě', 19, 1.25],
    ['chronicle', 'kronika (teď se neukazuje)', 16, 1.1],
  ]],
  ['Nástroje a řádek Stavby', [
    ['rotate', 'otočit, Tab', 15, 1.1],
    ['bend-diagonal', 'ohyb čáry: napřed šikmo, Tab', 15, 1.1],
    ['bend-straight', 'ohyb čáry: napřed rovně, Tab', 15, 1.1],
    ['another-look', 'jiná podoba, mezerník; i na kartě budovy', 15, 1.1],
    ['undo', 'Zpět, ⌘Z', 15, 1.1],
    ['redo', 'Znovu', 15, 1.1],
    ['terrain', 'Terén (hřbet hor)', 16, 1.1],
  ]],
  ['Karta budovy', [
    ['erase', 'Zbourat (guma)', 22, 1.1],
    ['person', 'u počtu obyvatel (jeden z lidí)', 16, 1.1],
    ['yard', 'Okolí (plot a keř)', 22, 1.1],
    ['no-road', 'nevede k ní cesta', 16, 1.1],
  ]],
  ['Nová mapa', [
    ['dice', 'Jiné jméno (kostka, pět ok)', 18, 1.3],
    ['hills', 'Krajina (kopce)', 16, 1.1],
    ['lakes', 'Jezera', 16, 1.1],
    ['forest', 'Lesy', 16, 1.1],
    ['river', 'Řeka', 16, 1.1],
  ]],
  ['Rozhovor', [
    ['more', '› dál, když je věta dopsaná', 16, 1.3],
  ]],
  ['Teď jen v Nastavení', [
    ['fullscreen', 'celá obrazovka: dovnitř', 22, 1.3],
    ['fullscreen-exit', 'celá obrazovka: zpátky', 22, 1.3],
    ['sound', 'zvuk zapnutý (obecní amplion)', 22, 1.3],
    ['sound-off', 'zvuk vypnutý', 22, 1.3],
    ['lang-cs', 'Čeština (vlajka)', 22, 1.3],
    ['lang-en', 'English (vlajka)', 22, 1.3],
  ]],
  ['Záložky Stavby (země na čárkované čáře)', [
    ['tab-transport', 'Cesty (pěšina do trávy)', 28, 1.3],
    ['tab-housing', 'Bydlení (dům kostka)', 28, 1.3],
    ['tab-amenities', 'Občanská vybavenost (Jednota)', 28, 1.3],
    ['tab-work', 'Výroba (pilová střecha)', 28, 1.3],
    ['tab-farming', 'Zemědělství (kravín a silo)', 28, 1.3],
    ['tab-fields', 'Pole a pastviny (klasy)', 28, 1.3],
    ['tab-spaces', 'Prostranství (strom, keř)', 28, 1.3],
    ['tab-heritage', 'Památky (kaple)', 28, 1.3],
  ]],
  ['Dlaždice Stavby', [
    ['tool-street', 'Ulice', 38, 1.3],
    ['tool-road', 'Silnice', 38, 1.3],
    ['tool-lane', 'Úzká silnice', 38, 1.3],
    ['tool-path', 'Pěšina', 38, 1.3],
    ['tool-rail', 'Železnice', 38, 1.3],
    ['tool-fence', 'Ohrada', 38, 1.3],
    ['tool-wall', 'Zídka (u hřbitova)', 38, 1.3],
    ['tool-grain', 'Obilí', 38, 1.3],
    ['tool-potatoes', 'Brambory', 38, 1.3],
    ['tool-meadow', 'Louka', 38, 1.3],
    ['tool-erase', 'Vymazat (guma)', 38, 1.3],
  ]],
];

const BLUE = '#8cc4e6', M = 100, HEAD = 460, COLS = 8;
// a cell, and the box in it: the file's whole viewBox, B px on its longer side
const CW = 460, CH = 640, B = 360, BOX_TOP = 150;
export const CELL = { x0: M, y0: HEAD, w: CW, h: CH, cols: COLS, box: B, boxTop: BOX_TOP };
// a line of `px` on screen in a drawing shown `shown` px big, on the sheet
const onSheet = (px, shown) => Math.round((px * B) / shown);

const cells = GROUPS.flatMap(([group, items]) => items.map((it, i) => [group, i === 0, ...it]));
const rows = Math.ceil(cells.length / COLS);
const W = M * 2 + CW * COLS, H = HEAD + CH * rows + M;
const out = [];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, size = 30, extra = '') => out.push(`<text x="${x}" y="${y}" font-size="${size}" ${extra}>${esc(s)}</text>`);

out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
out.push(`<style>
text { font-family: -apple-system, Helvetica, sans-serif; fill: ${BLUE}; }
.g { fill: none; stroke: ${BLUE}; stroke-width: 3; } .d { stroke-dasharray: 14 12; } .thin { stroke-width: 2; }
.ghost { opacity: 0.55; }
.ghost * { fill: none; stroke: ${BLUE}; stroke-width: var(--w); stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.ghost [fill="currentColor"], .ghost .ink { fill: ${BLUE}; }
.ghost .p { fill: #fff; stroke: none; }
.ghost .h { stroke-width: var(--h); }
</style>`);
out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);

// the head (outside the cells, so not imported)
text(M, 110, 'Dědina · kresby v rozhraní', 64, 'font-weight="600"');
text(M, 170, 'Kresli černě na vrstvu nad šablonou, každou kresbu do jejího plného modrého čtverce. Při importu se bere jen tmavý inkoust uvnitř čtverce;', 30);
text(M, 212, 'modrá, popisky a vzorky pera pod čtverci se zahodí. Prázdný čtverec nechá ve hře kresbu, jaká je. Čárkovaný čtverec uvnitř je bezpečný okraj (osmina).', 30);
text(M, 254, 'Modře je kresba, jak je teď, tloušťkou čáry, jakou má na obrazovce. Černá čárka pod čtvercem je to pero ve velikosti, v jaké se kresba ukazuje:', 30);
text(M, 296, 'čím menší ve hře, tím silnější tu. Kresba se do hry vezme celá, jak je nakreslená, i s tloušťkou fixy – čáry slabší než vzorek se na obrazovce ztratí.', 30);
text(M, 338, 'Bez písmen. Záložky Stavby: budova zepředu, země na čárkované čáře. Jednotlivé tečky (okna, oka kostky) klidně plné.', 30);
text(M, 400, `${cells.length} kreseb · políčko ${CW}×${CH} px · čtverec ${B} px`, 26);

let lastGroup = null;
cells.forEach(([group, first, name, where, shown, pen], i) => {
  const col = i % COLS, row = Math.floor(i / COLS);
  const x = M + col * CW, y = HEAD + row * CH;
  const svg = readFileSync(new URL(`../icons/ui/${name}.svg`, import.meta.url), 'utf8');
  const [vx, vy, vw, vh] = svg.match(/viewBox="([^"]+)"/)[1].split(/[\s,]+/).map(Number);
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '');
  // the box: the viewBox, its longer side B, in the middle of the cell
  const k = B / Math.max(vw, vh), bw = vw * k, bh = vh * k;
  const bx = x + (CW - bw) / 2, by = y + BOX_TOP + (B - bh) / 2;

  out.push(`<rect class="g d thin" x="${x + 6}" y="${y + 6}" width="${CW - 12}" height="${CH - 12}" rx="10"/>`);
  if (group !== lastGroup) text(x + 26, y + 46, first ? group : `${group} (dál)`, 24, 'font-weight="600" letter-spacing="1"');
  lastGroup = group;
  text(x + 26, y + 88, name, 34, 'font-weight="600"');
  text(x + 26, y + 124, where.length > 40 ? where.slice(0, 39) + '…' : where, 22);
  out.push(`<rect class="g" x="${bx}" y="${by}" width="${bw}" height="${bh}"/>`);
  const inset = Math.min(bw, bh) / 8;
  out.push(`<rect class="g d thin" x="${bx + inset}" y="${by + inset}" width="${bw - 2 * inset}" height="${bh - 2 * inset}"/>`);
  if (name.startsWith('tab-')) out.push(`<line class="g d thin" x1="${bx}" y1="${by + 21 * k}" x2="${bx + bw}" y2="${by + 21 * k}"/>`);
  const w = onSheet(pen, shown);
  out.push(`<g class="ghost" style="--w:${w}px; --h:${onSheet(0.6, shown)}px" transform="translate(${bx} ${by}) scale(${k}) translate(${-vx} ${-vy})">${inner}</g>`);

  // the pen, under the box
  const sy = y + BOX_TOP + B + 52;
  out.push(`<line x1="${x + 40}" y1="${sy}" x2="${x + 170}" y2="${sy}" stroke="#111" stroke-width="${w}" stroke-linecap="round"/>`);
  text(x + 200, sy - 6, `pero ${w} px`, 24);
  text(x + 200, sy + 24, `ve hře ${shown} px, čára ${String(pen).replace('.', ',')} px`, 20);
});
out.push('</svg>');

mkdirSync(new URL('../drawings/icons/', import.meta.url), { recursive: true });
writeFileSync(new URL('../drawings/icons/sablona.svg', import.meta.url), out.join('\n'));
console.log(`drawings/icons/sablona.svg ${W}×${H}, ${cells.length} cells`);
