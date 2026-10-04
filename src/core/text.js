// The game's words in every language, from plain text dictionaries
// (text/*.txt, format in text/README.md):
//
//   hud.residents
//     cs: Obyvatelé
//     en: Residents
//
// The language: the one picked in the game (remembered in this browser),
// else the browser's own if the game has it, else English. A player who
// hasn't picked one is asked on the opening cover (needsLanguage). A word
// missing in the language shows in English, then in Czech, then as its key.
//
//   t('hud.residents')                 the word
//   t('hud.cutoff', { n: 3 })          {n} filled in; with 'a | b | c' the
//                                      plural form for n (cs: 1 | 2–4 | 5+,
//                                      en: 1 | more)
//   reasonText('Too steep')            a reason something can't be built
//                                      (world.js, routing.js), as reason.too-steep

export const LANGUAGES = { cs: 'Čeština', en: 'English' };
export const FALLBACK = 'en';
export const FILES = ['text/ui.txt', 'text/buildings.txt'];
const STORE_KEY = 'urbanismus.language';

// the plural forms written in a dictionary, in order (Intl.PluralRules names)
const PLURALS = { cs: ['one', 'few', 'other'], en: ['one', 'other'] };

const words = new Map(); // key -> { cs, en, … }
let lang = FALLBACK;
const warned = new Set();

export function pickLanguage() {
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch { /* storage unavailable */ }
  if (saved in LANGUAGES) return saved;
  for (const l of globalThis.navigator?.languages ?? []) {
    const code = l.toLowerCase().split('-')[0];
    if (code in LANGUAGES) return code;
  }
  return FALLBACK;
}

// Ask for the language on the opening cover? When none was ever picked in
// this browser, or with ?ask-language in the address (to try it out).
export function needsLanguage() {
  if (new URLSearchParams(globalThis.location?.search ?? '').has('ask-language')) return true;
  try { return !(localStorage.getItem(STORE_KEY) in LANGUAGES); } catch { return false; }
}

export function language() {
  return lang;
}

export function setLanguage(code) {
  lang = code in LANGUAGES ? code : FALLBACK;
  if (globalThis.document) document.documentElement.lang = lang;
}

// Remembered for the next load (what's on screen was written in the old one).
export function saveLanguage(code) {
  try { localStorage.setItem(STORE_KEY, code); } catch { /* storage unavailable */ }
}

// A dictionary's text -> { entries: Map(key -> { lang: text }), errors: [line: message] }
export function parseText(text, file = '') {
  const entries = new Map();
  const errors = [];
  let key = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trimEnd();
    const at = `${file}:${i + 1}`;
    if (!line.trim() || line.trim().startsWith('#')) return;
    if (!/^\s/.test(line)) {
      key = line.trim();
      if (entries.has(key)) errors.push(`${at}: ${key} is there twice`);
      entries.set(key, {});
      return;
    }
    const m = line.trim().match(/^([a-z]{2}):\s?(.*)$/);
    if (!m) return errors.push(`${at}: expected "cs: …" or "en: …"`);
    if (!key) return errors.push(`${at}: ${m[1]}: before any key`);
    if (!(m[1] in LANGUAGES)) return errors.push(`${at}: unknown language ${m[1]}`);
    entries.get(key)[m[1]] = m[2];
  });
  return { entries, errors };
}

export function addText(text, file) {
  const { entries, errors } = parseText(text, file);
  for (const [k, v] of entries) words.set(k, v);
  for (const e of errors) console.warn(e);
  return errors;
}

// Reads the dictionaries and sets the language (before any UI is built).
export async function loadText(files = FILES) {
  setLanguage(pickLanguage());
  await Promise.all(files.map(async (file) => {
    try {
      const res = await fetch(file, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      addText(await res.text(), file);
    } catch (err) {
      console.warn(`Could not read ${file}:`, err);
    }
  }));
}

export function hasText(key) {
  return words.has(key);
}

export function t(key, vars) {
  const entry = words.get(key);
  const used = [lang, FALLBACK, 'cs'].find((l) => entry?.[l] != null);
  let text = entry?.[used];
  if (text == null) {
    if (!warned.has(key)) console.warn(`No text for ${key}`);
    warned.add(key);
    return key;
  }
  if (!vars) return text;
  if (vars.n != null && text.includes('|')) {
    const forms = text.split('|').map((s) => s.trim());
    const order = PLURALS[used] ?? ['one', 'other'];
    const kind = new Intl.PluralRules(used).select(vars.n);
    text = forms[order.indexOf(kind)] ?? forms.at(-1);
  }
  return text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all));
}

// world.js and the routing give their reasons in English, as they always
// have (the tests read them): the words come from reason.<it-in-dashes>.
export function reasonText(reason) {
  if (!reason) return '';
  const key = `reason.${reason.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  return words.has(key) ? t(key) : reason;
}
