# Translating the game

The game's words live in plain text files here, one per area:

- `ui.txt` – buttons, menus, hints, the reasons something can't be built
- `buildings.txt` – what everything that can be built is called, its few
  words in the Build menu and its sizes (keys explained at its top)

Each word has a **key** (what the code asks for, `t('stat.residents')`) on a
line of its own, and under it, indented, the word in each language:

```
stat.residents
  cs: Obyvatelé
  en: Residents
```

Czech is the original; the English stays as close to it as it can. Lines
starting with `#` are notes. Reload the game after editing; mistakes (a key
twice, an unknown language) are listed in the browser console, and
`node --test tests/` checks that every key has every language.

## Which language

The one picked in the game – on the opening cover the first time, then
with the language button in the menu at the top – remembered in this
browser; before that, the browser's own if the game has it; otherwise
English. To see the first time's question again, open the game with
`?ask-language` in the address. A word missing in one language shows in
English, then in Czech.

## Filling in

`{name}` is filled in by the game: `Otevřít obec {town}?`. Keep the same
`{…}` in every language.

For a number `{n}`, write the forms apart with `|`, the way the language
counts:

```
import.buildings
  cs: {n} budova | {n} budovy | {n} budov      # 1 | 2–4 | 5 and more
  en: {n} building | {n} buildings             # 1 | more
```

## A new language

Add it to `LANGUAGES` in `src/core/text.js` (and its plural forms to
`PLURALS`), then a line for it under each key.

## Not translated

Generated town and hill names stay Czech in every language.
