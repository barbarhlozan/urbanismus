// Simulation time. Every simulation system gets its time step through the
// clock, so pausing and speed apply to everything at once. Speeds are listed
// in config.time.speeds; add entries there for more.

export class SimClock {
  constructor(config) {
    this.speeds = config.time.speeds;
    this.index = 0;
    this.paused = false;
    this.elapsed = 0; // simulated seconds since start
  }

  get speed() {
    return this.speeds[this.index];
  }

  cycleSpeed() {
    this.index = (this.index + 1) % this.speeds.length;
  }

  // Real seconds -> simulated seconds.
  step(dt) {
    const sim = this.paused ? 0 : dt * this.speed.scale;
    this.elapsed += sim;
    return sim;
  }
}
