import * as THREE from "three";
import { createFish, createFishGeometry, createSeabedObject, createShadowTexture } from "./sea-models";
import { createSeaRenderer, readSeaPalette, runSeaLoop, type SeaScene } from "./sea-renderer";
import type { SeabedItem } from "./seabed-layout";

export type { SeaScene } from "./sea-renderer";

// The sand's nearest edge sits at this depth and is projected onto the bottom of the viewport.
const FLOOR_EDGE_Z = 2.2;
const FISH_COUNT = 16;

type Prop = ReturnType<typeof createSeabedObject> & {
  layout: SeabedItem;
  anchor: THREE.Vector3;
  displacement: THREE.Vector3;
  velocity: THREE.Vector3;
  response: number;
  radius: number;
};
type Swimmer = ReturnType<typeof createFish> & {
  velocity: THREE.Vector3;
  direction: number;
  lane: number;
  depth: number;
  speed: number;
  size: number;
  phase: number;
  target: Prop | null;
  mode: "cruise" | "approach" | "inspect";
  timer: number;
  cooldown: number;
  mobile: boolean;
};

export function createSeaScene(host: HTMLDivElement, layout: SeabedItem[], initiallyPaused: boolean): SeaScene {
  const { renderer, canvas, environment, dispose: disposeRenderer } = createSeaRenderer(host, "seaCanvas");
  const palette = readSeaPalette(host);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(palette.abyss, .032);
  scene.environment = environment;
  scene.environmentIntensity = .35;
  const camera = new THREE.OrthographicCamera(-10, 10, 6, -6, .1, 60);
  camera.position.set(0, 6.8, 18);
  camera.lookAt(0, 0, 0);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const floorY = (camera.bottom - up.z * FLOOR_EDGE_Z) / up.y;
  scene.add(new THREE.HemisphereLight(palette.water, palette.abyss, 1.25));
  const light = new THREE.DirectionalLight(palette.water.clone().lerp(palette.paper, .4), 1.9);
  light.position.set(-5, 9, 7);
  scene.add(light);
  const rim = new THREE.DirectionalLight(palette.seaGlass, .8);
  rim.position.set(6, 3, -4);
  scene.add(rim);

  // Rippled sand that runs past the bottom edge and fades into the water behind.
  const floorBack = -7, floorFront = FLOOR_EDGE_Z + 2;
  const floorGeometry = new THREE.PlaneGeometry(64, floorFront - floorBack, 320, 64);
  floorGeometry.rotateX(-Math.PI / 2);
  floorGeometry.translate(0, 0, (floorFront + floorBack) / 2);
  const floorVertices = floorGeometry.getAttribute("position");
  const floorColors: number[] = [];
  const sand = palette.sand.clone().lerp(palette.crate, .35).lerp(palette.waterDeep, .3);
  const sandColor = new THREE.Color();
  for (let index = 0; index < floorVertices.count; index++) {
    const x = floorVertices.getX(index), z = floorVertices.getZ(index);
    const ripple = Math.sin(x * 2.6 + Math.sin(z * .9 + x * .15) * 1.8) * .035 + Math.sin(x * .45 + z * .7) * .08;
    floorVertices.setY(index, ripple);
    sandColor.copy(sand).multiplyScalar(.92 + ripple * 1.1).lerp(palette.waterDeep, THREE.MathUtils.smoothstep(z, 1, -6) * .45);
    floorColors.push(sandColor.r, sandColor.g, sandColor.b, THREE.MathUtils.smoothstep(z, floorBack, floorBack + 5) * .85);
  }
  floorGeometry.setAttribute("color", new THREE.Float32BufferAttribute(floorColors, 4));
  floorGeometry.computeVertexNormals();
  const causticUniforms = { uTime: { value: 0 }, uCausticColor: { value: palette.water.clone().multiplyScalar(.5) } };
  const floorMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: .95, depthWrite: false });
  floorMaterial.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, causticUniforms);
    shader.vertexShader = "varying vec2 vCaustic;\n" + shader.vertexShader.replace("#include <project_vertex>",
      "#include <project_vertex>\nvCaustic = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = "uniform float uTime;\nuniform vec3 uCausticColor;\nvarying vec2 vCaustic;\n" + shader.fragmentShader.replace(
      "#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      vec2 causticPoint = vCaustic * vec2(.7, 1.1);
      float caustic = 0.0;
      for (int i = 0; i < 3; i++) {
        causticPoint += vec2(sin(causticPoint.y * 1.3 + uTime * .5 + float(i) * 1.7), cos(causticPoint.x * 1.1 - uTime * .42 + float(i) * 2.3)) * .6;
        caustic += pow(.5 + .5 * sin(causticPoint.x + causticPoint.y), 10.0);
      }
      totalEmissiveRadiance += uCausticColor * caustic * .45;`);
  };
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.position.y = floorY - .06;
  floor.renderOrder = -2;
  scene.add(floor);

  const shadowTexture = createShadowTexture();
  const props: Prop[] = layout.map((item, index) => {
    const model = createSeabedObject(item.kind, palette, index * 7919 + 17, shadowTexture);
    model.root.scale.setScalar(item.size);
    model.root.rotation.y = item.rotation;
    scene.add(model.root);
    return { ...model, layout: item, anchor: new THREE.Vector3(),
      displacement: new THREE.Vector3(), velocity: new THREE.Vector3(), response: 0,
      radius: item.size * (item.kind === "pebbles" ? .85 : .7) };
  });

  const species = [0, 1, 2].map(variant => createFishGeometry(palette, variant));
  function spawn(variant: number, size: number, x: number, lane: number, depth: number, direction: number, speed: number, phase: number) {
    const model = createFish(species[variant]);
    model.root.rotation.order = "YZX";
    model.root.scale.setScalar(size);
    model.root.position.set(x, lane, depth);
    model.root.rotation.y = direction === 1 ? 0 : Math.PI;
    scene.add(model.root);
    const swimmer: Swimmer = { ...model, velocity: new THREE.Vector3(direction * speed, 0, 0), direction,
      lane, depth, speed, size, phase, target: null, mode: "cruise",
      timer: 0, cooldown: 2 + phase * 1.6, mobile: true };
    return swimmer;
  }
  const fish: Swimmer[] = Array.from({ length: FISH_COUNT }, (_, index) => {
    const lane = 3.6 - ((index * 5) % FISH_COUNT) / (FISH_COUNT - 1) * 7.6;
    const swimmer = spawn(index % 3, .34 + ((index * 7) % 5) * .055, (index / FISH_COUNT - .5) * 16, lane,
      -4.4 + ((index * 3) % 5) * 1.25, index % 2 ? -1 : 1, 1 + ((index * 3) % 4) * .22, index * 1.7);
    swimmer.mobile = index < 8;
    return swimmer;
  });

  const dustCount = 120;
  const dustPositions = new Float32Array(dustCount * 3).fill(-100);
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({
    color: palette.sand, size: .035, transparent: true, opacity: .4, depthWrite: false,
  }));
  dust.frustumCulled = false;
  scene.add(dust);
  const particles = Array.from({ length: dustCount }, () => ({
    life: 0, position: new THREE.Vector3(), velocity: new THREE.Vector3(),
  }));
  let particleCursor = 0;
  function disturb(prop: Prop, direction: number) {
    prop.response = 1;
    if (prop.layout.kind === "pebbles") prop.velocity.x += direction * .055;
    for (let index = 0; index < 14; index++) {
      const particle = particles[particleCursor++ % dustCount];
      particle.life = 1.5 + index * .06;
      particle.position.copy(prop.anchor).add(new THREE.Vector3(Math.sin(index * 2.4) * .25, .22, Math.cos(index * 2.4) * .15));
      particle.velocity.set(Math.sin(index * 4) * .08, .12 + (index % 4) * .025, Math.cos(index * 3) * .07);
    }
  }

  let bound = 9;
  let elapsed = 0;
  let debugTime = -1;
  let encounters = 0;
  const goal = new THREE.Vector3();
  const steering = new THREE.Vector3();
  const separation = new THREE.Vector3();
  const inspectOffset = new THREE.Vector3();

  function update(delta: number) {
    elapsed += delta;
    causticUniforms.uTime.value = elapsed;
    for (const swimmer of fish) {
      if (!swimmer.root.visible) continue;
      if (swimmer.target && !swimmer.target.root.visible) {
        swimmer.mode = "cruise";
        swimmer.target = null;
      }
      const position = swimmer.root.position;
      swimmer.cooldown -= delta;
      if (swimmer.mode === "cruise") {
        if (position.x * swimmer.direction > bound - .7) swimmer.direction *= -1;
        goal.set(swimmer.direction * (bound + 2), swimmer.lane + Math.sin(elapsed * .33 + swimmer.phase) * .35,
          swimmer.depth + Math.sin(elapsed * .22 + swimmer.phase) * .7);
        if (swimmer.lane < -1.8 && swimmer.cooldown <= 0) {
          // Investigate an actual nearby 3D object, chosen by spatial distance.
          let nearest: Prop | null = null, distance = Infinity;
          for (const prop of props) {
            if (!prop.root.visible) continue;
            const candidate = position.distanceToSquared(prop.anchor);
            if (candidate < distance && Math.abs(position.x - prop.anchor.x) < 4) { nearest = prop; distance = candidate; }
          }
          if (nearest) { swimmer.target = nearest; swimmer.mode = "approach"; swimmer.timer = 0; }
          else swimmer.cooldown = 3;
        }
      }
      if (swimmer.target) {
        const prop = swimmer.target;
        goal.copy(prop.anchor).add(inspectOffset.set(-swimmer.direction * .6, .68, .15));
        if (swimmer.mode === "approach") {
          swimmer.timer += delta;
          if (position.distanceTo(goal) < .3) {
            swimmer.mode = "inspect";
            swimmer.timer = 0;
            disturb(prop, swimmer.direction);
            encounters++;
          } else if (swimmer.timer > 10) {
            swimmer.mode = "cruise"; swimmer.target = null; swimmer.cooldown = 5;
          }
        } else if (swimmer.mode === "inspect") {
          swimmer.timer += delta;
          goal.y += Math.sin(swimmer.timer * 2.5) * .055;
          if (swimmer.timer > 2) {
            swimmer.mode = "cruise"; swimmer.target = null; swimmer.cooldown = 7 + swimmer.phase;
          }
        }
      }
      steering.subVectors(goal, position);
      const distance = steering.length();
      const speed = swimmer.mode === "cruise" ? swimmer.speed : Math.min(swimmer.speed, distance * 1.8);
      if (distance > .001) steering.multiplyScalar(speed / distance);
      // Repulsion keeps fish from clipping into solid props or each other.
      for (const prop of props) {
        if (prop === swimmer.target || !prop.root.visible) continue;
        separation.subVectors(position, prop.root.position);
        const radius = prop.radius + .5;
        const distanceSq = separation.lengthSq();
        if (distanceSq < radius * radius && distanceSq > .001) {
          steering.addScaledVector(separation.normalize(), (radius - Math.sqrt(distanceSq)) * 1.8);
          steering.y += .1;
        }
      }
      for (const other of fish) {
        if (other === swimmer || !other.root.visible) continue;
        separation.subVectors(position, other.root.position);
        const reach = (swimmer.size + other.size) * 1.5;
        const distanceSq = separation.lengthSq();
        if (distanceSq < reach * reach && distanceSq > .001) steering.addScaledVector(separation, .45 * reach / distanceSq);
      }
      swimmer.velocity.lerp(steering, 1 - Math.exp(-delta * 2.4));
      position.addScaledVector(swimmer.velocity, delta);
      position.y = THREE.MathUtils.clamp(position.y, floorY + .46, 4.2);
      const velocity = swimmer.velocity;
      const pace = velocity.length();
      let turn = 0;
      if (pace > .07) {
        const yaw = Math.atan2(-velocity.z, velocity.x);
        const yawDelta = THREE.MathUtils.euclideanModulo(yaw - swimmer.root.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
        turn = yawDelta * (1 - Math.exp(-delta * 4));
        swimmer.root.rotation.y += turn;
        const pitch = Math.atan2(velocity.y, Math.hypot(velocity.x, velocity.z));
        swimmer.root.rotation.z = THREE.MathUtils.lerp(swimmer.root.rotation.z, pitch * .8, 1 - Math.exp(-delta * 3));
      }
      // Bank into turns a little, like a real fish rolling onto its side.
      const bank = delta > 0 ? THREE.MathUtils.clamp(-turn / delta * .12, -.4, .4) : 0;
      swimmer.root.rotation.x = THREE.MathUtils.lerp(swimmer.root.rotation.x, bank, 1 - Math.exp(-delta * 4));
      const beat = swimmer.mode === "inspect" ? 5 : (4 + pace * 4.5) * Math.sqrt(.36 / swimmer.size);
      swimmer.uniforms.uSwim.value += delta * beat;
      swimmer.uniforms.uAmp.value = THREE.MathUtils.lerp(swimmer.uniforms.uAmp.value,
        swimmer.mode === "inspect" ? .06 : .09 + Math.min(pace, 2) * .025, 1 - Math.exp(-delta * 3));
      swimmer.fins.forEach((fin, index) => { fin.rotation.x = Math.sin(elapsed * 6 + swimmer.phase + index * Math.PI) * .3; });
    }
    for (const prop of props) {
      prop.response = Math.max(0, prop.response - delta * .38);
      prop.velocity.addScaledVector(prop.displacement, -delta * 7).multiplyScalar(Math.exp(-delta * 4));
      prop.displacement.addScaledVector(prop.velocity, delta);
      prop.root.position.copy(prop.anchor).add(prop.displacement);
      prop.root.rotation.z = prop.layout.kind === "starfish" ? Math.sin(elapsed * 3) * prop.response * .055 : 0;
      if (prop.lid) prop.lid.rotation.x = -Math.PI / 2 + .16 + Math.sin(prop.response * Math.PI) * .48;
    }
    particles.forEach((particle, index) => {
      particle.life -= delta;
      if (particle.life > 0) particle.position.addScaledVector(particle.velocity, delta);
      const offset = index * 3;
      dustPositions[offset] = particle.life > 0 ? particle.position.x : -100;
      dustPositions[offset + 1] = particle.life > 0 ? particle.position.y : -100;
      dustPositions[offset + 2] = particle.life > 0 ? particle.position.z : -100;
    });
    dustGeometry.getAttribute("position").needsUpdate = true;
    if (elapsed - debugTime > 1) {
      debugTime = elapsed;
      canvas.dataset.encounters = String(encounters);
      canvas.dataset.inspecting = String(fish.filter(swimmer => swimmer.mode === "inspect").length);
      canvas.dataset.simulationTime = elapsed.toFixed(1);
    }
  }

  function resize(width: number, height: number) {
    const aspect = width / height;
    bound = Math.max(2.4, aspect * 6);
    camera.left = -bound;
    camera.right = bound;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    props.forEach(prop => {
      prop.anchor.set((prop.layout.x - .5) * bound * 2, floorY, 1 - prop.layout.depth * 6);
      prop.root.position.copy(prop.anchor).add(prop.displacement);
      prop.root.visible = width >= 600 || layout.indexOf(prop.layout) % 2 === 0;
    });
    fish.forEach(swimmer => {
      swimmer.root.position.x = THREE.MathUtils.clamp(swimmer.root.position.x, -bound - 1, bound + 1);
      swimmer.root.visible = width >= 600 || swimmer.mobile;
    });
  }
  const loop = runSeaLoop(host, canvas, initiallyPaused, { update, resize, render: () => renderer.render(scene, camera) });

  return {
    setPaused: loop.setPaused,
    dispose() {
      loop.stop();
      species.forEach(model => [model.body, model.fins, model.pectoral, model.gill, model.eyeball, model.pupil].forEach(geometry => geometry.dispose()));
      shadowTexture.dispose();
      disposeRenderer(scene);
    },
  };
}
