// Gameplay and engine tunables. No logic here.

export const CONFIG = {
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
    edge: 0.08,        // roads are drawn as two edge lines this far from the centre
                       // (cars keep sim.laneOffset right of it; lots stop at ROAD_GAP in render/lots.js)
    kerb: 0.14,        // streets (roads with sidewalks): kerb lines this far from the centre
    junctionRadius: 0, // cars round junction turns this much (same scale as cornerRadius)
  },

  path: {
    cornerRadius: 0.5,
    curveSamples: 6,
    edge: 0.035,          // footpaths are drawn as two edge lines this far from the centre
    junctionRadius: 0.12, // people round turns at junctions this much
  },

  // Railways: bends of at most 45° per dot (sharper ones can't be built),
  // level crossings with roads.
  rail: {
    cornerRadius: 0.5,
    curveSamples: 10,
    gauge: 0.04,         // trains keep this far right of the centre line
  },

  // Trains come in through railways that run off the map edge, stop at the
  // stations they pass and leave through another exit (or turn round at a
  // station when there is no other way out).
  trains: {
    interval: 30,       // seconds between arrivals through one exit
    max: 3,             // trains on the map at once
    speed: 2.6,         // grid steps per second at full speed
    accel: 1.2,         // grid steps per second² (braking too)
    dwell: 6,           // seconds stopped at a station
    maxStops: 3,        // stations visited per run
    carSpacing: 0.26,   // grid steps between carriages (a carriage is drawn a bit shorter)
    lengths: { short: 2, medium: 4, long: 6 }, // carriages, picked at random
    lookAhead: 0.35,    // keep this far behind another train
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
    interval: 2,               // simulated seconds between checks
    upTime: { 2: 60, 3: 150 }, // ~seconds of met conditions to reach level 2 / level 3
    downTime: 90,              // ~seconds of lost conditions before dropping a level
    // A church appears by itself now and then (chance per check) where at
    // least minHomes homes are within radius and no church within spacing.
    church: { chance: 0.03, minHomes: 14, radius: 4, spacing: 9 },
  },

  terrain: {
    ponds: 1,
    treeDensity: 3,     // 0 disables trees
    clearRadius: 5,     // keep the map centre free for the player
  },

  time: {
    // First entry is the starting speed; T / the speed button cycles through them.
    speeds: [
      { name: 'Normal', scale: 0.35 },
      { name: 'Fast', scale: 1 },
    ],
  },

  sim: {
    agentSpeed: 2.2,    // cars, grid steps per second
    walkSpeed: 0.8,     // pedestrians
    laneOffset: 0.04,   // cars keep this far right of the road centre
    doorPad: 0.45,      // trips start / end at the building's edge, this far from its dot
    doorSlowdown: 0.9,  // cars and bikes ease in / out over this distance from a door…
    doorMinSpeed: 0.2,  // …down to this share of their speed right at the door
    dwellMin: 2,        // seconds spent at home / destination
    dwellMax: 7,
    retryDelay: 3,
    leaveChance: 0.06,    // share of residents' trips that leave the map (needs a map exit)
    outsideMin: 20,       // seconds spent outside the map…
    outsideMax: 50,       // …at most
  },

  // Jobs vs residents. More residents than jobs: that share of residents'
  // trips (times outShare) go to work off the map. More jobs than residents:
  // commuters drive in through map exits to buildings with jobs.
  commute: {
    outShare: 0.8,        // how strongly a job shortage sends residents out
    interval: 40,         // seconds between commuter arrivals, divided by the missing workers
    max: 30,              // commuters in the city at once
    shiftMin: 25,         // seconds a commuter stays at work…
    shiftMax: 60,         // …at most
  },

  visitors: {
    interval: 10,         // seconds between arrivals through one exit, in a full-size city
    fullCity: 40,         // buildings for the full arrival rate (fewer = rarer visitors)
    max: 25,              // visitors in the city at once
    destinations: ['business', 'industrial', 'park', 'square', 'services', 'heritage'],
    dwellMin: 4,
    dwellMax: 15,
  },

  // Trucks: a cab and a trailer. Industrial buildings keep some (perLevel)
  // that mostly carry goods off the map through a road exit and come back,
  // otherwise make service runs to businesses or other industry. Delivery
  // trucks also come in from outside to businesses and industry.
  trucks: {
    homes: ['industrial', 'farm'],  // structure ids / tags that keep trucks
    perLevel: [1, 1, 2],            // trucks per building at level 1 / 2 / 3
    exportShare: 0.6,               // trips that leave the map (needs a road exit)
    destinations: ['business', 'business', 'industrial'], // service runs, picked at random
    speed: 0.75,                    // share of a car's speed
    dwellMin: 5,                    // seconds loading / unloading
    dwellMax: 12,
    firstTrip: 25,                  // new trucks set off within this many seconds
    outsideMin: 25,                 // seconds away on an export run…
    outsideMax: 60,                 // …at most
    deliveryInterval: 30,           // seconds between delivery trucks from outside, full-size city
    deliveryMax: 4,                 // delivery trucks in the city at once
    trailer: 0.11,                  // grid steps between cab and trailer
  },

  walk: {
    reach: 1.5,           // how far from a building people step onto a path / pavement
    sidewalkCost: 1.4,    // walking along a road counts as this much longer than a footpath
    comfortDistance: 6,   // walk (rather than drive) when the walk is at most this long
    maxDistance: 14,      // never walk further than this
    longWalkChance: 0.15, // chance of walking anyway when it's between the two
    leisureShare: 0.7,    // share of strolls that head for a park / square if one is in range
    strollMin: 2,         // strolls go this far along footpaths…
    strollMax: 8,         // …at most this far
    sideOffset: 0.1,      // pedestrians keep this far right of the line on a street (its sidewalk)…
    pathOffset: 0.015,    // …and this far on a footpath
  },

  bike: {
    speed: 1.5,           // grid steps per second
    share: 0.35,          // share of trips too long to walk that go by bike instead of car
    maxDistance: 30,      // never cycle further than this
    sideOffset: 0.07,     // cyclists keep this far right of the line on a road…
    pathOffset: 0.015,    // …and this far on a footpath
  },

  // Cars slow down where roads get crowded. Only cars are affected.
  traffic: {
    cell: 1,              // cars are counted per grid cell of this size
    capacity: 1,          // other cars a car tolerates nearby before slowing
    slowdown: 0.45,       // each car over capacity cuts speed by this share (compounding)
    minSpeed: 0.2,        // never slower than this share of full speed
    ease: 2.5,            // how quickly cars brake / pick up speed (per second)
  },

  storageKey: 'urbanismus.save.v1',
  autosaveDelay: 600,
};
