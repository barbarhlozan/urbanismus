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
    kerb: 0.05,        // streets (roads with sidewalks): kerb lines this far from the centre
  },

  path: {
    cornerRadius: 0.5,
    curveSamples: 6,
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

  visitors: {
    interval: 10,         // seconds between arrivals through one exit, in a full-size city
    fullCity: 40,         // buildings for the full arrival rate (fewer = rarer visitors)
    max: 25,              // visitors in the city at once
    destinations: ['business', 'industrial', 'park', 'square', 'services', 'heritage'],
    dwellMin: 4,
    dwellMax: 15,
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
    sideOffset: 0.1,      // pedestrians keep this far right of the line
  },

  bike: {
    speed: 1.5,           // grid steps per second
    share: 0.35,          // share of trips too long to walk that go by bike instead of car
    maxDistance: 30,      // never cycle further than this
    sideOffset: 0.07,     // cyclists keep this far right of the line
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
