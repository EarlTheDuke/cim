/**
 * TimeSystem - The fundamental clock for the entire simulation.
 * 
 * Responsibilities:
 * - Track simulated time
 * - Support variable speed (including 1000x)
 * - Provide clean tick advancement
 * - Remain completely independent of rendering
 */

import type { Tick, SimTimeHours, SimulationSpeed } from './types';

const TICKS_PER_HOUR = 60; // 1 simulated hour = 60 ticks (gives us minute-level granularity)

export class TimeSystem {
  private _tick: Tick = 0;
  private _speed: SimulationSpeed = 1;
  private _isPaused: boolean = false;
  private readonly _seed: number;

  constructor(seed: number = Date.now()) {
    this._seed = seed;
  }

  get tick(): Tick {
    return this._tick;
  }

  get speed(): SimulationSpeed {
    return this._isPaused ? 0 : this._speed;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  get seed(): number {
    return this._seed;
  }

  /** Current simulated time in hours since start */
  get timeHours(): SimTimeHours {
    return this._tick / TICKS_PER_HOUR;
  }

  /** Current simulated day (1-indexed) */
  get day(): number {
    return Math.floor(this.timeHours / 24) + 1;
  }

  /** Current hour within the day (0-23) */
  get hourOfDay(): number {
    return Math.floor(this.timeHours % 24);
  }

  /** Current minute within the hour (0-59) */
  get minuteOfHour(): number {
    return Math.floor((this.timeHours % 1) * 60);
  }

  /** Human-readable time string */
  get timeString(): string {
    const day = this.day;
    const hour = this.hourOfDay.toString().padStart(2, '0');
    const minute = this.minuteOfHour.toString().padStart(2, '0');
    return `Day ${day}, ${hour}:${minute}`;
  }

  /** Advance the simulation by one logical tick */
  advanceTick(): void {
    if (this._isPaused) return;
    this._tick += 1;
  }

  /** Change simulation speed. Passing 0 is treated as pause. 'realtime' = true 1:1 wall time. */
  setSpeed(newSpeed: SimulationSpeed): void {
    if (newSpeed === 0) {
      this.pause();
    } else {
      this._speed = newSpeed;
      this._isPaused = false;
    }
  }

  pause(): void {
    this._isPaused = true;
  }

  resume(): void {
    if (this._speed === 0) {
      this._speed = 1;
    }
    this._isPaused = false;
  }

  togglePause(): void {
    if (this._isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  /** Returns how many real milliseconds should pass per simulated tick at current speed */
  get msPerTick(): number {
    if (this._isPaused || this._speed === 0) return Infinity;

    // True real-time mode: 1 simulated second = 1 real second
    // Since TICKS_PER_HOUR=60 → 1 tick = 1 simulated minute = 1000ms in real time
    if (this._speed === 'realtime') {
      return 1000; // 1 tick per real second → true 1:1 wall time
    }

    // Base: 1x = 100ms per tick (10 ticks per real second)
    // Higher speeds divide the interval
    return 100 / (this._speed as number);
  }

  /** Reset time system (mostly for testing) */
  reset(): void {
    this._tick = 0;
    this._speed = 1;
    this._isPaused = false;
  }

  // === God Mode / Debug Time Manipulation (safe for inspectors & tooling) ===

  /** 
   * Advance internal time by N simulated hours (floor to whole ticks).
   * Does NOT run system updates — caller (Simulation) is responsible for stepping entities.
   * Forward only; use for fast-forward jumps in God Mode.
   */
  advanceHours(hours: number): void {
    if (hours <= 0) return;
    const ticks = Math.floor(hours * TICKS_PER_HOUR);
    this._tick += ticks;
  }

  /**
   * Directly set absolute simulated time (in hours since epoch 0).
   * Clamps to >= 0. Intended for precise "jump to hour X" inspector commands.
   * Does not run systems.
   */
  setTimeHours(targetHours: number): void {
    const targetTick = Math.floor(Math.max(0, targetHours) * TICKS_PER_HOUR);
    this._tick = targetTick;
  }

  /** For debugging and serialization */
  getSnapshot() {
    return {
      tick: this._tick,
      speed: this._speed,
      isPaused: this._isPaused,
    };
  }
}
