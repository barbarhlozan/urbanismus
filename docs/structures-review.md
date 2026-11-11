# The larger structures: a review

Two rules to check every building against:

1. **It has a purpose in the town.** It's something the town needs at its
   size, or it does something in the game: jobs of a certain kind, goods
   the trucks carry, a line in the chronicle.
2. **It has a real model.** It's a kind of place that stood in Czech
   towns from the 50s to the 80s, ideally with a named example to draw
   from. If it can't be named ("a sawtooth hall", "tanks and pipes"),
   it's generic.

## The main cause of the generic look

Industry is four tools: Workshop, Works, Factory and Plant. Each one
**picks a random kind when placed** (`g.pick([...])` in
structures/industrial.js). The player asks for "a Factory" and gets a
glassworks, a mill or a nameless sawtooth hall. Some of those kinds are
specific and good. Others are filler (`'gable'`, `'long'`, `'vaulted'`,
`'sawtooth'`, `'vaults'`, `'chemical'`), and because the tool's name is
generic, the good ones read as generic too.

Proposal: **make every named kind its own thing to build**, with its
own name and blurb ("Sklárna", "Pila", "Cukrovar"), and drop the filler.
Fewer items overall, but each one is a decision.

## Industry, kind by kind

| Now | Verdict | Real model / note |
|---|---|---|
| Workshop L: sawmill | **Keep, as Pila** | Village sawmills by the stream, a gantry over the log yard. Could take logs from the woods. |
| Workshop L: gable / long | Cut | No model. |
| Workshop L: vaulted hall + office | **Make it STS** | Strojní a traktorová stanice (from 1949): arched machine halls, tractors in the yard. Belongs with the farms. |
| Factory: glassworks | **Keep, as Sklárna** | Kavalier in Sázava (lab glass), the Nový Bor glassworks. Fits the Sázava setting. |
| Factory: old brick mill | **Keep, as Textilka** | Multi-storey textile mills of northern and eastern Bohemia (Náchod, Liberec region). |
| Factory: sawtooth (×2 weight) | Merge into Textilka | Sawtooth roofs are the weaving sheds. Give them that job instead of being nameless. |
| Factory: two arched halls | Cut, or an engineering works | No model as it stands. |
| Plant: panel plant | **Keep, as Panelárna** | Every district had one (the Prefa works). Purpose: the town's panel blocks come from here. |
| Plant: coal power station | **Rethink** | Two cooling towers on 2×3 plots is far too small, and it only makes sense next to a coal mine (Mostecko, Ostravsko). Unlock it with the deep mine, or cut it. |
| Plant: lime works | **Keep, as Vápenka** | Bohemian Karst kilns (Koněprusy, Čertovy schody). Only near rock (rocks.js). |
| Plant: heating plant | **Keep, as Výtopna** | Heats the panel estate. Its purpose is tied to blocks being built. |
| Plant: chemical | **Replace with Cukrovar** | Nothing in it is specific. A sugar factory is the most Czech rural industry there is: tall chimney, beet heaps, a beet-washing channel, a short season. Takes beet from the JZD and state farm. Or a potato distillery (lihovar), also rural. |
| Plant: grain silos | **Merge with state farm** | It duplicates the silos of Státní statek, and the small grain silo too. |
| Works S: substation | Keep | Real and needed once the town grows. |
| Works S: dairy / bakery-dairy / bread works | **Merge** | Three overlapping kinds. Keep one Mlékárna (milk from the cows) and one Pekárna. |
| Works S: print works | Keep only with a model | A district print shop and newspaper. Otherwise cut. |
| Works S: arched depot shed | Cut | No model. |
| Workshop S: Benzina | **Keep, own item** | Very specific and loved. It belongs with the roads, not with industry. |
| Workshop S: car repair, smithy, plank shed | Keep the first two | Autoopravna and kovárna are real. The plank shed overlaps the joinery. |
| Plant S/M: brewery | Keep | The town brewery, iconic. |
| Plant S: waterworks | Keep | Purpose: water for the town once it has blocks. |
| Medium: builders' yard, ČSAD depot, joinery, Kovo co-op, dairy, heating plant | Mostly keep | ČSAD and Kovo are named and good. Check the overlap with the small kinds. |
| Mines (mine.js) | Keep | Already a real three-step story. |

## Shops and services

| Now | Verdict | Real model / note |
|---|---|---|
| **Tuzex** | **Cut as a building** | Tuzex shops (1957–92) were shopfronts in city centres, almost never a building of their own, and none in a town this size. Better as a ground-floor shop in the department store or a townhouse, or as a chronicle event ("Tuzex opened in the district town"). |
| **Hotel** (1×1, 8–10 floors) | **Replace** | A finned slab on a podium is an Interhotel: Prague, Brno, spa towns (Thermal in Karlovy Vary). A town like this has a **hotel on the square** (an older 2–3 storey house, "Hotel Slavie"-type), or a **ROH recreation centre** by a pond or in the woods. The Interhotel could stay only for a large town. |
| Hotel wide (Interhotel) | Keep for the largest towns only | |
| Department store (Prior) | Keep, large towns | Prior was the real chain. Kotva and Máj (Prague, 1975) for reference. |
| Národní výbor | Keep | MNV in every village, ONV in the district town. |
| KNV tower | **Cut or justify** | The regional seat is in the regional capital. The stepped tower with a spire is the Hotel International (Prague-Dejvice) look. |
| Jednota, hospoda, pošta | Keep | The heart of the village, all real. |
| Fire house, fire station, district fire station | Keep | Real tiers (zbrojnice, then a professional station). |
| Service centre (fire + doctors) | **Done: cut** | No real model. The fire station and the health centre stand on their own; old saves get the large fire station. |
| Health centre, polyclinic, hospital | Keep | Real tiers of OÚNZ care. |
| VB post, school, kulturní dům, koupaliště | Keep | |

## Then: purpose through small links

Once each building is a specific thing, a few links would give them
reasons to exist without becoming a production chain game:

- sawmill ← woods, cukrovar ← farms' beet, mlékárna ← cows
- power station ← deep mine, panelárna → panel blocks, výtopna → panel blocks
- vápenka needs rock nearby, waterworks needs a river or wells

Each link could just be a truck route and a chronicle line. No
economy is needed.

## Done (2026-10-08)

- Industry split into named works; filler kinds cut; Cukrovar, STS and ZZN
  added with a new Zemědělství tab; Benzina moved to Doprava.
- Service centre cut. Wide house: the two cubes cut.
- Space steps through a building's kinds in order.
- Tuzex cut (saves get a Jednota). The 1×1 hotel is now the hotel on the
  square: an old one under a mansard, or a 30s functionalist one; the
  Interhotel stays as the wide size.

## Suggested order

1. Split the industrial tools into named items and cut the filler (the
   biggest gain in "authored" feel).
2. Tuzex out, hotel on the square in, Interhotel and KNV for big towns only.
3. Add the cukrovar, with STS next to the farms.
4. Links, one at a time.
