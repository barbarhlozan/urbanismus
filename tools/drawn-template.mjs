// Writes the blank line sheet for the test cottage (src/lab/lines.js) to
// drawings/chalupa-template.svg:  node tools/drawn-template.mjs
import { writeFileSync } from 'node:fs';
import { CHALUPA, templateSVG } from '../src/lab/lines.js';

const file = `drawings/${CHALUPA.id}-template.svg`;
writeFileSync(new URL(`../${file}`, import.meta.url), templateSVG(CHALUPA));
console.log(file);
