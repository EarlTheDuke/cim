/**
 * Core shared types for CityWithLifeGrok
 */

export type Tick = number;

/** Simulated time in hours since simulation start (can be fractional) */
export type SimTimeHours = number;

/** Speed multiplier for the simulation. 'realtime' = true 1:1 wall-clock time (1 simulated second = 1 real second) */
export type SimulationSpeed = 0 | 1 | 10 | 100 | 1000 | 'realtime';

export interface SimulationState {
  readonly tick: Tick;
  readonly timeHours: SimTimeHours;
  readonly speed: SimulationSpeed;
  readonly isPaused: boolean;
  readonly seed: number;
}
