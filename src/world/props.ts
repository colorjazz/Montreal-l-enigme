import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { City, StreetRec } from "./city";
import type { V2 } from "./geom";
import type { Physics } from "../core/physics";
import { Rng, hash01 } from "../core/rng";
import { worldUniforms } from "./materials";
import { SIDEWALK_Y } from "./city";
import { makeCanvasTexture } from "../core/textures";
import { pointInPoly } from "./geom";

/** Regroupe des instances par tranche spatiale pour que le frustum culling serve. */
class InstanceBuckets {
  private buckets = new Map<string, { m: THREE.Matrix4[]; c: THREE.Color[] }>();
  constructor(private size = 200) {}
  add(x: number, z: number, m: THREE.Matrix4, c?: THREE.Color) {
    const k = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
    let b = this.buckets.get(k);
    if (!b) this.buckets.set(k, (b = { m: [], c: [] }));
    b.m.push(m);
    if (c) b.c.push(c);
  }
  build(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, name: string, cast = true, receive = false): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const b of this.buckets.values()) {
      const im = new THREE.InstancedMesh(geo, mat, b.m.length);
      b.m.forEach((m, i) => im.setMatrixAt(i, m));
      if (b.c.length === b.m.length) b.c.forEach((c, i) => im.setColorAt(i, c));
      im.castShadow = cast;
      im.receiveShadow = receive;
      im.name = name;
      im.computeBoundingSphere();
      parent.add(im);
      out.push(im);
    }
    return out;
  }
  get count() {
    let n = 0;
    for (const b of this.buckets.values()) n += b.m.length;
    return n;
  }
}

const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function mat4(x: number, y: number, z: number, rotY = 0, s = 1, sy = s): THREE.Matrix4 {
  tmpQ.setFromAxisAngle(UP, rotY);
  tmpS.set(s, sy, s);
  tmpP.set(x, y, z);
  return new THREE.Matrix4().compose(tmpP, tmpQ, tmpS);
}

/** Feuillage : grappes de sphères déformées (érables d'automne). */
function canopyGeometry(seed: number, detail = 1, blobCount = 5): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const blobs = [
    [0, 0, 0, 1.0],
    [0.9, -0.25, 0.3, 0.75],
    [-0.8, -0.2, -0.4, 0.8],
    [0.2, 0.55, -0.5, 0.7],
    [-0.3, 0.4, 0.7, 0.65],
  ].slice(0, blobCount);
  const jitter = new Map<string, number>();
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r * 1.9, detail);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // même déplacement pour les sommets partagés : pas de fissures
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      let k = jitter.get(key);
      if (k === undefined) jitter.set(key, (k = 1 + (rng.float() - 0.5) * 0.3));
      pos.setXYZ(i, pos.getX(i) * k + x * 1.6, pos.getY(i) * k * 0.85 + y * 1.6, pos.getZ(i) * k + z * 1.6);
    }
    jitter.clear();
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  // ombrage de volume : plus sombre en bas
  const col: number[] = [];
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = 0.7 + 0.3 * THREE.MathUtils.smoothstep(p.getY(i), -2.5, 2.5);
    col.push(v, v, v);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function swayMaterial(mat: THREE.MeshStandardMaterial, key: string, amount = 0.12): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float ph = ip.x * 0.37 + ip.z * 0.21;
        float h = max(0.0, position.y + 1.5) * ${amount.toFixed(3)};
        transformed.x += sin(uTime * 1.3 + ph) * h * 0.25;
        transformed.z += cos(uTime * 1.1 + ph * 1.3) * h * 0.2;`,
      );
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

export const AUTUMN = ["#b8321f", "#c9461f", "#d9682a", "#e08a2c", "#e0a92b", "#d4b237", "#8a9a3a", "#6b8e3a", "#a33a2a", "#c25b26"];

export interface PropsStats {
  trees: number;
  lamps: number;
  signs: number;
  trafficLights: number;
  stops: number;
  benches: number;
  bins: number;
  hydrants: number;
  bixi: number;
  busStops: number;
  shopSigns: number;
  balconies: number;
}

export class StreetProps {
  readonly group = new THREE.Group();
  readonly stats: PropsStats = { trees: 0, lamps: 0, signs: 0, trafficLights: 0, stops: 0, benches: 0, bins: 0, hydrants: 0, bixi: 0, busStops: 0, shopSigns: 0, balconies: 0 };
  /** Feux de circulation : un disque par lampe, recoloré par le système de circulation. */
  signalLamps!: THREE.InstancedMesh;
  signalIndex: { inter: number; axis: 0 | 1; color: "r" | "y" | "g"; i: number }[] = [];
  lampPositions: THREE.Vector3[] = [];
  private treeLod: { mesh: THREE.InstancedMesh; hi: THREE.BufferGeometry; lo: THREE.BufferGeometry; center: THREE.Vector3 }[] = [];

  /** Niveau de détail du feuillage selon la distance à la caméra. */
  updateLod(cam: THREE.Vector3) {
    for (const t of this.treeLod) {
      const far = t.center.distanceTo(cam) > 170;
      const g = far ? t.lo : t.hi;
      if (t.mesh.geometry !== g) t.mesh.geometry = g;
      t.mesh.castShadow = !far;
    }
  }
  lightPools!: THREE.InstancedMesh;
  lampHeads: THREE.InstancedMesh[] = [];
  private lampHeadMat!: THREE.MeshStandardMaterial;
  benchSpots: { x: number; z: number; rot: number }[] = [];
  bixiStations: { x: number; z: number; rot: number; name: string }[] = [];
  busStops: { x: number; z: number; rot: number; line: string }[] = [];

  constructor(
    private city: City,
    private physics: Physics,
    private clearZones: V2[][] = [],
  ) {
    this.group.name = "mobilier";
    this.buildTrees();
    this.buildLamps();
    this.buildIntersections();
    this.buildFurniture();
    this.buildShopSigns();
    this.buildBalconies();
  }

  private collider(desc: import("@dimforge/rapier3d-compat").ColliderDesc) {
    this.physics.world.createCollider(desc, this.physics.fixedBody);
  }

  private playable(x: number, z: number, m = 30) {
    return this.city.inPlayable(x, z, m);
  }

  // ------------------------------------------------------------ arbres
  private buildTrees() {
    const R = this.physics.RAPIER;
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.22, 4.2, 6, 1, true).translate(0, 2.1, 0);
    // branches principales
    const br1 = new THREE.CylinderGeometry(0.05, 0.1, 2.0, 4, 1, true).rotateZ(0.7).translate(0.6, 4.2, 0);
    const br2 = new THREE.CylinderGeometry(0.05, 0.1, 1.8, 4, 1, true).rotateX(-0.6).translate(0, 4.1, 0.5);
    const trunk = mergeGeometries([trunkGeo, br1, br2])!;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3b30, roughness: 1 });
    const canopies = [canopyGeometry(1, 1, 4), canopyGeometry(2, 1, 4), canopyGeometry(3, 1, 4)];
    const canopiesLow = [canopyGeometry(1, 0, 3), canopyGeometry(2, 0, 3), canopyGeometry(3, 0, 3)];
    const leafMat = swayMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), "leaves");
    const trunkB = new InstanceBuckets(170);
    const canB = canopies.map(() => new InstanceBuckets(170));
    const data = this.city.data;
    const c = new THREE.Color();
    const keep: [number, number, number][] = [];
    const inPark = (x: number, z: number) => data.parks.some((p) => pointInPoly(x, z, p.poly));
    data.trees.forEach((t, i) => {
      if (!this.playable(t[0], t[1], 140)) return;
      if (this.clearZones.some((zp) => pointInPoly(t[0], t[1], zp))) return;
      // parcs plus aérés : pelouses dégagées
      if (inPark(t[0], t[1]) && hash01(i * 3 + 1) < 0.45) return;
      keep.push(t);
    });
    keep.forEach(([x, z, s], i) => {
      const h = hash01(i * 31 + 5);
      const rot = h * Math.PI * 2;
      const y = SIDEWALK_Y;
      trunkB.add(x, z, mat4(x, y, z, rot, s));
      c.set(AUTUMN[Math.floor(hash01(i * 7 + 1) * AUTUMN.length)]);
      c.offsetHSL(0, 0, (hash01(i * 13) - 0.5) * 0.08);
      canB[i % 3].add(x, z, mat4(x, y + 5.6 * s, z, rot, s * 1.05, s * 0.95), c.clone());
      if (this.playable(x, z, 5)) {
        this.collider(R.ColliderDesc.cylinder(2.1, 0.22).setTranslation(x, y + 2.1, z));
      }
    });
    trunkB.build(trunk, trunkMat, this.group, "troncs", true, false);
    canB.forEach((b, i) => {
      for (const im of b.build(canopies[i], leafMat, this.group, "feuillage", true, false)) {
        this.treeLod.push({ mesh: im, hi: canopies[i], lo: canopiesLow[i], center: im.boundingSphere!.center.clone() });
      }
    });
    this.stats.trees = keep.length;
  }

  // ------------------------------------------------------------ lampadaires
  private buildLamps() {
    const R = this.physics.RAPIER;
    // lampadaire de rue montréalais : fût galvanisé, crosse et tête « cobra »
    const pole = new THREE.CylinderGeometry(0.08, 0.13, 8.5, 6, 1, true).translate(0, 4.25, 0);
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 4, 1, true).rotateZ(Math.PI / 2 - 0.12).translate(1.15, 8.45, 0);
    const head = new THREE.BoxGeometry(0.9, 0.18, 0.38).translate(2.35, 8.55, 0);
    const base = new THREE.CylinderGeometry(0.2, 0.24, 0.5, 6, 1, true).translate(0, 0.25, 0);
    const lampGeo = mergeGeometries([pole, arm, head, base])!;
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.55, metalness: 0.6 });
    const lensGeo = new THREE.BoxGeometry(0.7, 0.04, 0.3).translate(2.35, 8.44, 0);
    this.lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffc77a, emissiveIntensity: 0 });
    const lampB = new InstanceBuckets(220);
    const lensB = new InstanceBuckets(220);
    const poolB = new InstanceBuckets(220);
    let n = 0;
    for (const [x, z, ang] of this.city.data.lamps) {
      if (!this.playable(x, z, 70)) continue;
      // la crosse pointe vers la chaussée : rotation autour de Y
      const rot = -ang;
      lampB.add(x, z, mat4(x, SIDEWALK_Y, z, rot));
      lensB.add(x, z, mat4(x, SIDEWALK_Y, z, rot));
      const hx = x + Math.cos(ang) * 2.35;
      const hz = z + Math.sin(ang) * 2.35;
      poolB.add(hx, hz, mat4(hx, 0.03, hz, 0, 1));
      this.lampPositions.push(new THREE.Vector3(hx, 8.4, hz));
      if (this.playable(x, z, 4)) this.collider(R.ColliderDesc.cylinder(4.25, 0.13).setTranslation(x, SIDEWALK_Y + 4.25, z));
      n++;
    }
    lampB.build(lampGeo, lampMat, this.group, "lampadaires", true, false);
    this.lampHeads = lensB.build(lensGeo, this.lampHeadMat, this.group, "lanternes", false, false);
    // halo au sol (flaque de lumière, additive)
    const poolTex = makeCanvasTexture(256, 256, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, "rgba(255,210,150,0.85)");
      g.addColorStop(0.45, "rgba(255,190,120,0.35)");
      g.addColorStop(1, "rgba(255,170,90,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, fog: true });
    const poolGeo = new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2);
    const pools = poolB.build(poolGeo, poolMat, this.group, "halos", false, false);
    this.lightPools = pools[0];
    this.poolMat = poolMat;
    this.stats.lamps = n;
  }
  private poolMat!: THREE.MeshBasicMaterial;

  /** Allume les lampadaires selon la nuit (0..1). */
  setNight(night: number) {
    this.lampHeadMat.emissiveIntensity = night * 3.2;
    this.poolMat.opacity = night * 1.0;
    for (const p of this.signsGlow) p.emissiveIntensity = 0.15 + night * 1.1;
  }
  private signsGlow: THREE.MeshStandardMaterial[] = [];

  // ------------------------------------------------------------ carrefours : plaques, feux, ARRÊT
  private buildIntersections() {
    const R = this.physics.RAPIER;
    const data = this.city.data;
    // atlas des plaques de rue (bleu, lettres blanches)
    const names = [...new Set(data.streets.filter((s) => s.name).map((s) => s.name))];
    const atlasW = 1024;
    const cellH = 96;
    const plateTex = makeCanvasTexture(atlasW, cellH * names.length, (ctx, w) => {
      names.forEach((name, i) => {
        const y = i * cellH;
        ctx.fillStyle = "#0b3a8c";
        ctx.fillRect(0, y, w, cellH);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 5;
        ctx.strokeRect(6, y + 6, w - 12, cellH - 12);
        ctx.fillStyle = "#ffffff";
        let size = 54;
        ctx.font = `bold ${size}px "DejaVu Sans", "Helvetica Neue", Arial, sans-serif`;
        while (ctx.measureText(name).width > w - 60 && size > 20) {
          size -= 2;
          ctx.font = `bold ${size}px "DejaVu Sans", "Helvetica Neue", Arial, sans-serif`;
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(name, w / 2, y + cellH / 2 + 2);
      });
    });
    plateTex.anisotropy = 8;
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5, metalness: 0.1 });
    const plates: THREE.BufferGeometry[] = [];
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 3.6, 6).translate(0, 1.8, 0);
    const poleB = new InstanceBuckets(400);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5d6166, metalness: 0.5, roughness: 0.5 });

    // feux
    const housingGeo = new THREE.BoxGeometry(0.34, 1.0, 0.28);
    const housingB = new InstanceBuckets(400);
    const tlPoleGeo = mergeGeometries([new THREE.CylinderGeometry(0.09, 0.11, 5.2, 8).translate(0, 2.6, 0)])!;
    const tlPoleB = new InstanceBuckets(400);
    const lampDiscs: THREE.Matrix4[] = [];

    // ARRÊT
    const stopTex = makeCanvasTexture(256, 256, (ctx, w, h) => {
      ctx.translate(w / 2, h / 2);
      ctx.rotate(Math.PI / 8);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) ctx.lineTo(Math.cos((i * Math.PI) / 4) * 124, Math.sin((i * Math.PI) / 4) * 124);
      ctx.closePath();
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < 8; i++) ctx.lineTo(Math.cos((i * Math.PI) / 4) * 112, Math.sin((i * Math.PI) / 4) * 112);
      ctx.closePath();
      ctx.fillStyle = "#c8102e";
      ctx.fill();
      ctx.rotate(-Math.PI / 8);
      ctx.fillStyle = "#ffffff";
      ctx.font = 'bold 66px "DejaVu Sans", Arial, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ARRÊT", 0, 4);
    });
    const stopGeo = new THREE.CircleGeometry(0.38, 8).rotateZ(Math.PI / 8);
    const stopMat = new THREE.MeshStandardMaterial({ map: stopTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
    const stopB = new InstanceBuckets(400);

    data.intersections.forEach((it, ii) => {
      if (!this.playable(it.p[0], it.p[1], 25)) return;
      const s1 = this.city.streetById.get(it.s[0])!;
      const s2 = this.city.streetById.get(it.s[1])!;
      const d1 = dirOf(s1);
      const d2 = dirOf(s2);
      // coins : P ± d1*(w2/2+sw2*0.6) ± d2*(w1/2+sw1*0.6)
      const corners: { p: V2; a: number; b: number }[] = [];
      for (const a of [1, -1])
        for (const b of [1, -1]) {
          const off2 = s2.w / 2 + s2.sw * 0.55;
          const off1 = s1.w / 2 + s1.sw * 0.55;
          const p: V2 = [it.p[0] + d1[0] * a * off2 + d2[0] * b * off1, it.p[1] + d1[1] * a * off2 + d2[1] * b * off1];
          corners.push({ p, a, b });
        }
      const onSidewalk = (p: V2) => this.city.data.sidewalks.some((s) => pointInPoly(p[0], p[1], s.outer) && !s.holes.some((h) => pointInPoly(p[0], p[1], h)));
      // plaques de rue sur un coin
      const c0 = corners.find((c) => onSidewalk(c.p));
      if (c0) {
        const [x, z] = c0.p;
        poleB.add(x, z, mat4(x, SIDEWALK_Y, z));
        if (this.playable(x, z, 3)) this.collider(R.ColliderDesc.cylinder(1.8, 0.06).setTranslation(x, SIDEWALK_Y + 1.8, z));
        [s1, s2].forEach((s, k) => {
          if (!s.name) return;
          const idx = names.indexOf(s.name);
          const d = k === 0 ? d1 : d2;
          const plate = new THREE.BoxGeometry(1.15, 0.24, 0.02);
          const uv = plate.attributes.uv as THREE.BufferAttribute;
          const v0 = 1 - (idx + 1) / names.length;
          const v1 = 1 - idx / names.length;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), v0 + uv.getY(i) * (v1 - v0));
          const ang = Math.atan2(-d[1], d[0]);
          plate.rotateY(ang);
          plate.translate(x + d[0] * 0.6, SIDEWALK_Y + 3.25 + k * 0.28, z + d[1] * 0.6);
          plates.push(plate);
          this.stats.signs++;
        });
      }
      if (it.kind === "light") {
        // un feu par coin, tourné vers la circulation entrante
        corners.forEach((c, ci) => {
          if (!onSidewalk(c.p)) return;
          const [x, z] = c.p;
          tlPoleB.add(x, z, mat4(x, SIDEWALK_Y, z));
          if (this.playable(x, z, 3)) this.collider(R.ColliderDesc.cylinder(2.6, 0.1).setTranslation(x, SIDEWALK_Y + 2.6, z));
          // deux têtes : une pour chaque axe
          for (const axis of [0, 1] as const) {
            const d = axis === 0 ? d1 : d2;
            const sgn = axis === 0 ? -c.a : -c.b;
            // la tête regarde vers les véhicules qui arrivent (sens opposé)
            const face: V2 = [d[0] * -sgn, d[1] * -sgn];
            const rot = Math.atan2(face[0], face[1]);
            const hx = x + face[0] * 0.25;
            const hz = z + face[1] * 0.25;
            const hy = SIDEWALK_Y + 4.3 + axis * 0.02;
            housingB.add(hx, hz, mat4(hx, hy, hz, rot));
            const colors: ("r" | "y" | "g")[] = ["r", "y", "g"];
            colors.forEach((col, k) => {
              const ly = hy + 0.3 - k * 0.3;
              const m = new THREE.Matrix4().compose(new THREE.Vector3(hx + face[0] * 0.15, ly, hz + face[1] * 0.15), new THREE.Quaternion().setFromAxisAngle(UP, rot), new THREE.Vector3(1, 1, 1));
              this.signalIndex.push({ inter: ii, axis, color: col, i: lampDiscs.length });
              lampDiscs.push(m);
            });
          }
          void ci;
          this.stats.trafficLights++;
        });
      } else {
        // ARRÊT sur les rues mineures
        corners.forEach((c) => {
          if (!onSidewalk(c.p) || hash01(ii * 11 + c.a * 3 + c.b) > 0.55) return;
          const [x, z] = c.p;
          const minor = s1.cat === "minor" ? s1 : s2;
          const d = minor === s1 ? d1 : d2;
          const sgn = minor === s1 ? c.a : c.b;
          const face: V2 = [d[0] * sgn, d[1] * sgn];
          const rot = Math.atan2(face[0], face[1]);
          poleB.add(x, z, mat4(x, SIDEWALK_Y, z, 0, 1, 0.75));
          stopB.add(x, z, mat4(x + face[0] * 0.06, SIDEWALK_Y + 2.35, z + face[1] * 0.06, rot));
          this.stats.stops++;
        });
      }
    });
    poleB.build(poleGeo, poleMat, this.group, "poteaux", true);
    if (plates.length) {
      const pm = new THREE.Mesh(mergeGeometries(plates)!, plateMat);
      pm.name = "plaques de rue";
      pm.castShadow = true;
      this.group.add(pm);
    }
    tlPoleB.build(tlPoleGeo, poleMat, this.group, "poteaux de feux", true);
    housingB.build(housingGeo, new THREE.MeshStandardMaterial({ color: 0x1d2a22, roughness: 0.6 }), this.group, "feux", true);
    stopB.build(stopGeo, stopMat, this.group, "ARRÊT", true);
    const discGeo = new THREE.CircleGeometry(0.11, 12);
    this.signalLamps = new THREE.InstancedMesh(discGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, lampDiscs.length));
    lampDiscs.forEach((m, i) => {
      this.signalLamps.setMatrixAt(i, m);
      this.signalLamps.setColorAt(i, new THREE.Color(0x222222));
    });
    this.signalLamps.name = "lampes de feux";
    this.signalLamps.frustumCulled = false;
    this.group.add(this.signalLamps);
  }

  // ------------------------------------------------------------ bancs, poubelles, bornes, BIXI, abribus
  private buildFurniture() {
    const R = this.physics.RAPIER;
    const rng = new Rng(77);
    // banc de parc (lattes de bois + pieds de fonte)
    const slats: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) slats.push(new THREE.BoxGeometry(1.8, 0.04, 0.09).translate(0, 0.45, -0.18 + i * 0.12));
    for (let i = 0; i < 3; i++) slats.push(new THREE.BoxGeometry(1.8, 0.09, 0.04).rotateX(-0.25).translate(0, 0.62 + i * 0.13, -0.28));
    const wood = mergeGeometries(slats)!;
    const legs = mergeGeometries([new THREE.BoxGeometry(0.06, 0.45, 0.5).translate(-0.75, 0.22, -0.05), new THREE.BoxGeometry(0.06, 0.45, 0.5).translate(0.75, 0.22, -0.05)])!;
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5132, roughness: 0.8 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x1f2a24, roughness: 0.5, metalness: 0.6 });
    const benchB = new InstanceBuckets();
    const legB = new InstanceBuckets();
    // poubelle (vert foncé)
    const binGeo = new THREE.CylinderGeometry(0.32, 0.28, 0.95, 12).translate(0, 0.48, 0);
    const binB = new InstanceBuckets();
    // borne-fontaine (rouge, chapeau jaune)
    const hyd = mergeGeometries([
      new THREE.CylinderGeometry(0.14, 0.16, 0.65, 10).translate(0, 0.33, 0),
      new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8).rotateZ(Math.PI / 2).translate(0, 0.45, 0),
    ])!;
    const hydCap = new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.65, 0);
    const hydB = new InstanceBuckets();
    const hydCapB = new InstanceBuckets();

    // le long des rues commerçantes : bancs et poubelles près des carrefours
    const data = this.city.data;
    for (const s of data.streets) {
      if (s.cat === "minor") continue;
      const d = dirOf(s);
      const n: V2 = [-d[1], d[0]];
      const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      for (let t = 20; t < L; t += rng.range(38, 60)) {
        for (const side of [1, -1]) {
          const off = s.w / 2 + 1.0;
          const x = s.a[0] + d[0] * t + n[0] * side * off;
          const z = s.a[1] + d[1] * t + n[1] * side * off;
          if (!this.playable(x, z, 2) || this.nearIntersection(x, z, 8)) continue;
          if (!this.isSidewalk(x, z)) continue;
          const rot = Math.atan2(-n[0] * side, -n[1] * side) + Math.PI;
          const r = rng.float();
          if (r < 0.35) {
            binB.add(x, z, mat4(x, SIDEWALK_Y, z));
            this.dynamicSpots.push({ kind: "bin", x, z });
            this.stats.bins++;
          } else if (r < 0.55) {
            const bx = x + n[0] * side * 0.9;
            const bz = z + n[1] * side * 0.9;
            const brot = Math.atan2(n[0] * side, n[1] * side);
            benchB.add(bx, bz, mat4(bx, SIDEWALK_Y, bz, brot));
            legB.add(bx, bz, mat4(bx, SIDEWALK_Y, bz, brot));
            this.benchSpots.push({ x: bx, z: bz, rot: brot });
            this.collider(R.ColliderDesc.cuboid(0.9, 0.3, 0.3).setTranslation(bx, SIDEWALK_Y + 0.3, bz).setRotation(quatY(brot)));
            this.stats.benches++;
          } else if (r < 0.68) {
            hydB.add(x, z, mat4(x, SIDEWALK_Y, z, rot));
            hydCapB.add(x, z, mat4(x, SIDEWALK_Y, z, rot));
            this.collider(R.ColliderDesc.cylinder(0.35, 0.16).setTranslation(x, SIDEWALK_Y + 0.35, z));
            this.stats.hydrants++;
          }
        }
      }
    }
    // bancs du parc Émilie-Gamelin et de la place Pasteur
    for (const p of data.parks) {
      if (!p.name) continue;
      const pts = p.poly;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const d: V2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        const inward: V2 = [-d[1], d[0]];
        for (let t = 8; t < L - 8; t += 14) {
          const x = a[0] + d[0] * t + inward[0] * 3.2;
          const z = a[1] + d[1] * t + inward[1] * 3.2;
          if (!pointInPoly(x, z, pts)) continue;
          const brot = Math.atan2(inward[0], inward[1]);
          benchB.add(x, z, mat4(x, SIDEWALK_Y, z, brot));
          legB.add(x, z, mat4(x, SIDEWALK_Y, z, brot));
          this.benchSpots.push({ x, z, rot: brot });
          this.collider(R.ColliderDesc.cuboid(0.9, 0.3, 0.3).setTranslation(x, SIDEWALK_Y + 0.3, z).setRotation(quatY(brot)));
          this.stats.benches++;
        }
      }
    }
    benchB.build(wood, woodMat, this.group, "bancs", true);
    legB.build(legs, ironMat, this.group, "pieds de bancs", true);
    binB.build(binGeo, new THREE.MeshStandardMaterial({ color: 0x24432f, roughness: 0.6, metalness: 0.3 }), this.group, "poubelles", true);
    hydB.build(hyd, new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5 }), this.group, "bornes-fontaines", true);
    hydCapB.build(hydCap, new THREE.MeshStandardMaterial({ color: 0xe8b923, roughness: 0.5 }), this.group, "chapeaux", true);
    this.buildBixi();
    this.buildBusStops();
  }

  /** Emplacements pour objets dynamiques (poubelles renversables, cônes). */
  dynamicSpots: { kind: string; x: number; z: number }[] = [];

  private buildBixi() {
    const R = this.physics.RAPIER;
    const spots: { x: number; z: number; d: V2; name: string }[] = [];
    const want: [string, string, number][] = [
      ["berri", "Berri / De Maisonneuve", 25],
      ["stdenis", "Saint-Denis / Ontario", -95],
      ["stecath", "Sainte-Catherine / Saint-Hubert", 100],
      ["emery", "Émery / Saint-Denis", -160],
    ];
    for (const [sid, name, t] of want) {
      const s = this.city.streetById.get(sid)!;
      const d = dirOf(s);
      const n: V2 = [-d[1], d[0]];
      // position le long de la rue, mesurée depuis l'origine projetée
      const t0 = -(s.a[0] * d[0] + s.a[1] * d[1]) + t;
      for (const side of [1, -1]) {
        const x = s.a[0] + d[0] * t0 + n[0] * side * (s.w / 2 + 0.9);
        const z = s.a[1] + d[1] * t0 + n[1] * side * (s.w / 2 + 0.9);
        if (this.isSidewalk(x, z) && !this.nearIntersection(x, z, 6)) {
          spots.push({ x, z, d, name });
          break;
        }
      }
    }
    const dockGeo = mergeGeometries([new THREE.BoxGeometry(0.18, 0.9, 0.35).translate(0, 0.45, 0)])!;
    const bike = bikeGeometry();
    const dockB = new InstanceBuckets();
    const bikeB = new InstanceBuckets();
    const kioskGeo = new THREE.BoxGeometry(0.6, 2.2, 0.4).translate(0, 1.1, 0);
    const kioskB = new InstanceBuckets();
    for (const sp of spots) {
      const rot = Math.atan2(sp.d[0], sp.d[1]);
      for (let i = 0; i < 9; i++) {
        const x = sp.x + sp.d[0] * (i * 0.8 - 3.2);
        const z = sp.z + sp.d[1] * (i * 0.8 - 3.2);
        dockB.add(x, z, mat4(x, SIDEWALK_Y, z, rot));
        if (i % 4 !== 3) bikeB.add(x, z, mat4(x, SIDEWALK_Y, z, rot + Math.PI / 2));
      }
      const kx = sp.x + sp.d[0] * 4.2;
      const kz = sp.z + sp.d[1] * 4.2;
      kioskB.add(kx, kz, mat4(kx, SIDEWALK_Y, kz, rot));
      this.collider(R.ColliderDesc.cuboid(0.4, 0.6, 3.6).setTranslation(sp.x, SIDEWALK_Y + 0.6, sp.z).setRotation(quatY(rot)));
      this.bixiStations.push({ x: sp.x, z: sp.z, rot, name: sp.name });
      this.stats.bixi++;
    }
    dockB.build(dockGeo, new THREE.MeshStandardMaterial({ color: 0x4a4f55, metalness: 0.6, roughness: 0.4 }), this.group, "bornes BIXI", true);
    bikeB.build(bike, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), this.group, "vélos BIXI", true);
    const kioskTex = makeCanvasTexture(128, 256, (ctx, w, h) => {
      ctx.fillStyle = "#d52b1e";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      ctx.font = 'bold 34px "DejaVu Sans", Arial, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("BIXI", w / 2, 60);
      ctx.fillStyle = "#222";
      ctx.fillRect(18, 90, w - 36, 70);
      ctx.fillStyle = "#9ad";
      ctx.fillRect(24, 96, w - 48, 58);
    });
    kioskB.build(kioskGeo, new THREE.MeshStandardMaterial({ map: kioskTex, roughness: 0.5 }), this.group, "kiosques BIXI", true);
  }

  private buildBusStops() {
    const R = this.physics.RAPIER;
    const want: [string, number, string][] = [
      ["berri", 60, "30 · Saint-Denis/Saint-Hubert"],
      ["stecath", -60, "15 · Sainte-Catherine"],
      ["ontario", 40, "125 · Ontario"],
      ["rene", -20, "150 · René-Lévesque"],
    ];
    const signTex = makeCanvasTexture(128, 256, (ctx, w) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, 256);
      ctx.fillStyle = "#0a4ea2";
      ctx.fillRect(0, 0, w, 90);
      ctx.fillStyle = "#fff";
      ctx.font = 'bold 40px "DejaVu Sans", Arial, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("STM", w / 2, 60);
      ctx.fillStyle = "#0a4ea2";
      ctx.font = 'bold 26px "DejaVu Sans", Arial, sans-serif';
      ctx.fillText("ARRÊT", w / 2, 140);
      ctx.font = '20px "DejaVu Sans", Arial, sans-serif';
      ctx.fillText("d'autobus", w / 2, 170);
      // pictogramme d'autobus
      ctx.fillRect(34, 190, 60, 36);
      ctx.fillStyle = "#fff";
      ctx.fillRect(40, 196, 48, 14);
    });
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfd9e6, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, depthWrite: false });
    const frame = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.6, roughness: 0.4 });
    const signMat = new THREE.MeshStandardMaterial({ map: signTex });
    for (const [sid, t, line] of want) {
      const s = this.city.streetById.get(sid)!;
      const d = dirOf(s);
      const n: V2 = [-d[1], d[0]];
      const t0 = -(s.a[0] * d[0] + s.a[1] * d[1]) + t;
      for (const side of [-1, 1]) {
        const off = s.w / 2 + 1.6;
        const x = s.a[0] + d[0] * t0 + n[0] * side * off;
        const z = s.a[1] + d[1] * t0 + n[1] * side * off;
        if (!this.isSidewalk(x, z) || this.nearIntersection(x, z, 10)) continue;
        const rot = Math.atan2(d[0], d[1]);
        const g = new THREE.Group();
        g.position.set(x, SIDEWALK_Y, z);
        g.rotation.y = rot;
        // abribus : toit, paroi arrière vitrée, côtés
        const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 3.6), frame);
        roof.position.set(0, 2.4, 0);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.1, 3.4), glass);
        back.position.set(side * 0.75, 1.2, 0);
        const sideA = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.1, 0.03), glass);
        sideA.position.set(0, 1.2, 1.7);
        const postGeo = new THREE.BoxGeometry(0.06, 2.4, 0.06);
        for (const [px, pz] of [
          [0.75, 1.75],
          [0.75, -1.75],
          [-0.75, 1.75],
          [-0.75, -1.75],
        ]) {
          const p = new THREE.Mesh(postGeo, frame);
          p.position.set(px, 1.2, pz);
          g.add(p);
        }
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 6), frame);
        pole.position.set(-side * 0.6, 1.4, -2.4);
        const sign = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.8, 0.42), signMat);
        sign.position.set(-side * 0.6, 2.5, -2.4);
        g.add(roof, back, sideA, pole, sign);
        g.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
        this.group.add(g);
        this.collider(R.ColliderDesc.cuboid(0.05, 1.1, 1.7).setTranslation(x + Math.cos(rot) * side * 0.75, SIDEWALK_Y + 1.1, z - Math.sin(rot) * side * 0.75).setRotation(quatY(rot)));
        this.busStops.push({ x, z, rot, line });
        this.stats.busStops++;
        break;
      }
    }
  }

  // ------------------------------------------------------------ enseignes de commerces
  private buildShopSigns() {
    const shops = SHOP_NAMES;
    const cellW = 512;
    const cellH = 112;
    const cols = 2;
    const rows = Math.ceil(shops.length / cols);
    const tex = makeCanvasTexture(cellW * cols, cellH * rows, (ctx) => {
      shops.forEach((s, i) => {
        const x = (i % cols) * cellW;
        const y = Math.floor(i / cols) * cellH;
        drawShopSign(ctx, x, y, cellW, cellH, s);
      });
    });
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 });
    this.signsGlow.push(mat);
    const geos: THREE.BufferGeometry[] = [];
    const awnings: THREE.BufferGeometry[] = [];
    const awnColors: number[] = [];
    let k = 0;
    const used = new Set<number>();
    for (const f of this.city.frontages) {
      if (!f.commercial || f.len < 4) continue;
      const mid: V2 = [(f.p0[0] + f.p1[0]) / 2, (f.p0[1] + f.p1[1]) / 2];
      if (!this.playable(mid[0], mid[1], 60)) continue;
      const h = hash01(f.building * 97 + Math.round(mid[0] * 3));
      let idx = Math.floor(h * shops.length);
      // évite de répéter la même enseigne côte à côte
      for (let t = 0; t < 5 && used.has(idx); t++) idx = (idx + 7) % shops.length;
      used.add(idx);
      if (used.size > shops.length * 0.6) used.clear();
      const w = Math.min(f.len - 1, 6.5);
      const g = new THREE.PlaneGeometry(w, w * (cellH / cellW) * 1.0);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const u0 = (idx % cols) / cols;
      const v0 = 1 - (Math.floor(idx / cols) + 1) / rows;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / cols, v0 + uv.getY(i) / rows);
      const rot = Math.atan2(f.normal[0], f.normal[1]);
      g.rotateY(rot);
      const y = f.groundH - 0.55;
      g.translate(mid[0] + f.normal[0] * 0.06, y, mid[1] + f.normal[1] * 0.06);
      geos.push(g);
      // auvents en toile pour certains commerces
      if (hash01(f.building * 13 + 5) < 0.4 && f.len > 4) {
        const aw = awningGeometry(Math.min(f.len - 1.5, 7));
        aw.rotateY(rot);
        aw.translate(mid[0], f.groundH - 1.2, mid[1]);
        awnings.push(aw);
        if (this.playable(mid[0], mid[1], 10)) {
          const aw2 = Math.min(f.len - 1.5, 7) / 2;
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5));
          this.collider(
            this.physics.RAPIER.ColliderDesc.cuboid(aw2, 0.04, 0.72)
              .setTranslation(mid[0] + f.normal[0] * 0.65, f.groundH - 1.2 + 0.42, mid[1] + f.normal[1] * 0.65)
              .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
          );
        }
        awnColors.push(AWNING_COLORS[Math.floor(hash01(f.building * 3) * AWNING_COLORS.length)]);
      }
      k++;
      // enseigne en drapeau perpendiculaire, de temps en temps
      if (hash01(f.building * 41 + 9) < 0.25) {
        const blade = new THREE.BoxGeometry(0.06, 0.7, 1.0);
        const buv = blade.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < buv.count; i++) buv.setXY(i, u0 + (buv.getX(i) * 0.5) / cols, v0 + buv.getY(i) / rows);
        blade.rotateY(rot);
        const ex = f.p0[0] + (f.p1[0] - f.p0[0]) * 0.15 + f.normal[0] * 0.6;
        const ez = f.p0[1] + (f.p1[1] - f.p0[1]) * 0.15 + f.normal[1] * 0.6;
        blade.translate(ex, f.groundH + 0.6, ez);
        geos.push(blade);
      }
    }
    if (geos.length) {
      const m = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))!, mat);
      m.name = "enseignes";
      m.castShadow = false;
      m.receiveShadow = true;
      this.group.add(m);
    }
    if (awnings.length) {
      awnings.forEach((g, i) => {
        const c = new THREE.Color(awnColors[i]);
        const n = g.attributes.position.count;
        const col = new Float32Array(n * 3);
        for (let j = 0; j < n; j++) {
          // rayures
          const stripe = Math.floor((g.attributes.uv.getX(j) * 10) % 2) === 0 ? 1 : 0.82;
          col[j * 3] = c.r * stripe;
          col[j * 3 + 1] = c.g * stripe;
          col[j * 3 + 2] = c.b * stripe;
        }
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      });
      const am = new THREE.Mesh(mergeGeometries(awnings)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
      am.castShadow = true;
      am.name = "auvents";
      this.group.add(am);
    }
    this.stats.shopSigns = k;
  }

  // ------------------------------------------------------------ balcons et escaliers extérieurs
  private buildBalconies() {
    const R = this.physics.RAPIER;
    const parts: THREE.BufferGeometry[] = [];
    let n = 0;
    for (const f of this.city.frontages) {
      if (f.commercial || f.len < 5 || f.street.cat === "major") continue;
      const b = this.city.data.buildings[f.building];
      if (!b || b.filler || b.landmark || !b.row) continue;
      if (!["brick_red", "greystone", "brick_cream", "painted"].includes(b.style)) continue;
      if (hash01(f.building * 59 + 1) > 0.6) continue;
      const mid: V2 = [(f.p0[0] + f.p1[0]) / 2, (f.p0[1] + f.p1[1]) / 2];
      if (!this.playable(mid[0], mid[1], 40)) continue;
      const d: V2 = [(f.p1[0] - f.p0[0]) / f.len, (f.p1[1] - f.p0[1]) / f.len];
      const nn = f.normal;
      const floors = Math.round((f.height - f.groundH) / 3.1) + 1;
      const bw = Math.min(f.len - 1.2, 5.5);
      const rot = Math.atan2(nn[0], nn[1]);
      const local = (lx: number, ly: number, lz: number): [number, number, number] => [mid[0] + d[0] * lx + nn[0] * lz, ly, mid[1] + d[1] * lx + nn[1] * lz];
      for (let fl = 1; fl < Math.min(floors, 3); fl++) {
        const y = SIDEWALK_Y + f.groundH + (fl - 1) * 3.1;
        // dalle
        const slab = new THREE.BoxGeometry(bw, 0.12, 1.3);
        slab.rotateY(rot);
        slab.translate(...local(0, y, 0.65));
        parts.push(slab);
        // garde-corps : main courante + barreaux
        const rail = new THREE.BoxGeometry(bw, 0.05, 0.05);
        rail.rotateY(rot);
        rail.translate(...local(0, y + 1.0, 1.28));
        parts.push(rail);
        for (let i = 0; i <= Math.floor(bw / 0.42); i++) {
          const bar = new THREE.CylinderGeometry(0.014, 0.014, 1.0, 3, 1, true);
          bar.translate(...local(-bw / 2 + i * 0.42, y + 0.5, 1.28));
          parts.push(bar);
        }
      }
      // escalier extérieur droit, du trottoir au premier balcon (le long de la façade)
      const topY = SIDEWALK_Y + f.groundH;
      const steps = Math.round((topY - SIDEWALK_Y) / 0.21);
      const rise = (topY - SIDEWALK_Y) / steps;
      const run = steps * 0.27;
      if (hash01(f.building * 7 + 3) < 0.7) {
        const xEnd = -bw / 2; // haut de l'escalier : bout du balcon
        for (let i = 0; i < steps; i++) {
          const st = new THREE.BoxGeometry(0.29, 0.05, 1.0);
          st.rotateY(rot);
          st.translate(...local(xEnd - run + (i + 0.5) * 0.27, SIDEWALK_Y + (i + 1) * rise - 0.025, 0.65));
          parts.push(st);
        }
        // limons et main courante
        const len = Math.hypot(run, topY - SIDEWALK_Y);
        const theta = Math.atan2(topY - SIDEWALK_Y, run);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -theta));
        for (const [zz, yy] of [
          [0.13, 0],
          [1.17, 0],
          [1.17, 0.95],
        ]) {
          const str = new THREE.BoxGeometry(len, 0.07, 0.05);
          str.applyQuaternion(q);
          str.translate(...local(xEnd - run / 2, SIDEWALK_Y + (topY - SIDEWALK_Y) / 2 + yy, zz));
          parts.push(str);
        }
        // rampe physique : on peut monter sur le balcon
        const c = local(xEnd - run / 2, SIDEWALK_Y + (topY - SIDEWALK_Y) / 2 - 0.02, 0.65);
        this.collider(R.ColliderDesc.cuboid(len / 2, 0.04, 0.5).setTranslation(c[0], c[1], c[2]).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
        this.collider(
          R.ColliderDesc.cuboid(bw / 2, 0.06, 0.65)
            .setTranslation(...local(0, topY - 0.06, 0.65))
            .setRotation(quatY(rot)),
        );
        // garde-corps physique
        this.collider(
          R.ColliderDesc.cuboid(bw / 2, 0.5, 0.03)
            .setTranslation(...local(0, topY + 0.5, 1.28))
            .setRotation(quatY(rot)),
        );
      }
      n++;
    }
    if (parts.length) {
      const m = new THREE.Mesh(mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!, new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.55, metalness: 0.5 }));
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = "balcons";
      this.group.add(m);
    }
    this.stats.balconies = n;
  }

  // ------------------------------------------------------------ utilitaires
  isSidewalk(x: number, z: number): boolean {
    for (const s of this.city.data.sidewalks) {
      if (pointInPoly(x, z, s.outer) && !s.holes.some((h) => pointInPoly(x, z, h))) return true;
    }
    return false;
  }

  nearIntersection(x: number, z: number, margin: number): boolean {
    for (const it of this.city.data.intersections) {
      const s1 = this.city.streetById.get(it.s[0])!;
      const s2 = this.city.streetById.get(it.s[1])!;
      const r = Math.max(s1.w, s2.w) / 2 + margin;
      if (Math.hypot(x - it.p[0], z - it.p[1]) < r) return true;
    }
    return false;
  }
}

export function dirOf(s: StreetRec): V2 {
  const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
  return [(s.b[0] - s.a[0]) / L, (s.b[1] - s.a[1]) / L];
}

export function quatY(angle: number) {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

function bikeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const colorize = (g: THREE.BufferGeometry, c: number) => {
    const col = new THREE.Color(c);
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = col.r;
      a[i * 3 + 1] = col.g;
      a[i * 3 + 2] = col.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const wheel = (x: number) => colorize(new THREE.TorusGeometry(0.33, 0.035, 6, 18).translate(x, 0.36, 0), 0x1a1a1a);
  parts.push(wheel(-0.52), wheel(0.52));
  parts.push(colorize(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 6).rotateZ(1.2).translate(0.05, 0.62, 0), 0xd52b1e));
  parts.push(colorize(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 6).rotateZ(-0.4).translate(-0.3, 0.6, 0), 0x2b2b2b));
  parts.push(colorize(new THREE.BoxGeometry(0.42, 0.18, 0.32).translate(0.55, 0.88, 0), 0x2b2b2b)); // panier avant
  parts.push(colorize(new THREE.BoxGeometry(0.22, 0.05, 0.12).translate(-0.3, 0.92, 0), 0x111111)); // selle
  parts.push(colorize(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5).rotateX(Math.PI / 2).translate(0.42, 1.0, 0), 0x333333));
  return mergeGeometries(parts)!;
}

function awningGeometry(w: number): THREE.BufferGeometry {
  // toile inclinée vers la rue (+Z local) + lambrequin
  const g = new THREE.BufferGeometry();
  const d = 1.3;
  const drop = 0.7;
  const pos = [-w / 2, 0.75, 0.02, w / 2, 0.75, 0.02, w / 2, 0.05, d, -w / 2, 0.05, d, -w / 2, 0.05, d, w / 2, 0.05, d, w / 2, -0.25, d, -w / 2, -0.25, d];
  void drop;
  const uv = [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0];
  const idx = [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6];
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv.map((v, i) => (i % 2 === 0 ? v * w : v)), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

const AWNING_COLORS = [0x1f5c3f, 0x8c1c13, 0x1b3a6b, 0xc9a227, 0x5b2a5e, 0x2f2f2f, 0xa4471f];

export interface ShopSign {
  name: string;
  kind: string;
  bg: string;
  fg: string;
  font?: "serif" | "sans" | "script";
}

export const SHOP_NAMES: ShopSign[] = [
  { name: "Dépanneur du Coin", kind: "Bière · Vin · Loto", bg: "#c8102e", fg: "#ffffff" },
  { name: "Boulangerie Saint-Denis", kind: "Pain artisanal", bg: "#f3e6c8", fg: "#5a3a1a", font: "serif" },
  { name: "Café Gamelin", kind: "Espresso · Pâtisseries", bg: "#2b1b12", fg: "#e8c48a", font: "serif" },
  { name: "Librairie du Quartier", kind: "Livres neufs et usagés", bg: "#1d3557", fg: "#f1faee", font: "serif" },
  { name: "Pharmacie Berri", kind: "Ordonnances", bg: "#ffffff", fg: "#0a7d3b" },
  { name: "Friperie Latine", kind: "Vêtements vintage", bg: "#6d2e46", fg: "#f6d7a7" },
  { name: "Poutinerie La Patate", kind: "Poutine · Hot-dogs", bg: "#f2b705", fg: "#2b2b2b" },
  { name: "Crêperie Bretonne", kind: "Crêpes et galettes", bg: "#2d4a7a", fg: "#ffffff", font: "serif" },
  { name: "Fleuriste Rose-Marie", kind: "Bouquets", bg: "#f7d6e0", fg: "#7a1f3d", font: "script" },
  { name: "Salon de coiffure Élégance", kind: "Coupe · Couleur", bg: "#111111", fg: "#e5c07b", font: "script" },
  { name: "Quincaillerie Berri", kind: "Outils · Peinture", bg: "#e85d04", fg: "#ffffff" },
  { name: "Épicerie Fine", kind: "Fromages · Charcuteries", bg: "#283618", fg: "#fefae0", font: "serif" },
  { name: "Bistro Chez Émile", kind: "Table d'hôte", bg: "#7f1d1d", fg: "#fde68a", font: "serif" },
  { name: "Pizzeria Napoli", kind: "Four à bois", bg: "#1b5e20", fg: "#ffffff" },
  { name: "Cinéma Quartier Latin", kind: "Films en français", bg: "#0b0b0b", fg: "#ffcc00" },
  { name: "Bureau de poste", kind: "Postes Canada", bg: "#d52b1e", fg: "#ffffff" },
  { name: "Caisse populaire", kind: "Guichet automatique", bg: "#00704a", fg: "#ffffff" },
  { name: "Disquaire Vinyle", kind: "Disques · Platines", bg: "#3c096c", fg: "#ffd60a" },
  { name: "Papeterie Le Crayon", kind: "Fournitures scolaires", bg: "#fefae0", fg: "#bc6c25", font: "serif" },
  { name: "Salon de thé Earl Grey", kind: "Thés du monde", bg: "#e9edc9", fg: "#344e41", font: "script" },
  { name: "Bagels Saint-Viateur", kind: "Cuits au bois", bg: "#fff3d6", fg: "#3d2b1f", font: "serif" },
  { name: "Fromagerie du Marché", kind: "Fromages du Québec", bg: "#ffd166", fg: "#3d2b1f" },
  { name: "Nettoyeur Express", kind: "Nettoyage à sec", bg: "#e0fbfc", fg: "#3d5a80" },
  { name: "Clinique dentaire", kind: "Urgences", bg: "#ffffff", fg: "#1d3557" },
  { name: "Smoked meat Chez Ben", kind: "Depuis 1952", bg: "#9d0208", fg: "#ffba08" },
  { name: "Brasserie Le Houblon", kind: "Bières de microbrasserie", bg: "#432818", fg: "#ffe6a7", font: "serif" },
  { name: "Tabagie Ste-Catherine", kind: "Journaux · Loto-Québec", bg: "#14213d", fg: "#fca311" },
  { name: "Atelier Vélo Libre", kind: "Réparations", bg: "#2a9d8f", fg: "#ffffff" },
  { name: "Sandwicherie Le Midi", kind: "Soupes · Sandwichs", bg: "#f4a261", fg: "#264653" },
  { name: "Bar Le Saint-Laurent", kind: "Spectacles", bg: "#240046", fg: "#ff6d00" },
  { name: "Restaurant Le Vieux Port", kind: "Fruits de mer", bg: "#003049", fg: "#fcbf49", font: "serif" },
  { name: "Boutique Souvenirs", kind: "Sirop d'érable", bg: "#c1121f", fg: "#fdf0d5" },
  { name: "Optométriste", kind: "Examens de la vue", bg: "#ffffff", fg: "#457b9d" },
  { name: "Comptoir à pho", kind: "Cuisine vietnamienne", bg: "#bc4749", fg: "#f2e8cf" },
  { name: "À LOUER", kind: "514-555-0199", bg: "#ffffff", fg: "#d00000" },
  { name: "Marché Tradition", kind: "Fruits et légumes", bg: "#386641", fg: "#f2e8cf" },
];

function drawShopSign(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: ShopSign) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = s.fg;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.globalAlpha = 1;
  ctx.fillStyle = s.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const family = s.font === "serif" ? 'Georgia, "DejaVu Serif", serif' : s.font === "script" ? '"Brush Script MT", "URW Chancery L", Georgia, cursive' : '"DejaVu Sans", "Trebuchet MS", Arial, sans-serif';
  let size = 46;
  const weight = s.font === "script" ? "italic bold" : "bold";
  ctx.font = `${weight} ${size}px ${family}`;
  while (ctx.measureText(s.name).width > w - 40 && size > 18) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  ctx.fillText(s.name, w / 2, h * 0.42);
  ctx.font = `18px ${family}`;
  ctx.globalAlpha = 0.85;
  ctx.fillText(s.kind, w / 2, h * 0.8);
  ctx.restore();
}
