// Gameplay and engine tunables. No logic here.

export const CONFIG = {
  // shown in the corner of the screen
  app: { name: 'Urbanismus', version: '0.2', author: 'mlozanek' },

  grid: { width: 70, height: 70 },

  // null = random seed for each new map
  seed: null,

  camera: {
    tile: 34,        // scene px per grid step
    zScale: 0.9,     // vertical exaggeration of heights
    zoom: 2.2,       // starting zoom: close enough for the drawings to read
    minZoom: 0.6,    // further out the linework turns to mush
    maxZoom: 4,
  },

  render: {
    // Detail levels by zoom: below `medium` small details hide (facade lines,
    // fences, props, paving patterns); below `far` lots and parked cars hide too.
    lod: { medium: 0.9, far: 0.55 },
    // Forest trees are drawn plainer further out (smoother crown outlines,
    // see features/trees.js): below `medium` a little, below `far` more.
    trees: { medium: 1.5, far: 0.9 },
  },

  road: {
    cornerRadius: 0.5, // fraction of the shorter adjoining segment (max 0.5)
    curveSamples: 8,
    edge: 0.088,       // roads are drawn as two edge lines this far from the centre
                       // (cars keep sim.laneOffset right of it; lots stop at ROAD_GAP in render/lots.js)
    kerb: 0.154,       // streets (roads with sidewalks): kerb lines this far from the centre
    junctionRadius: 0.15, // cars round junction turns this much (same scale as cornerRadius)
  },

  // Single-track lanes: road segments (world.lanes) one car wide – people
  // walk and cycle on them as on a footpath. A footpath drawn beside one
  // becomes a sidewalk on that side only.
  lane: {
    edge: 0.05,        // edge lines this far from the centre
    kerb: 0.116,       // a sidewalk (on one side or both, world.laneWalks): its kerb this far out
    taper: 0.3,        // where a lane meets a wider road, its edges widen over this length
    speed: 0.55,       // cars go this share of their speed on a lane…
    laneOffset: 0.012, // …near the middle (they squeeze past oncoming ones)
    walkCost: 1.1,     // walking along a lane counts as this much longer than a footpath
  },

  path: {
    cornerRadius: 0.5,
    curveSamples: 6,
    edge: 0.035,          // footpaths are drawn as two edge lines this far from the centre
    junctionRadius: 0.12, // people round turns at junctions this much
  },

  // Railways: on the dense grid, bends of at most 45° per dot (sharper
  // ones can't be built), smoothed along each run (World.railPos), level
  // crossings with roads.
  rail: {
    cornerRadius: 0.5,
    curveSamples: 10,
    gauge: 0.04,         // trains keep this far right of the centre line
  },

  // Trains come in through railways that run off the map edge, stop at the
  // stations they pass and leave through another exit (or turn round at a
  // station when there is no other way out).
  trains: {
    interval: 85,       // seconds between arrivals through one exit
    max: 3,             // trains on the map at once
    speed: 0.9,         // grid steps per second at full speed
    accel: 0.15,        // grid steps per second² (braking too)
    dwell: 17,          // seconds stopped at a station
    maxStops: 3,        // stations visited per run
    carSpacing: 0.46,   // grid steps between carriages (a carriage is drawn a bit shorter)
    lengths: { short: 2, medium: 4, long: 6 }, // carriages, picked at random
    lookAhead: 0.6,     // keep this far behind another train
  },

  // Level crossings: wherever a road, street or footpath crosses a railway.
  // A crossing closes while a train is within `approach` of it (ahead) until
  // its tail is `clear` past; cars, cyclists and pedestrians wait and queue.
  crossing: {
    approach: 1.8,
    clear: 0.3,
    gap: { drive: 0.3, cycle: 0.22, walk: 0.18 },   // stop this far before the line…
    queue: { drive: 0.17, cycle: 0.09, walk: 0.07 }, // …and this far behind the one in front
  },

  // canoes down the rivers and streams (sim/boats.js)
  boats: {
    first: 20,           // seconds before the first group
    interval: [60, 150], // seconds between groups, at random
    group: [1, 5],       // canoes in a group (fewer more likely)
    max: 12,             // on the map at once
    speed: 0.16,         // grid steps per second, about
    gap: 0.4,            // grid steps between canoes in a group, about
    pair: 0.65,          // share of canoes with two aboard (else one, at the back)
    switch: 3,           // seconds between paddlers switching sides, about
    fromHome: 0.35,      // share of launches by a house near the water (when there is one)…
    homeReach: 3,        // …a house within this many grid steps of the river's line
    homeGroup: 2,        // …and at most this many canoes from there
  },

  // deer out of the forests to graze (sim/deer.js)
  deer: {
    first: 15,           // seconds before the first herd
    interval: [40, 120], // seconds between herds, at random
    herd: [1, 4],        // deer in a herd (fewer more likely)
    max: 10,             // on the map at once
    forest: 12,          // trees a map needs before any come
    reach: 8,            // grid steps from the trees they'll go to graze
    graze: [40, 110],    // seconds they graze, at random
    roam: 0.4,           // grid steps they shuffle about while grazing
    speed: 0.16,         // grid steps per second, walking
    run: 0.7,            // …and running off
    gap: 0.35,           // grid steps between deer walking in file
    shy: 1.5,            // grid steps: anyone this near sends them off
    red: 0.3,            // share of herds that are red deer (else roe)
    male: 0.35,          // share of herds led by a stag / buck
    fawn: 0.5,           // share of herds of 2+ with a fawn
  },

  // fences (the 'fence' network, render/renderer.js), drawn as the garden
  // fences are (structures/kit.js fenceAlong): a rail along the top, short
  // posts close together; heights as the map's (a walker is about 0.08)
  fence: {
    cornerRadius: 0,     // (straight runs, sharp corners)
    curveSamples: 1,
    post: 0.06,          // as high as a garden fence
    rails: [0.06],       // heights of the rails: one, along the top
    spacing: 0.1,        // grid steps between posts, about
    gate: 0.07,          // grid steps from a gate's middle to its pillars, either side of the footpath through it
  },

  // cows and sheep in fenced pastures (sim/livestock.js)
  livestock: {
    steep: 6,                       // average slope (World.slopeAt) from which a pasture keeps sheep, below it cows
    area: { cow: 3, sheep: 1.5 },   // grid squares of pasture per head
    most: 16,                       // in one pasture at most
    speed: { cow: 0.1, sheep: 0.13 }, // grid steps per second, wandering
    wander: 1.2,                    // grid steps they wander at a time, at most
    room: 0.3,                      // grid steps they keep from each other
    lie: [30, 90],                  // seconds lying down, at random
  },

  growth: {
    interval: 6,               // simulated seconds between checks
    // A church appears by itself now and then (chance per check) where at
    // least minHomes homes are within radius and no church within spacing.
    church: { chance: 0.03, minHomes: 14, radius: 4, spacing: 9 },
  },

  terrain: {
    riverChance: 0.6,     // share of maps with a river across them
    riverSize: null,      // 'river' or 'stream' (terrain/rivers.js), null: either, at random
    tributaries: 0,       // streams running into it from the map's edges (generate.js)
    meander: [2.2, 0.7],  // grid steps the river swings to the sides: wide bends, small wiggles
    lakes: [1, 3],        // wanted per map, picked at random; fewer when the land has no hollows for them
    lakeSize: [8, 60],    // nodes: smaller hollows stay dry, bigger ones are only partly filled
    treeDensity: 3,       // 0 disables trees
    forestThreshold: 0.58, // forest noise above this grows trees: lower, more woodland
    clearRadius: 5,     // keep the map centre free for the player
  },

  // Too steep to build on (metres of rise per grid step): buildings where
  // the ground under any of their dots is steeper than `build` (not parks,
  // `anySlope`); roads and railways where a segment climbs more than
  // `road` / `rail` per grid step of its length, measured at its steepest
  // along the way (World.grade) – so a road may still run across a steep
  // hillside, just not straight up it. Footpaths go anywhere (steps);
  // bridges are level. 14 for roads: about three contour lines a step; on
  // a Hilly map that leaves out roughly one stretch in sixteen. Lanes
  // (narrow, slow) may climb steeper, `lane`.
  steep: { build: 14, road: 14, lane: 16, rail: 8 },

  // Weather: one for the whole map, moving one step at a time along `kinds`
  // (fair never turns to rain without clouds first). How long each lasts, in
  // simulated seconds [shortest, longest]; src/sim/weather.js.
  weather: {
    kinds: ['fair', 'cloudy', 'overcast', 'rain', 'storm'],
    start: 'cloudy',
    // what can follow each kind, and how likely (the weights are shares) –
    // mostly cloudy, now and then clearing up or clouding over into rain,
    // a storm only out of rain. Over a long time this comes to roughly
    // cloudy 50 %, fair 19 %, overcast 15 %, rain 14 %, storm 2 %.
    next: {
      fair: { cloudy: 1 },
      cloudy: { fair: 0.45, overcast: 0.55 },
      overcast: { cloudy: 0.5, rain: 0.5 },
      rain: { overcast: 0.5, cloudy: 0.2, storm: 0.3 },
      storm: { rain: 1 },
    },
    lasts: { fair: [400, 900], cloudy: [500, 1100], overcast: [150, 400], rain: [240, 540], storm: [120, 260] },
    // how much the sun shades the walls turned away from it (1 full, 0 none):
    // under a grey sky there is little to tell one side from the other
    sun: { fair: 1, cloudy: 1, overcast: 0.25, rain: 0.2, storm: 0.15 },
    // how hard it rains (render/rain.js: 1 = rain)
    rain: { rain: 1, storm: 2.4 },
    // the grey sky's shade over the whole map (styles.css #gloom): the detail
    // colour laid over it at this opacity
    gloom: { overcast: 0.3, rain: 0.2, storm: 0.4 },
    // the wind in the trees (Renderer.swayTrees): how far a tree's top leans,
    // as a share of its height
    wind: { fair: 0.025, cloudy: 0.045, overcast: 0.05, rain: 0.07, storm: 0.14 },
    // what people do in it (sim/agents.js, render/people.js): their
    // activities' weights scaled (config.activities: more stay in, fewer go
    // for a walk), the share still cycling, how often visitors come, and the
    // share of walkers under an umbrella
    people: {
      rain: { activities: { stay: 2.5, porch: 0.3, stroll: 0.3, park: 0.2, lunch: 0.5 }, bike: 0.4, visitors: 0.7, umbrellas: 0.8 },
      storm: { activities: { stay: 8, porch: 0, stroll: 0, park: 0, errand: 0.3, lunch: 0, leave: 0.3 }, bike: 0.1, visitors: 0.3, umbrellas: 1 },
    },
  },

  time: {
    // First entry is the starting speed; T / the speed button cycles through them.
    // At Normal (scale 1) simulated seconds are real seconds: every speed
    // and duration in this file is tuned for that.
    speeds: [
      { name: 'Normal', scale: 1 },
      { name: 'Fast', scale: 3 },
    ],
  },

  sim: {
    agentSpeed: 0.77,   // cars, grid steps per second
    walkSpeed: 0.28,    // pedestrians
    laneOffset: 0.044,  // cars keep this far right of the road centre
    doorPad: 0.45,      // trips start / end at the building's edge, this far from its dot
    doorSlowdown: 0.9,  // cars and bikes ease in / out over this distance from a door…
    doorMinSpeed: 0.2,  // …down to this share of their speed right at the door
    retryDelay: 9,
    outsideMin: 55,       // seconds spent outside the map…
    outsideMax: 145,      // …at most
  },

  // What people do each time they set off: a weighted pick from their
  // building's list (def.sim.activities, 'worker' when not given). One that
  // can't happen (no park in reach, no footpath…) is dropped and the pick
  // repeated.
  //   stay     don't go out, just stay in a while longer
  //   porch    step out in front of the house and potter about (linger.porch)
  //   stroll   a loop walk along footpaths (or sidewalks) and home another way
  //   park     walk to a park / square (def.sim.leisure) and wander in it (linger.park)
  //   errand   to a shop or service (errands), a short stay
  //   work     to a workplace (def.sim.destinations), a long stay – off the
  //            map when the town is short of jobs (see commute)
  //   leave    off the map for a while, by bus / train or car (see transit)
  //   lunch    workers: a park if one is in reach, else a stroll
  //   delivery workers: a drive to one of def.sim.destinations and back
  activities: {
    resident: { stay: 20, porch: 15, stroll: 25, park: 15, errand: 15, work: 10, leave: 3 },
    worker: { stay: 60, lunch: 25, delivery: 15 },
    errands: ['business', 'services'],
    leisure: ['park', 'square', 'heritage', 'cemetery'], // when def.sim.leisure isn't given
  },

  // Seconds spent in one place, [min, max].
  dwell: {
    home: [30, 90],     // residents at home
    work: [60, 140],    // at work (also workers between their outings)
    errand: [12, 30],   // at a shop, a service, a delivery
    turn: [1, 4],       // a pause at a stroll's far end
  },

  // Lingering: people standing about in view, stepping between spots.
  linger: {
    park: [30, 75],     // seconds wandering in a park / square
    porch: [20, 50],    // seconds in front of the house
    pause: [2, 6],      // seconds standing at each spot
    speed: 0.5,         // share of walking speed
    porchReach: 0.65,   // the spot this far out from the door dot…
    porchWidth: 0.3,    // …give or take this much along the front
  },

  // Off the map by bus or train: walk to a stop / station in walking range
  // that buses (road exits) or trains (rail exits) call at, wait, board. On the
  // way back they get off a bus / train calling there and walk home.
  transit: {
    share: 0.5,         // off-map trips that go this way when a stop is in reach
    maxWait: 100,       // seconds; then they give up, walk home and drive instead
    returnWait: 120,    // seconds away waiting for a ride back; then they turn up anyway
  },

  // Jobs vs residents. More residents than jobs: that share of residents'
  // trips (times outShare) go to work off the map. More jobs than residents:
  // commuters drive in through map exits to buildings with jobs.
  commute: {
    outShare: 0.8,        // how strongly a job shortage sends residents out
    interval: 115,        // seconds between commuter arrivals, divided by the missing workers
    max: 30,              // commuters in the city at once
    shiftMin: 70,         // seconds a commuter stays at work…
    shiftMax: 170,        // …at most
  },

  visitors: {
    interval: 28,         // seconds between arrivals through one exit, in a full-size city
    fullCity: 40,         // buildings for the full arrival rate (fewer = rarer visitors)
    max: 25,              // visitors in the city at once
    destinations: ['business', 'industrial', 'park', 'square', 'services', 'heritage'],
    dwellMin: 11,
    dwellMax: 43,
  },

  // Trucks: one long body. Industrial buildings keep some (def.trucks, default 1)
  // that mostly carry goods off the map through a road exit and come back,
  // otherwise make service runs to businesses or other industry. Delivery
  // trucks also come in from outside to businesses and industry.
  trucks: {
    homes: ['industrial', 'farm'],  // structure ids / tags that keep trucks
    exportShare: 0.6,               // trips that leave the map (needs a road exit)
    destinations: ['business', 'business', 'industrial'], // service runs, picked at random
    speed: 0.75,                    // share of a car's speed
    dwellMin: 14,                   // seconds loading / unloading
    dwellMax: 34,
    firstTrip: 70,                  // new trucks set off within this many seconds
    outsideMin: 70,                 // seconds away on an export run…
    outsideMax: 170,                // …at most
    deliveryInterval: 85,           // seconds between delivery trucks from outside, full-size city
    deliveryMax: 4,                 // delivery trucks in the city at once
    trailer: 0.2,                   // grid steps from the truck's front to its back
  },

  // Buses: come in through a road exit, call at a few bus stops (nearest
  // next) and leave through an exit. No road to the map edge, no buses.
  buses: {
    interval: 115,    // seconds between buses (with one stop; more stops, more often)
    max: 3,           // buses in the city at once (at most one per stop)
    maxStops: 4,      // stops one bus calls at
    speed: 0.8,       // share of a car's speed
    dwellMin: 9,      // seconds at a stop
    dwellMax: 17,
    length: 0.24,     // grid steps from front to back
  },

  walk: {
    reach: 1.5,           // how far from a building people step onto a path / pavement
    sidewalkCost: 1.4,    // walking along a road counts as this much longer than a footpath
    comfortDistance: 8,   // walk (rather than ride / drive) when the walk is at most this long
    maxDistance: 14,      // never walk further than this
    longWalkChance: 0.15, // chance of walking anyway when it's between the two
    strollMin: 2,         // strolls turn round this far along footpaths…
    strollMax: 8,         // …at most this far
    sideOffset: 0.11,     // pedestrians keep this far right of the line on a street (its sidewalk)…
    laneOffset: 0.035,    // …this far on a lane (near its edge)…
    pathOffset: 0.015,    // …and this far on a footpath
  },

  bike: {
    speed: 0.52,          // grid steps per second
    // Chance of cycling a trip too long to walk, by its length: nearShare up
    // to `near`, falling to farShare at `far`, then `share` up to maxDistance.
    near: 8,
    far: 16,
    nearShare: 0.8,
    farShare: 0.5,
    share: 0.15,
    maxDistance: 30,      // never cycle further than this
    sideOffset: 0.077,    // cyclists keep this far right of the line on a road…
    laneOffset: 0.025,    // …this far on a lane…
    pathOffset: 0.015,    // …and this far on a footpath
  },

  // Cars slow down where roads get crowded. Only cars are affected.
  traffic: {
    cell: 1,              // cars are counted per grid cell of this size
    capacity: 1,          // other cars a car tolerates nearby before slowing
    slowdown: 0.45,       // each car over capacity cuts speed by this share (compounding)
    minSpeed: 0.2,        // never slower than this share of full speed
    ease: 0.9,            // how quickly cars brake / pick up speed (per second)
  },

  // The story (src/story/, written in story/story.txt – see story/README.md).
  story: {
    file: 'story/story.txt',
    unlocks: 'story/unlocks.txt', // what may be built (src/story/unlocks.js)
    check: 2,             // real seconds between looks at the rules
    typing: 55,           // letters a second as a line is written out (0: all at once)
  },

  // The town's chronicle (src/sim/chronicle.js), opened from the book by the town's name.
  chronicle: {
    day: 180,             // game seconds in one of the chronicle's days
    residents: [25, 50, 100, 250, 500, 1000, 2000, 3500, 5000, 7500, 10000], // worth a line when passed
    houses: [15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000], // after the first ten, each its own line
    check: 5,             // real seconds between counts of the residents
  },

  storageKey: 'urbanismus.save.v1',
  autosaveDelay: 600,
};
