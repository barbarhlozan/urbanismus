# Urbanismus

A little black-and-white isometric city builder. Plain JS, no build step.

## Running it

```
python3 serve.py
```

Then open http://localhost:8173. The city saves itself in the browser; **New map** starts over.

## Controls

- **Click a dot** – menu (build, road from here, remove)
- **R** roads, **F** footpaths – click start, click end; **Tab** flips the bend
- **1 2 3** – residential / business / industrial (**Tab** rotates, **C** tries another look)
- **4–9** – parks, squares, services
- **X** – demolish
- **V / Esc / right-click** – back to select
- **Drag / wheel** – pan / zoom, **Q / E** – rotate view
- **Space** – pause, **T** – speed

On a phone it's all taps: tap once to preview, tap again to confirm.

## How it works, roughly

- Buildings have three levels and grow on their own when their surroundings are right
  (enough neighbours, a park nearby, service coverage…). Click one to see what it's missing.
- Each building gets a random seed, so it always looks the same, but **C** / **Change look**
  rerolls it.
- People walk or drive, depending on distance. Roads that hit the map edge let people leave
  and visitors come in.
- The **Style** button (top right) has all the visual toggles: pixels, warp, CRT, glow…

## Where things live

- `structures/` – the buildings (one file per type, registered in `index.js`)
- `features/` – trees and other nature bits
- `src/config.js` – most of the numbers worth tweaking
- `src/theme.js` – colours
- `src/render/` – drawing (`painter.js` has the drawing API at the top)
- `src/sim/` – growth, people, parking
- `src/roads/`, `src/tools/`, `src/ui/` – what they say

**New building:** copy `structures/residential.js`, change the id/name/hotkey, and add it
to `structures/index.js`.
