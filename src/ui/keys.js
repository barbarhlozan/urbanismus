// Shortcuts go by where a key sits on the keyboard, not what it types: the
// build tools are laid out in rows (1–6, Q–T, A–G, Z–,), and on a Czech
// layout the number row types ě š č… and Y and Z swap places. keyOf(e)
// names the key by its place on a US (QWERTY) keyboard, lowercase, which is
// how hotkeys are written ('q', '1', ',', '[').

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
