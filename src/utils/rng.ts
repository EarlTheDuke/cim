/**
 * Seeded Random Number Generator
 * 
 * Uses a simple but high-quality SplitMix32 algorithm.
 * This gives us deterministic, reproducible randomness across runs
 * when using the same seed — critical for debugging and testing.
 */

export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    // Ensure we have a decent starting state
    this.state = seed >>> 0;
  }

  /** Returns a number between 0 (inclusive) and 1 (exclusive) */
  next(): number {
    this.state = (this.state + 0x9e3779b9) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Float in [min, max) */
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /** Returns true with the given probability (0.0 - 1.0) */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Pick a random element from an array */
  pick<T>(array: T[]): T {
    return array[this.nextInt(0, array.length - 1)];
  }

  /** Shuffle array in place (Fisher-Yates) */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /** Create a new independent RNG with a derived seed */
  fork(): SeededRNG {
    return new SeededRNG(this.nextInt(0, 2 ** 32 - 1));
  }
}

/** Convenience function to create an RNG */
export function createRNG(seed: number): SeededRNG {
  return new SeededRNG(seed);
}
