# Token cleanup – plan

Written 2026-11-19 for one Sonnet session. Goal: Claude reads less at the start of
every chat and finds fewer duplicates when it searches. Delete this file when done.

Ground rules: work on main, commit only your own changes (the user often has
uncommitted edits – `git status` first, never touch files you didn't change).
Anything git tracks can be deleted freely: history keeps it. Anything outside git
(worktrees, `.delta`, memory files) – list it and ask the user before deleting.

## 1. Duplicate copies of the repo (biggest win)

- `.delta/` (7 MB, a clone + worktree from 2026-11-14, remote `delta`, branch
  `free-placement`) is **not gitignored**, so Grep returns every hit twice.
  Check `free-placement` is merged into main (`git branch -r --merged main`),
  then ask the user and remove it; add `.delta/` to `.gitignore` either way.
- `.claude/worktrees/` – three clean, detached worktrees, 5 days old
  (`magical-heyrovsky`, `upbeat-moser`, `wonderful-wu`). If `git -C <wt> status`
  is clean and their commits are on main, `git worktree remove` each (ask first).

## 2. Memory (`~/.claude/projects/-Users-hlozanek-Projekty-urbanismus/memory/`)

`MEMORY.md` (5.5 kB) loads into every chat; the 40 files (100 kB) load when
recalled. Many are diaries ("Status 2026-10-22… Later that night…").

- Rewrite each note as **current state only**: what is true now, the rule, why.
  Drop dated progress logs, commit names, fps numbers from past benches.
  Target ≤ 1 kB per file; `perf-profiling` (7 kB), `night` (6 kB),
  `watercolour-branch` (5 kB), `story-tone`, `terrain-relief-attempts`, `sound`,
  `weather`, `houses`, `drawn-buildings`, `people-figures`, `webgl-migration` first.
- Delete notes that are finished history: `webgl-migration` (WebGL is the only
  renderer now – keep one line of its "how to apply" in `perf-profiling` if
  needed), `watercolour-branch` (the branch no longer exists – check
  `git branch -a`), anything "awaiting verdict" the user has since settled
  (ask the user in one list, don't guess).
- Merge overlaps: `hand-drawn-look` + `pen-sketch-decisions`; `fire-look` +
  `fire-response`; `vehicles-doodle` + `trains-lokalka`.
- `MEMORY.md`: one line per note, ≤ 80 characters after the link.

## 3. Docs that are done (`docs/`)

Nothing links to these and the work is finished – delete them (git keeps them):
`webgl-plan.md` (21 kB), `weather-plan.md`, `visual-review.md`,
`structures-review.md`. Before deleting, move any rule that still applies into
one line of the matching memory note or the README.
`free-placement-plan.md` (34 kB, linked from 11 places): ask the user whether
it's done; if so, replace it with a 10-line "how placement works" section in the
README and fix the links.

## 4. README and CLAUDE.md

`CLAUDE.md` says "read the README first", so every chat reads 22 kB.
- `## Controls` (lines 40–181, ~140 lines) is for players – move it to
  `docs/controls.md`, leave a 3-line summary.
- Change CLAUDE.md to "read `## Where things live` in the README when you need
  to find something", not the whole README.
- Add a short "Keeping it lean" section to CLAUDE.md (see below).

## 5. Labs at the root

13 experiment pages sit beside `index.html` (`bubbles-lab`, `clouds`, `deer`,
`drawn-lab`, `fields-lab`, `flames`, `house-lab`, `livestock`, `mist`, `rails`,
`shadows`, `slope-lab`, `smoke`, `sound`, `yard-lab`, `builder`, `gallery`).
List them for the user and ask which still matter; delete the rest, move the
kept ones to `labs/` (fix their relative paths to `src/`, `labs.css`, `serve.py`
routes if any). Check each still opens after the move.

## 6. Code comments

Comments are 28 % of the JS (580 kB of 2.07 MB). Don't strip them wholesale –
the header of `painter.js` is the API reference. Only remove:
- history in comments ("used to", "was", "now", "no longer", dates, "before
  the change"),
- comments that repeat the next line in words.
Do it in the 10 biggest files only (`src/render/painter.js`, `photo.js`,
`main.js`, `gl/objects.js`, `gl/geometry.js`, `renderer/networks.js`,
`renderer.js`, `config.js`, `renderer/terrain.js`, `gl/hatching.js`).
Run `npm test` after each file. No code changes, comments only.

## Keeping it lean (add to CLAUDE.md)

- Memory notes: current state, not a diary. Rewrite the note when things
  change; don't append "Update …". ≤ 1 kB.
- Plans in `docs/` are deleted when the work is done; the lasting rule goes
  into the README or a memory note in one line.
- Comments say why, never what changed – that's the commit's job.
- Commits: subject 1–3 words, body only when the why isn't obvious, ≤ 2 lines.
- Final messages: say what changed and what's left, a few lines, no recap of
  every step.

## Done when

`.delta` ignored/removed, worktrees gone, memory ≤ ~40 kB with MEMORY.md
≤ 3 kB, finished docs deleted, CLAUDE.md updated, labs sorted, `npm test`
passes, the game opens at `?testing`. One commit per section ("Lean memory"
is outside git – no commit), subjects one word to three.
