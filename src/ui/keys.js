// Shortcuts go by where a key sits on the keyboard, not what it types: on
// a Czech layout the number row types ě š č… and Y and Z swap places.
// keyOf(e) names the key by its place on a US (QWERTY) keyboard, lowercase,
// which is how hotkeys are written ('q', '1', ',', '[').
//
// The Build menu takes two rows of keys at once: the number row picks a
// group (its tabs, GROUP_KEYS), and the letter rows pick a tool in the
// group that's open (its tiles in reading order, SLOT_KEYS) – so every tool
// has a key, however many a group holds. Kept out of the slots: P (photo),
// L (pause), and the keys the tool in hand uses (Tab, Space, Shift).

export const GROUP_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
export const SLOT_KEYS = [...'qwertyuio', ...'asdfghjk', ...'zxcvbnm', ',', '.', '/'];

const NAMED = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backquote: '`', Minus: '-', Equal: '=',
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
