import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { Physics } from "../core/physics";
import { METRO } from "./metroLayout";
import { SIDEWALK_Y } from "./city";
import { drawMetroLogo, makeCanvasTexture } from "../core/textures";
import { quatY } from "./props";

type CD = RAPIER.ColliderDesc;

/** Station Berri-UQAM : escaliers, mezzanine, tourniquets, quai, rame MPM-10. */
export class Metro {
  readonly group = new THREE.Group();
  private lights: THREE.PointLight[] = [];
  readonly train = new THREE.Group();
  private trainState: "away" | "arriving" | "stopped" | "leaving" = "away";
  private trainT = 0;
  private trainX: number = METRO.track.x1;
  private doors: THREE.Mesh[] = [];
  private stopX = (METRO.platform.x0 + METRO.platform.x1) / 2;
  onChime: (() => void) | null = null;
  onArrive: (() => void) | null = null;
  onRumble: ((k: number) => void) | null = null;
  /** Le joueur est-il sous terre ? */
  underground = false;
  arrivals = 0;
  private trainBody: RAPIER.RigidBody;
  private gateOpen = 0;
  private gate: THREE.Mesh | null = null;
  private gateCollider: RAPIER.Collider | null = null;
  hasValidTicket: () => boolean = () => false;
  onGateRefused: (() => void) | null = null;
  private refusedCooldown = 0;

  constructor(private physics: Physics) {
    this.group.name = "station Berri-UQAM";
    this.build();
    this.buildTrain();
    const R = physics.RAPIER;
    this.trainBody = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.trainX, METRO.track.y + 1.9, METRO.track.z));
    physics.world.createCollider(R.ColliderDesc.cuboid(76, 1.9, 1.4), this.trainBody);
    this.group.visible = false;
  }

  private col(desc: CD) {
    this.physics.world.createCollider(desc, this.physics.fixedBody);
  }

  private build() {
    const R = this.physics.RAPIER;
    const tileTex = makeCanvasTexture(256, 256, (ctx, w, h) => {
      // carreaux de céramique orangés et béton, palette typique du métro de 1966
      ctx.fillStyle = "#c0753a";
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          ctx.fillStyle = `hsl(${24 + Math.random() * 8}, ${50 + Math.random() * 15}%, ${42 + Math.random() * 10}%)`;
          ctx.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
        }
    }, true);
    tileTex.repeat.set(6, 2);
    const concreteTex = makeCanvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#8e8a83";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 3000; i++) {
        ctx.fillStyle = `rgba(${Math.random() * 60},${Math.random() * 60},${Math.random() * 60},0.15)`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      for (let x = 0; x < w; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }, true);
    concreteTex.repeat.set(8, 2);
    const floorTex = makeCanvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#4b4a48";
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          ctx.fillStyle = `hsl(30, 4%, ${30 + Math.random() * 8}%)`;
          ctx.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
        }
    }, true);
    floorTex.repeat.set(20, 6);
    const tiles = new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.4 });
    const concrete = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 });
    const floor = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6 });
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x5a5753, roughness: 0.95 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.3 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xfff4dc });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    // boîte (plancher + murs + plafond) avec collisions
    const room = (x0: number, x1: number, z0: number, z1: number, y: number, h: number, wallMat: THREE.Material, openings: { side: "x0" | "x1" | "z0" | "z1"; a: number; b: number }[] = [], withFloor = true) => {
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const w = x1 - x0;
      const d = z1 - z0;
      if (withFloor) {
        add(new THREE.BoxGeometry(w, 0.3, d), floor, cx, y - 0.15, cz);
        this.col(R.ColliderDesc.cuboid(w / 2, 0.15, d / 2).setTranslation(cx, y - 0.15, cz));
      }
      add(new THREE.BoxGeometry(w, 0.3, d), ceilingMat, cx, y + h + 0.15, cz);
      this.col(R.ColliderDesc.cuboid(w / 2, 0.15, d / 2).setTranslation(cx, y + h + 0.15, cz));
      const wall = (side: "x0" | "x1" | "z0" | "z1") => {
        const along = side === "x0" || side === "x1" ? [z0, z1] : [x0, x1];
        const ops = openings.filter((o) => o.side === side).sort((p, q) => p.a - q.a);
        let s = along[0];
        const segs: [number, number][] = [];
        for (const o of ops) {
          if (o.a > s) segs.push([s, o.a]);
          s = o.b;
        }
        if (s < along[1]) segs.push([s, along[1]]);
        for (const [a, b] of segs) {
          const L = b - a;
          const mid = (a + b) / 2;
          if (side === "x0" || side === "x1") {
            const x = side === "x0" ? x0 : x1;
            add(new THREE.BoxGeometry(0.3, h, L), wallMat, x, y + h / 2, mid);
            this.col(R.ColliderDesc.cuboid(0.15, h / 2, L / 2).setTranslation(x, y + h / 2, mid));
          } else {
            const z = side === "z0" ? z0 : z1;
            add(new THREE.BoxGeometry(L, h, 0.3), wallMat, mid, y + h / 2, z);
            this.col(R.ColliderDesc.cuboid(L / 2, h / 2, 0.15).setTranslation(mid, y + h / 2, z));
          }
        }
      };
      (["x0", "x1", "z0", "z1"] as const).forEach(wall);
      // néons
      for (let x = x0 + 3; x < x1 - 1; x += 6) add(new THREE.BoxGeometry(2.4, 0.06, 0.25), glow, x, y + h - 0.05, cz);
    };

    // ---------------- escalier 1 : de l'édicule à la mezzanine
    const s1 = METRO.stairs1;
    const run1 = s1.xTop - s1.xBottom;
    const rise1 = s1.yTop - s1.yBottom;
    const n1 = Math.round(rise1 / 0.18);
    for (let i = 0; i < n1; i++) {
      const x = s1.xTop - ((i + 0.5) * run1) / n1;
      const yTop = s1.yTop - ((i + 1) * rise1) / n1;
      add(new THREE.BoxGeometry(run1 / n1 + 0.02, 0.18, s1.z1 - s1.z0), concrete, x, yTop + 0.09 - 0.18 + 0.18, (s1.z0 + s1.z1) / 2);
    }
    const ang1 = Math.atan2(rise1, run1);
    const len1 = Math.hypot(rise1, run1);
    const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang1);
    this.col(R.ColliderDesc.cuboid(len1 / 2, 0.08, (s1.z1 - s1.z0) / 2).setTranslation((s1.xTop + s1.xBottom) / 2, (s1.yTop + s1.yBottom) / 2 - 0.08, (s1.z0 + s1.z1) / 2).setRotation({ x: q1.x, y: q1.y, z: q1.z, w: q1.w }));
    // murs de la cage d'escalier
    for (const z of [s1.z0 - 0.15, s1.z1 + 0.15]) {
      add(new THREE.BoxGeometry(run1 + 0.6, 7, 0.3), tiles, (s1.xTop + s1.xBottom) / 2, -2.8, z);
      this.col(R.ColliderDesc.cuboid(run1 / 2 + 0.3, 3.5, 0.15).setTranslation((s1.xTop + s1.xBottom) / 2, -2.8, z));
    }
    // plafond incliné au-dessus de l'escalier (pour la caméra)
    const ceil1 = new THREE.Mesh(new THREE.BoxGeometry(len1 + 2, 0.2, s1.z1 - s1.z0 + 0.6), ceilingMat);
    ceil1.position.set((s1.xTop + s1.xBottom) / 2 - 1.2, (s1.yTop + s1.yBottom) / 2 + 3.6, (s1.z0 + s1.z1) / 2);
    ceil1.quaternion.copy(q1);
    this.group.add(ceil1);
    // main courante
    for (const z of [s1.z0 + 0.1, s1.z1 - 0.1]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len1, 6).rotateZ(Math.PI / 2), steel);
      r.position.set((s1.xTop + s1.xBottom) / 2, (s1.yTop + s1.yBottom) / 2 + 0.9, z);
      r.quaternion.copy(q1).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0));
      r.rotation.z = ang1 + Math.PI / 2 - Math.PI / 2;
      r.rotateZ(Math.PI / 2);
      this.group.add(r);
    }

    // ---------------- mezzanine
    const m = METRO.mezz;
    room(m.x0, m.x1, m.z0, m.z1, m.y, m.h, tiles, [
      { side: "x1", a: s1.z0, b: s1.z1 },
      { side: "z0", a: METRO.stairs2.x0, b: METRO.stairs2.x1 },
    ]);
    // grande murale (hommage aux verrières de la station)
    const mural = makeCanvasTexture(1024, 256, (ctx, w, h) => {
      const cols = ["#1f4e79", "#e8b923", "#c0392b", "#2a9d8f", "#f4a261", "#6d2e46", "#f1faee"];
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = cols[i % cols.length];
        ctx.beginPath();
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.random() * 160 - 80, y + Math.random() * 160 - 80);
        ctx.lineTo(x + Math.random() * 160 - 80, y + Math.random() * 160 - 80);
        ctx.fill();
      }
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 6;
      for (let x = 0; x < w; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = 'bold 30px Georgia, "DejaVu Serif", serif';
      ctx.fillText("Hommage aux fondateurs de la ville de Montréal", 30, h - 20);
    });
    const mur = new THREE.Mesh(new THREE.PlaneGeometry(20, 3.2), new THREE.MeshBasicMaterial({ map: mural }));
    mur.position.set((m.x0 + m.x1) / 2, m.y + 2.4, m.z1 - 0.17);
    mur.rotation.y = Math.PI;
    this.group.add(mur);
    // nom de la station
    const nameTex = makeCanvasTexture(1024, 160, (ctx, w, h) => {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, w, h);
      drawMetroLogo(ctx, 80, h / 2, 60);
      ctx.fillStyle = "#fff";
      ctx.font = 'bold 96px "DejaVu Sans", Arial, sans-serif';
      ctx.textBaseline = "middle";
      ctx.fillText("Berri-UQAM", 170, h / 2 + 4);
    });
    const nameMat = new THREE.MeshBasicMaterial({ map: nameTex });
    const nm = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.1), nameMat);
    nm.position.set(m.x1 - 0.17, m.y + 3.0, (m.z0 + m.z1) / 2 + 6);
    nm.rotation.y = -Math.PI / 2;
    this.group.add(nm);
    // loge du changeur (guichet)
    const [bx, bz] = METRO.booth;
    const booth = new THREE.Group();
    const bb = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 2.2), new THREE.MeshStandardMaterial({ color: 0x0a4ea2, roughness: 0.5 }));
    bb.position.y = 0.55;
    const bg = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.3, 2.2), new THREE.MeshStandardMaterial({ color: 0xbfd9e6, transparent: true, opacity: 0.3, roughness: 0.05 }));
    bg.position.y = 1.75;
    const btop = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 2.4), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    btop.position.y = 2.5;
    const bsign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.4), new THREE.MeshBasicMaterial({ map: makeCanvasTexture(512, 80, (ctx, w, h) => {
      ctx.fillStyle = "#0a4ea2";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      ctx.font = 'bold 44px "DejaVu Sans", Arial, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("INFORMATION · STM", w / 2, h / 2 + 2);
    }) }));
    bsign.position.set(0, 2.85, 1.21);
    booth.add(bb, bg, btop, bsign);
    booth.position.set(bx, m.y, bz);
    this.group.add(booth);
    this.col(R.ColliderDesc.cuboid(1.6, 1.4, 1.1).setTranslation(bx, m.y + 1.4, bz));
    // distributeur de titres
    const [mx, mz] = METRO.machine;
    const machine = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.6), new THREE.MeshStandardMaterial({ map: makeCanvasTexture(128, 256, (ctx, w, h) => {
      ctx.fillStyle = "#e9ecef";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#0a4ea2";
      ctx.fillRect(0, 0, w, 40);
      ctx.fillStyle = "#fff";
      ctx.font = 'bold 18px "DejaVu Sans", Arial, sans-serif';
      ctx.fillText("Titres OPUS", 12, 26);
      ctx.fillStyle = "#1c2630";
      ctx.fillRect(16, 60, w - 32, 70);
      ctx.fillStyle = "#4ea3ff";
      ctx.fillRect(22, 66, w - 44, 58);
      ctx.fillStyle = "#333";
      ctx.fillRect(40, 170, 48, 10);
      ctx.fillRect(30, 200, 68, 30);
    }), roughness: 0.5 }));
    machine.position.set(mx, m.y + 0.95, mz + 0.4);
    machine.rotation.y = Math.PI;
    this.group.add(machine);
    this.col(R.ColliderDesc.cuboid(0.5, 0.95, 0.3).setTranslation(mx, m.y + 0.95, mz + 0.4));
    // tourniquets : rangée avec un portillon central
    const tx = METRO.turnstileX;
    const gateZ = 29;
    for (let z = m.z0 + 1; z < m.z1 - 0.5; z += 1.6) {
      if (Math.abs(z - gateZ) < 1.2) continue;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.3), steel);
      post.position.set(tx, m.y + 0.5, z);
      this.group.add(post);
      this.col(R.ColliderDesc.cuboid(0.45, 0.5, 0.15).setTranslation(tx, m.y + 0.5, z));
    }
    // barrières entre les tourniquets
    for (let z = m.z0 + 1.8; z < m.z1 - 1; z += 1.6) {
      if (Math.abs(z - gateZ) < 1.6) continue;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.3), steel);
      bar.position.set(tx, m.y + 0.95, z);
      this.group.add(bar);
      this.col(R.ColliderDesc.cuboid(0.1, 0.5, 0.65).setTranslation(tx, m.y + 0.5, z));
    }
    // portillon (s'ouvre avec une carte OPUS)
    this.gate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 1.5), new THREE.MeshStandardMaterial({ color: 0xbfd9e6, transparent: true, opacity: 0.5 }));
    this.gate.position.set(tx, m.y + 0.6, gateZ);
    this.group.add(this.gate);
    this.gateCollider = this.physics.world.createCollider(R.ColliderDesc.cuboid(0.1, 1.0, 0.75).setTranslation(tx, m.y + 1.0, gateZ), this.physics.fixedBody);
    const valid = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    valid.position.set(tx, m.y + 0.6, gateZ + 1.05);
    this.group.add(valid);

    // ---------------- escalier 2 : mezzanine → quai
    const s2 = METRO.stairs2;
    const run2 = s2.zTop - s2.zBottom;
    const rise2 = s2.yTop - s2.yBottom;
    const n2 = Math.round(rise2 / 0.18);
    for (let i = 0; i < n2; i++) {
      const z = s2.zTop - ((i + 0.5) * run2) / n2;
      const yTop = s2.yTop - ((i + 1) * rise2) / n2;
      add(new THREE.BoxGeometry(s2.x1 - s2.x0, 0.18, run2 / n2 + 0.02), concrete, (s2.x0 + s2.x1) / 2, yTop + 0.09, z);
    }
    const ang2 = Math.atan2(rise2, run2);
    const len2 = Math.hypot(rise2, run2);
    const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -ang2);
    this.col(R.ColliderDesc.cuboid((s2.x1 - s2.x0) / 2, 0.08, len2 / 2).setTranslation((s2.x0 + s2.x1) / 2, (s2.yTop + s2.yBottom) / 2 - 0.08, (s2.zTop + s2.zBottom) / 2).setRotation({ x: q2.x, y: q2.y, z: q2.z, w: q2.w }));
    for (const x of [s2.x0 - 0.15, s2.x1 + 0.15]) {
      add(new THREE.BoxGeometry(0.3, 8, run2 + 0.4), tiles, x, (s2.yTop + s2.yBottom) / 2 + 1.5, (s2.zTop + s2.zBottom) / 2);
      this.col(R.ColliderDesc.cuboid(0.15, 4, run2 / 2 + 0.2).setTranslation(x, (s2.yTop + s2.yBottom) / 2 + 1.5, (s2.zTop + s2.zBottom) / 2));
    }
    const ceil2 = new THREE.Mesh(new THREE.BoxGeometry(s2.x1 - s2.x0 + 0.6, 0.2, len2 + 1), ceilingMat);
    ceil2.position.set((s2.x0 + s2.x1) / 2, (s2.yTop + s2.yBottom) / 2 + 3.8, (s2.zTop + s2.zBottom) / 2);
    ceil2.quaternion.copy(q2);
    this.group.add(ceil2);

    // ---------------- quai
    const p = METRO.platform;
    room(p.x0, p.x1, p.z0 - 7.6, p.z1, p.y, p.h, concrete, [{ side: "z1", a: s2.x0, b: s2.x1 }], false);
    // plancher du quai
    add(new THREE.BoxGeometry(p.x1 - p.x0, 0.3, p.z1 - p.z0), floor, (p.x0 + p.x1) / 2, p.y - 0.15, (p.z0 + p.z1) / 2);
    this.col(R.ColliderDesc.cuboid((p.x1 - p.x0) / 2, 0.15, (p.z1 - p.z0) / 2).setTranslation((p.x0 + p.x1) / 2, p.y - 0.15, (p.z0 + p.z1) / 2));
    // la voie est en contrebas (fosse)
    const pitY = METRO.track.y - 0.1;
    add(new THREE.BoxGeometry(p.x1 - p.x0, 0.3, 7.6), new THREE.MeshStandardMaterial({ color: 0x2d2b29, roughness: 1 }), (p.x0 + p.x1) / 2, pitY - 0.15, p.z0 - 3.8);
    this.col(R.ColliderDesc.cuboid((p.x1 - p.x0) / 2, 0.15, 3.8).setTranslation((p.x0 + p.x1) / 2, pitY - 0.15, p.z0 - 3.8));
    add(new THREE.BoxGeometry(p.x1 - p.x0, p.y - pitY, 0.3), concrete, (p.x0 + p.x1) / 2, (p.y + pitY) / 2, p.z0 - 0.15);
    // bord du quai (bande jaune) et muret pour ne pas tomber
    const edge = new THREE.Mesh(new THREE.BoxGeometry(p.x1 - p.x0, 0.02, 0.5), new THREE.MeshStandardMaterial({ color: 0xe8b923 }));
    edge.position.set((p.x0 + p.x1) / 2, p.y + 0.01, p.z0 + 0.25);
    this.group.add(edge);
    this.col(R.ColliderDesc.cuboid((p.x1 - p.x0) / 2, 1.0, 0.1).setTranslation((p.x0 + p.x1) / 2, p.y + 1.0, p.z0 - 0.1));
    // rails
    for (const dz of [-0.72, 0.72]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(p.x1 - p.x0 + 300, 0.12, 0.08), steel);
      rail.position.set((p.x0 + p.x1) / 2, METRO.track.y, METRO.track.z + dz);
      this.group.add(rail);
    }
    // pistes de roulement (le métro de Montréal roule sur pneus !)
    for (const dz of [-1.0, 1.0]) {
      const pist = new THREE.Mesh(new THREE.BoxGeometry(p.x1 - p.x0 + 300, 0.1, 0.3), concrete);
      pist.position.set((p.x0 + p.x1) / 2, METRO.track.y + 0.05, METRO.track.z + dz);
      this.group.add(pist);
    }
    // tunnels aux extrémités
    for (const x of [p.x0 - 0.2, p.x1 + 0.2]) {
      const tunnel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.4, 7.2), new THREE.MeshBasicMaterial({ color: 0x050505 }));
      tunnel.position.set(x, p.y + 0.9, p.z0 - 3.8);
      this.group.add(tunnel);
    }
    // affiches de direction et nom de station sur le mur d'en face
    for (const [x, txt] of [
      [p.x0 + 12, "← Direction Angrignon"],
      [p.x1 - 12, "Direction Honoré-Beaugrand →"],
    ] as [number, string][]) {
      const t = makeCanvasTexture(512, 96, (ctx, w, h) => {
        ctx.fillStyle = "#00843d";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#fff";
        ctx.font = 'bold 40px "DejaVu Sans", Arial, sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(txt, w / 2, h / 2 + 2);
      });
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.85), new THREE.MeshBasicMaterial({ map: t }));
      sm.position.set(x, p.y + 3.4, p.z1 - 0.17);
      sm.rotation.y = Math.PI;
      this.group.add(sm);
    }
    for (let x = p.x0 + 25; x < p.x1 - 10; x += 30) {
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.95), nameMat);
      sm.position.set(x, p.y + 2.2, p.z0 - 7.43);
      this.group.add(sm);
    }
    // bancs du quai
    for (let x = p.x0 + 15; x < p.x1 - 10; x += 18) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.45, 0.5), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 }));
      bench.position.set(x, p.y + 0.23, p.z1 - 0.8);
      this.group.add(bench);
      this.col(R.ColliderDesc.cuboid(1.2, 0.23, 0.25).setTranslation(x, p.y + 0.23, p.z1 - 0.8));
    }
    // lumières ponctuelles (actives seulement sous terre)
    for (const [x, y, z] of [
      [(m.x0 + m.x1) / 2, m.y + 3.6, (m.z0 + m.z1) / 2],
      [-40, p.y + 4.5, 2],
      [-90, p.y + 4.5, 2],
    ]) {
      const L = new THREE.PointLight(0xffe2b8, 0, 45, 1.4);
      L.position.set(x, y, z);
      this.lights.push(L);
      this.group.add(L);
    }
    void quatY;
  }

  private buildTrain() {
    // rame MPM-10 « Azur » : bleue et blanche, trois voitures visibles
    const blue = new THREE.MeshStandardMaterial({ color: 0x1f5fae, roughness: 0.35, metalness: 0.3 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.35 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1c2630, roughness: 0.1, metalness: 0.3 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xcfd6dc, roughness: 0.3 });
    const len = 152;
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, 3.0, 2.5), white);
    body.position.y = 1.7;
    const band = new THREE.Mesh(new THREE.BoxGeometry(len + 0.02, 0.6, 2.52), blue);
    band.position.y = 1.0;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, 2.3), blue);
    roof.position.y = 3.3;
    const win = new THREE.Mesh(new THREE.BoxGeometry(len - 2, 0.9, 2.54), glass);
    win.position.y = 2.25;
    this.train.add(body, band, roof, win);
    for (let x = -len / 2 + 4; x < len / 2 - 2; x += 5.5) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.06), doorMat);
      d.position.set(x, 1.45, 1.27);
      this.doors.push(d);
      this.train.add(d);
    }
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.6, 2.4), blue);
    nose.position.set(-len / 2 - 0.2, 1.6, 0);
    const head = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), new THREE.MeshBasicMaterial({ color: 0xffffee }));
    head.position.set(-len / 2 - 0.41, 0.9, 0.7);
    head.rotation.y = -Math.PI / 2;
    const head2 = head.clone();
    head2.position.z = -0.7;
    this.train.add(nose, head, head2);
    this.train.position.set(this.trainX, METRO.track.y, METRO.track.z);
    this.group.add(this.train);
  }

  update(dt: number, player: THREE.Vector3) {
    const wasUnder = this.underground;
    this.underground = player.y < -1.2 && player.x < -10 && player.x > -140 && player.z < 45 && player.z > -12;
    this.group.visible = this.underground || (player.distanceTo(new THREE.Vector3(-20, 0, 28)) < 40);
    for (const L of this.lights) L.intensity = this.underground ? 45 : 0;
    void wasUnder;
    // portillon : s'ouvre si le joueur a une carte OPUS et s'approche
    if (this.gate && this.gateCollider) {
      const near = Math.abs(player.x - METRO.turnstileX) < 2.2 && Math.abs(player.z - 29) < 1.4 && player.y < -4;
      const ok = this.hasValidTicket();
      if (near && !ok) {
        this.refusedCooldown -= dt;
        if (this.refusedCooldown <= 0) {
          this.refusedCooldown = 4;
          this.onGateRefused?.();
        }
      }
      const target = near && ok ? 1 : 0;
      this.gateOpen += (target - this.gateOpen) * Math.min(1, dt * 6);
      this.gate.rotation.y = this.gateOpen * 1.4;
      this.gateCollider.setEnabled(this.gateOpen < 0.5);
    }
    // cycle de la rame
    this.trainT += dt;
    switch (this.trainState) {
      case "away":
        if (this.trainT > 25) {
          this.trainState = "arriving";
          this.trainT = 0;
          this.trainX = METRO.track.x1 + 120;
          if (this.underground) this.onRumble?.(1);
        }
        break;
      case "arriving": {
        // freinage jusqu'au milieu du quai
        const k = Math.min(1, this.trainT / 9);
        const ease = 1 - Math.pow(1 - k, 2.4);
        this.trainX = METRO.track.x1 + 120 + (this.stopX - (METRO.track.x1 + 120)) * ease;
        if (k >= 1) {
          this.trainState = "stopped";
          this.trainT = 0;
          this.arrivals++;
          this.onArrive?.();
        }
        break;
      }
      case "stopped": {
        const open = this.trainT > 1 && this.trainT < 12 ? Math.min(1, (this.trainT - 1) * 2, (12 - this.trainT) * 2) : 0;
        this.doors.forEach((d, i) => (d.position.z = 1.27 + open * 0.05 + (i % 2 ? 0 : 0)));
        this.doors.forEach((d) => (d.scale.x = 1 - open * 0.92));
        if (this.trainT > 11 && this.trainT - dt <= 11) this.onChime?.();
        if (this.trainT > 13.5) {
          this.trainState = "leaving";
          this.trainT = 0;
          if (this.underground) this.onRumble?.(0.7);
        }
        break;
      }
      case "leaving": {
        const k = Math.min(1, this.trainT / 10);
        this.trainX = this.stopX - Math.pow(k, 1.8) * 260;
        if (k >= 1) {
          this.trainState = "away";
          this.trainT = 0;
          this.trainX = METRO.track.x0 - 200;
        }
        break;
      }
    }
    this.train.position.x = this.trainX;
    this.trainBody.setNextKinematicTranslation({ x: this.trainX, y: METRO.track.y + 1.9, z: METRO.track.z });
  }

  get trainStatus() {
    return this.trainState;
  }
}

export const METRO_SURFACE_Y = SIDEWALK_Y;
