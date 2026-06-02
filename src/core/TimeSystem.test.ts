import { describe, it, expect, beforeEach } from 'vitest';
import { TimeSystem } from './TimeSystem';

describe('TimeSystem', () => {
  let time: TimeSystem;

  beforeEach(() => {
    time = new TimeSystem(42); // fixed seed for reproducibility
  });

  it('starts at tick 0 and 1x speed', () => {
    expect(time.tick).toBe(0);
    expect(time.speed).toBe(1);
    expect(time.isPaused).toBe(false);
  });

  it('advances time correctly', () => {
    time.advanceTick();
    expect(time.tick).toBe(1);
    expect(time.timeHours).toBeCloseTo(1 / 60, 5);
  });

  it('calculates day and hour correctly', () => {
    // Advance 25 hours worth of ticks
    for (let i = 0; i < 25 * 60; i++) {
      time.advanceTick();
    }

    expect(time.day).toBe(2);
    expect(time.hourOfDay).toBe(1);
  });

  it('supports speed changes', () => {
    time.setSpeed(100);
    expect(time.speed).toBe(100);
    expect(time.isPaused).toBe(false);
  });

  it('pause sets speed to 0 effectively', () => {
    time.setSpeed(10);
    time.pause();
    expect(time.isPaused).toBe(true);
    expect(time.speed).toBe(0);
  });

  it('resume restores previous speed', () => {
    time.setSpeed(100);
    time.pause();
    time.resume();
    expect(time.speed).toBe(100);
    expect(time.isPaused).toBe(false);
  });

  it('produces consistent time strings', () => {
    for (let i = 0; i < 90; i++) time.advanceTick(); // 1.5 hours
    expect(time.timeString).toBe('Day 1, 01:30');
  });

  it('is serializable via snapshot', () => {
    time.setSpeed(10);
    time.advanceTick();

    const snapshot = time.getSnapshot();
    expect(snapshot.tick).toBe(1);
    expect(snapshot.speed).toBe(10);
  });

  // === God Mode / Debug time manipulation tests ===
  it('advanceHours moves time forward by whole ticks', () => {
    time.advanceHours(2.5); // 2.5h = 150 ticks
    expect(time.tick).toBe(150);
    expect(time.timeHours).toBeCloseTo(2.5, 5);
  });

  it('setTimeHours sets absolute time (god jumps)', () => {
    time.setTimeHours(48); // exactly 2 days
    expect(time.day).toBe(3);
    expect(time.hourOfDay).toBe(0);
    expect(time.tick).toBe(48 * 60);
  });

  it('god time methods are safe with zero/negative inputs', () => {
    time.setTimeHours(10);
    time.advanceHours(-3);
    time.setTimeHours(-5);
    expect(time.timeHours).toBeGreaterThanOrEqual(0);
  });
});
