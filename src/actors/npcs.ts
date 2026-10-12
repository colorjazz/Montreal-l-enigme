import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { Character, randomLook, type Look, type AnimState } from "./character";
import type { Physics } from "../core/physics";
import { Rng, hash01 } from "../core/rng";
import { SIDEWALK_Y, type CityData } from "../world/city";

const HALF_H = 0.55;
const RADIUS = 0.3;

function makeBody(physics: Physics, x: number, y: number, z: number): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
  const R = physics.RAPIER;
  const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + HALF_H + RADIUS, z));
  const collider = physics.world.createCollider(R.ColliderDesc.capsule(HALF_H, RADIUS), body);
  return { body, collider };
}

// ------------------------------------------------------------ PNJ nommés
export interface NamedNpcSpec {
  id: string;
  name: string;
  role: string;
  color: string;
  look: Partial<Look>;
  seed: number;
  at: () => { x: number; z: number; y?: number; facing: number };
  pose?: AnimState;
  /** Répliques lancées quand le joueur passe à proximité. */
  barks?: string[];
  /** Objet tenu en main (visuel). */
  holding?: "accordion" | "coffee" | "book" | "sign" | "phone" | "leash" | "clipboard" | "violin";
}

export class NamedNpc {
  readonly char: Character;
  readonly pos = new THREE.Vector3();
  facing = 0;
  pose: AnimState;
  talking = false;
  private body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Cible de déplacement (escorte, défilé). */
  goal: THREE.Vector3 | null = null;
  goalSpeed = 1.4;
  speed = 0;
  private lookAtP: THREE.Vector3 | null = null;
  lastBark = -100;
  visible = true;

  constructor(
    readonly spec: NamedNpcSpec,
    physics: Physics,
    scene: THREE.Scene,
  ) {
    const rng = new Rng(spec.seed);
    this.char = new Character(randomLook(rng, spec.look));
    this.char.root.name = spec.name;
    scene.add(this.char.root);
    const a = spec.at();
    this.pos.set(a.x, a.y ?? SIDEWALK_Y, a.z);
    this.facing = a.facing;
    this.pose = spec.pose ?? "idle";
    const b = makeBody(physics, this.pos.x, this.pos.y, this.pos.z);
    this.body = b.body;
    this.collider = b.collider;
    if (spec.holding) attachProp(this.char, spec.holding);
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.char.root.visible = v;
    this.collider.setEnabled(v);
  }

  /** Replace le PNJ à sa position d'origine. */
  reset() {
    const a = this.spec.at();
    this.pos.set(a.x, a.y ?? SIDEWALK_Y, a.z);
    this.facing = a.facing;
    this.goal = null;
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y + HALF_H + RADIUS, z: this.pos.z }, true);
  }

  teleport(x: number, y: number, z: number) {
    this.pos.set(x, y, z);
    this.body.setTranslation({ x, y: y + HALF_H + RADIUS, z }, true);
  }

  lookAt(p: THREE.Vector3 | null) {
    this.lookAtP = p ? p.clone() : null;
  }

  fixedUpdate(h: number) {
    if (this.goal) {
      const dx = this.goal.x - this.pos.x;
      const dz = this.goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.15) {
        const sp = Math.min(this.goalSpeed, d * 2.5);
        this.speed += (sp - this.speed) * Math.min(1, h * 6);
        this.pos.x += (dx / d) * this.speed * h;
        this.pos.z += (dz / d) * this.speed * h;
        const want = Math.atan2(dx, dz);
        let a = want - this.facing;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        this.facing += a * Math.min(1, h * 8);
        this.pos.y += (this.goal.y - this.pos.y) * Math.min(1, h * 6);
      } else this.speed *= 0.8;
    } else this.speed *= 0.8;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + HALF_H + RADIUS, z: this.pos.z });
  }

  update(dt: number) {
    if (!this.visible) return;
    // se tourne vers le joueur quand il parle
    if (this.lookAtP && this.speed < 0.2) {
      const want = Math.atan2(this.lookAtP.x - this.pos.x, this.lookAtP.z - this.pos.z);
      let a = want - this.facing;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      this.facing += a * Math.min(1, dt * 5);
    }
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.facing;
    let st: AnimState = this.pose;
    if (this.speed > 0.3) st = this.speed > 3 ? "run" : "walk";
    else if (this.talking) st = this.pose === "sit" ? "sit" : "talk";
    this.char.anim.update(dt, this.speed, st);
  }

  headPos(): THREE.Vector3 {
    const h = this.pose === "sit" && this.speed < 0.3 ? 1.55 : 2.05;
    return new THREE.Vector3(this.pos.x, this.pos.y + h * this.char.look.height, this.pos.z);
  }
}

/** Accessoires tenus en main, rattachés aux os de la main. */
export function attachProp(c: Character, kind: NonNullable<NamedNpcSpec["holding"]>) {
  const g = new THREE.Group();
  const m = (geo: THREE.BufferGeometry, color: number) => new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  switch (kind) {
    case "coffee": {
      const cup = m(new THREE.CylinderGeometry(0.035, 0.028, 0.11, 10), 0xf1ece0);
      const lid = m(new THREE.CylinderGeometry(0.037, 0.037, 0.015, 10), 0x3b2a20);
      lid.position.y = 0.06;
      g.add(cup, lid);
      g.position.set(0, -0.06, 0.03);
      c.handR.add(g);
      break;
    }
    case "book": {
      g.add(m(new THREE.BoxGeometry(0.03, 0.2, 0.15), 0x7a1f1f));
      g.position.set(0, -0.05, 0.03);
      c.handL.add(g);
      break;
    }
    case "phone": {
      g.add(m(new THREE.BoxGeometry(0.01, 0.13, 0.065), 0x111111));
      g.position.set(0, -0.04, 0.03);
      c.handR.add(g);
      break;
    }
    case "clipboard": {
      g.add(m(new THREE.BoxGeometry(0.015, 0.3, 0.22), 0x8a5a2b));
      g.position.set(0, -0.08, 0.05);
      c.handL.add(g);
      break;
    }
    case "sign": {
      const stick = m(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6), 0x8a6a4a);
      stick.position.y = 0.3;
      const board = m(new THREE.BoxGeometry(0.6, 0.4, 0.02), 0xf5f0e1);
      board.position.y = 0.95;
      g.add(stick, board);
      c.handR.add(g);
      break;
    }
    case "accordion": {
      const body = m(new THREE.BoxGeometry(0.32, 0.26, 0.18), 0x8c1c13);
      const keys = m(new THREE.BoxGeometry(0.05, 0.24, 0.16), 0xf1f1f1);
      keys.position.x = -0.18;
      g.add(body, keys);
      g.position.set(0, 1.2, 0.2);
      c.bones.chest.add(g);
      g.position.set(0, -0.02, 0.2);
      break;
    }
    case "violin": {
      const body = m(new THREE.BoxGeometry(0.2, 0.06, 0.38), 0x8b4513);
      g.add(body);
      g.position.set(0.06, 0.12, 0.12);
      g.rotation.set(0.3, 0, -0.4);
      c.bones.chest.add(g);
      break;
    }
    case "leash": {
      const l = m(new THREE.CylinderGeometry(0.006, 0.006, 0.8, 4), 0xc0392b);
      l.position.y = -0.4;
      g.add(l);
      c.handL.add(g);
      break;
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

// ------------------------------------------------------------ piétons d'ambiance
interface Ped {
  char: Character;
  body: RAPIER.RigidBody;
  active: boolean;
  from: number;
  to: number;
  prev: number;
  t: number;
  speed: number;
  lateral: number;
  pos: THREE.Vector3;
  facing: number;
  pause: number;
  pauseAnim: AnimState;
  talkUntil: number;
  blocked: number;
  umbrella: THREE.Object3D;
}

export const PED_LINES = [
  "Bonjour !",
  "Belle journée, hein ?",
  "Excusez-moi, je suis pressé.",
  "Il commence à faire frisquet le matin.",
  "Avez-vous vu les couleurs des arbres ? C'est magnifique !",
  "Le métro ? C'est juste là, au coin de Berri et De Maisonneuve.",
  "Bonne Action de grâce !",
  "Je m'en vais au Théâtre St-Denis ce soir.",
  "Pardon, je cherche la Grande Bibliothèque… Ah, la voilà !",
  "Bon, je suis encore en retard pour mon cours à l'UQAM.",
  "Il paraît qu'il va pleuvoir cet après-midi.",
  "Allô ! Ça va bien ?",
  "Vous êtes touriste ? Bienvenue à Montréal !",
  "Attention aux cônes orange, il y en a partout en ville !",
  "J'ai entendu dire qu'un trésor serait caché dans le Quartier latin…",
  "Les Jardins Gamelin ferment bientôt pour l'hiver.",
  "Bonne journée !",
  "Je vais prendre un café, tu viens ?",
  "Désolé, je ne parle pas aux inconnus !",
  "Le prochain autobus passe dans cinq minutes.",
];

export class Pedestrians {
  readonly peds: Ped[] = [];
  private adj: number[][] = [];
  private nodes: THREE.Vector3[] = [];
  private crossing = new Set<string>();
  private rng = new Rng(99);
  /** Nombre de piétons visibles (ajusté selon la qualité). */
  target = 34;
  raining = false;
  private umbrellaMat = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.5, side: THREE.DoubleSide });
  private time = 0;

  constructor(
    physics: Physics,
    scene: THREE.Scene,
    data: CityData,
    count = 40,
    private walkable: (x: number, z: number) => boolean,
  ) {
    for (const [x, z] of data.nav.nodes) this.nodes.push(new THREE.Vector3(x, SIDEWALK_Y, z));
    this.adj = data.nav.nodes.map(() => []);
    for (const [a, b] of data.nav.edges) {
      this.adj[a].push(b);
      this.adj[b].push(a);
    }
    // arêtes de traversée (passages piétons) : y = chaussée
    for (const cw of data.crosswalks) {
      const ia = this.nearestNode(cw.a[0], cw.a[1]);
      const ib = this.nearestNode(cw.b[0], cw.b[1]);
      if (ia >= 0 && ib >= 0) this.crossing.add(`${Math.min(ia, ib)}-${Math.max(ia, ib)}`);
    }
    const umbGeo = new THREE.ConeGeometry(0.55, 0.25, 10, 1, true);
    umbGeo.translate(0, 0.12, 0);
    for (let i = 0; i < count; i++) {
      const look = randomLook(new Rng(5000 + i * 31));
      const char = new Character(look, { castShadow: true });
      char.root.visible = false;
      scene.add(char.root);
      const { body } = makeBody(physics, 0, -50 - i * 3, 0);
      const umbrella = new THREE.Group();
      const top = new THREE.Mesh(umbGeo, this.umbrellaMat);
      top.position.y = 0.95;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.95, 4), this.umbrellaMat);
      stick.position.y = 0.48;
      umbrella.add(top, stick);
      umbrella.visible = false;
      char.handR.add(umbrella);
      this.peds.push({ char, body, active: false, from: 0, to: 0, prev: -1, t: 0, speed: 1.3, lateral: 0, pos: new THREE.Vector3(), facing: 0, pause: 0, pauseAnim: "idle", talkUntil: 0, blocked: 0, umbrella });
    }
  }

  private nearestNode(x: number, z: number): number {
    let best = -1;
    let bd = 3;
    this.nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  private isCrossing(a: number, b: number) {
    return this.crossing.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
  }

  private spawn(p: Ped, player: THREE.Vector3, initial: boolean) {
    // nœud à bonne distance du joueur
    for (let tries = 0; tries < 40; tries++) {
      const i = Math.floor(this.rng.float() * this.nodes.length);
      const n = this.nodes[i];
      const d = Math.hypot(n.x - player.x, n.z - player.z);
      const okDist = initial ? d > 8 && d < 95 : d > 55 && d < 105;
      if (!okDist || this.adj[i].length === 0 || !this.walkable(n.x, n.z)) continue;
      p.from = i;
      p.to = this.rng.pick(this.adj[i]);
      p.prev = -1;
      p.t = 0;
      p.speed = this.rng.range(1.05, 1.6);
      p.lateral = this.rng.range(-0.7, 0.7);
      p.active = true;
      p.pause = 0;
      p.char.root.visible = true;
      p.pos.copy(n);
      return true;
    }
    return false;
  }

  private chooseNext(p: Ped) {
    const opts = this.adj[p.to].filter((k) => k !== p.from);
    const cur = this.nodes[p.to];
    const dirIn = cur.clone().sub(this.nodes[p.from]).normalize();
    let next = p.from;
    if (opts.length) {
      // préfère continuer tout droit
      const scored = opts.map((k) => {
        const d = this.nodes[k].clone().sub(cur).normalize();
        return { k, s: d.dot(dirIn) + this.rng.range(-0.6, 0.6) + (this.isCrossing(p.to, k) ? -0.35 : 0) };
      });
      scored.sort((a, b) => b.s - a.s);
      next = scored[0].k;
    }
    p.prev = p.from;
    p.from = p.to;
    p.to = next;
    p.t = 0;
    // petites pauses (vitrines, téléphone)
    if (this.rng.chance(0.06)) {
      p.pause = this.rng.range(2, 6);
      p.pauseAnim = this.rng.pick(["idle", "phone", "idle"] as AnimState[]);
    }
  }

  fixedUpdate(h: number, player: THREE.Vector3) {
    for (const p of this.peds) {
      if (!p.active) continue;
      const a = this.nodes[p.from];
      const b = this.nodes[p.to];
      const L = Math.max(0.01, a.distanceTo(b));
      const dir = new THREE.Vector3().subVectors(b, a).divideScalar(L);
      // évite le joueur : ralentit s'il est juste devant
      const toPlayer = new THREE.Vector3(player.x - p.pos.x, 0, player.z - p.pos.z);
      const dist = toPlayer.length();
      const ahead = dist > 0.01 ? toPlayer.dot(dir) / dist : 0;
      let sp = p.speed * (this.raining ? 1.35 : 1);
      if (dist < 1.6 && ahead > 0.4) {
        sp = 0;
        p.blocked += h;
        // contourne après une seconde
        if (p.blocked > 0.8) p.lateral = THREE.MathUtils.clamp(p.lateral + (this.rng.chance(0.5) ? 1 : -1) * h * 2, -1.4, 1.4);
      } else p.blocked = 0;
      if (p.pause > 0 || this.time < p.talkUntil) {
        p.pause -= h;
        sp = 0;
      }
      p.t += (sp * h) / L;
      if (p.t >= 1) this.chooseNext(p);
      const cross = this.isCrossing(p.from, p.to);
      const t = Math.min(1, p.t);
      const base = new THREE.Vector3().lerpVectors(this.nodes[p.from], this.nodes[p.to], t);
      const d2 = new THREE.Vector3().subVectors(this.nodes[p.to], this.nodes[p.from]).normalize();
      const side = new THREE.Vector3(-d2.z, 0, d2.x);
      const lat = cross ? p.lateral * 0.5 : p.lateral;
      p.pos.set(base.x + side.x * lat, cross && t > 0.12 && t < 0.88 ? 0 : SIDEWALK_Y, base.z + side.z * lat);
      if (sp > 0.05) {
        const want = Math.atan2(d2.x, d2.z);
        let da = want - p.facing;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        p.facing += da * Math.min(1, h * 6);
      }
      (p as Ped & { curSpeed?: number }).curSpeed = sp;
      p.body.setNextKinematicTranslation({ x: p.pos.x, y: p.pos.y + HALF_H + RADIUS, z: p.pos.z });
    }
  }

  update(dt: number, player: THREE.Vector3, camera: THREE.Camera) {
    this.time += dt;
    let active = 0;
    for (const p of this.peds) if (p.active) active++;
    for (const p of this.peds) {
      if (p.active) {
        const d = Math.hypot(p.pos.x - player.x, p.pos.z - player.z);
        if (d > 125) {
          p.active = false;
          p.char.root.visible = false;
          p.body.setNextKinematicTranslation({ x: 0, y: -80, z: 0 });
          active--;
        }
      } else if (active < this.target) {
        if (this.spawn(p, player, this.time < 1)) active++;
      }
      if (!p.active) continue;
      const sp = (p as Ped & { curSpeed?: number }).curSpeed ?? 0;
      p.char.root.position.copy(p.pos);
      if (this.time < p.talkUntil) {
        const want = Math.atan2(player.x - p.pos.x, player.z - p.pos.z);
        let da = want - p.facing;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        p.facing += da * Math.min(1, dt * 6);
      }
      p.char.root.rotation.y = p.facing;
      p.umbrella.visible = this.raining && hash01(this.peds.indexOf(p) * 7) < 0.6;
      // détail d'animation réduit au loin
      const far = p.pos.distanceToSquared(camera.position) > 70 * 70;
      if (!far || Math.floor(this.time * 30) % 2 === 0) {
        const st: AnimState = this.time < p.talkUntil ? "talk" : sp > 0.05 ? (sp > 2 ? "run" : "walk") : p.pause > 0 ? p.pauseAnim : "idle";
        p.char.anim.update(far ? dt * 2 : dt, sp, st);
        if (p.umbrella.visible) {
          p.char.bones.upperArmR.rotation.x = -0.9;
          p.char.bones.forearmR.rotation.x = -1.2;
        }
      }
    }
  }

  /** Piéton le plus proche du point (pour parler). */
  nearest(x: number, z: number, maxD: number): Ped | null {
    let best: Ped | null = null;
    let bd = maxD;
    for (const p of this.peds) {
      if (!p.active) continue;
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  talkTo(p: Ped, seconds = 3.5) {
    p.talkUntil = this.time + seconds;
  }

  activeCount() {
    return this.peds.filter((p) => p.active).length;
  }

  /** Positions (pour la circulation : les voitures s'arrêtent devant les piétons). */
  positions(): THREE.Vector3[] {
    return this.peds.filter((p) => p.active).map((p) => p.pos);
  }

  headPos(p: Ped) {
    return new THREE.Vector3(p.pos.x, p.pos.y + 2.05 * p.char.look.height, p.pos.z);
  }
}

export type { Ped };
