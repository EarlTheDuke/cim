import { describe, it, expect } from 'vitest';
import { createRNG } from './rng';

describe('SeededRNG', () => {
  it('produces the same sequence with the same seed', () => {
    const rng1 = createRNG(12345);
    const rng2 = createRNG(12345);

    const results1 = Array.from({ length: 20 }, () => rng1.next());
    const results2 = Array.from({ length: 20 }, () => rng2.next());

    expect(results1).toEqual(results2);
  });

  it('produces different sequences with different seeds', () => {
    const rng1 = createRNG(111);
    const rng2 = createRNG(222);

    const r1 = rng1.next();
    const r2 = rng2.next();

    expect(r1).not.toBe(r2);
  });

  it('nextInt stays within range', () => {
    const rng = createRNG(999);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(5, 15);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(15);
    }
  });

  it('shuffle is deterministic per seed', () => {
    const rng1 = createRNG(42);
    const rng2 = createRNG(42);

    const arr1 = [1, 2, 3, 4, 5, 6, 7, 8];
    const arr2 = [1, 2, 3, 4, 5, 6, 7, 8];

    rng1.shuffle(arr1);
    rng2.shuffle(arr2);

    expect(arr1).toEqual(arr2);
  });
});
