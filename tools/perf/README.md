# Performance tests

How smoothly the map runs, measured in headless Chrome (Playwright's
"Chrome for Testing", `npx playwright install chromium` if it isn't there).
Nothing to install otherwise: Node 22 talks to Chrome directly.

The town is one saved to a file (Menu › Save to a file). It is seeded into a
fresh browser profile each run, so your own saved town is never touched. The
game is loaded from the dev server on port 8173 if it's running, or from a
`serve.py` the tools start on a port of their own.

```
node tools/perf/bench.mjs ~/Downloads/Pupíkov.urbanismus.json
```

It opens the town, waits until the view has its turned drawings ready, and
then measures:

| scenario | what happens |
|---|---|
| idle | nothing, 3 s |
| pan | the view swung left and right, 4 s |
| zoom, settle | zoomed out for 1.5 s, then 3 s while it redraws |
| unzoom, settle2 | the same, back in |
| turn | turned 20° by hand and let go |

For each: frames per second, the 95th-percentile and worst frame (ms), and
where the work went, in ms per second: the page's main thread (`main`), its
script, style, paint and garbage collection, and the raster workers drawing
the page's tiles (`raster`, the GPU side). For the turn, `behind` counts the
buildings and trees in sight not yet drawn at the angle the view has reached.
Then the memory: the JS heap, elements on the page and the turned drawings
kept off it.

Name variants after the town to switch one thing off first and see what it
costs (each runs in a fresh browser):

```
node tools/perf/bench.mjs town.json base noShadows noSway --only pan,zoom,settle
```

`base`, `noShadows`, `noSway`, `noAgents`, `noCanvases`, `noNight`,
`noClouds`, `noMeadow`, `noTrees`, `noBuildings`; `--setup '<js>'` runs your
own before measuring (`R` is the renderer), `--dpr 1` for a plain screen,
`--json` for the rows as data.

Which functions the time goes to:

```
node tools/perf/profile.mjs town.json --ms 3000 --step 'cam => cam.turnAt(innerWidth / 2, innerHeight / 2, Math.PI / 360)'
```

Numbers move by about ±20 % between runs; compare runs made one after the other.
