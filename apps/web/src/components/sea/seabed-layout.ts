export type SeabedItem = {
  kind: "pebbles" | "shell" | "starfish";
  x: number;
  depth: number;
  size: number;
  rotation: number;
};

export function createSeabed(seed: string): SeabedItem[] {
  let state = Array.from(seed).reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const kinds = ["pebbles", "shell", "starfish"] as const;
  return Array.from({ length: 18 }, (_, index) => ({
    kind: kinds[index % 3],
    x: (index + .2 + random() * .6) / 18,
    depth: random(),
    size: .55 + random() * .4,
    rotation: (random() - .5) * 1.8,
  }));
}
