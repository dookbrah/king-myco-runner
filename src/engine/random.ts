export const hashToSeed = (input: string): number => {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

export const createSeededRng = (seedInput: string | number): (() => number) => {
  let state =
    typeof seedInput === "number"
      ? seedInput >>> 0
      : hashToSeed(String(seedInput));

  return () => {
    state += 0x6d2b79f5;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

export const pickOne = <T>(items: T[], rng: () => number): T => {
  if (items.length === 0) {
    throw new Error("pickOne received an empty array");
  }

  const index = Math.floor(rng() * items.length);
  return items[index] as T;
};
