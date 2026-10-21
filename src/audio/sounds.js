// The game's recordings (sounds/), where each came from and under what
// licence: read by the players (birds.js, bed.js, effects.js) and listed
// in the Menu's Credits (main.js). Every one is from Freesound; a CC BY
// one must be credited (its author, its title, the licence, a link), the
// CC0 ones are credited all the same. `what` is the key of its few words
// in text/ui.txt.

export const SOUNDS = {
  birds: { file: 'birds-olomouc.mp3', what: 'credits.birds', title: '-64 OLOMUC BIRDS nicely separated one with quiet background', author: 'SoundEnsemble (Piotrek Zyla)', id: 550850, licence: 'CC0' },
  forest: { file: 'forest-june.mp3', what: 'credits.forest', title: 'Czech June Forest', author: 'Kukensius', id: 347618, licence: 'CC0' },
  rain: { file: 'rain-woods.mp3', what: 'credits.rain', title: 'spring rain in the woods', author: 'Berwitz', id: 150195, licence: 'CC BY 4.0' },
  pencil: { file: 'pencil.mp3', what: 'credits.pencil', title: 'Pencil Scribbles', author: 'Xalkomak', id: 697239, licence: 'CC0' },
  wood: { file: 'wood.mp3', what: 'credits.wood', title: 'lite wood', author: 'Ranner', id: 487587, licence: 'CC0' },
  knock: { file: 'knock.mp3', what: 'credits.knock', title: 'Battering End of Battery into Wooden Panel 3', author: 'F.M.Audio', id: 560334, licence: 'CC BY 4.0' },
};

export const LICENCES = {
  CC0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
};

export const sourceOf = (sound) => `https://freesound.org/s/${sound.id}/`;

// A recording, read and decoded once for each audio context (a promise of
// its AudioBuffer).
const loaded = new WeakMap();
export function load(ctx, name) {
  if (!loaded.has(ctx)) loaded.set(ctx, new Map());
  const cache = loaded.get(ctx);
  if (!cache.has(name)) {
    cache.set(name, (async () => {
      const res = await fetch(new URL(`../../sounds/${SOUNDS[name].file}`, import.meta.url));
      if (!res.ok) throw new Error(`${SOUNDS[name].file}: ${res.status}`);
      return ctx.decodeAudioData(await res.arrayBuffer());
    })());
  }
  return cache.get(name);
}
