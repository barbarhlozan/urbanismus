// Constants and helpers that more than one part of the renderer uses
// (renderer.js and the files in this folder).

import { Camera } from '../camera.js';

export const SVGNS = 'http://www.w3.org/2000/svg';
// Moving the camera (see placeView): ms it must rest before the map is
// redrawn, and how far past each window edge the map is drawn.
export const VIEW_SETTLE = 150;
// The bit of an object's band (Renderer.bandOf) set close up, from lod.near.
export const NEAR = 64;
// The band an object is drawn with mid-turn, once the view has turned
// config.render.turnBare from where it rested (bandOf): without the
// close-up detail (level 1), its roof hatching thinned to tier 1 and a
// plainer crown, or less where its own band has less – drawn back in by
// the pen once it rests (land).
export function bareOf(band) {
  const level = Math.max(1, (band >> 4) & 3), roof = Math.min(1, (band >> 2) & 3), tree = Math.max(1, band & 3);
  return (level << 4) | (roof << 2) | tree;
}
// An object's detail changes only once the zoom is this share past its
// threshold (Renderer.bandOf), so one resting on it doesn't switch to and fro.
export const BAND_HOLD = 0.02;
// The network layers (LINES in view.js) are on the ground in world space
// (gl/lines.js): the camera turns them
export const GL_LINES = ['paths', 'rails', 'roads', 'fences'];
// The terrain's lines on the GPU as well, in world space (renderGlTerrain),
// back to front, and the classes the SVG had for them, whose pens and
// colours they take (terrainStyles). The brows, worked out for the view,
// are put on the ground where they were drawn (browOnGround): a turn carries
// them with their hills until they are worked out again where it rests.
// What is drawn on the screen (the summits' marks, the water's washes)
// stays in its SVG.
export const TERRAIN_LINES = {
  steep: 'steep', 'contour-d2': 'contour d2', 'contour-d1': 'contour d1', 'contour-index': 'contour index',
  'brow-light': 'brow light', brow: 'brow', 'brow-outline': 'brow outline', 'rock-face': 'rock-face', 'rock-lip': 'rock-lip',
  shore: 'shore', bank: 'bank', wave: 'wave d1',
};
// The steps of a whole turn (Camera.STEP); the views an object keeps of
// the steps it has been drawn at, at most (Renderer.swapIn); and ms the
// view must rest before those either side are made ready (prepareTurn).
export const STEPS = Math.round((Math.PI * 2) / Camera.STEP);

// A number from a key ('v12'), to seed by (a beam's shape, headlights).
export const hashKey = (k) => [...String(k)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
export const NO_COVER = [];
// The steps of a turn either way whose drawings are made ready on the GPU
// as well (gl/objects.js), while the view rests.
export const GL_AHEAD = 3; // (the objects' night while the view turns: none)
export const COS30 = Math.cos(Math.PI / 6);
export const r2 = (n) => Math.round(n * 100) / 100;

export function detailRank(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

// Trees swaying in the wind (Renderer.swayTrees): at most `most` on screen
// at once, only at zoom `minZoom` or closer, updated `fps` times a second
// (on twos, as drawn animation: each step repaints the objects whole).
export const TREE_SWAY = { most: 60, minZoom: 1.2, fps: 12 };

// Half-size of a building's ground area around each of its dots.
export const STRUCTURE_PAD = 0.45;
