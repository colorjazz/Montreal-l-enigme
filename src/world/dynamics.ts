import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Physics } from "../core/physics";
import { SIDEWALK_Y } from "./city";
import { makeCanvasTexture } from "../core/textures";

export type DynKind = "cone" | "barrel" | "box" | "ball" | "bin";

interface Dyn {
  kind: DynKind;
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  prev: THREE.Vector3;
  prevQ: THREE.Quaternion;
  cur: THREE.Vector3;
  curQ: THREE.Quaternion;
}

/** Objets dynamiques (physique Rapier) : cônes orange, barils, boîtes, ballon. */
export class Dynamics {
  readonly group = new THREE.Group();
  readonly items: Dyn[] = [];
  private geos: Partial<Record<DynKind, THREE.BufferGeometry>> = {};
  private mats: Partial<Record<DynKind, THREE.Material | THREE.Material[]>> = {};
  /** Bruit d'impact (pour l'audio). */
  onImpact: ((pos: THREE.Vector3, strength: number, kind: DynKind) => void) | null = null;

  constructor(private physics: Physics) {
    this.group.name = "objets dynamiques";
    // cône de signalisation : orange fluo, bandes réfléchissantes
    const coneTex = makeCanvasTexture(64, 256, (ctx, w, h) => {
      ctx.fillStyle = "#ff6a00";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#f4f4f4";
      ctx.fillRect(0, h * 0.25, w, h * 0.12);
      ctx.fillRect(0, h * 0.5, w, h * 0.1);
    });
    const cone = new THREE.ConeGeometry(0.17, 0.7, 14, 1, true).translate(0, 0.35 + 0.03, 0);
    const base = new THREE.BoxGeometry(0.4, 0.05, 0.4).translate(0, 0.025, 0);
    // UV de la base hors des bandes
    const buv = base.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < buv.count; i++) buv.setXY(i, 0.5, 0.05);
    this.geos.cone = mergeGeometries([cone.index ? cone.toNonIndexed() : cone, base.toNonIndexed()])!;
    this.mats.cone = new THREE.MeshStandardMaterial({ map: coneTex, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x331100 });
    const barrelTex = makeCanvasTexture(64, 256, (ctx, w, h) => {
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 ? "#f4f4f4" : "#ff6a00";
        ctx.fillRect(0, (i * h) / 5, w, h / 5);
      }
    });
    this.geos.barrel = new THREE.CylinderGeometry(0.28, 0.3, 1.0, 14).translate(0, 0.5, 0);
    this.mats.barrel = new THREE.MeshStandardMaterial({ map: barrelTex, roughness: 0.6 });
    this.geos.box = new THREE.BoxGeometry(0.55, 0.45, 0.45).translate(0, 0.225, 0);
    this.mats.box = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.95 });
    const ballTex = makeCanvasTexture(128, 64, (ctx, w, h) => {
      ctx.fillStyle = "#f4f4f4";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#111";
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.arc((i * w) / 8 + 8, (i % 2) * 30 + 16, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    this.geos.ball = new THREE.SphereGeometry(0.11, 16, 12);
    this.mats.ball = new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.5 });
    this.geos.bin = new THREE.CylinderGeometry(0.3, 0.26, 0.9, 12).translate(0, 0.45, 0);
    this.mats.bin = new THREE.MeshStandardMaterial({ color: 0x2c5f3f, roughness: 0.6 });
  }

  add(kind: DynKind, x: number, z: number, rotY = 0, tipped = false, y = SIDEWALK_Y): { pos: () => THREE.Vector3; body: RAPIER.RigidBody } {
    const R = this.physics.RAPIER;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tipped ? Math.PI / 2 : 0, rotY, 0));
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(x, y + (tipped ? 0.2 : 0.02), z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.6)
      .setAngularDamping(0.8)
      .setCanSleep(true);
    const body = this.physics.world.createRigidBody(desc);
    let col: RAPIER.ColliderDesc;
    switch (kind) {
      case "cone":
        col = R.ColliderDesc.convexHull(new Float32Array([-0.2, 0, -0.2, 0.2, 0, -0.2, 0.2, 0, 0.2, -0.2, 0, 0.2, -0.04, 0.72, -0.04, 0.04, 0.72, -0.04, 0.04, 0.72, 0.04, -0.04, 0.72, 0.04]))!.setDensity(25);
        break;
      case "barrel":
        col = R.ColliderDesc.cylinder(0.5, 0.29).setTranslation(0, 0.5, 0).setDensity(60);
        break;
      case "box":
        col = R.ColliderDesc.cuboid(0.275, 0.225, 0.225).setTranslation(0, 0.225, 0).setDensity(40);
        break;
      case "ball":
        col = R.ColliderDesc.ball(0.11).setDensity(80).setRestitution(0.7);
        break;
      case "bin":
        col = R.ColliderDesc.cylinder(0.45, 0.29).setTranslation(0, 0.45, 0).setDensity(70);
        break;
    }
    col.setFriction(kind === "ball" ? 0.6 : 0.7);
    this.physics.world.createCollider(col, body);
    const mesh = new THREE.Mesh(this.geos[kind]!, this.mats[kind]!);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const t = body.translation();
    const r = body.rotation();
    const d: Dyn = { kind, body, mesh, prev: new THREE.Vector3(t.x, t.y, t.z), cur: new THREE.Vector3(t.x, t.y, t.z), prevQ: new THREE.Quaternion(r.x, r.y, r.z, r.w), curQ: new THREE.Quaternion(r.x, r.y, r.z, r.w) };
    this.items.push(d);
    mesh.position.copy(d.cur);
    mesh.quaternion.copy(d.curQ);
    return { pos: () => d.cur, body };
  }

  /** Panneau de chantier en A (statique). */
  addSign(x: number, z: number, text: string) {
    const tex = makeCanvasTexture(512, 256, (ctx, w, h) => {
      for (let i = -2; i < 12; i++) {
        ctx.fillStyle = i % 2 ? "#ff6a00" : "#f4f4f4";
        ctx.beginPath();
        ctx.moveTo(i * 50, h);
        ctx.lineTo(i * 50 + 50, h);
        ctx.lineTo(i * 50 + 150, 0);
        ctx.lineTo(i * 50 + 100, 0);
        ctx.fill();
      }
      ctx.fillStyle = "#ff6a00";
      ctx.fillRect(20, 30, w - 40, h - 60);
      ctx.fillStyle = "#111";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let s = 70;
      ctx.font = `bold ${s}px "DejaVu Sans", Arial, sans-serif`;
      while (ctx.measureText(text).width > w - 70 && s > 20) {
        s -= 3;
        ctx.font = `bold ${s}px "DejaVu Sans", Arial, sans-serif`;
      }
      ctx.fillText(text, w / 2, h / 2);
    });
    const g = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.04), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    board.position.y = 1.0;
    const legMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    for (const s of [-0.7, 0.7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.06), legMat);
      leg.position.set(s, 0.65, 0);
      g.add(leg);
    }
    g.add(board);
    g.position.set(x, 0, z);
    g.rotation.y = 0;
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.group.add(g);
    const R = this.physics.RAPIER;
    this.physics.world.createCollider(R.ColliderDesc.cuboid(0.8, 0.7, 0.1).setTranslation(x, 0.7, z), this.physics.fixedBody);
  }

  /** Après chaque pas physique : mémorise l'état pour l'interpolation. */
  afterStep() {
    for (const d of this.items) {
      d.prev.copy(d.cur);
      d.prevQ.copy(d.curQ);
      const t = d.body.translation();
      const r = d.body.rotation();
      const v = d.body.linvel();
      const speedBefore = d.cur.distanceTo(new THREE.Vector3(t.x, t.y, t.z)) * 60;
      d.cur.set(t.x, t.y, t.z);
      d.curQ.set(r.x, r.y, r.z, r.w);
      // tombé sous la ville : on le replace
      if (t.y < -30) {
        d.body.setTranslation({ x: t.x, y: 1, z: t.z }, true);
        d.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      const sp = Math.hypot(v.x, v.y, v.z);
      if (this.onImpact && speedBefore > 2.5 && sp < speedBefore * 0.5) this.onImpact(d.cur, speedBefore, d.kind);
    }
  }

  update(alpha: number) {
    for (const d of this.items) {
      d.mesh.position.lerpVectors(d.prev, d.cur, alpha);
      d.mesh.quaternion.slerpQuaternions(d.prevQ, d.curQ, alpha);
    }
  }

  awakeCount() {
    return this.items.filter((d) => !d.body.isSleeping()).length;
  }
}
