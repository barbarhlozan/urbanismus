// Shortcuts go by where a key sits on the keyboard, not what it types: on
// a Czech layout the number row types ě š č… and Y and Z swap places.
// keyOf(e) names the key by its place on a US (QWERTY) keyboard, lowercase,
// which is how hotkeys are written ('q', '1', ',', '[').
//
// The Build menu takes two rows of keys at once: the number row picks a
// group (its tabs, GROUP_KEYS), and the letter rows pick a tool in the
// group that's open (slotKey: by where its tile sits) – so every tool has
// a key, however many a group holds. Kept out of the slots: P (photo),
// L (pause), and the keys the tool in hand uses (Tab, Space, Shift).

export const GROUP_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const LETTER_ROWS = ['qwertyuiop', 'asdfghjkl;', 'zxcvbnm,./'];
const KEPT = ['p', 'l'];

// The key of the i-th tile of a group laid out `cols` across, by where the
// tile sits: the tiles' rows in blocks of three, each block taking the next
// `cols` keys along the three letter rows – three across, q w e / a s d /
// z x c, then r t y / f g h / v b n… – so a tile's key lies on the keyboard
// as the tile lies in the menu. null for one that would take P or L, or
// runs off the keyboard.
export function slotKey(i, cols) {
  const row = Math.floor(i / cols);
  const key = LETTER_ROWS[row % 3][Math.floor(row / 3) * cols + (i % cols)];
  return key && !KEPT.includes(key) ? key : null;
}

const NAMED = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backquote: '`', Backslash: '\\', Minus: '-', Equal: '=',
  Space: ' ', Backspace: 'backspace', Delete: 'delete',
};

export function keyOf(e) {
  const c = e.code ?? '';
  if (c.startsWith('Key')) return c.slice(3).toLowerCase();
  if (c.startsWith('Digit')) return c.slice(5);
  return NAMED[c] ?? (e.key ?? '').toLowerCase();
}

// How a hotkey is shown on screen.
export function keyLabel(k) {
  return { backspace: '⌫', ' ': 'Space' }[k] ?? k.toUpperCase();
}
