import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Rng } from "../core/rng";

/**
 * Personnage humanoïde procédural : un seul SkinnedMesh (pièces rigides
 * liées chacune à un os), animé par un cycle de marche procédural.
 */

export type HairStyle = "short" | "long" | "bun" | "bald" | "curly" | "ponytail" | "mohawk";
export type TopStyle = "tshirt" | "jacket" | "hoodie" | "coat" | "sweater" | "dress" | "vest";
export type BottomStyle = "pants" | "jeans" | "skirt" | "shorts";
export type HatStyle = "tuque" | "cap" | "beret" | "helmet" | "none";

export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  top: string;
  topStyle: TopStyle;
  bottom: string;
  bottomStyle: BottomStyle;
  shoes: string;
  hat: HatStyle;
  hatColor: string;
  backpack?: string;
  scarf?: string;
  glasses?: boolean;
  beard?: boolean;
  height: number;
  build: number;
  vest?: string; // dossard (ouvrier, policier)
}

export const SKINS = ["#f2d3b8", "#e8be9c", "#d9a27e", "#c68a63", "#a96d48", "#8a5536", "#6b3f26", "#f5dccb"];
const HAIRS = ["#1b1410", "#2e1f15", "#4a3020", "#6b4a2b", "#8c6239", "#b88a52", "#d9b77a", "#9a9a9a", "#e8e2d6", "#7a2a14"];
const TOPS = ["#1d3557", "#e63946", "#2a9d8f", "#f4a261", "#264653", "#6d597a", "#b56576", "#3d405b", "#81b29a", "#e07a5f", "#222222", "#f1faee", "#8d99ae", "#bc4749", "#386641", "#003049", "#d62828", "#5e548e", "#c9ada7", "#e9c46a"];
const BOTTOMS = ["#22223b", "#2b2d42", "#3a5a78", "#4a4e69", "#1b263b", "#5c4033", "#2f3e46", "#6c757d", "#344e41", "#0d1b2a"];
const SHOES = ["#111111", "#3b2a20", "#f1f1f1", "#6b4226", "#22333b", "#9d0208"];

export function randomLook(rng: Rng, over: Partial<Look> = {}): Look {
  const fem = rng.chance(0.5);
  const look: Look = {
    skin: rng.pick(SKINS),
    hair: rng.pick(HAIRS),
    hairStyle: fem ? rng.pick(["long", "bun", "ponytail", "curly", "short"] as HairStyle[]) : rng.pick(["short", "short", "curly", "bald", "mohawk", "long"] as HairStyle[]),
    top: rng.pick(TOPS),
    topStyle: rng.pick(["tshirt", "jacket", "hoodie", "coat", "sweater", "jacket", "coat", fem ? "dress" : "vest"] as TopStyle[]),
    bottom: rng.pick(BOTTOMS),
    bottomStyle: fem ? rng.pick(["jeans", "pants", "skirt", "jeans"] as BottomStyle[]) : rng.pick(["jeans", "pants", "jeans", "shorts"] as BottomStyle[]),
    shoes: rng.pick(SHOES),
    hat: rng.chance(0.35) ? rng.pick(["tuque", "tuque", "cap", "beret"] as HatStyle[]) : "none",
    hatColor: rng.pick(TOPS),
    backpack: rng.chance(0.3) ? rng.pick(TOPS) : undefined,
    scarf: rng.chance(0.3) ? rng.pick(TOPS) : undefined,
    glasses: rng.chance(0.25),
    beard: !fem && rng.chance(0.3),
    height: rng.range(0.92, 1.06) * (fem ? 0.97 : 1.02),
    build: rng.range(0.9, 1.12),
  };
  if (look.topStyle === "dress") look.bottomStyle = "skirt";
  return { ...look, ...over };
}

// ------------------------------------------------------------ squelette
export const BONES = ["root", "hips", "spine", "chest", "neck", "head", "upperArmL", "forearmL", "handL", "upperArmR", "forearmR", "handR", "thighL", "shinL", "footL", "thighR", "shinR", "footR"] as const;
export type BoneName = (typeof BONES)[number];

const PARENT: Record<BoneName, BoneName | null> = {
  root: null,
  hips: "root",
  spine: "hips",
  chest: "spine",
  neck: "chest",
  head: "neck",
  upperArmL: "chest",
  forearmL: "upperArmL",
  handL: "forearmL",
  upperArmR: "chest",
  forearmR: "upperArmR",
  handR: "forearmR",
  thighL: "hips",
  shinL: "thighL",
  footL: "shinL",
  thighR: "hips",
  shinR: "thighR",
  footR: "shinR",
};

function bindPositions(build: number): Record<BoneName, THREE.Vector3> {
  const sx = 0.19 * build;
  return {
    root: new THREE.Vector3(0, 0, 0),
    hips: new THREE.Vector3(0, 0.95, 0),
    spine: new THREE.Vector3(0, 1.07, 0),
    chest: new THREE.Vector3(0, 1.29, 0),
    neck: new THREE.Vector3(0, 1.5, 0),
    head: new THREE.Vector3(0, 1.58, 0),
    upperArmL: new THREE.Vector3(sx, 1.45, 0),
    forearmL: new THREE.Vector3(sx + 0.01, 1.17, 0),
    handL: new THREE.Vector3(sx + 0.015, 0.93, 0),
    upperArmR: new THREE.Vector3(-sx, 1.45, 0),
    forearmR: new THREE.Vector3(-sx - 0.01, 1.17, 0),
    handR: new THREE.Vector3(-sx - 0.015, 0.93, 0),
    thighL: new THREE.Vector3(0.095, 0.93, 0),
    shinL: new THREE.Vector3(0.095, 0.51, 0),
    footL: new THREE.Vector3(0.095, 0.1, 0),
    thighR: new THREE.Vector3(-0.095, 0.93, 0),
    shinR: new THREE.Vector3(-0.095, 0.51, 0),
    footR: new THREE.Vector3(-0.095, 0.1, 0),
  };
}

interface Part {
  g: THREE.BufferGeometry;
  bone: BoneName;
  color: string;
}

function capsule(r: number, y0: number, y1: number, x = 0, z = 0, seg = 6): THREE.BufferGeometry {
  const len = Math.max(0.001, Math.abs(y1 - y0) - 2 * r);
  return new THREE.CapsuleGeometry(r, len, 2, seg).translate(x, (y0 + y1) / 2, z);
}

function buildParts(look: Look): Part[] {
  const P: Part[] = [];
  const b = look.build;
  const add = (g: THREE.BufferGeometry, bone: BoneName, color: string) => P.push({ g, bone, color });
  const longSleeves = look.topStyle !== "tshirt" && look.topStyle !== "vest" && look.topStyle !== "dress";
  const sleeve = look.topStyle === "vest" ? look.skin : look.top;
  const legsSkin = look.bottomStyle === "shorts" || look.bottomStyle === "skirt";
  // bassin
  add(new THREE.SphereGeometry(1, 8, 5).scale(0.165 * b, 0.11, 0.12).translate(0, 0.96, 0), "hips", look.bottomStyle === "skirt" ? look.top : look.bottom);
  // ventre et torse
  add(new THREE.CylinderGeometry(0.155 * b, 0.16 * b, 0.26, 9, 1, true).scale(1, 1, 0.72).translate(0, 1.1, 0), "spine", look.top);
  add(new THREE.SphereGeometry(1, 10, 7).scale(0.2 * b, 0.19, 0.125).translate(0, 1.33, 0), "chest", look.top);
  add(new THREE.CylinderGeometry(0.19 * b, 0.16 * b, 0.2, 9, 1, true).scale(1, 1, 0.66).translate(0, 1.27, 0), "chest", look.top);
  for (const s of [1, -1]) add(new THREE.SphereGeometry(0.068, 7, 5).translate(s * 0.185 * b, 1.43, 0), "chest", look.top);
  // capuchon
  if (look.topStyle === "hoodie") add(new THREE.TorusGeometry(0.1, 0.04, 6, 12).rotateX(Math.PI / 2).translate(0, 1.47, -0.04), "chest", look.top);
  // manteau long
  if (look.topStyle === "coat") add(new THREE.CylinderGeometry(0.175 * b, 0.22 * b, 0.42, 12, 1, true).scale(1, 1, 0.75).translate(0, 0.82, 0), "hips", look.top);
  if (look.topStyle === "dress" || look.bottomStyle === "skirt")
    add(new THREE.CylinderGeometry(0.17 * b, 0.27 * b, 0.42, 14, 1, true).scale(1, 1, 0.8).translate(0, 0.8, 0), "hips", look.topStyle === "dress" ? look.top : look.bottom);
  // dossard
  if (look.vest) add(new THREE.CylinderGeometry(0.205 * b, 0.17 * b, 0.42, 12, 1, true).scale(1, 1, 0.7).translate(0, 1.2, 0), "chest", look.vest);
  // cou et tête
  add(new THREE.CylinderGeometry(0.048, 0.055, 0.16, 6, 1, true).translate(0, 1.53, 0), "neck", look.skin);
  add(new THREE.SphereGeometry(0.112, 12, 9).scale(1, 1.13, 1.05).translate(0, 1.69, 0.005), "head", look.skin);
  for (const s of [1, -1]) {
    add(new THREE.SphereGeometry(0.016, 6, 5).translate(s * 0.04, 1.71, 0.103), "head", "#1a1410"); // yeux
    add(new THREE.SphereGeometry(0.007, 4, 3).translate(s * 0.043, 1.715, 0.116), "head", "#ffffff"); // reflets
    add(new THREE.BoxGeometry(0.04, 0.009, 0.01).translate(s * 0.04, 1.738, 0.106), "head", look.hair); // sourcils
    add(new THREE.SphereGeometry(0.024, 6, 5).scale(0.6, 1, 0.9).translate(s * 0.113, 1.69, 0), "head", look.skin); // oreilles
  }
  add(new THREE.ConeGeometry(0.018, 0.045, 6).rotateX(Math.PI / 2).translate(0, 1.685, 0.125), "head", look.skin); // nez
  add(new THREE.BoxGeometry(0.04, 0.007, 0.01).translate(0, 1.645, 0.108), "head", "#8a3b3b"); // bouche
  if (look.beard) add(new THREE.SphereGeometry(0.1, 10, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45).scale(1, 1.2, 1.1).translate(0, 1.7, 0.012), "head", look.hair);
  if (look.glasses) {
    for (const s of [1, -1]) add(new THREE.TorusGeometry(0.026, 0.005, 4, 12).translate(s * 0.042, 1.712, 0.118), "head", "#111111");
    add(new THREE.BoxGeometry(0.03, 0.005, 0.005).translate(0, 1.715, 0.12), "head", "#111111");
  }
  // cheveux
  const hairCap = (scaleY = 1) => new THREE.SphereGeometry(0.122, 11, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1.02, 1.1 * scaleY, 1.08).translate(0, 1.7, -0.008);
  switch (look.hairStyle) {
    case "short":
      add(hairCap(), "head", look.hair);
      break;
    case "curly":
      add(hairCap(1.15), "head", look.hair);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        add(new THREE.SphereGeometry(0.045, 6, 5).translate(Math.cos(a) * 0.1, 1.78, Math.sin(a) * 0.09 - 0.01), "head", look.hair);
      }
      break;
    case "long":
      add(hairCap(), "head", look.hair);
      add(new THREE.BoxGeometry(0.22, 0.28, 0.08).translate(0, 1.6, -0.08), "head", look.hair);
      break;
    case "ponytail":
      add(hairCap(), "head", look.hair);
      add(new THREE.CapsuleGeometry(0.035, 0.16, 3, 6).rotateX(0.4).translate(0, 1.62, -0.15), "head", look.hair);
      break;
    case "bun":
      add(hairCap(), "head", look.hair);
      add(new THREE.SphereGeometry(0.055, 8, 6).translate(0, 1.82, -0.06), "head", look.hair);
      break;
    case "mohawk":
      add(new THREE.BoxGeometry(0.03, 0.08, 0.22).translate(0, 1.82, -0.01), "head", look.hair);
      break;
    case "bald":
      break;
  }
  // chapeaux
  if (look.hat === "tuque") {
    add(new THREE.SphereGeometry(0.128, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1.02, 1.08, 1.08).translate(0, 1.72, -0.006), "head", look.hatColor);
    add(new THREE.TorusGeometry(0.121, 0.022, 6, 16).rotateX(Math.PI / 2).translate(0, 1.73, -0.006), "head", look.hatColor);
    add(new THREE.SphereGeometry(0.04, 8, 6).translate(0, 1.87, -0.01), "head", "#f1f1f1");
  } else if (look.hat === "cap") {
    add(new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1.02, 0.9, 1.06).translate(0, 1.73, -0.005), "head", look.hatColor);
    add(new THREE.BoxGeometry(0.17, 0.012, 0.1).translate(0, 1.745, 0.15), "head", look.hatColor);
  } else if (look.hat === "beret") {
    add(new THREE.CylinderGeometry(0.14, 0.12, 0.05, 14).rotateX(-0.2).translate(0.02, 1.8, -0.01), "head", look.hatColor);
  } else if (look.hat === "helmet") {
    add(new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1.05, 0.95, 1.12).translate(0, 1.73, 0), "head", look.hatColor);
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 16).scale(1, 1, 1.15).translate(0, 1.73, 0.01), "head", look.hatColor);
  }
  // bras
  for (const [s, up, fo, ha] of [
    [1, "upperArmL", "forearmL", "handL"],
    [-1, "upperArmR", "forearmR", "handR"],
  ] as [number, BoneName, BoneName, BoneName][]) {
    const x = s * 0.19 * b;
    add(capsule(0.054, 1.17, 1.47, x), up, sleeve);
    add(capsule(0.046, 0.93, 1.19, x + s * 0.01), fo, longSleeves ? sleeve : look.skin);
    add(new THREE.SphereGeometry(0.048, 6, 4).scale(0.75, 1.15, 0.6).translate(x + s * 0.015, 0.885, 0), ha, look.skin);
  }
  // jambes
  for (const [s, th, sh, ft] of [
    [1, "thighL", "shinL", "footL"],
    [-1, "thighR", "shinR", "footR"],
  ] as [number, BoneName, BoneName, BoneName][]) {
    const x = s * 0.095;
    add(capsule(0.079 * b, 0.48, 0.97, x), th, legsSkin ? (look.bottomStyle === "shorts" ? look.bottom : look.skin) : look.bottom);
    if (look.bottomStyle === "shorts") add(capsule(0.072 * b, 0.5, 0.62, x), th, look.skin);
    add(capsule(0.063, 0.09, 0.53, x), sh, legsSkin ? look.skin : look.bottom);
    add(new THREE.BoxGeometry(0.1, 0.075, 0.25).translate(x, 0.04, 0.045), ft, look.shoes);
  }
  // sac à dos et foulard
  if (look.backpack) {
    add(new THREE.BoxGeometry(0.28 * b, 0.36, 0.14).translate(0, 1.27, -0.18), "chest", look.backpack);
    add(new THREE.BoxGeometry(0.2 * b, 0.12, 0.06).translate(0, 1.16, -0.27), "chest", look.backpack);
  }
  if (look.scarf) {
    add(new THREE.TorusGeometry(0.075, 0.034, 6, 14).rotateX(Math.PI / 2).translate(0, 1.47, 0), "chest", look.scarf);
    add(new THREE.BoxGeometry(0.07, 0.22, 0.03).translate(0.05, 1.33, 0.12), "chest", look.scarf);
  }
  return P;
}

export interface CharacterOpts {
  castShadow?: boolean;
}

/** Instance de personnage : groupe racine (position/orientation monde) + maillage skinné. */
export class Character {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones = {} as Record<BoneName, THREE.Bone>;
  private rest = {} as Record<BoneName, THREE.Vector3>;
  readonly anim = new Animator(this);
  /** Objets tenus dans la main droite (café, livre...). */
  readonly handR: THREE.Bone;
  readonly handL: THREE.Bone;

  constructor(
    readonly look: Look,
    opts: CharacterOpts = {},
  ) {
    const pos = bindPositions(look.build);
    for (const n of BONES) {
      const bone = new THREE.Bone();
      bone.name = n;
      this.bones[n] = bone;
    }
    for (const n of BONES) {
      const p = PARENT[n];
      const local = p ? pos[n].clone().sub(pos[p]) : pos[n].clone();
      this.bones[n].position.copy(local);
      this.rest[n] = local.clone();
      if (p) this.bones[p].add(this.bones[n]);
    }
    const parts = buildParts(look);
    const geos: THREE.BufferGeometry[] = [];
    const col = new THREE.Color();
    for (const part of parts) {
      const g = part.g.index ? part.g.toNonIndexed() : part.g;
      g.deleteAttribute("uv");
      const n = g.attributes.position.count;
      const colors = new Float32Array(n * 3);
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      col.set(part.color);
      const bi = BONES.indexOf(part.bone);
      for (let i = 0; i < n; i++) {
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
        si[i * 4] = bi;
        sw[i * 4] = 1;
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
      geos.push(g);
    }
    const geo = mergeGeometries(geos)!;
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    this.mesh = new THREE.SkinnedMesh(geo, mat);
    this.mesh.add(this.bones.root);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(BONES.map((n) => this.bones[n])));
    this.mesh.castShadow = opts.castShadow ?? true;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.root.scale.setScalar(look.height);
    this.handR = this.bones.handR;
    this.handL = this.bones.handL;
  }

  restPos(n: BoneName) {
    return this.rest[n];
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export type AnimState = "idle" | "walk" | "run" | "jump" | "fall" | "talk" | "sit" | "wave" | "dance" | "phone" | "cheer";

/** Animation procédurale : marche, course, saut, conversation, assis, salut, danse. */
export class Animator {
  phase = 0;
  state: AnimState = "idle";
  speed = 0;
  t = Math.random() * 10;
  blend = 0; // 0 = idle, 1 = cycle de marche
  private look = new THREE.Vector2();
  lookTarget = new THREE.Vector2();
  /** Pas : appelé à chaque contact d'un pied (pour les sons). */
  onStep: ((foot: 0 | 1) => void) | null = null;
  private lastStepSign = 0;
  private tmpE = new THREE.Euler();

  constructor(private c: Character) {}

  update(dt: number, speed: number, state: AnimState) {
    this.t += dt;
    this.speed = speed;
    this.state = state;
    const B = this.c.bones;
    const moving = state === "walk" || state === "run";
    const run = state === "run" ? 1 : 0;
    const target = moving ? 1 : 0;
    this.blend += (target - this.blend) * Math.min(1, dt * 8);
    // fréquence du pas selon la vitesse
    const stride = THREE.MathUtils.lerp(1.45, 2.6, THREE.MathUtils.clamp((speed - 1.5) / 4, 0, 1));
    if (moving) this.phase += (speed / stride) * Math.PI * 2 * dt;
    const ph = this.phase;
    const w = this.blend;

    // remise à zéro
    for (const n of BONES) {
      B[n].rotation.set(0, 0, 0);
      B[n].position.copy(this.c.restPos(n));
    }

    const ampLeg = THREE.MathUtils.lerp(0.42, 0.85, run) * w;
    const ampKnee = THREE.MathUtils.lerp(0.75, 1.45, run) * w;
    const ampArm = THREE.MathUtils.lerp(0.32, 0.85, run) * w;
    for (const [side, th, sh, ft, ua, fa] of [
      [0, "thighL", "shinL", "footL", "upperArmL", "forearmL"],
      [Math.PI, "thighR", "shinR", "footR", "upperArmR", "forearmR"],
    ] as [number, BoneName, BoneName, BoneName, BoneName, BoneName][]) {
      const p = ph + side;
      const swing = Math.sin(p);
      B[th].rotation.x = -ampLeg * swing;
      B[sh].rotation.x = ampKnee * Math.max(0, Math.cos(p)) * (0.6 + 0.4 * run) + 0.05 * w;
      B[ft].rotation.x = -B[th].rotation.x * 0.4 - B[sh].rotation.x * 0.3 + 0.15 * Math.max(0, -swing) * w;
      B[ua].rotation.x = ampArm * swing;
      B[fa].rotation.x = -(0.2 + 0.55 * run) * w - 0.08;
      const sgn = side === 0 ? 1 : -1;
      B[ua].rotation.z = sgn * (0.06 + 0.05 * run);
    }
    // bassin : rebond et rotation
    const bob = -Math.abs(Math.cos(ph)) * THREE.MathUtils.lerp(0.035, 0.07, run) * w;
    B.hips.position.y += bob + 0.02 * w;
    B.hips.rotation.y = 0.12 * Math.sin(ph) * w;
    B.spine.rotation.y = -0.16 * Math.sin(ph) * w;
    B.spine.rotation.x = 0.06 * w + 0.22 * run * w;
    B.head.rotation.x = -0.05 * w - 0.12 * run * w;
    // détection des appuis pour les bruits de pas
    const s = Math.sign(Math.cos(ph));
    if (moving && s !== this.lastStepSign) {
      this.onStep?.(s > 0 ? 0 : 1);
      this.lastStepSign = s;
    }

    // respiration et regard au repos
    const idle = 1 - w;
    const breath = Math.sin(this.t * 1.7);
    B.chest.rotation.x += breath * 0.015 * idle;
    B.upperArmL.rotation.z += (0.07 + breath * 0.01) * idle;
    B.upperArmR.rotation.z -= (0.07 + breath * 0.01) * idle;
    B.forearmL.rotation.x -= 0.12 * idle;
    B.forearmR.rotation.x -= 0.12 * idle;
    this.look.lerp(this.lookTarget, Math.min(1, dt * 3));
    B.neck.rotation.y = this.look.x * 0.6;
    B.head.rotation.y += this.look.x * 0.4;
    B.head.rotation.x += this.look.y;
    B.hips.rotation.z = Math.sin(this.t * 0.6) * 0.015 * idle;

    switch (state) {
      case "jump":
      case "fall": {
        const k = state === "jump" ? 1 : 0.7;
        B.thighL.rotation.x = -0.9 * k;
        B.shinL.rotation.x = 1.3 * k;
        B.thighR.rotation.x = -0.25 * k;
        B.shinR.rotation.x = 0.8 * k;
        B.upperArmL.rotation.z = 0.9;
        B.upperArmR.rotation.z = -0.9;
        B.upperArmL.rotation.x = -0.3;
        B.upperArmR.rotation.x = -0.3;
        B.spine.rotation.x = 0.15;
        break;
      }
      case "talk": {
        const g = Math.sin(this.t * 2.3) * 0.5 + Math.sin(this.t * 3.7) * 0.3;
        B.upperArmR.rotation.x = -0.45 - 0.25 * g;
        B.upperArmR.rotation.z = -0.25;
        B.forearmR.rotation.x = -1.0 + 0.3 * Math.sin(this.t * 4.1);
        B.upperArmL.rotation.x = -0.2 + 0.15 * Math.sin(this.t * 1.9);
        B.forearmL.rotation.x = -0.6;
        B.head.rotation.x += 0.06 * Math.sin(this.t * 3.1);
        B.head.rotation.z = 0.05 * Math.sin(this.t * 1.3);
        break;
      }
      case "sit": {
        B.hips.position.y -= 0.47;
        B.hips.position.z -= 0.05;
        B.thighL.rotation.x = -1.5;
        B.thighR.rotation.x = -1.5;
        B.shinL.rotation.x = 1.45;
        B.shinR.rotation.x = 1.45;
        B.footL.rotation.x = 0.05;
        B.footR.rotation.x = 0.05;
        B.spine.rotation.x = -0.08;
        B.upperArmL.rotation.x = -0.35;
        B.upperArmR.rotation.x = -0.35;
        B.forearmL.rotation.x = -0.9;
        B.forearmR.rotation.x = -0.9;
        break;
      }
      case "wave": {
        B.upperArmR.rotation.z = -2.6;
        B.upperArmR.rotation.x = -0.2;
        B.forearmR.rotation.z = -0.4 + 0.45 * Math.sin(this.t * 9);
        B.forearmR.rotation.x = -0.3;
        break;
      }
      case "cheer": {
        B.upperArmR.rotation.z = -2.7 + 0.2 * Math.sin(this.t * 7);
        B.upperArmL.rotation.z = 2.7 - 0.2 * Math.sin(this.t * 7);
        B.hips.position.y += Math.abs(Math.sin(this.t * 7)) * 0.08;
        break;
      }
      case "phone": {
        B.upperArmR.rotation.x = -0.4;
        B.upperArmR.rotation.z = -0.35;
        B.forearmR.rotation.x = -2.1;
        B.forearmR.rotation.z = 0.5;
        B.head.rotation.z = -0.12;
        break;
      }
      case "dance": {
        const d = this.t * 5;
        B.hips.position.y += Math.abs(Math.sin(d)) * 0.07;
        B.hips.rotation.y = Math.sin(d * 0.5) * 0.4;
        B.upperArmL.rotation.z = 1.2 + Math.sin(d) * 0.6;
        B.upperArmR.rotation.z = -1.2 + Math.sin(d + 1) * 0.6;
        B.forearmL.rotation.x = -1.2;
        B.forearmR.rotation.x = -1.2;
        B.thighL.rotation.x = -0.3 * Math.max(0, Math.sin(d));
        B.thighR.rotation.x = -0.3 * Math.max(0, -Math.sin(d));
        B.shinL.rotation.x = 0.6 * Math.max(0, Math.sin(d));
        B.shinR.rotation.x = 0.6 * Math.max(0, -Math.sin(d));
        B.head.rotation.z = Math.sin(d) * 0.15;
        break;
      }
      default:
        break;
    }
    void this.tmpE;
  }
}
