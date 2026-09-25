// CRT screen effects, fixed to the screen (not the map):
//   scanlines  thin dark horizontal lines (CSS)

export class Crt {
  constructor(root) {
    this.lines = document.createElement('div');
    this.lines.className = 'crt-scanlines hidden';
    root.append(this.lines);
  }

  set({ scanlines }) {
    this.lines.classList.toggle('hidden', !scanlines);
  }
}
