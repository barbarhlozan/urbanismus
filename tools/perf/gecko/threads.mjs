// The threads of a Firefox profile with the CPU each used, busiest first,
// and the pages it saw: to pick the game's (its page's thread, the GPU
// process's 'Renderer', the 'DOM Worker' of the shadows).
//
//   node tools/perf/gecko/threads.mjs <profile.json>
import { readFileSync } from 'node:fs';

const p = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const cpu = (t) => (t.samples.threadCPUDelta ?? []).reduce((a, b) => a + (b || 0), 0) / 1000;
const rows = p.threads.map((t, i) => ({ i, name: t.name, proc: t.processName ?? '', pid: t.pid, ms: cpu(t), pages: (t.usedInnerWindowIDs ?? []).map((w) => p.pages.find((pg) => pg.innerWindowID === w)?.url).filter((u) => u && !u.startsWith('about:') && !u.startsWith('chrome:') && !u.startsWith('moz-extension:')) }));
for (const r of rows.sort((a, b) => b.ms - a.ms).slice(0, 15)) console.log(`${String(r.i).padStart(3)}  ${r.name.padEnd(12)} ${r.proc.padEnd(22)} pid ${String(r.pid).padEnd(6)} ${r.ms.toFixed(0).padStart(7)} ms CPU  ${[...new Set(r.pages)].slice(0, 2).join(' ')}`);
