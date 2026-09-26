import * as THREE from "three";
import { createSeaRenderer, readSeaPalette, runSeaLoop, type SeaScene } from "./sea-renderer";

// World units shown across the strip's height; the camera tilt matches the sea scene below.
const VIEW_TOP = .42, VIEW_BOTTOM = -.78;
const SURFACE_BACK = -3, CURTAIN_DEPTH = .95;

// Gerstner swells: [direction x, direction z, wavelength, steepness]. Big lazy swells shape the
// silhouette; the short ones only add glints across the surface.
const WAVES = [[1, .05, 7.2, .22], [.9, .44, 3.1, .15], [.5, -.87, 1.35, .1], [-.3, .95, .72, .08]];

const GERSTNER = /* glsl */ `
uniform float uTime;
varying vec2 vRest;
varying float vHeight;
vec3 gerstner(vec2 point, vec4 wave, inout vec3 tangent, inout vec3 binormal) {
  vec2 direction = normalize(wave.xy);
  float k = 6.28318 / wave.z;
  float f = k * (dot(direction, point) - sqrt(9.8 / k) * .32 * uTime);
  float a = wave.w / k;
  tangent += vec3(-direction.x * direction.x * wave.w * sin(f), direction.x * wave.w * cos(f), -direction.x * direction.y * wave.w * sin(f));
  binormal += vec3(-direction.x * direction.y * wave.w * sin(f), direction.y * wave.w * cos(f), -direction.y * direction.y * wave.w * sin(f));
  return vec3(direction.x * a * cos(f), a * sin(f), direction.y * a * cos(f));
}
vec3 swell(vec2 point, out vec3 normal) {
  vec3 tangent = vec3(1., 0., 0.), binormal = vec3(0., 0., 1.), offset = vec3(0.);
${WAVES.map(([x, z, length, steepness]) =>
    `  offset += gerstner(point, vec4(${x.toFixed(3)}, ${z.toFixed(3)}, ${length.toFixed(3)}, ${steepness.toFixed(3)}), tangent, binormal);`).join("\n")}
  normal = normalize(cross(binormal, tangent));
  return offset;
}
`;

function waving(material: THREE.Material, uniforms: { uTime: { value: number } }, vertex: string, fragment = "") {
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = GERSTNER + shader.vertexShader
      .replace("#include <beginnormal_vertex>", vertex)
      .replace("#include <begin_vertex>", "vec3 transformed = waved;");
    shader.fragmentShader = "uniform float uTime;\nvarying vec2 vRest;\nvarying float vHeight;\n" + shader.fragmentShader
      .replace("#include <color_fragment>", `#include <color_fragment>\n${fragment}`);
  };
  return material;
}

/** A lit, reflective water surface seen edge-on, replacing the flat SVG wave strip. */
export function createWaveScene(host: HTMLDivElement, initiallyPaused: boolean): SeaScene {
  const { renderer, canvas, environment, dispose: disposeRenderer } = createSeaRenderer(host, "waveCanvas");
  const palette = readSeaPalette(host);
  const computed = getComputedStyle(host);
  const waterMid = new THREE.Color(computed.getPropertyValue("--water-mid").trim() || "#9fd5e6");
  const foam = new THREE.Color(computed.getPropertyValue("--foam").trim() || "#ffffff");
  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.environmentIntensity = .55;
  const camera = new THREE.OrthographicCamera(-10, 10, VIEW_TOP, VIEW_BOTTOM, .1, 60);
  camera.position.set(0, 6.8, 18);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(palette.water, palette.waterDeep, 1.3));
  const sun = new THREE.DirectionalLight(foam, 2.2);
  sun.position.set(-4, 8, 6);
  scene.add(sun);
  const uniforms = { uTime: { value: 0 } };

  const surfaceMaterial = waving(new THREE.MeshPhysicalMaterial({
    color: waterMid, roughness: .16, clearcoat: .6, clearcoatRoughness: .12, sheen: .4, sheenColor: palette.water,
  }), uniforms, /* glsl */ `
    vec3 objectNormal;
    vec3 waved = position + swell(position.xz, objectNormal);
    vRest = position.xz;
    vHeight = waved.y;`, /* glsl */ `
    float crest = smoothstep(.1, .2, vHeight);
    float lip = smoothstep(-.34 + .06 * sin(vRest.x * 2.7 + uTime * .8), -.06, vRest.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${palette.waterDeep.toArray().map(value => value.toFixed(4)).join(", ")}), smoothstep(-.2, -.9, vRest.y) * .18);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${foam.toArray().map(value => value.toFixed(4)).join(", ")}), max(crest * .45, lip * .92));`);
  const surface = new THREE.Mesh(new THREE.BufferGeometry(), surfaceMaterial);
  scene.add(surface);

  // The water body directly under the surface: deep blue at the lip, fading into the viewport.
  const curtainMaterial = waving(new THREE.MeshStandardMaterial({
    color: palette.waterDeep, roughness: .5, transparent: true, depthWrite: false,
  }), uniforms, /* glsl */ `
    vec3 surfaceNormal;
    float hang = pow(clamp(1. + position.y / ${CURTAIN_DEPTH.toFixed(2)}, 0., 1.), 1.6);
    vec3 waved = position + swell(position.xz, surfaceNormal) * hang;
    vec3 objectNormal = normalize(vec3(surfaceNormal.x * hang * .6, .15, 1.));
    vRest = position.xy;
    vHeight = hang;`, /* glsl */ `
    diffuseColor.rgb = mix(diffuseColor.rgb * .72, diffuseColor.rgb * 1.08, smoothstep(.55, 1., vHeight));
    diffuseColor.a *= smoothstep(0., .55, vHeight);`);
  const curtain = new THREE.Mesh(new THREE.BufferGeometry(), curtainMaterial);
  curtain.renderOrder = 1;
  scene.add(curtain);

  let builtWidth = 0;
  function build(width: number) {
    surface.geometry.dispose();
    curtain.geometry.dispose();
    const columns = Math.ceil(width * 14);
    const surfaceGeometry = new THREE.PlaneGeometry(width, -SURFACE_BACK, columns, 28);
    surfaceGeometry.rotateX(-Math.PI / 2);
    surfaceGeometry.translate(0, 0, SURFACE_BACK / 2);
    surface.geometry = surfaceGeometry;
    const curtainGeometry = new THREE.PlaneGeometry(width, CURTAIN_DEPTH, columns, 12);
    curtainGeometry.translate(0, -CURTAIN_DEPTH / 2, 0);
    curtain.geometry = curtainGeometry;
    builtWidth = width;
  }

  const loop = runSeaLoop(host, canvas, initiallyPaused, {
    update(delta) { uniforms.uTime.value += delta; },
    render() { renderer.render(scene, camera); },
    resize(width, height) {
      const half = (VIEW_TOP - VIEW_BOTTOM) * width / height / 2;
      camera.left = -half;
      camera.right = half;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      // Overscan so horizontal Gerstner drift never exposes the ends of the mesh.
      if (half * 2 + 2 > builtWidth) build(Math.ceil(half * 2 + 6));
    },
  });

  return {
    setPaused: loop.setPaused,
    dispose() {
      loop.stop();
      disposeRenderer(scene);
    },
  };
}
