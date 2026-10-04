// What buildings are called on screen (text/buildings.txt). A structure's
// own `name` stays what story/unlocks.txt and the code call it; the words
// shown are under keys made from it the way the unlock names are
// (Národní výbor -> narodni_vybor, Deep mine -> deep_mine):
//
//   <name>          the name, shared by its sizes
//   <id>.blurb      its few words in the Build menu, or else <name>.blurb
//   size.<size>     its size on the Size button (Wide -> size.wide)

import { t, hasText } from '../core/text.js';
import { normalName } from '../story/script.js';

const word = (key, fallback) => (hasText(key) ? t(key) : fallback);
const keyOf = (def) => normalName(def.name);

export const nameOf = (def) => word(keyOf(def), def.name);

export function blurbOf(def) {
  if (hasText(`${def.id}.blurb`)) return t(`${def.id}.blurb`);
  return word(`${keyOf(def)}.blurb`, def.blurb ?? '');
}

// its own size, else Small / Large by footprint
export function sizeOf(def) {
  const size = def.size ?? (def.footprint?.length > 1 ? 'Large' : 'Small');
  return word(`size.${normalName(size)}`, size);
}
