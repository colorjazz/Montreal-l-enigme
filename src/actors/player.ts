import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { Character, type Look, type AnimState } from "./character";
import type { Physics } from "../core/physics";
import type { Input } from "../core/input";

export const PLAYER_LOOK: Look = {
  skin: "#e8be9c",
  hair: "#3a2416",
  hairStyle: "short",
  top: "#1f4e79",
  topStyle: "jacket",
  bottom: "#2b2d42",
  bottomStyle: "jeans",
  shoes: "#f1f1f1",
  hat: "tuque",
  hatColor: "#c8102e",
  backpack: "#e9c46a",
  scarf: undefined,
  glasses: false,
  height: 1.0,
  build: 1.0,
};

const HALF_H = 0.55;
const RADIUS = 0.32;
const CENTER_Y = HALF_H + RADIUS; // centre de la capsule au-dessus des pieds

export interface PlayerTuning {
  walk: number;
  jog: number;
  sprint: number;
  jump: number;
  gravity: number;
}

/** Joueur à la troisième personne : contrôleur cinématique Rapier + caméra orbitale. */
export class Player {
  readonly char: Character;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly kcc: RAPIER.KinematicCharacterController;
  readonly tuning: PlayerTuning = { walk: 1.7, jog: 4.4, sprint: 7.4, jump: 5.6, gravity: 19 };
  /** Position des pieds (interpolée pour l'affichage). */
  readonly position = new THREE.Vector3();
  private prev = new THREE.Vector3();
  private cur = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  private velY = 0;
  grounded = true;
  private coyote = 0;
  private jumpBuffer = 0;
  facing = 0;
  camYaw = Math.PI * 0.8;
  camPitch = 0.28;
  camDist = 5.2;
  private camDistSmoothed = 5.2;
  walkMode = false;
  mouseSens = 1;
  /** Désactive le déplacement (dialogue, cinématique). */
  frozen = false;
  private desiredDir = new THREE.Vector3();
  private speed = 0;
  state: AnimState = "idle";
  /** Animation imposée (ex. « talk », « wave ») tant que > 0 s. */
  private forced: { state: AnimState; t: number } | null = null;
  /** Bruits de pas (surface sous les pieds). */
  onStep: ((surface: "pavé" | "herbe" | "bois" | "métal") => void) | null = null;
  onLand: ((v: number) => void) | null = null;
  surfaceAt: (x: number, z: number, y: number) => "pavé" | "herbe" | "bois" | "métal" = () => "pavé";
  private airTime = 0;
  distanceWalked = 0;
  jumps = 0;
  /** Poussée externe (voiture, collision) amortie. */
  private push = new THREE.Vector3();
  spawn = new THREE.Vector3();

  constructor(
    private physics: Physics,
    scene: THREE.Scene,
    start: THREE.Vector3,
  ) {
    const R = physics.RAPIER;
    this.char = new Character(PLAYER_LOOK);
    this.char.root.name = "joueur";
    scene.add(this.char.root);
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y + CENTER_Y, start.z));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(HALF_H, RADIUS).setFriction(0), this.body);
    this.kcc = physics.world.createCharacterController(0.02);
    this.kcc.enableAutostep(0.38, 0.18, false);
    this.kcc.enableSnapToGround(0.45);
    this.kcc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(75);
    this.kcc.setSlideEnabled(true);
    this.cur.copy(start);
    this.prev.copy(start);
    this.position.copy(start);
    this.spawn.copy(start);
    this.char.anim.onStep = () => {
      if (this.grounded && this.speed > 0.5) this.onStep?.(this.surfaceAt(this.cur.x, this.cur.z, this.cur.y));
    };
  }

  teleport(p: THREE.Vector3, facing?: number) {
    this.body.setTranslation({ x: p.x, y: p.y + CENTER_Y, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + CENTER_Y, z: p.z });
    this.cur.copy(p);
    this.prev.copy(p);
    this.position.copy(p);
    this.velY = 0;
    this.speed = 0;
    if (facing !== undefined) {
      this.facing = facing;
      this.camYaw = facing + Math.PI;
    }
  }

  force(state: AnimState, seconds: number) {
    this.forced = { state, t: seconds };
  }

  knock(dir: THREE.Vector3, strength: number) {
    this.push.addScaledVector(dir, strength);
    this.velY = Math.max(this.velY, strength * 0.35);
  }

  /** Lecture des entrées et calcul de la direction voulue (une fois par image). */
  readInput(input: Input) {
    if (input.wasPressed("KeyC")) this.walkMode = !this.walkMode;
    const sens = 0.0024 * this.mouseSens;
    this.camYaw -= input.mouseDX * sens;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + input.mouseDY * sens, -0.5, 1.2);
    this.camYaw -= input.touchLook.x * 0.04;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + input.touchLook.y * 0.03, -0.5, 1.2);
    if (input.wheel) this.camDist = THREE.MathUtils.clamp(this.camDist + input.wheel * 0.6, 2.2, 12);
    const ax = this.frozen ? { x: 0, y: 0 } : input.moveAxes();
    const fwd = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    this.desiredDir.set(0, 0, 0).addScaledVector(fwd, ax.y).addScaledVector(right, ax.x);
    const mag = Math.min(1, this.desiredDir.length());
    if (mag > 0.01) this.desiredDir.normalize().multiplyScalar(mag);
    const sprint = input.isDown("ShiftLeft") || input.isDown("ShiftRight");
    const walk = this.walkMode || input.isDown("AltLeft");
    this.targetSpeed = mag < 0.01 ? 0 : (sprint ? this.tuning.sprint : walk ? this.tuning.walk : this.tuning.jog) * mag;
    if (!this.frozen && input.wasPressed("Space")) this.jumpBuffer = 0.15;
  }
  private targetSpeed = 0;

  /** Pas physique fixe (appelé avant chaque world.step). */
  fixedUpdate(h: number) {
    this.prev.copy(this.cur);
    // vitesse horizontale avec accélération
    const accel = this.grounded ? 14 : 4;
    const dv = this.targetSpeed - this.speed;
    this.speed += Math.sign(dv) * Math.min(Math.abs(dv), accel * h * (dv < 0 ? 1.6 : 1));
    if (this.desiredDir.lengthSq() > 0.0001) {
      const want = Math.atan2(this.desiredDir.x, this.desiredDir.z);
      let d = want - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, h * 12);
    }
    const dir = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    // saut (tampon + temps de coyote)
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - h);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - h);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velY = this.tuning.jump;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
      this.jumps++;
    }
    this.velY -= this.tuning.gravity * h;
    if (this.velY < -40) this.velY = -40;
    this.push.multiplyScalar(Math.exp(-h * 3));
    const move = {
      x: dir.x * this.speed * h + this.push.x * h,
      y: this.velY * h,
      z: dir.z * this.speed * h + this.push.z * h,
    };
    const R = this.physics.RAPIER;
    this.kcc.computeColliderMovement(this.collider, move, R.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = this.kcc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    // heurt d'un plafond
    if (this.velY > 0 && m.y < move.y * 0.5) this.velY = 0;
    if (this.grounded && this.velY < 0) {
      if (!wasGrounded && this.airTime > 0.25) this.onLand?.(-this.velY);
      this.velY = -1;
      this.airTime = 0;
    } else if (!this.grounded) this.airTime += h;
    const t = this.body.translation();
    const nx = t.x + m.x;
    const ny = t.y + m.y;
    const nz = t.z + m.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.cur.set(nx, ny - CENTER_Y, nz);
    const horiz = Math.hypot(m.x, m.z);
    this.velocity.set(m.x / h, m.y / h, m.z / h);
    this.distanceWalked += horiz;
    // vitesse réelle (bloqué contre un mur => animation ralentie)
    this.actualSpeed = horiz / h;
    if (this.cur.y < -60) this.teleport(this.spawn);
  }
  actualSpeed = 0;

  /** Mise à jour visuelle (interpolation, animation, caméra). */
  update(dt: number, alpha: number, camera: THREE.PerspectiveCamera, castCamera: (from: THREE.Vector3, to: THREE.Vector3) => number) {
    this.position.lerpVectors(this.prev, this.cur, alpha);
    this.char.root.position.copy(this.position);
    this.char.root.rotation.y = this.facing;
    // état d'animation
    let st: AnimState;
    const sp = Math.min(this.actualSpeed, this.speed + 0.5);
    if (!this.grounded && this.airTime > 0.12) st = this.velY > 0 ? "jump" : "fall";
    else if (sp > 5.6) st = "run";
    else if (sp > 0.35) st = sp > 3 ? "run" : "walk";
    else st = "idle";
    if (this.forced) {
      this.forced.t -= dt;
      if (sp < 0.35 && this.grounded) st = this.forced.state;
      if (this.forced.t <= 0) this.forced = null;
    }
    this.state = st;
    this.char.anim.update(dt, sp, st);

    // caméra orbitale au-dessus de l'épaule
    const target = new THREE.Vector3(this.position.x, this.position.y + 1.55, this.position.z);
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    target.addScaledVector(right, 0.45);
    const cp = Math.cos(this.camPitch);
    const want = new THREE.Vector3(Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), Math.cos(this.camYaw) * cp).multiplyScalar(this.camDist).add(target);
    const free = castCamera(target, want);
    const d = Math.min(this.camDist, free);
    // rapproche vite, éloigne doucement
    this.camDistSmoothed += (d - this.camDistSmoothed) * Math.min(1, dt * (d < this.camDistSmoothed ? 20 : 4));
    const camPos = new THREE.Vector3(Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), Math.cos(this.camYaw) * cp).multiplyScalar(this.camDistSmoothed).add(target);
    // pas sous le sol
    camPos.y = Math.max(camPos.y, this.position.y + 0.4);
    camera.position.copy(camPos);
    camera.lookAt(target);
    // champ de vision dynamique au sprint
    const fov = 60 + THREE.MathUtils.clamp((sp - 4.5) / 3, 0, 1) * 7;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
  }

  /** Point devant le joueur (pour les interactions). */
  forward(dist = 1): THREE.Vector3 {
    return new THREE.Vector3(this.position.x + Math.sin(this.facing) * dist, this.position.y, this.position.z + Math.cos(this.facing) * dist);
  }
}
