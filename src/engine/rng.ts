/**
 * Deterministic seeded randomness.
 *
 * Every stochastic outcome in the eval is derived from a string seed so that a
 * batch replays identically across runs, machines, and strategies. Both the Triage
 * and naive arms draw from the same seeds, which is what makes the comparison a
 * controlled experiment rather than two different dice rolls.
 *
 * FNV-1a is used because the naive `hash * 31 + charCode` construction distributes
 * terribly on structured inputs: amounts ending in "00" all collapse to the same
 * residue mod 100, which silently pinned every outcome to the same result.
 */

export function hash32(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Final avalanche so adjacent seeds diverge.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform value in [0, 1). */
export function roll(seed: string): number {
  return hash32(seed) / 4294967296;
}

/** True with the given probability, deterministically for this seed. */
export function chance(seed: string, probability: number): boolean {
  return roll(seed) < probability;
}

/** Deterministic pick from a list. */
export function pick<T>(seed: string, items: readonly T[]): T {
  return items[hash32(seed) % items.length];
}
