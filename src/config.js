// Gameplay and engine tunables. No logic here.

export const CONFIG = {
  // shown in the corner of the screen
  app: { name: 'Urbanismus', version: '0.1', author: 'mlozanek' },

  grid: { width: 40, height: 40 },

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

  growth: {
    interval: 6,               // simulated seconds between checks
    upTime: { 2: 170, 3: 430 }, // ~seconds of met conditions to reach level 2 / level 3
    downTime: 260,             // ~seconds of lost conditions before dropping a level
    // A church appears by itself now and then (chance per check) where at
    // least minHomes homes are within radius and no church within spacing.
    church: { chance: 0.03, minHomes: 14, radius: 4, spacing: 9 },
  },

  terrain: {
    riverChance: 0.6,     // share of maps with a river across them
    meander: [2.2, 0.7],  // grid steps the river swings to the sides: wide bends, small wiggles
    lakes: [1, 3],        // wanted per map, picked at random; fewer when the land has no hollows for them
    lakeSize: [8, 60],    // nodes: smaller hollows stay dry, bigger ones are only partly filled
    treeDensity: 3,       // 0 disables trees
    forestThreshold: 0.58, // forest noise above this grows trees: lower, more woodland
    clearRadius: 5,     // keep the map centre free for the player
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

  // Trucks: one long body. Industrial buildings keep some (perLevel)
  // that mostly carry goods off the map through a road exit and come back,
  // otherwise make service runs to businesses or other industry. Delivery
  // trucks also come in from outside to businesses and industry.
  trucks: {
    homes: ['industrial', 'farm'],  // structure ids / tags that keep trucks
    perLevel: [1, 1, 2],            // trucks per building at level 1 / 2 / 3
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

  storageKey: 'urbanismus.save.v1',
  autosaveDelay: 600,
};
