import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { City, StreetRec } from "./city";
import type { Physics } from "../core/physics";
import type { StreetProps } from "./props";
import { Rng, hash01 } from "../core/rng";
import { makeCanvasTexture } from "../core/textures";

interface Lane {
  street: StreetRec;
  a: THREE.Vector3;
  b: THREE.Vector3;
  dir: THREE.Vector3;
  len: number;
  speed: number;
  /** Arrêts le long de la voie : position t, carrefour, axe, type. */
  stops: { t: number; inter: number; axis: 0 | 1; kind: "light" | "stop"; priority: boolean }[];
  bus: boolean;
}

interface Car {
  lane: Lane;
  t: number;
  speed: number;
  max: number;
  len: number;
  group: THREE.Group;
  body: RAPIER.RigidBody;
  active: boolean;
  stopWait: number;
  passed: Set<number>;
  blockedTime: number;
  honked: number;
  bus: boolean;
  busStopT: number;
  busWait: number;
}

const CYCLE = 46;

function colorize(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = ng.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  ng.setAttribute("color", new THREE.BufferAttribute(a, 3));
  ng.deleteAttribute("uv");
  return ng;
}

/** Géométrie d'une voiture (l'avant pointe vers +Z). */
function carGeometry(kind: "sedan" | "hatch" | "suv" | "taxi", paint: string): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const L = kind === "suv" ? 4.7 : kind === "hatch" ? 4.0 : 4.5;
  const W = kind === "suv" ? 1.95 : 1.8;
  const H = kind === "suv" ? 0.95 : 0.75;
  const glass = "#1c2630";
  parts.push(colorize(new THREE.BoxGeometry(W, H, L).translate(0, 0.35 + H / 2, 0), paint));
  const cabL = kind === "hatch" ? L * 0.55 : kind === "suv" ? L * 0.62 : L * 0.5;
  const cabZ = kind === "hatch" ? -0.3 : kind === "suv" ? -0.35 : -0.15;
  const cabH = kind === "suv" ? 0.75 : 0.62;
  // habitacle vitré, légèrement plus étroit
  parts.push(colorize(new THREE.BoxGeometry(W * 0.86, cabH, cabL).translate(0, 0.35 + H + cabH / 2, cabZ), glass));
  parts.push(colorize(new THREE.BoxGeometry(W * 0.88, 0.06, cabL * 0.92).translate(0, 0.35 + H + cabH + 0.02, cabZ), paint));
  // montants
  for (const s of [1, -1]) parts.push(colorize(new THREE.BoxGeometry(0.06, cabH, 0.12).translate(s * W * 0.43, 0.35 + H + cabH / 2, cabZ), paint));
  // roues
  for (const [x, z] of [
    [W / 2 - 0.12, L / 2 - 0.8],
    [-W / 2 + 0.12, L / 2 - 0.8],
    [W / 2 - 0.12, -L / 2 + 0.8],
    [-W / 2 + 0.12, -L / 2 + 0.8],
  ]) {
    parts.push(colorize(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12).rotateZ(Math.PI / 2).translate(x, 0.34, z), "#111111"));
    parts.push(colorize(new THREE.CylinderGeometry(0.18, 0.18, 0.26, 8).rotateZ(Math.PI / 2).translate(x, 0.34, z), "#9aa0a6"));
  }
  // pare-chocs
  parts.push(colorize(new THREE.BoxGeometry(W + 0.04, 0.22, 0.2).translate(0, 0.42, L / 2), "#2a2a2a"));
  parts.push(colorize(new THREE.BoxGeometry(W + 0.04, 0.22, 0.2).translate(0, 0.42, -L / 2), "#2a2a2a"));
  // phares et feux arrière (zones colorées ; l'éclairage nocturne est un objet séparé)
  for (const s of [1, -1]) {
    parts.push(colorize(new THREE.BoxGeometry(0.34, 0.14, 0.04).translate(s * (W / 2 - 0.3), 0.75, L / 2 + 0.01), "#f5f2e6"));
    parts.push(colorize(new THREE.BoxGeometry(0.3, 0.14, 0.04).translate(s * (W / 2 - 0.28), 0.78, -L / 2 - 0.01), "#9b111e"));
  }
  if (kind === "taxi") {
    parts.push(colorize(new THREE.BoxGeometry(0.6, 0.18, 0.25).translate(0, 0.35 + H + cabH + 0.13, cabZ), "#f2c200"));
  }
  return mergeGeometries(parts)!;
}

function busGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const L = 12;
  const W = 2.55;
  parts.push(colorize(new THREE.BoxGeometry(W, 2.6, L).translate(0, 0.45 + 1.3, 0), "#f4f4f2"));
  // bandeau de fenêtres et bande bleue de la STM
  for (const s of [1, -1]) {
    parts.push(colorize(new THREE.BoxGeometry(0.03, 1.0, L * 0.86).translate(s * (W / 2 + 0.01), 2.25, -0.3), "#1a2430"));
    parts.push(colorize(new THREE.BoxGeometry(0.03, 0.35, L).translate(s * (W / 2 + 0.012), 1.25, 0), "#0a4ea2"));
  }
  parts.push(colorize(new THREE.BoxGeometry(W * 0.92, 1.4, 0.03).translate(0, 2.0, L / 2 + 0.01), "#1a2430"));
  parts.push(colorize(new THREE.BoxGeometry(W * 0.7, 0.3, 0.04).translate(0, 2.85, L / 2 + 0.02), "#111111"));
  for (const [x, z] of [
    [W / 2 - 0.15, L / 2 - 2.2],
    [-W / 2 + 0.15, L / 2 - 2.2],
    [W / 2 - 0.15, -L / 2 + 2.6],
    [-W / 2 + 0.15, -L / 2 + 2.6],
  ])
    parts.push(colorize(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 14).rotateZ(Math.PI / 2).translate(x, 0.5, z), "#111111"));
  return mergeGeometries(parts)!;
}

/** Circulation : voitures, taxis et autobus de la STM avec feux et arrêts. */
export class Traffic {
  readonly group = new THREE.Group();
  readonly lanes: Lane[] = [];
  readonly cars: Car[] = [];
  private rng = new Rng(314);
  private carGeos: THREE.BufferGeometry[] = [];
  private busGeo: THREE.BufferGeometry;
  private carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45, envMapIntensity: 1.2 });
  private lightMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  private tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false });
  time = 0;
  target = 22;
  private signalCol = new THREE.Color();
  /** Événement : choc avec le joueur. */
  onHitPlayer: ((dir: THREE.Vector3, speed: number) => void) | null = null;
  onHonk: ((pos: THREE.Vector3) => void) | null = null;
  /** Feux en panne (événement) : tous clignotent en rouge. */
  signalsOut = false;
  busStops: { x: number; z: number }[] = [];
  stats = { spawned: 0, stoppedAtLights: 0, honks: 0, hits: 0 };

  constructor(
    private city: City,
    private physics: Physics,
    private props: StreetProps,
  ) {
    this.group.name = "circulation";
    const paints = ["#c0c4c8", "#1d1f22", "#f2f2f2", "#8b1e22", "#1f3a5f", "#3b4a3a", "#6b6f75", "#b7a37a", "#2e5e8c", "#9a3412"];
    const kinds = ["sedan", "hatch", "suv", "sedan"] as const;
    for (let i = 0; i < 12; i++) this.carGeos.push(carGeometry(kinds[i % 4], paints[i % paints.length]));
    this.carGeos.push(carGeometry("taxi", "#f4f4f4"), carGeometry("taxi", "#1d1f22"));
    this.busGeo = busGeometry();
    this.buildLanes();
    this.busStops = props.busStops.map((b) => ({ x: b.x, z: b.z }));
  }

  private buildLanes() {
    const data = this.city.data;
    for (const s of data.streets) {
      const A = new THREE.Vector3(s.a[0], 0, s.a[1]);
      const B = new THREE.Vector3(s.b[0], 0, s.b[1]);
      const dir = B.clone().sub(A).normalize();
      // découpe à la zone jouable (+ marge)
      const L = A.distanceTo(B);
      let t0 = -1;
      let t1 = -1;
      for (let t = 0; t <= L; t += 4) {
        const p = A.clone().addScaledVector(dir, t);
        if (this.city.inPlayable(p.x, p.z, 70)) {
          if (t0 < 0) t0 = t;
          t1 = t;
        }
      }
      if (t0 < 0 || t1 - t0 < 30) continue;
      const a = A.clone().addScaledVector(dir, t0);
      const b = A.clone().addScaledVector(dir, t1);
      let offsets: [number, 1 | -1][] = [];
      if (s.id === "rene") offsets = [[5.2, 1], [9.4, 1], [-5.2, -1], [-9.4, -1]];
      else if (s.oneway === 2) {
        if (s.id === "stdenis") offsets = [[1.9, 1], [-1.9, -1]];
        else if (s.w >= 14) offsets = [[1.9, 1], [5.3, 1], [-1.9, -1], [-5.3, -1]];
        else offsets = [[s.w / 4, 1], [-s.w / 4, -1]];
      } else {
        const d = s.oneway as 1 | -1;
        offsets = s.w >= 11 ? [[-s.w / 4, d], [s.w / 4, d]] : [[0.4 * d, d]];
      }
      for (const [off, d] of offsets) {
        // la voie se trouve à droite du sens de circulation (circulation à droite)
        const start = d === 1 ? a : b;
        const end = d === 1 ? b : a;
        const ldir = end.clone().sub(start).normalize();
        const rightLane = new THREE.Vector3(-ldir.z, 0, ldir.x);
        const r = s.oneway === 2 || s.id === "rene" ? Math.abs(off) : off;
        const la = start.clone().addScaledVector(rightLane, r);
        const lb = end.clone().addScaledVector(rightLane, r);
        const lane: Lane = { street: s, a: la, b: lb, dir: ldir, len: la.distanceTo(lb), speed: s.cat === "major" ? 12 : s.cat === "medium" ? 10 : 7.5, stops: [], bus: ["berri", "stecath", "ontario", "rene", "stdenis", "sthubert"].includes(s.id) && Math.abs(off) < 3 };
        // arrêts aux carrefours
        data.intersections.forEach((it, ii) => {
          if (!it.s.includes(s.id)) return;
          const other = this.city.streetById.get(it.s[0] === s.id ? it.s[1] : it.s[0])!;
          const p = new THREE.Vector3(it.p[0], 0, it.p[1]);
          const t = p.clone().sub(la).dot(ldir) - (other.w / 2 + other.sw * 0.5 + 3.6);
          if (t < 1 || t > lane.len - 1) return;
          const axis: 0 | 1 = it.s[0] === s.id ? 0 : 1;
          const priority = it.kind === "stop" && s.cat !== "minor" && other.cat === "minor";
          lane.stops.push({ t, inter: ii, axis, kind: it.kind, priority });
        });
        lane.stops.sort((x, y) => x.t - y.t);
        this.lanes.push(lane);
      }
    }
  }

  /** État d'un feu : "g", "y" ou "r". */
  signal(inter: number, axis: 0 | 1): "g" | "y" | "r" {
    if (this.signalsOut) return Math.floor(this.time * 1.5) % 2 === 0 ? "r" : "y";
    const off = hash01(inter * 977) * CYCLE;
    const c = (this.time + off) % CYCLE;
    const ph = axis === 0 ? c : (c + CYCLE / 2) % CYCLE;
    if (ph < 19) return "g";
    if (ph < 22) return "y";
    return "r";
  }

  private spawn(player: THREE.Vector3): boolean {
    for (let tries = 0; tries < 20; tries++) {
      const busWanted = this.cars.filter((c) => c.active && c.bus).length < 3 && this.rng.chance(0.25);
      const lanes = busWanted ? this.lanes.filter((l) => l.bus) : this.lanes;
      const lane = this.rng.pick(lanes);
      // point de la voie entre 60 et 160 m du joueur
      const t = this.rng.range(0, lane.len);
      const p = lane.a.clone().addScaledVector(lane.dir, t);
      const d = p.distanceTo(player);
      if (d < 55 || d > 165) continue;
      if (this.cars.some((c) => c.active && c.lane === lane && Math.abs(c.t - t) < 14)) continue;
      let car = this.cars.find((c) => !c.active && c.bus === busWanted);
      if (!car) {
        if (this.cars.length >= this.target + 6) return false;
        car = this.makeCar(busWanted);
      }
      car.lane = lane;
      car.t = t;
      car.max = lane.speed * this.rng.range(0.85, 1.1) * (busWanted ? 0.8 : 1);
      car.speed = car.max * 0.7;
      car.active = true;
      car.group.visible = true;
      car.passed = new Set(lane.stops.filter((s) => s.t < t).map((s) => s.inter));
      car.stopWait = 0;
      car.busStopT = -1;
      car.busWait = 0;
      if (busWanted) {
        const bs = this.busStops.find((b) => {
          const v = new THREE.Vector3(b.x, 0, b.z).sub(lane.a);
          const lat = Math.abs(v.x * -lane.dir.z + v.z * lane.dir.x);
          const tt = v.dot(lane.dir);
          return lat < lane.street.w / 2 + 4 && tt > t;
        });
        if (bs) car.busStopT = new THREE.Vector3(bs.x, 0, bs.z).sub(lane.a).dot(lane.dir);
      }
      this.stats.spawned++;
      return true;
    }
    return false;
  }

  private makeCar(bus: boolean): Car {
    const R = this.physics.RAPIER;
    const geo = bus ? this.busGeo : this.rng.pick(this.carGeos);
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geo, this.carMat);
    mesh.castShadow = true;
    group.add(mesh);
    const len = bus ? 12 : 4.6;
    const W = bus ? 2.55 : 1.85;
    // phares : cônes de lumière additifs + feux arrière
    // éclairage de nuit (masqué le jour : un seul appel de dessin par véhicule)
    const night = new THREE.Group();
    night.name = "phares";
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 9, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0.75, len / 2 + 4.5), this.lightMat);
    cone.renderOrder = 2;
    night.add(cone);
    const tl = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.3, 0.16).rotateY(Math.PI), this.tailMat);
    tl.position.set(0, bus ? 1.0 : 0.78, -len / 2 - 0.04);
    night.add(tl);
    night.visible = false;
    group.add(night);
    if (bus) {
      const sign = makeCanvasTexture(256, 32, (ctx, w, h) => {
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#ffb000";
        ctx.font = 'bold 22px "DejaVu Sans", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.rng.pick(["15 Sainte-Catherine", "30 Saint-Denis", "125 Ontario", "150 René-Lévesque", "24 Sherbrooke"]), w / 2, h / 2 + 1);
      });
      const s = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.26), new THREE.MeshBasicMaterial({ map: sign }));
      s.position.set(0, 2.85, len / 2 + 0.05);
      group.add(s);
      const logo = makeCanvasTexture(128, 64, (ctx, w, h) => {
        ctx.fillStyle = "#f4f4f2";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#0a4ea2";
        ctx.font = 'bold 40px "DejaVu Sans", Arial, sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("STM", w / 2, h / 2 + 2);
      });
      for (const sd of [1, -1]) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshStandardMaterial({ map: logo }));
        l.position.set(sd * 1.29, 1.65, 3);
        l.rotation.y = (sd * Math.PI) / 2;
        group.add(l);
      }
    }
    group.visible = false;
    this.group.add(group);
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, 0));
    this.physics.world.createCollider(R.ColliderDesc.cuboid(W / 2, bus ? 1.6 : 0.8, len / 2).setTranslation(0, bus ? 1.75 : 0.95, 0), body);
    const car: Car = { lane: this.lanes[0], t: 0, speed: 0, max: 10, len, group, body, active: false, stopWait: 0, passed: new Set(), blockedTime: 0, honked: 0, bus, busStopT: -1, busWait: 0 };
    this.cars.push(car);
    return car;
  }

  fixedUpdate(h: number, player: THREE.Vector3, peds: THREE.Vector3[]) {
    this.time += h;
    for (const car of this.cars) {
      if (!car.active) continue;
      const lane = car.lane;
      let target = car.max;
      const front = car.t + car.len / 2;
      // véhicule devant
      for (const o of this.cars) {
        if (o === car || !o.active || o.lane !== lane) continue;
        const gap = o.t - o.len / 2 - front;
        if (gap > -1 && gap < 40) target = Math.min(target, Math.max(0, (gap - 3) * 0.9));
      }
      // feux et ARRÊT
      for (const s of lane.stops) {
        if (car.passed.has(s.inter)) continue;
        const d = s.t - front;
        if (d < -2) {
          car.passed.add(s.inter);
          continue;
        }
        if (d > 45) break;
        if (s.kind === "light") {
          const st = this.signal(s.inter, s.axis);
          if (st === "r" || (st === "y" && d > 6)) {
            target = Math.min(target, Math.max(0, d * 0.75));
            if (d < 1.5 && car.speed < 0.5) this.stats.stoppedAtLights++;
          }
        } else if (!s.priority) {
          if (d < 0.8 && car.speed < 0.3) {
            car.stopWait += h;
            if (car.stopWait > 1.4) {
              car.passed.add(s.inter);
              car.stopWait = 0;
            }
          }
          target = Math.min(target, Math.max(0, d * 0.75));
        }
        break;
      }
      // arrêt d'autobus
      if (car.bus && car.busStopT > 0) {
        const d = car.busStopT - car.t;
        if (d < 30 && d > -1) {
          target = Math.min(target, Math.max(0, d * 0.7));
          if (Math.abs(d) < 1.2 && car.speed < 0.3) {
            car.busWait += h;
            if (car.busWait > 6) car.busStopT = -1;
          }
        }
      }
      // piétons et joueur devant
      const pos = lane.a.clone().addScaledVector(lane.dir, car.t);
      const right = new THREE.Vector3(-lane.dir.z, 0, lane.dir.x);
      let blockedByPlayer = false;
      const check = (p: THREE.Vector3, isPlayer: boolean) => {
        if (p.y > 3 || p.y < -2) return;
        const v = p.clone().sub(pos);
        const ahead = v.dot(lane.dir) - car.len / 2;
        const lat = Math.abs(v.dot(right));
        if (lat < 1.9 && ahead > -0.5 && ahead < 14) {
          target = Math.min(target, Math.max(0, (ahead - 2.2) * 0.8));
          if (isPlayer && ahead < 6) blockedByPlayer = true;
        }
      };
      check(player, true);
      for (const p of peds) if (Math.abs(p.x - pos.x) < 20 && Math.abs(p.z - pos.z) < 20) check(p, false);
      // accélération / freinage
      const acc = target > car.speed ? 2.6 : 7.5;
      car.speed += Math.sign(target - car.speed) * Math.min(Math.abs(target - car.speed), acc * h);
      car.t += car.speed * h;
      // klaxon si le joueur bloque
      if (blockedByPlayer && car.speed < 0.5) {
        car.blockedTime += h;
        if (car.blockedTime > 1.8 && this.time - car.honked > 4) {
          car.honked = this.time;
          this.stats.honks++;
          this.onHonk?.(pos);
        }
      } else car.blockedTime = 0;
      // choc avec le joueur (si le joueur saute devant)
      const vp = player.clone().sub(pos);
      const aheadP = vp.dot(lane.dir);
      if (Math.abs(vp.dot(right)) < 1.1 && aheadP > 0 && aheadP < car.len / 2 + 0.6 && car.speed > 2.5 && player.y < 2) {
        this.stats.hits++;
        this.onHitPlayer?.(lane.dir.clone().add(new THREE.Vector3(0, 0.3, 0)), car.speed);
        car.speed = 0;
      }
      if (car.t > lane.len || pos.distanceTo(player) > 190) {
        car.active = false;
        car.group.visible = false;
        car.body.setNextKinematicTranslation({ x: 0, y: -100, z: 0 });
        continue;
      }
      const yaw = Math.atan2(lane.dir.x, lane.dir.z);
      car.body.setNextKinematicTranslation({ x: pos.x, y: 0, z: pos.z });
      car.body.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    }
  }

  update(dt: number, player: THREE.Vector3, night: number) {
    let active = 0;
    for (const c of this.cars) if (c.active) active++;
    if (active < this.target) this.spawn(player);
    for (const car of this.cars) {
      if (!car.active) continue;
      const p = car.lane.a.clone().addScaledVector(car.lane.dir, car.t);
      car.group.position.lerp(p, car.group.position.distanceTo(p) > 3 ? 1 : Math.min(1, dt * 20));
      car.group.rotation.y = Math.atan2(car.lane.dir.x, car.lane.dir.z);
      car.group.position.y = Math.sin(this.time * 9 + car.t) * 0.008 * Math.min(1, car.speed / 5);
    }
    this.lightMat.opacity = night * 0.07;
    this.tailMat.opacity = night;
    const showLights = night > 0.05;
    for (const car of this.cars) {
      const n = car.group.children.find((c) => c.name === "phares");
      if (n) n.visible = showLights && car.active;
    }
    // feux de circulation
    const lamps = this.props.signalLamps;
    if (lamps && this.props.signalIndex.length) {
      for (const s of this.props.signalIndex) {
        const st = this.signal(s.inter, s.axis);
        const on = st === s.color;
        const base = s.color === "r" ? 0xff2a1a : s.color === "y" ? 0xffb300 : 0x2bd36b;
        this.signalCol.set(base).multiplyScalar(on ? 2.2 : 0.12);
        lamps.setColorAt(s.i, this.signalCol);
      }
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    }
  }

  activeCount() {
    return this.cars.filter((c) => c.active).length;
  }
}
