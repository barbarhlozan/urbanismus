// A Czech-sounding town name for a new map, picked from its seed: sometimes
// an adjective in front (Horní Lhota, Nové Město), sometimes a river or hill
// after (Kamenice nad Lipou). The player can rename the town from the HUD.

import { mulberry32 } from './random.js';

// [name, gender]: m, f, n or p (plural) – the adjective agrees with it
const ROOTS = [
  ['Lhota', 'f'], ['Lhotka', 'f'], ['Ves', 'f'], ['Kamenice', 'f'], ['Bystřice', 'f'],
  ['Lipnice', 'f'], ['Olešnice', 'f'], ['Březnice', 'f'], ['Jesenice', 'f'], ['Stráž', 'f'],
  ['Brod', 'm'], ['Hradec', 'm'], ['Újezd', 'm'], ['Dvůr', 'm'], ['Hrádek', 'm'],
  ['Sedlec', 'm'], ['Chlumec', 'm'], ['Týnec', 'm'], ['Kostelec', 'm'], ['Vranov', 'm'],
  ['Radostín', 'm'], ['Rudník', 'm'], ['Mlýnec', 'm'], ['Dubnov', 'm'], ['Habrov', 'm'],
  ['Mýto', 'n'], ['Město', 'n'], ['Sedlo', 'n'], ['Údolí', 'n'], ['Rovensko', 'n'],
  ['Petrovice', 'p'], ['Třebenice', 'p'], ['Lužany', 'p'], ['Dolany', 'p'], ['Kněžice', 'p'],
  ['Janovice', 'p'], ['Heřmanice', 'p'], ['Ořechovice', 'p'],
];

// too plain on their own: always get an adjective (Nové Město, Dolní Ves)
const PLAIN = new Set(['Ves', 'Dvůr', 'Mýto', 'Město', 'Sedlo', 'Údolí', 'Újezd']);

// soft adjectives are the same for every gender; hard ones take an ending
const SOFT = ['Horní', 'Dolní', 'Zadní', 'Přední'];
const HARD = ['Nov', 'Star', 'Velk', 'Mal', 'Česk', 'Dlouh'];
const ENDING = { m: 'ý', f: 'á', n: 'é', p: 'é' };

const AFTER = [
  'nad Sázavou', 'nad Orlicí', 'nad Lužnicí', 'nad Vltavou', 'nad Otavou', 'nad Jizerou',
  'pod Radhoštěm', 'pod Třemšínem', 'pod Blaníkem', 'pod Sněžkou', 'u Lesa', 'na Moravě',
];

export function townName(seed) {
  const rand = mulberry32(seed ^ 0x7a3c9);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const [root, gender] = pick(ROOTS);
  const r = rand();
  if (r < 0.4 || PLAIN.has(root)) {
    const adj = rand() < 0.5 ? pick(SOFT) : pick(HARD) + ENDING[gender];
    return `${adj} ${root}`;
  }
  if (r < 0.65) return `${root} ${pick(AFTER)}`;
  return root;
}
