// Cities as files, to move them to another computer or keep a copy:
//
//   exportCity(world)  downloads the city as "<name>.urbanismus.json" – the
//                      same data as the autosave (World.toJSON), wrapped
//                      with the app's name and the date
//   pickCity()         asks for such a file and resolves with the World it
//                      holds (checked by loading it), or null if none was
//                      picked; rejects with a readable message when the file
//                      is no city
//
// A bare World.toJSON() (e.g. the autosave copied out of the browser) is
// taken too.

import { CONFIG } from '../config.js';
import { World } from '../core/world.js';
import { t } from '../core/text.js';

const FORMAT = 'urbanismus-city';

export function exportCity(world) {
  const file = {
    format: FORMAT,
    app: `${CONFIG.app.name} ${CONFIG.app.version}`,
    exported: new Date().toISOString(),
    world: world.toJSON(),
  };
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${world.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'city'}.urbanismus.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickCity() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      file.text().then(readCity).then(resolve, reject);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function readCity(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t('import.not-city'));
  }
  if (data?.format === FORMAT) data = data.world;
  if (!Number.isInteger(data?.width) || !Array.isArray(data.structures) || !data.terrain) {
    throw new Error(t('import.not-city'));
  }
  try {
    return World.fromJSON(data);
  } catch (err) {
    throw new Error(/newer version/.test(err.message)
      ? t('import.newer')
      : t('import.damaged'));
  }
}
