# The Menu's drawings

One drawing for each item of the Menu (≡, top right). The game reads these
files when it starts (`src/ui/menuIcons.js`), so replacing a file is all it
takes to change a drawing. A file that's missing or isn't an SVG leaves its
item the old drawing from `src/ui/icons.js`.

| file | item |
| --- | --- |
| `colors.svg` | Barvy / Colours – opens the colour schemes (an ink pot with three pens) |
| `export.svg` | Uložit do souboru / Save to a file (a sheet going into a desk drawer) |
| `import.svg` | Otevřít ze souboru / Open from a file (an opened document folder) |
| `newmap.svg` | Nová mapa / New map (a rolled survey plan) |
| `fullscreen.svg` | Celá obrazovka / Full screen (a big picture frame) |
| `fullscreen-exit.svg` | Leaving full screen again (the small picture back on its nail) |
| `lang-cs.svg` | switches to Czech (the Czech flag) – shown while the game is in English |
| `lang-en.svg` | switches to English (the Union Jack) – shown while the game is in Czech |

How to draw one:

- `viewBox="0 0 24 24"`; keep the drawing inside it, about 2 from the edge.
- Lines only, no fill: `fill="none"`, and `stroke="currentColor"` – required,
  it's how the drawing takes the colour scheme in use.
- Any `stroke-width` in the file is only for looking at the file on its own:
  in the game every line is drawn at the pen's weight (styles.css,
  `.menu-art`), so keep to plain lines, not filled shapes or thick strokes.
- Drawn by hand, in the map's pen: lines a little uneven, running a touch
  past the corners. Simple enough to read at 22 px.
- No text in the drawing: the item's name is shown beside it when it's
  pointed at or held.
