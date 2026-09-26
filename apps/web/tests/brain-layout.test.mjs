import assert from 'node:assert/strict';
import test from 'node:test';
import { BRAIN_REGIONS, layoutBrain, regionContains } from '../src/components/observatory/feature-map/brain-layout.ts';
import { TEST_FEATURES } from '../src/components/observatory/feature-map/test-feature-layout.ts';

const volume = (region) => region.radius.x * region.radius.y * region.radius.z * (1 - region.taper / 2);

test('fill order runs largest region to smallest, except the diencephalon twin comes last', () => {
  const ordered = BRAIN_REGIONS.slice(0, -1);
  for (let i = 1; i < ordered.length; i += 1) {
    assert.ok(volume(ordered[i]) <= volume(ordered[i - 1]) + 1e-9, `${ordered[i].name} is bigger than ${ordered[i - 1].name}`);
  }
  assert.equal(BRAIN_REGIONS.at(-1).name, 'diencephalon (right)');
});

test('a neuron can never sit inside another lobe', () => {
  // Sample each region's neuron zone (its ellipsoid scaled by FILL = 0.78).
  const FILL = 0.78;
  for (const region of BRAIN_REGIONS) {
    for (let i = 0; i < 4000; i += 1) {
      const u = Math.cos(i * 2.399) * Math.sin(i * 0.61), v = Math.sin(i * 2.399) * Math.sin(i * 0.61), w = Math.cos(i * 0.61);
      const r = FILL * Math.cbrt((i % 97) / 96);
      const lx = u * r;
      const point = {
        x: region.center.x + lx * region.radius.x,
        y: region.center.y + w * r * region.radius.y,
        z: region.center.z + v * r * region.radius.z * (1 - region.taper * (1 - (lx + 1) / 2)),
      };
      for (const other of BRAIN_REGIONS) {
        if (other !== region) assert.ok(!regionContains(other, point), `${region.name} neuron zone enters ${other.name}`);
      }
    }
  }
});

test('test layout: unsupported and outlier share the diencephalon, style and hedging share the tectum', () => {
  const { labels } = layoutBrain(TEST_FEATURES);
  const at = (name) => labels[BRAIN_REGIONS.findIndex((region) => region.name === name)];
  assert.deepEqual([at('diencephalon (left)'), at('diencephalon (right)')], ['unsupported', 'outlier']);
  assert.deepEqual(new Set([at('optic tectum (left)'), at('optic tectum (right)')]), new Set(['style', 'hedging']));
  assert.equal(labels.filter(Boolean).length, BRAIN_REGIONS.length);
});

test('paired lobes mirror each other across the midline', () => {
  const pairs = new Map();
  for (const region of BRAIN_REGIONS) {
    const base = region.name.replace(/ \((left|right)\)$/, '');
    if (base !== region.name) pairs.set(base, [...(pairs.get(base) ?? []), region]);
  }
  assert.ok(pairs.size >= 3);
  for (const [name, [a, b]] of pairs) {
    assert.equal(a.center.x, b.center.x, name);
    assert.equal(a.center.z, -b.center.z, name);
    assert.deepEqual(a.radius, b.radius, name);
  }
});

function assertEveryNeuronHome(features, layout) {
  const regionOf = new Map(layout.labels.map((label, index) => [label, BRAIN_REGIONS[index]]));
  for (const feature of features) {
    const position = layout.positions.get(feature.id);
    assert.ok(position, `${feature.id} has no position`);
    const region = regionOf.get(feature.cluster) ?? regionOf.get('other');
    assert.ok(regionContains(region, position), `${feature.id} (${feature.cluster}) sits outside ${region.name}`);
  }
}

test('test layout: every neuron sits inside its own cluster region, biggest cluster in the biggest region', () => {
  const layout = layoutBrain(TEST_FEATURES);
  assert.equal(layout.positions.size, TEST_FEATURES.length);
  assertEveryNeuronHome(TEST_FEATURES, layout);
  const sizes = new Map();
  for (const feature of TEST_FEATURES) sizes.set(feature.cluster, (sizes.get(feature.cluster) ?? 0) + 1);
  assert.equal(layout.labels[0], [...sizes].sort((a, b) => b[1] - a[1])[0][0]);
});

test('tapered regions still contain their neurons at the narrow end', () => {
  // A cluster stretched along x lands neurons at both ends of the hindbrain.
  const features = Array.from({ length: 40 }, (_, i) => ({
    id: `n${i}`, cluster: 'long', coords: { x: i - 20, y: (i % 5) - 2, z: (i % 3) - 1 },
  }));
  const layout = layoutBrain(features);
  assert.equal(BRAIN_REGIONS[0].taper > 0, true);
  assertEveryNeuronHome(features, layout);
});

test('more clusters than regions: the smallest share the last region as "other"', () => {
  const features = Array.from({ length: 12 }, (_, cluster) => Array.from({ length: 12 - cluster }, (_, i) => ({
    id: `c${cluster}_${i}`, cluster: `cluster ${cluster}`, coords: { x: cluster * 10 + Math.cos(i) * 3, y: Math.sin(i) * 3, z: i % 2 },
  }))).flat();
  const layout = layoutBrain(features);
  assert.equal(layout.labels.at(-1), 'other');
  assert.equal(new Set(layout.labels).size, BRAIN_REGIONS.length);
  assert.equal(layout.positions.size, features.length);
  assertEveryNeuronHome(features, layout);
});

test('missing z, single-neuron and empty inputs do not break the layout', () => {
  const one = [{ id: 'a', cluster: 'solo', coords: { x: 5, y: 5 } }];
  const layout = layoutBrain(one);
  assertEveryNeuronHome(one, layout);
  assert.ok(Object.values(layout.positions.get('a')).every(Number.isFinite));
  assert.deepEqual(layoutBrain([]).labels.filter(Boolean), []);
});
