// SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
// Optional 3D site view. Loaded lazily; if WebGL or the CDN fails, the planner is unaffected.
// Lighting comes from core.sunlightMap (validated shadow test), NOT from the renderer's shadow maps.
// True vertical scale. A ring at 60 km is the full LOLA terrain horizon (computeHorizon), so Sun/Earth are hidden exactly
// as in the sky chart even though the mesh only covers +-HALF km.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as C from "./core.js";

const HALF = 15, CELL = 0.24, WALL_KM = 60, SKY_KM = 300;
let renderer, scene, camera, controls, terrain, wall, sun, sunGlow, earth, pole, container, cur = null, eye = false;

export function init(el) {
  container = el;
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  el.appendChild(renderer.domElement);
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x020308);
  camera = new THREE.PerspectiveCamera(50, 1, 0.005, 2000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxDistance = 50; controls.minDistance = 0.02;
  sun = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
  const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,220,120,0.9)"); gr.addColorStop(1, "rgba(255,200,80,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false }));
  earth = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: 0x5aa0ff }));
  scene.add(sun, sunGlow, earth);
  new ResizeObserver(resize).observe(el); resize();
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
  camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}

// local frame: three (x, y, z) = (east, up, -north) in km, origin at the site's ground point
const toLocal = (site, q) => { const d = [q[0] - site.p[0], q[1] - site.p[1], q[2] - site.p[2]];
  const dot = (a) => d[0] * a[0] + d[1] * a[1] + d[2] * a[2]; return [dot(site.east), dot(site.up), -dot(site.north)]; };
const dirLocal = (az, el) => { const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180; return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)]; };

/** Rebuild terrain + horizon ring for a site. hz = computeHorizon result for this site (any mast height). */
export function setSite(dem, siteInfo, hz, color) {
  for (const o of [terrain, wall, pole]) if (o) { scene.remove(o); o.geometry.dispose(); }
  const [x0, y0] = C.latlonToXY(siteInfo.lat, siteInfo.lon), h0 = C.heightKm(dem, x0, y0);
  const site = C.makeSite(siteInfo.lat, siteInfo.lon, C.R + h0), n = Math.round((2 * HALF) / CELL) + 1;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 - HALF + i * CELL, y = y0 + HALF - j * CELL; let h = C.heightKm(dem, x, y); if (Number.isNaN(h)) h = h0;
    const u = C.unitFromXY(x, y), q = [u[0] * (C.R + h), u[1] * (C.R + h), u[2] * (C.R + h)];
    pos.set(toLocal(site, q), 3 * (j * n + i));
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * n * 3).fill(0.3), 3));
  terrain = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
  // horizon ring from the validated terrain horizon
  const N = C.N_AZ, wp = new Float32Array((N + 1) * 2 * 3);
  for (let k = 0; k <= N; k++) {
    const az = ((k % N) + 0.5) * (360 / N), d = dirLocal(az, 0), top = WALL_KM * Math.tan((hz.el[k % N] * Math.PI) / 180);
    wp.set([d[0] * WALL_KM, -20, d[2] * WALL_KM, d[0] * WALL_KM, top + hz.site.radiusKm - site.radiusKm, d[2] * WALL_KM], 6 * k);
  }
  const widx = []; for (let k = 0; k < N; k++) { const a = 2 * k; widx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.BufferAttribute(wp, 3)); wg.setIndex(widx);
  wall = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: 0x23262e, side: THREE.DoubleSide }));
  pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8).translate(0, 0.4, 0), new THREE.MeshBasicMaterial({ color }));
  scene.add(terrain, wall, pole);
  cur = { site, hzSite: hz.site, n, x0, y0, color };
  setEye(eye);
  return { x0, y0, half: HALF, cell: CELL };
}

/** Update Sun/Earth and terrain colours. st = core.stateAt for this site; frac = sunlightMap on the same grid. */
export function setTime(st, frac, mastM) {
  if (!cur) return;
  const sd = dirLocal(st.sunAz, st.sunEl), ed = dirLocal(st.earthAz, st.earthEl);
  const sr = SKY_KM * Math.tan((C.SUN_RADIUS_DEG * Math.PI) / 180), er = SKY_KM * Math.tan((st.earthR * Math.PI) / 180);
  sun.position.set(sd[0] * SKY_KM, sd[1] * SKY_KM, sd[2] * SKY_KM); sun.scale.setScalar(sr);
  sunGlow.position.copy(sun.position); sunGlow.scale.setScalar(sr * 8); sunGlow.visible = st.sunFrac > 0;
  earth.position.set(ed[0] * SKY_KM, ed[1] * SKY_KM, ed[2] * SKY_KM); earth.scale.setScalar(er);
  if (frac) {
    const nrm = terrain.geometry.getAttribute("normal"), col = terrain.geometry.getAttribute("color");
    for (let k = 0; k < cur.n * cur.n; k++) {
      const f = frac[k], lam = Math.max(0, nrm.getX(k) * sd[0] + nrm.getY(k) * sd[1] + nrm.getZ(k) * sd[2]);
      const v = Number.isNaN(f) ? 0.1 : f >= C.LIT ? 0.16 + 0.8 * Math.sqrt(lam) : 0.035;
      col.setXYZ(k, v, v * 0.97, v * 0.92);
    }
    col.needsUpdate = true;
  }
}

function placeEye(mastM = 2, st) {
  const hgt = Math.max(0.002, mastM / 1000);
  camera.position.set(0, hgt, 0);
  const d = st ? dirLocal(st.sunAz, 0) : [0, 0, -1];
  controls.target.set(d[0] * 0.01, hgt, d[2] * 0.01); controls.update();
}
export function setEye(on, mastM, st) {
  eye = on;
  controls.enableZoom = !on; controls.enablePan = !on;
  if (on) placeEye(mastM, st);
  else { camera.position.set(0, 9, 22); controls.target.set(0, 0, 0); controls.update(); }
}
