# Writing the story

The story lives in `story/story.txt`, a plain text file. It has **rules** that
watch the town, and **branches** of dialogue that the rules start. Reload the
game after editing it. Any mistakes are listed in the dialogue window when it
loads, with their line numbers.

A branch is told once per town. To hear it again, run `urbanismus.story.reset()`
in the browser console, or `urbanismus.story.play('IntroDialogue')` to tell one
straight away.

## Rules

```
if residential_house > 5 trigger IntroDialogue
```

Every couple of seconds the rules are checked in the order they're written.
The first one that holds, for a branch that hasn't been told yet, starts it.
While a branch is being told, the rules wait.

Conditions can use:

- numbers and the town's counts (below)
- `>` `<` `>=` `<=` `==` (or `=`) `!=`
- `and`, `or`, `not`, and brackets
- `+` `-` `*` `/`
- `seen(Branch)`, which is true once that branch has been told

```
if church >= 1 and not seen(Bells) trigger Bells
if (park + square) >= 3 or residents > 400 trigger Greenery
```

Names aren't case sensitive. `-`, `.` and spaces count as `_`, and an `_amount`
or `_count` on the end is ignored. So `residential_house_amount`,
`Residential.House` and `residential-house` all mean the same.

Put spaces around a minus: `residents - 5`. Written as `residents-5`, it reads as
one name.

### What you can count

| Name | What |
|---|---|
| `residential`, `business`, `industrial`, `park`, `square`, `services`, `church`, `chapel`, `station`, `mine`, `farm`, `cemetery`, `heritage`, … | how many there are, by type (as in `structures/`) or by tag |
| `residential_house`, `residential_apartments`, `residential_panel_block`, `park_green`, `mine_deep_mine`, … | how many at that level, by the level's name |
| `residents`, `jobs` | people living and working in town |
| `buildings` | everything built |
| `roads`, `lanes`, `streets`, `footpaths`, `railways` | how long, in dots |
| `bridges` | crossings over water |
| `trees` | trees and other nature on the map |
| `walking`, `cycling`, `driving`, `trains`, `buses` | out and about right now |
| `minutes` | how long the town has been running (game time) |
| `photos` | photographs taken |

Plus anything the story itself `set`s (see below). A name the story doesn't
know counts as 0, and is listed as a mistake when the game loads.

## Branches

```
::IntroDialogue::
Grandma: So in this village there were five houses and not much else.
The wind blows over the meadow.
> Ask about the geese -> Geese
> Say goodbye -> Goodbye
::
```

| Line | What it does |
|---|---|
| `::Name::` | starts a branch (a line of just `::` ends it; the next `::Name::` does too) |
| `Speaker: text` | a line of dialogue, with the speaker's name on top |
| `text` | narration, nobody speaking |
| `> text -> Branch` | a choice; choices one after another are offered together (`*` works too) |
| `-> Branch` | go on in another branch |
| `if condition -> Branch` | …only if the condition holds |
| `set name = value` | remember a number (`set asked = asked + 1`) for later conditions |
| `chronicle: text` | write a line in the town's chronicle (the book by the town's name) |
| `unlock name` / `lock name` | what may be built, and which buttons show (see below) |
| `scheme name` | switch the colour scheme (`scheme Night`) |
| `# …` | a comment |

`{name}` in any line is replaced by that number, and `{town}` by the town's
name: `{residents} people live in {town} now.`

Branches you reach with `->` or a choice count as told too, so `seen(Geese)`
is true once someone picked that choice.

The player clicks the dialogue window, or presses Enter, to go on. Choices
are picked with a click, or with ↑ ↓ and Enter. The town keeps going
underneath.

## What can be built

`story/unlocks.txt` says what's locked when a town starts. The story changes
it as it goes, with the same two commands inside a branch:

```
::Railway::
Station master: The line reaches {town} now.
unlock station
unlock railway
```

```
# story/unlocks.txt
lock all
unlock road
unlock footpath
unlock residential
lock residential_panel_block
```

Lines are read top to bottom (the file first, then whatever the story has
unlocked or locked so far), and the last one that matches wins. Anything not
locked is open. What the story changed is kept with the town.

| Name | What it covers |
|---|---|
| `all` | everything |
| `transport`, `zones`, `public`, `landmarks` | a whole Build menu group |
| `road`, `lane`, `footpath`, `railway` | the network tools (no footpath: no new streets either) |
| `residential`, `business`, `industrial`, `park`, `square`, `services` | the type in all its sizes and levels (the sizes share the name) |
| `residential_wide`, `park_large`, `industrial_small`, `square_large`, … | just that size |
| `station`, `station_main`, `stop`, `church`, `castle`, `bus_stop`, … | one type (the three railway stops are separate) |
| `heritage` | all the landmarks |
| `residential_panel_block`, `park_green`, `mine_deep_mine`, … | one level, by its name (or `residential_level3`) |
| `chronicle`, `photo`, `terrain`, `colors`, `assets`, `debug`, `export`, `import`, `new_map`, `fullscreen` | a button at the top (`controls`: all of them). `all` leaves them be. |
| `cars`, `trucks`, `buses` | traffic (`vehicles`: all three; `all` leaves them be). No cars: people walk, cycle or take the bus or train, nobody comes in by car, car parks stand empty. No trucks: no industry trucks or deliveries. No buses: none come. |

The file can also set the **colour scheme** the game starts in:

```
scheme Countryside
```

Use a name (`Blue pen`, `Black pen`, `Night`, `Countryside`), a number from 1,
`custom`, or three colours for background, main and detail
(`scheme #ebe7dd #3e12b6 #9b9486`). It's put on whenever the line changes. While
`colors` is locked it's put on every time. Otherwise a scheme the player picks
in the Colors menu stays.

A locked type or size isn't in the Build menu, can't be picked up with a
right-click, and isn't offered under **Turn into…**. Nothing grows into a
locked level, and it isn't offered as an **Upgrade**. Buildings already
standing are left as they are. A locked button is hidden (and its panel
closed); a locked chronicle still writes, so unlocking it later shows the
whole story so far. Erase can't be locked.

Mistakes (a name that isn't anything) are listed with the story's when the
game loads.

