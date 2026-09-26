export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * One lobe of the brain as an ellipsoid. Axes: x runs tail (−) to nose (+),
 * y is up, z is left–right. `taper` narrows the lobe towards its tail end
 * (0 = plain ellipsoid, 0.5 = half as wide at the back).
 */
export interface BrainRegion {
  /** Anatomical name, for code only — not shown, since the mapping is arbitrary. */
  name: string;
  center: Vec3;
  radius: Vec3;
  taper: number;
}

export interface BrainLayout {
  /** Cluster label per region index, or null when the region is empty. */
  labels: (string | null)[];
  positions: Map<string, Vec3>;
}

// A larval zebrafish brain from above, loosely following light-sheet
// reconstructions: paired telencephalon at the front, a paired diencephalon
// behind it, two large optic tectum lobes, the cerebellum across the middle
// and a long hindbrain tapering to the spinal cord.
//
// Clusters fill regions in this order, largest cluster first. It runs
// largest region to smallest, except the diencephalon's second lobe comes
// last, so the smallest cluster sits beside a mid-sized one instead of alone.
export const BRAIN_REGIONS: readonly BrainRegion[] = [
  { name: "hindbrain", center: { x: -3.0, y: -0.1, z: 0 }, radius: { x: 2.4, y: 0.7, z: 1.05 }, taper: 0.55 },
  { name: "optic tectum (left)", center: { x: 1.5, y: 0.15, z: -1.12 }, radius: { x: 1.2, y: 0.85, z: 1.05 }, taper: 0 },
  { name: "optic tectum (right)", center: { x: 1.5, y: 0.15, z: 1.12 }, radius: { x: 1.2, y: 0.85, z: 1.05 }, taper: 0 },
  { name: "cerebellum", center: { x: -0.15, y: 0.1, z: 0 }, radius: { x: 0.55, y: 0.6, z: 1.6 }, taper: 0 },
  { name: "diencephalon (left)", center: { x: 3.6, y: -0.15, z: -0.78 }, radius: { x: 0.85, y: 0.65, z: 0.75 }, taper: 0 },
  { name: "telencephalon (left)", center: { x: 5.3, y: 0, z: -0.55 }, radius: { x: 0.8, y: 0.6, z: 0.55 }, taper: 0 },
  { name: "telencephalon (right)", center: { x: 5.3, y: 0, z: 0.55 }, radius: { x: 0.8, y: 0.6, z: 0.55 }, taper: 0 },
  { name: "diencephalon (right)", center: { x: 3.6, y: -0.15, z: 0.78 }, radius: { x: 0.85, y: 0.65, z: 0.75 }, taper: 0 },
];

/** Centre and bounding radius of the whole brain, for framing it on screen. */
export const BRAIN_BOUNDS = (() => {
  const minX = Math.min(...BRAIN_REGIONS.map((r) => r.center.x - r.radius.x));
  const maxX = Math.max(...BRAIN_REGIONS.map((r) => r.center.x + r.radius.x));
  const maxZ = Math.max(...BRAIN_REGIONS.map((r) => Math.abs(r.center.z) + r.radius.z));
  const center = { x: (minX + maxX) / 2, y: 0, z: 0 };
  // A sphere around the centre that holds every lobe's bounding box.
  const radius = Math.max(...BRAIN_REGIONS.map((r) => Math.hypot(
    Math.abs(r.center.x - center.x) + r.radius.x, Math.abs(r.center.y) + r.radius.y, Math.abs(r.center.z) + r.radius.z)));
  return { center, length: maxX - minX, width: maxZ * 2, radius };
})();

/**
 * How the brain sits inside the glass fish, in fish units (tail −0.98 → nose
 * 1). The brain runs from behind mid-body (`from`: the tapering hindbrain
 * doubles as the spinal cord) to just behind the snout (`to`), a little above
 * the body's centre line (`lift`). The brain is drawn larger than a real
 * fish's so its lobes stay readable, and the fish `lateral` times wider than
 * the reef fish in the sea so the optic tectum fits. tests/brain-layout.test.mjs
 * checks that every lobe stays inside the body.
 */
export const FISH_PLACEMENT = (() => {
  const from = -0.5, to = 0.9, lift = 0.03, lateral = 1.6;
  const scale = BRAIN_BOUNDS.length / (to - from);
  const brainTail = BRAIN_BOUNDS.center.x - BRAIN_BOUNDS.length / 2;
  return {
    from, to, lift, lateral, scale,
    /**
     * Eyes, in fish units, on the head's surface beside the telencephalon.
     * They are round spheres (not stretched with the body) and sit clear of
     * every lobe; tests/brain-layout.test.mjs checks it.
     */
    eye: { x: 0.74, y: 0.065, z: 0.14, radius: 0.055 },
    /** World position of the fish's origin. */
    offset: { x: brainTail - from * scale, y: -lift * scale, z: 0 },
    /** Fish-space point → world (brain) space. */
    toWorld: (x: number, y: number, z: number): Vec3 => ({
      x: brainTail + (x - from) * scale, y: (y - lift) * scale, z: z * scale * lateral,
    }),
  };
})();

// Neurons are spread over this share of their region, clear of the surface.
const FILL = 0.78;

/** How wide a tapered region is at local x in [-1, 1] (back to front). */
export function taperAt(region: BrainRegion, localX: number) {
  return 1 - region.taper * (1 - (localX + 1) / 2);
}

/** True when `point` is inside the region's (tapered) ellipsoid. */
export function regionContains(region: BrainRegion, point: Vec3) {
  const lx = (point.x - region.center.x) / region.radius.x;
  const ly = (point.y - region.center.y) / region.radius.y;
  const lz = (point.z - region.center.z) / (region.radius.z * taperAt(region, Math.max(-1, Math.min(1, lx))));
  return lx * lx + ly * ly + lz * lz <= 1 + 1e-9;
}

/**
 * Assigns each cluster to a region (largest cluster → largest region) and
 * places its features inside it as neurons, keeping the cluster's own 3D
 * layout: layout x → front/back, y → left/right, z → up/down. With more
 * clusters than regions, the smallest share the last region as "other".
 */
export function layoutBrain(features: readonly { id: string; cluster: string; coords: { x: number; y: number; z?: number } }[]): BrainLayout {
  const groups = new Map<string, typeof features[number][]>();
  for (const feature of features) {
    groups.set(feature.cluster, [...(groups.get(feature.cluster) ?? []), feature]);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const slots = BRAIN_REGIONS.length;
  const assigned = ranked.slice(0, ranked.length > slots ? slots - 1 : slots).map(([label, members]) => ({ label, members }));
  if (ranked.length > slots) {
    assigned.push({ label: "other", members: ranked.slice(slots - 1).flatMap(([, members]) => members) });
  }

  const positions = new Map<string, Vec3>();
  const labels: (string | null)[] = BRAIN_REGIONS.map(() => null);
  assigned.forEach((group, index) => {
    const region = BRAIN_REGIONS[index];
    labels[index] = group.label;
    const n = group.members.length;
    const center = {
      x: group.members.reduce((sum, m) => sum + m.coords.x, 0) / n,
      y: group.members.reduce((sum, m) => sum + m.coords.y, 0) / n,
      z: group.members.reduce((sum, m) => sum + (m.coords.z ?? 0), 0) / n,
    };
    const spread = Math.max(1e-9, ...group.members.map((m) =>
      Math.hypot(m.coords.x - center.x, m.coords.y - center.y, (m.coords.z ?? 0) - center.z)));
    for (const member of group.members) {
      // A point in the unit ball, stretched into the region.
      const u = ((member.coords.x - center.x) / spread) * FILL;
      const v = ((member.coords.y - center.y) / spread) * FILL;
      const w = (((member.coords.z ?? 0) - center.z) / spread) * FILL;
      positions.set(member.id, {
        x: region.center.x + u * region.radius.x,
        y: region.center.y + w * region.radius.y,
        z: region.center.z + v * region.radius.z * taperAt(region, u),
      });
    }
  });
  return { labels, positions };
}
