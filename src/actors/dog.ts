import * as THREE from "three";
import { SIDEWALK_Y } from "../world/city";
import { pointInPoly, type V2 } from "../world/geom";

/** Petit chien procédural (« Poutine ») : erre, fuit si l'on court vers lui. */
export class Dog {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  facing = 0;
  private legs: THREE.Object3D[] = [];
  private tail: THREE.Object3D;
  private head: THREE.Object3D;
  private phase = 0;
  speed = 0;
  private goal = new THREE.Vector3();
  private retarget = 0;
  caught = false;
  /** Suit cette position une fois attrapé. */
  follow: THREE.Vector3 | null = null;
  barkTimer = 3;
  onBark: (() => void) | null = null;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    start: THREE.Vector3,
    private area: V2[],
  ) {
    const fur = new THREE.MeshStandardMaterial({ color: 0xc8955a, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.38, 4, 10).rotateX(Math.PI / 2), fur);
    body.position.y = 0.38;
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), fur);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.12), fur);
    snout.position.set(0, -0.03, 0.12);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), dark);
    nose.position.set(0, -0.01, 0.19);
    for (const s of [1, -1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), dark);
      ear.position.set(s * 0.08, 0.1, -0.01);
      ear.rotation.z = -s * 0.5;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), dark);
      eye.position.set(s * 0.05, 0.03, 0.11);
      this.head.add(ear, eye);
    }
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 12), new THREE.MeshStandardMaterial({ color: 0xc0392b }));
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, -0.08, -0.04);
    this.head.add(skull, snout, nose, collar);
    this.head.position.set(0, 0.55, 0.3);
    for (const [x, z] of [
      [0.09, 0.2],
      [-0.09, 0.2],
      [0.09, -0.2],
      [-0.09, -0.2],
    ]) {
      const leg = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.2, 3, 6), fur);
      m.position.y = -0.14;
      leg.add(m);
      leg.position.set(x, 0.3, z);
      this.legs.push(leg);
      this.root.add(leg);
    }
    this.tail = new THREE.Group();
    const tm = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.18, 3, 6), fur);
    tm.position.y = 0.1;
    this.tail.add(tm);
    this.tail.position.set(0, 0.45, -0.32);
    this.tail.rotation.x = -0.7;
    this.root.add(body, this.head, this.tail);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.root.name = "Poutine le chien";
    scene.add(this.root);
    this.pos.copy(start);
    this.goal.copy(start);
  }

  update(dt: number, player: THREE.Vector3, playerSpeed: number) {
    this.time += dt;
    let target = this.speed;
    if (this.follow) {
      // en laisse : suit le maître
      const d = this.pos.distanceTo(this.follow);
      this.goal.copy(this.follow);
      target = d > 1.6 ? Math.min(4, d * 1.5) : 0;
    } else if (!this.caught) {
      const dp = Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
      if (dp < 7 && playerSpeed > 2.6) {
        // fuit à l'opposé du joueur
        const away = new THREE.Vector3(this.pos.x - player.x, 0, this.pos.z - player.z).normalize();
        const cand = this.pos.clone().addScaledVector(away, 6);
        if (!pointInPoly(cand.x, cand.z, this.area)) {
          // longe le bord : tourne de 90°
          away.set(-away.z, 0, away.x);
          cand.copy(this.pos).addScaledVector(away, 6);
        }
        this.goal.copy(cand);
        target = 5.2;
        this.retarget = 1.5;
      } else {
        this.retarget -= dt;
        if (this.retarget <= 0) {
          // nouveau but au hasard dans le parc
          for (let i = 0; i < 10; i++) {
            const c = this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16));
            if (pointInPoly(c.x, c.z, this.area)) {
              this.goal.copy(c);
              break;
            }
          }
          this.retarget = 2 + Math.random() * 3;
        }
        target = this.pos.distanceTo(this.goal) > 0.4 ? 1.6 : 0;
      }
      this.barkTimer -= dt;
      if (this.barkTimer < 0) {
        this.barkTimer = 4 + Math.random() * 6;
        this.onBark?.();
      }
    } else target = 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 5);
    const dx = this.goal.x - this.pos.x;
    const dz = this.goal.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05 && this.speed > 0.05) {
      const step = Math.min(d, this.speed * dt);
      const nx = this.pos.x + (dx / d) * step;
      const nz = this.pos.z + (dz / d) * step;
      if (this.follow || pointInPoly(nx, nz, this.area)) {
        this.pos.x = nx;
        this.pos.z = nz;
      } else this.retarget = 0;
      const want = Math.atan2(dx, dz);
      let a = want - this.facing;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      this.facing += a * Math.min(1, dt * 8);
    }
    this.pos.y = SIDEWALK_Y;
    this.phase += this.speed * dt * 9;
    this.legs.forEach((l, i) => (l.rotation.x = Math.sin(this.phase + (i === 0 || i === 3 ? 0 : Math.PI)) * Math.min(0.7, this.speed * 0.25)));
    this.tail.rotation.z = Math.sin(this.time * (this.caught ? 18 : 9)) * 0.5;
    this.head.rotation.x = Math.sin(this.time * 2) * 0.08;
    this.root.position.copy(this.pos);
    this.root.position.y += Math.abs(Math.sin(this.phase)) * 0.03 * Math.min(1, this.speed);
    this.root.rotation.y = this.facing;
  }
}
