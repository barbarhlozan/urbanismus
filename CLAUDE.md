# Dědina – notes for Claude

A black-and-white isometric village builder: plain JS, no build step. The README says how
it's run and where things live; read it first.

## Running and checking the game

- `python3 serve.py`, then http://localhost:8173. Tests: `npm test` (Node 22+, no installs).
- **The game opens on the main menu** (`src/ui/mainMenu.js`). To go straight into the town
  when trying something out, take screenshots or drive it with Playwright, open it with
  **`?testing`**: http://localhost:8173/?testing (`?testing=0` leaves the menu on). With no
  save it then plays its new map at once, as before there was a menu.
- A reload in the same tab comes back where it was (sessionStorage `urbanismus.view`), past
  the menu: to see the menu again, open a new tab or clear sessionStorage.
- The language is asked on a first visit: set `localStorage['urbanismus.language'] = 'cs'`
  (or `'en'`) beforehand to skip the question.
- `window.cmd` in the console builds, erases and sets the time and weather (`cmd.help()`).

## The UI: one set of pieces, used everywhere

Build every box and control from the shared pieces rather than styling or animating it on
its own, so that a change in one place reaches the whole game:

- `src/ui/motion.js` – how boxes come and go (`reveal`, `slide`, `bump`…).
- `src/ui/sketchFrame.js` – the pen-drawn frames (main.js `sketchFrames`).
- `src/ui/penMarks.js` – what a control is doing, drawn in the pen: underlined when pointed
  at, crop marks in keyboard focus, pressed, `.choice` ticked when picked, `.toggle` boxed
  and crossed while on, struck through when it can't be used. Plain `<button>`s get these by
  themselves.
- `src/ui/sketchSlider.js` – the pen-drawn slider (New map, Settings).
- `styles.css`, section "Panels": `.panel`, `.panel-head`, `.panel-body`, `.panel-group`,
  `.setting-row` (`.field-name`, `.slot`, `.value`), `.choices`, `.panel-foot` – the New map
  dialog and Settings are built of them.
- Settings (`src/ui/settingsPanel.js`) is one panel, opened in the main menu and from the
  Menu's (≡) Nastavení in the town; add a setting there and it's in both.
- The UI's drawings are files in `icons/ui/` (see its README); words on screen are in
  `text/ui.txt`, Czech and English.

## Writing

- Comments and docs in the project's own voice: plain words about what the player sees,
  saying why, as the existing files do.
- Keep the README up to date with what changes for the player.
