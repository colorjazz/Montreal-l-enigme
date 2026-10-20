import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { City } from "./city";
import { SIDEWALK_Y } from "./city";
import type { Physics } from "../core/physics";
import { drawMetroLogo, makeCanvasTexture, FONT, FONT_SERIF } from "../core/textures";
import { pointInPoly, distToSegment, type V2 } from "./geom";
import { quatY } from "./props";
import { Rng } from "../core/rng";
import { buildVapoterie, type VapoterieLayout } from "./vapoterie";

type ColliderDesc = import("@dimforge/rapier3d-compat").ColliderDesc;

const STONE = 0x9a948a;

/** Panneau texte (une seule texture par panneau). */
function textPanel(text: string, opts: { w: number; h: number; bg: string; fg: string; font?: string; px?: number; border?: string; sub?: string }): THREE.Mesh {
  const ratio = opts.w / opts.h;
  const H = 128;
  const W = Math.min(2048, Math.round(H * ratio));
  const tex = makeCanvasTexture(W, H, (ctx, w, h) => {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, w, h);
    if (opts.border) {
      ctx.strokeStyle = opts.border;
      ctx.lineWidth = 6;
      ctx.strokeRect(5, 5, w - 10, h - 10);
    }
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = opts.px ?? 76;
    const family = opts.font ?? FONT;
    ctx.font = `bold ${size}px ${family}`;
    while (ctx.measureText(text).width > w - 30 && size > 12) {
      size -= 2;
      ctx.font = `bold ${size}px ${family}`;
    }
    ctx.fillText(text, w / 2, opts.sub ? h * 0.4 : h / 2 + 4);
    if (opts.sub) {
      ctx.font = `${Math.round(size * 0.45)}px ${family}`;
      ctx.fillText(opts.sub, w / 2, h * 0.8);
    }
  });
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.1 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(opts.w, opts.h), mat);
  m.userData.glow = mat;
  return m;
}

export interface LandmarkInfo {
  id: string;
  name: string;
  pos: V2;
  /** Texte affiché quand on s'approche (en français). */
  blurb: string;
}

export class Landmarks {
  readonly group = new THREE.Group();
  readonly info: LandmarkInfo[] = [];
  private glowMats: THREE.MeshStandardMaterial[] = [];
  bulbs: THREE.InstancedMesh | null = null;
  private bulbMat!: THREE.MeshBasicMaterial;
  private stringLights: THREE.Points | null = null;
  clocherTop = new THREE.Vector3();
  /** Polygones à garder libres d'arbres (allées, jardins). */
  readonly clearZones: V2[][] = [];

  constructor(
    private city: City,
    private physics: Physics,
  ) {
    this.group.name = "repères";
    this.buildMetroEntrance();
    this.buildClocher();
    this.buildTheatre();
    this.buildBanq();
    this.buildDupuis();
    this.buildGamelin();
    this.buildFacadeSigns();
    this.buildPasteur();
    this.vapoterie = buildVapoterie(city, physics, this.group);
    if (this.vapoterie) {
      this.glowMats.push(...this.vapoterie.glow);
      this.info.push({ id: "vapoterie", name: this.vapoterie.name, pos: this.vapoterie.outside, blurb: "Boutique de produits de vapotage de la rue Saint-Denis. Vente interdite aux moins de 18 ans." });
    }
  }
  /** Boutique où l'on peut entrer (vendeur, porte, salle). */
  vapoterie: VapoterieLayout | null = null;

  private col(desc: ColliderDesc) {
    this.physics.world.createCollider(desc, this.physics.fixedBody);
  }

  private building(id: string) {
    return this.city.data.buildings.find((b) => b.landmark === id);
  }

  /** Façade d'un repère donnant sur une rue donnée (ou la plus longue). */
  private facade(id: string, street?: string) {
    const bi = this.city.data.buildings.findIndex((b) => b.landmark === id);
    const fs = this.city.frontages.filter((f) => f.building === bi && (!street || f.street.id === street));
    return fs.sort((a, b) => b.len - a.len)[0];
  }

  // ------------------------------------------------------------ édicule Berri-UQAM
  private buildMetroEntrance() {
    const R = this.physics.RAPIER;
    const g = new THREE.Group();
    g.name = "édicule Berri-UQAM";
    const steel = new THREE.MeshStandardMaterial({ color: 0x2c3036, metalness: 0.7, roughness: 0.35 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fc2d6, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide });
    const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b5ac, roughness: 0.9 });
    const x0 = -27.5;
    const x1 = -13.0;
    const z0 = 24.5;
    const z1 = 31.5;
    const H = 4.2;
    const y0 = SIDEWALK_Y;
    // toit en porte-à-faux
    const roof = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 2.4, 0.45, z1 - z0 + 2.0), concrete);
    roof.position.set((x0 + x1) / 2 + 0.8, y0 + H + 0.22, (z0 + z1) / 2);
    roof.castShadow = true;
    roof.receiveShadow = true;
    g.add(roof);
    // bandeau « MÉTRO » sur la façade est (côté Berri)
    const band = textPanel("MÉTRO  BERRI-UQAM", { w: 9, h: 0.75, bg: "#0a4ea2", fg: "#ffffff", px: 80 });
    band.position.set(x1 + 2.02, y0 + H + 0.22, (z0 + z1) / 2);
    band.rotation.y = Math.PI / 2;
    g.add(band);
    this.glowMats.push(band.userData.glow);
    // murs vitrés (nord, sud, ouest) avec meneaux
    const walls: [number, number, number, number][] = [
      [x0, z0, x1, z0],
      [x1, z1, x0, z1],
      [x0, z1, x0, z0],
    ];
    for (const [ax, az, bx, bz] of walls) {
      const L = Math.hypot(bx - ax, bz - az);
      const ang = Math.atan2(bz - az, bx - ax);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(L, H, 0.04), glass);
      pane.position.set((ax + bx) / 2, y0 + H / 2, (az + bz) / 2);
      pane.rotation.y = -ang;
      g.add(pane);
      const n = Math.max(2, Math.round(L / 1.8));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, H, 0.12), steel);
        post.position.set(ax + (bx - ax) * t, y0 + H / 2, az + (bz - az) * t);
        post.castShadow = true;
        g.add(post);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.1, 0.12), steel);
      rail.position.set((ax + bx) / 2, y0 + 1.1, (az + bz) / 2);
      rail.rotation.y = -ang;
      g.add(rail);
      this.col(
        R.ColliderDesc.cuboid(L / 2, H / 2, 0.1)
          .setTranslation((ax + bx) / 2, y0 + H / 2, (az + bz) / 2)
          .setRotation(quatY(-ang)),
      );
    }
    // poteaux de l'entrée côté Berri
    for (const z of [z0, z1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, H, 0.25), steel);
      post.position.set(x1, y0 + H / 2, z);
      g.add(post);
    }
    // plancher du palier (pavés) autour de la trémie
    // garde-corps le long de la trémie (côtés nord et sud) jusqu'au palier
    for (const z of [26, 30]) {
      const gr = new THREE.Mesh(new THREE.BoxGeometry(10, 1.0, 0.06), glass);
      gr.position.set(-21, y0 + 0.5, z);
      g.add(gr);
      const top = new THREE.Mesh(new THREE.BoxGeometry(10, 0.06, 0.08), steel);
      top.position.set(-21, y0 + 1.02, z);
      g.add(top);
    }
    // enseigne ronde du métro sur son mât
    const logoTex = makeCanvasTexture(256, 256, (ctx, w, h) => drawMetroLogo(ctx, w / 2, h / 2, w / 2 - 4));
    const logoMat = new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, alphaTest: 0.4, emissive: 0xffffff, emissiveMap: logoTex, emissiveIntensity: 0.25, side: THREE.DoubleSide });
    this.glowMats.push(logoMat);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.6, 10), steel);
    const mx = -11.6;
    const mz = 34.5;
    mast.position.set(mx, y0 + 2.3, mz);
    mast.castShadow = true;
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), logoMat);
    logo.position.set(mx, y0 + 4.35, mz);
    logo.rotation.y = Math.PI / 2;
    const logo2 = logo.clone();
    logo2.rotation.y = 0;
    const name = textPanel("Berri-UQAM", { w: 1.7, h: 0.38, bg: "#0a4ea2", fg: "#ffffff", px: 70 });
    name.position.set(mx + 0.06, y0 + 3.3, mz);
    name.rotation.y = Math.PI / 2;
    this.glowMats.push(name.userData.glow);
    g.add(mast, logo, logo2, name);
    this.col(R.ColliderDesc.cylinder(2.3, 0.12).setTranslation(mx, y0 + 2.3, mz));
    this.group.add(g);
    this.info.push({ id: "metro", name: "Station Berri-UQAM", pos: [-13, 28], blurb: "La plus grande station du métro de Montréal : les lignes verte, orange et jaune s'y croisent." });
  }

  // ------------------------------------------------------------ clocher Saint-Jacques
  private buildClocher() {
    const R = this.physics.RAPIER;
    const b = this.building("judith");
    if (!b) return;
    // coin sud-ouest du pavillon (Saint-Denis / Sainte-Catherine)
    let best = b.poly[0];
    for (const p of b.poly) if (-p[0] + p[1] > -best[0] + best[1]) best = p;
    const cx = best[0] + 4.2;
    const cz = best[1] - 4.2;
    const stoneTex = makeCanvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#8f897e";
      ctx.fillRect(0, 0, w, h);
      const rng = new Rng(9);
      for (let y = 0; y < h; y += 32) {
        let x = -rng.range(0, 40);
        while (x < w) {
          const bw = rng.range(40, 80);
          ctx.fillStyle = `hsl(38, ${rng.range(4, 9)}%, ${rng.range(52, 62)}%)`;
          ctx.fillRect(x + 2, y + 2, bw - 3, 29);
          x += bw;
        }
      }
    }, true);
    stoneTex.repeat.set(2, 6);
    const stone = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0xffffff, roughness: 0.92 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.8 });
    const copper = new THREE.MeshStandardMaterial({ color: 0x5f7f73, roughness: 0.6, metalness: 0.35 });
    const g = new THREE.Group();
    g.name = "clocher Saint-Jacques";
    g.position.set(cx, SIDEWALK_Y, cz);
    // tour carrée
    const tower = new THREE.Mesh(new THREE.BoxGeometry(7, 30, 7), stone);
    tower.position.y = 15;
    // contreforts
    for (const [dx, dz] of [
      [3.6, 3.6],
      [-3.6, 3.6],
      [3.6, -3.6],
      [-3.6, -3.6],
    ]) {
      const bt = new THREE.Mesh(new THREE.BoxGeometry(1.2, 26, 1.2), stone);
      bt.position.set(dx, 13, dz);
      g.add(bt);
      const pin = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.2, 4), stone);
      pin.position.set(dx, 27.6, dz);
      pin.rotation.y = Math.PI / 4;
      g.add(pin);
    }
    // baies en arc brisé (beffroi) sur chaque face
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const arch = archShape(2.0, 5.5);
      const ag = new THREE.ShapeGeometry(arch);
      const m = new THREE.Mesh(ag, dark);
      m.position.set(Math.sin(a) * 3.52, 21, Math.cos(a) * 3.52);
      m.rotation.y = a;
      g.add(m);
      const lower = new THREE.Mesh(new THREE.ShapeGeometry(archShape(1.3, 4)), dark);
      lower.position.set(Math.sin(a) * 3.52, 10, Math.cos(a) * 3.52);
      lower.rotation.y = a;
      g.add(lower);
      // horloge
      const clock = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32), new THREE.MeshStandardMaterial({ color: 0xf2efe6, emissive: 0xfff3d6, emissiveIntensity: 0.1 }));
      clock.position.set(Math.sin(a) * 3.53, 16.2, Math.cos(a) * 3.53);
      clock.rotation.y = a;
      this.glowMats.push(clock.material as THREE.MeshStandardMaterial);
      g.add(clock);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.02), dark);
      hand.position.set(Math.sin(a) * 3.56, 16.5, Math.cos(a) * 3.56);
      hand.rotation.y = a;
      g.add(hand);
    }
    // flèche octogonale élancée
    const spire = new THREE.Mesh(new THREE.ConeGeometry(3.4, 30, 8, 1, false), copper);
    spire.position.y = 30 + 15;
    spire.rotation.y = Math.PI / 8;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.0, 1.2, 8), stone);
    collar.position.y = 30.4;
    const cross = new THREE.Group();
    const cv = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.2, 0.18), dark);
    const ch = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.18), dark);
    ch.position.y = 0.4;
    cross.add(cv, ch);
    cross.position.y = 61;
    g.add(tower, spire, collar, cross);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(g);
    this.clocherTop.set(cx, 62, cz);
    this.col(R.ColliderDesc.cuboid(4.2, 15, 4.2).setTranslation(cx, SIDEWALK_Y + 15, cz));
    // façade du transept sud : pignon de pierre et rosace, sur Sainte-Catherine
    const f = this.facade("judith", "stecath");
    if (f) {
      const mid: V2 = [(f.p0[0] + f.p1[0]) / 2, (f.p0[1] + f.p1[1]) / 2];
      // près du clocher
      const d: V2 = [(f.p1[0] - f.p0[0]) / f.len, (f.p1[1] - f.p0[1]) / f.len];
      const t = Math.max(0, Math.min(f.len, (cx - f.p0[0]) * d[0] + (cz - f.p0[1]) * d[1] + 14));
      void mid;
      const px = f.p0[0] + d[0] * t + f.normal[0] * 0.3;
      const pz = f.p0[1] + d[1] * t + f.normal[1] * 0.3;
      const gable = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.ShapeGeometry(gableShape(12, 14, 6)), stone);
      gable.add(wall);
      const rose = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), new THREE.MeshStandardMaterial({ color: 0x3d4d66, emissive: 0xffb36b, emissiveIntensity: 0, roughness: 0.2 }));
      rose.position.set(0, 13.5, 0.05);
      this.roseMat = rose.material as THREE.MeshStandardMaterial;
      const portal = new THREE.Mesh(new THREE.ShapeGeometry(archShape(2.4, 5.2)), dark);
      portal.position.set(0, 0, 0.05);
      const lancetL = new THREE.Mesh(new THREE.ShapeGeometry(archShape(1.0, 4.5)), dark);
      lancetL.position.set(-3.6, 6.5, 0.05);
      const lancetR = lancetL.clone();
      lancetR.position.x = 3.6;
      gable.add(rose, portal, lancetL, lancetR);
      gable.position.set(px, SIDEWALK_Y, pz);
      gable.rotation.y = Math.atan2(f.normal[0], f.normal[1]);
      gable.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.group.add(gable);
    }
    this.info.push({ id: "clocher", name: "Clocher de l'église Saint-Jacques", pos: [cx, cz], blurb: "Le clocher et le transept sud de l'ancienne église Saint-Jacques sont intégrés au pavillon Judith-Jasmin de l'UQAM." });
  }
  private roseMat: THREE.MeshStandardMaterial | null = null;

  // ------------------------------------------------------------ Théâtre St-Denis
  private buildTheatre() {
    const f = this.facade("theatre", "stdenis");
    if (!f) return;
    const d: V2 = [(f.p1[0] - f.p0[0]) / f.len, (f.p1[1] - f.p0[1]) / f.len];
    const mid: V2 = [(f.p0[0] + f.p1[0]) / 2, (f.p0[1] + f.p1[1]) / 2];
    const rot = Math.atan2(f.normal[0], f.normal[1]);
    const g = new THREE.Group();
    g.position.set(mid[0], SIDEWALK_Y, mid[1]);
    g.rotation.y = rot;
    // marquise lumineuse
    const marquee = new THREE.Mesh(new THREE.BoxGeometry(Math.min(14, f.len - 2), 1.2, 3.2), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.4 }));
    marquee.position.set(0, 4.6, 1.6);
    const front = textPanel("ESPACE ST-DENIS", { w: Math.min(13.6, f.len - 2.4), h: 1.0, bg: "#f5efe0", fg: "#b3121a", px: 84, sub: "CE SOIR · HUMOUR · CHANSON · THÉÂTRE" });
    front.position.set(0, 4.6, 3.22);
    this.glowMats.push(front.userData.glow);
    // enseigne verticale à ampoules
    const blade = textPanel("ST-DENIS", { w: 6.5, h: 1.3, bg: "#b3121a", fg: "#ffe9b0", px: 96, font: FONT_SERIF });
    blade.rotation.z = Math.PI / 2;
    blade.rotation.y = Math.PI / 2;
    blade.position.set(-f.len / 2 + 3, 9.5, 1.1);
    const blade2 = blade.clone();
    blade2.rotation.y = -Math.PI / 2;
    blade2.position.x -= 0.02;
    this.glowMats.push(blade.userData.glow);
    const bladeBox = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6.8, 1.6), new THREE.MeshStandardMaterial({ color: 0x7a0c12 }));
    bladeBox.position.set(-f.len / 2 + 3 - 0.18, 9.5, 1.1);
    g.add(marquee, front, blade, blade2, bladeBox);
    // ampoules autour de la marquise
    const bulbs: THREE.Vector3[] = [];
    const mw = Math.min(14, f.len - 2);
    for (let i = 0; i <= 40; i++) bulbs.push(new THREE.Vector3(-mw / 2 + (mw * i) / 40, 4.0, 3.25));
    for (let i = 0; i <= 40; i++) bulbs.push(new THREE.Vector3(-mw / 2 + (mw * i) / 40, 5.2, 3.25));
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false });
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 4), this.bulbMat, bulbs.length);
    bulbs.forEach((p, i) => bm.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    this.bulbs = bm;
    g.add(bm);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o !== bm) o.castShadow = true;
    });
    this.group.add(g);
    void d;
    const world = new THREE.Vector3(0, 0, 4).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(new THREE.Vector3(mid[0], 0, mid[1]));
    this.info.push({ id: "theatre", name: "Théâtre St-Denis", pos: [world.x, world.z], blurb: "Salle de spectacle mythique de la rue Saint-Denis, ouverte en 1916." });
  }

  // ------------------------------------------------------------ Grande Bibliothèque
  private buildBanq() {
    const f = this.facade("banq", "maisonneuve") ?? this.facade("banq");
    if (!f) return;
    const mid: V2 = [(f.p0[0] + f.p1[0]) / 2, (f.p0[1] + f.p1[1]) / 2];
    const rot = Math.atan2(f.normal[0], f.normal[1]);
    const sign = textPanel("GRANDE BIBLIOTHÈQUE", { w: Math.min(24, f.len - 4), h: 1.4, bg: "#16261f", fg: "#d8f3e3", px: 84 });
    sign.position.set(mid[0] + f.normal[0] * 0.15, f.height - 1.6, mid[1] + f.normal[1] * 0.15);
    sign.rotation.y = rot;
    this.glowMats.push(sign.userData.glow);
    // auvent d'entrée en bois
    const can = new THREE.Mesh(new THREE.BoxGeometry(12, 0.35, 4), new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.7 }));
    const e = new THREE.Vector3(0, 0, 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    can.position.set(mid[0] + e.x, SIDEWALK_Y + 4.5, mid[1] + e.z);
    can.rotation.y = rot;
    can.castShadow = true;
    this.group.add(sign, can);
    const ent = new THREE.Vector3(0, 0, 4.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    this.info.push({ id: "banq", name: "Grande Bibliothèque (BAnQ)", pos: [mid[0] + ent.x, mid[1] + ent.z], blurb: "Bibliothèque et Archives nationales du Québec : plus de quatre millions de documents." });
  }

  // ------------------------------------------------------------ Place Dupuis
  private buildDupuis() {
    const R = this.physics.RAPIER;
    const b = this.building("dupuis");
    if (!b) return;
    // tour de bureaux sur la partie est de l'îlot
    const xs = b.poly.map((p) => p[0]);
    const zs = b.poly.map((p) => p[1]);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const cx = maxX - 22;
    const cz = minZ + 18;
    if (!pointInPoly(cx, cz, b.poly)) return;
    const floors = 21;
    const h = floors * 3.3;
    const towerTex = makeCanvasTexture(256, 512, (ctx, w, hh) => {
      ctx.fillStyle = "#6e5a49";
      ctx.fillRect(0, 0, w, hh);
      for (let y = 0; y < hh; y += 24) {
        ctx.fillStyle = "#1f2730";
        ctx.fillRect(0, y + 6, w, 12);
        ctx.fillStyle = "rgba(140,170,200,0.25)";
        ctx.fillRect(0, y + 6, w, 3);
      }
    }, true);
    towerTex.repeat.set(4, 2.6);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(30, h, 22), new THREE.MeshStandardMaterial({ map: towerTex, roughness: 0.7 }));
    tower.position.set(cx, SIDEWALK_Y + h / 2, cz);
    tower.castShadow = true;
    tower.receiveShadow = true;
    this.group.add(tower);
    const sign = textPanel("PLACE DUPUIS", { w: 14, h: 2.2, bg: "#2a2420", fg: "#ffcf6e", px: 96 });
    sign.position.set(cx, SIDEWALK_Y + h - 2, cz + 11.05);
    this.glowMats.push(sign.userData.glow);
    this.group.add(sign);
    this.col(R.ColliderDesc.cuboid(15, h / 2, 11).setTranslation(cx, SIDEWALK_Y + h / 2, cz));
    this.info.push({ id: "dupuis", name: "Place Dupuis", pos: [cx, cz + 14], blurb: "Complexe de bureaux et centre commercial relié au métro par le Montréal souterrain." });
  }

  // ------------------------------------------------------------ Place Émilie-Gamelin
  private buildGamelin() {
    const R = this.physics.RAPIER;
    const park = this.city.data.parks.find((p) => p.id === "emilie");
    if (!park) return;
    const xs = park.poly.map((p) => p[0]);
    const zs = park.poly.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    const Y = SIDEWALK_Y + 0.02;
    // allées en diagonale et allée centrale
    const paths: [V2, V2, number][] = [
      [[x0 + 2, z0 + 2], [x1 - 2, z1 - 2], 4.5],
      [[x1 - 2, z0 + 2], [x0 + 2, z1 - 2], 4.5],
      [[(x0 + x1) / 2, z0 + 1], [(x0 + x1) / 2, z1 - 1], 3.5],
      [[x0 + 1, (z0 + z1) / 2], [x1 - 1, (z0 + z1) / 2], 3.5],
    ];
    const pathGeo: THREE.BufferGeometry[] = [];
    for (const [a, b, w] of paths) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const pg = new THREE.PlaneGeometry(L, w).rotateX(-Math.PI / 2);
      pg.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0]));
      pg.translate((a[0] + b[0]) / 2, Y, (a[1] + b[1]) / 2);
      pathGeo.push(pg);
      const d: V2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const n: V2 = [-d[1] * (w / 2 + 1.2), d[0] * (w / 2 + 1.2)];
      this.clearZones.push([
        [a[0] + n[0], a[1] + n[1]],
        [b[0] + n[0], b[1] + n[1]],
        [b[0] - n[0], b[1] - n[1]],
        [a[0] - n[0], a[1] - n[1]],
      ]);
    }
    // place centrale circulaire
    const plaza = new THREE.CircleGeometry(11, 40).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, Y + 0.003, (z0 + z1) / 2);
    pathGeo.push(plaza);
    const cxp = (x0 + x1) / 2;
    const czp = (z0 + z1) / 2;
    this.clearZones.push(circlePoly(cxp, czp, 13));
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xb8a68a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
    const pm = new THREE.Mesh(mergeGeometries(pathGeo)!, pathMat);
    pm.receiveShadow = true;
    pm.name = "allées";
    this.group.add(pm);

    // sculptures de Melvin Charney : charpentes d'acier en forme de maisons
    const steel = new THREE.MeshStandardMaterial({ color: 0x4f5459, metalness: 0.75, roughness: 0.4 });
    const sculptX = x1 - 9;
    for (let i = 0; i < 4; i++) {
      const sz = z0 + 18 + i * 13;
      const sg = houseFrame(3.2 + (i % 2) * 0.8, 6 + i * 1.6, 3.2);
      const m = new THREE.Mesh(sg, steel);
      m.position.set(sculptX, SIDEWALK_Y, sz);
      m.rotation.y = 0.15 * (i - 1.5);
      m.castShadow = true;
      this.group.add(m);
      this.col(R.ColliderDesc.cuboid(1.8, 4, 1.8).setTranslation(sculptX, SIDEWALK_Y + 4, sz));
      this.clearZones.push(circlePoly(sculptX, sz, 4));
    }

    // Jardins Gamelin (partie nord) : guirlandes, tables, kiosque
    const jz0 = z0 + 6;
    const jz1 = z0 + 34;
    const jx0 = x0 + 8;
    const jx1 = cxp - 8;
    this.clearZones.push([
      [jx0 - 2, jz0 - 2],
      [jx1 + 2, jz0 - 2],
      [jx1 + 2, jz1 + 2],
      [jx0 - 2, jz1 + 2],
    ]);
    // plancher de bois
    const deck = new THREE.Mesh(new THREE.BoxGeometry(jx1 - jx0, 0.12, jz1 - jz0), new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.85 }));
    deck.position.set((jx0 + jx1) / 2, SIDEWALK_Y + 0.06, (jz0 + jz1) / 2);
    deck.receiveShadow = true;
    this.group.add(deck);
    // tables de pique-nique
    const tableGeo = mergeGeometries([
      new THREE.BoxGeometry(1.8, 0.06, 0.8).translate(0, 0.75, 0),
      new THREE.BoxGeometry(1.8, 0.05, 0.3).translate(0, 0.45, 0.6),
      new THREE.BoxGeometry(1.8, 0.05, 0.3).translate(0, 0.45, -0.6),
      new THREE.BoxGeometry(0.08, 0.75, 1.4).translate(-0.7, 0.37, 0),
      new THREE.BoxGeometry(0.08, 0.75, 1.4).translate(0.7, 0.37, 0),
    ])!;
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x3e6b4f, roughness: 0.8 });
    const tablePos: [number, number][] = [];
    for (let ix = 0; ix < 3; ix++)
      for (let iz = 0; iz < 3; iz++) {
        const x = jx0 + 4 + ix * ((jx1 - jx0 - 8) / 2);
        const z = jz0 + 6 + iz * 7;
        tablePos.push([x, z]);
      }
    const tables = new THREE.InstancedMesh(tableGeo, tableMat, tablePos.length);
    tablePos.forEach(([x, z], i) => {
      tables.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, SIDEWALK_Y + 0.12, z));
      this.col(R.ColliderDesc.cuboid(0.9, 0.4, 0.75).setTranslation(x, SIDEWALK_Y + 0.5, z));
    });
    tables.castShadow = true;
    this.group.add(tables);
    this.picnicSpots = tablePos;
    // kiosque-conteneur
    const kiosk = new THREE.Mesh(new THREE.BoxGeometry(6, 2.8, 2.6), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6, metalness: 0.3 }));
    const kx = jx0 + 4;
    const kz = jz1 - 1.5;
    kiosk.position.set(kx, SIDEWALK_Y + 1.4, kz);
    kiosk.castShadow = true;
    this.group.add(kiosk);
    const ks = textPanel("JARDINS GAMELIN", { w: 5.6, h: 0.6, bg: "#1d1d1d", fg: "#ffd166", px: 80, sub: "café · bar · musique" });
    ks.position.set(kx, SIDEWALK_Y + 2.4, kz - 1.32);
    ks.rotation.y = Math.PI;
    this.glowMats.push(ks.userData.glow);
    this.group.add(ks);
    this.col(R.ColliderDesc.cuboid(3, 1.4, 1.3).setTranslation(kx, SIDEWALK_Y + 1.4, kz));
    this.kioskPos = [kx, kz - 2.3];
    // guirlandes lumineuses entre des mâts
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 });
    const poles: V2[] = [
      [jx0, jz0],
      [jx1, jz0],
      [jx1, jz1],
      [jx0, jz1],
      [(jx0 + jx1) / 2, jz0],
      [(jx0 + jx1) / 2, jz1],
    ];
    for (const [px, pz] of poles) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5, 6), poleMat);
      p.position.set(px, SIDEWALK_Y + 2.5, pz);
      this.group.add(p);
    }
    const pts: number[] = [];
    const links: [number, number][] = [
      [0, 2],
      [1, 3],
      [4, 5],
      [0, 1],
      [3, 2],
    ];
    for (const [a, b] of links) {
      const A = poles[a];
      const B = poles[b];
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        const sag = Math.sin(Math.PI * t) * 1.2;
        pts.push(A[0] + (B[0] - A[0]) * t, SIDEWALK_Y + 4.8 - sag, A[1] + (B[1] - A[1]) * t);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.stringLights = new THREE.Points(lg, new THREE.PointsMaterial({ color: 0xffd28a, size: 0.22, sizeAttenuation: true, toneMapped: false }));
    this.stringLights.name = "guirlandes";
    this.group.add(this.stringLights);
    // chaises Adirondack colorées
    const chairColors = [0xe63946, 0xf4a261, 0x2a9d8f, 0xe9c46a, 0x457b9d];
    for (let i = 0; i < 10; i++) {
      const x = cxp - 18 + (i % 5) * 3;
      const z = jz1 + 6 + Math.floor(i / 5) * 3;
      const chair = adirondack(chairColors[i % chairColors.length]);
      chair.position.set(x, SIDEWALK_Y, z);
      chair.rotation.y = Math.PI + (i % 3) * 0.3;
      this.group.add(chair);
    }

    // pavillon rond du métro dans le parc (fermé)
    const mp = this.city.data.poi.metroPavilion;
    const pav = new THREE.Group();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 4.5, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x9fc2d6, transparent: true, opacity: 0.45, roughness: 0.08, metalness: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    cyl.position.y = 2.25;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 0.5, 32), new THREE.MeshStandardMaterial({ color: 0xc7c2b8, roughness: 0.8 }));
    roof.position.y = 4.7;
    roof.castShadow = true;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 4.5, 16), new THREE.MeshStandardMaterial({ color: 0x55595e }));
    core.position.y = 2.25;
    pav.add(cyl, roof, core);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 4.5, 0.15), new THREE.MeshStandardMaterial({ color: 0x2c3036, metalness: 0.7, roughness: 0.4 }));
      post.position.set(Math.cos(a) * 6, 2.25, Math.sin(a) * 6);
      pav.add(post);
    }
    pav.position.set(mp[0], SIDEWALK_Y, mp[1]);
    this.group.add(pav);
    this.col(R.ColliderDesc.cylinder(2.5, 6.1).setTranslation(mp[0], SIDEWALK_Y + 2.5, mp[1]));
    this.clearZones.push(circlePoly(mp[0], mp[1], 8.5));
    this.info.push({ id: "gamelin", name: "Place Émilie-Gamelin", pos: [cxp, czp], blurb: "Place publique nommée en l'honneur d'Émilie Tavernier-Gamelin, fondatrice des Sœurs de la Providence." });
  }
  picnicSpots: [number, number][] = [];
  kioskPos: V2 = [0, 0];

  // ------------------------------------------------------------ Place Pasteur
  private buildPasteur() {
    const park = this.city.data.parks.find((p) => p.id === "pasteur");
    if (!park) return;
    const xs = park.poly.map((p) => p[0]);
    const zs = park.poly.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    // statue sur socle
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 1.6), new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.9 }));
    base.position.set(cx, SIDEWALK_Y + 0.9, cz);
    const bronze = new THREE.MeshStandardMaterial({ color: 0x3d5a4a, metalness: 0.6, roughness: 0.45 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.2, 4, 10), bronze);
    body.position.set(cx, SIDEWALK_Y + 2.7, cz);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), bronze);
    head.position.set(cx, SIDEWALK_Y + 3.65, cz);
    for (const m of [base, body, head]) {
      m.castShadow = true;
      this.group.add(m);
    }
    this.col(this.physics.RAPIER.ColliderDesc.cuboid(0.8, 0.9, 0.8).setTranslation(cx, SIDEWALK_Y + 0.9, cz));
    this.clearZones.push(circlePoly(cx, cz, 3));
    this.info.push({ id: "pasteur", name: "Place Pasteur", pos: [cx, cz], blurb: "Petite place de la rue Saint-Denis, rendez-vous des étudiants de l'UQAM." });
  }

  // ------------------------------------------------------------ enseignes des repères
  private buildFacadeSigns() {
    const specs: [string, string | undefined, string, string, string][] = [
      ["judith", "berri", "UQAM · PAVILLON JUDITH-JASMIN", "#ffffff", "#0072ce"],
      ["hubert", "stecath", "UQAM · PAVILLON HUBERT-AQUIN", "#ffffff", "#0072ce"],
      ["gare", "berri", "GARE D'AUTOCARS DE MONTRÉAL", "#14213d", "#ffffff"],
      ["berri1259", "berri", "1259, RUE BERRI", "#f1ede4", "#1d3557"],
      ["cegep", "ontario", "CÉGEP DU VIEUX MONTRÉAL", "#e9e5dc", "#8c1c13"],
      ["mhotel", undefined, "M MONTRÉAL · HÔTEL", "#111111", "#f5c518"],
      ["stereo", undefined, "STEREO", "#000000", "#ff2d95"],
      ["boxotel", undefined, "BOXOTEL", "#ffffff", "#e63946"],
      ["ideal", undefined, "L'IDÉAL · BAR & CONTENUS", "#2b2d42", "#edf2f4"],
    ];
    for (const [id, street, text, bg, fg] of specs) {
      const f = this.facade(id, street) ?? this.facade(id);
      if (!f) {
        const b = this.building(id);
        if (b && !this.info.some((i) => i.id === id)) this.info.push({ id, name: b.name ?? text, pos: this.entranceOf(b.poly), blurb: BLURBS[id] ?? "" });
        continue;
      }
      const mid: V2 = [(f.p0[0] + f.p1[0]) / 2, (f.p0[1] + f.p1[1]) / 2];
      const w = Math.min(f.len - 2, Math.max(6, text.length * 0.55));
      const h = Math.max(0.8, w / 14);
      const sign = textPanel(text, { w, h, bg, fg, px: 80 });
      const y = id === "berri1259" ? SIDEWALK_Y + 3.6 : Math.min(f.height - 1.2, SIDEWALK_Y + f.groundH + 2.2);
      sign.position.set(mid[0] + f.normal[0] * 0.12, y, mid[1] + f.normal[1] * 0.12);
      sign.rotation.y = Math.atan2(f.normal[0], f.normal[1]);
      this.glowMats.push(sign.userData.glow);
      this.group.add(sign);
      const b = this.building(id)!;
      const ent = [mid[0] + f.normal[0] * 3, mid[1] + f.normal[1] * 3] as V2;
      if (!this.info.some((i) => i.id === id)) this.info.push({ id, name: b.name ?? text, pos: ent, blurb: BLURBS[id] ?? "" });
    }
  }

  /** Point d'entrée d'un bâtiment : milieu de l'arête la plus proche d'une rue, décalé vers l'extérieur. */
  private entranceOf(poly: V2[]): V2 {
    let best: V2 = poly[0];
    let bd = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 3) continue;
      const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const n: V2 = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
      for (const s of this.city.data.streets) {
        const d = distToSegment(mid[0] + n[0] * 2, mid[1] + n[1] * 2, s.a, s.b).d - s.w / 2;
        if (d < bd) {
          bd = d;
          best = [mid[0] + n[0] * 2.5, mid[1] + n[1] * 2.5];
        }
      }
    }
    return best;
  }

  update(t: number, night: number) {
    for (const m of this.glowMats) m.emissiveIntensity = 0.12 + night * 0.9;
    if (this.bulbMat) {
      const k = 0.5 + 0.5 * night;
      this.bulbMat.color.setRGB(1.0 * k * (0.85 + 0.15 * Math.sin(t * 6)), 0.82 * k, 0.48 * k);
    }
    if (this.stringLights) (this.stringLights.material as THREE.PointsMaterial).color.setRGB(0.4 + night * 0.6, 0.33 + night * 0.5, 0.2 + night * 0.35);
    if (this.roseMat) this.roseMat.emissiveIntensity = night * 1.2;
  }

  nearest(x: number, z: number, maxD = 25): LandmarkInfo | null {
    let best: LandmarkInfo | null = null;
    let bd = maxD;
    for (const i of this.info) {
      const d = Math.hypot(i.pos[0] - x, i.pos[1] - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
}

const BLURBS: Record<string, string> = {
  judith: "Pavillon principal de l'Université du Québec à Montréal, construit sur le site de l'église Saint-Jacques.",
  hubert: "Pavillon de l'UQAM qui abrite notamment l'administration de l'université.",
  gare: "Point de départ des autocars vers Québec, les Laurentides et les États-Unis.",
  berri1259: "Immeuble de la rue Berri, au sud de Sainte-Catherine.",
  cegep: "Collège d'enseignement général et professionnel fondé en 1968.",
  mhotel: "Hôtel du Quartier latin.",
  stereo: "Discothèque célèbre de la rue Sainte-Catherine.",
  boxotel: "Hôtel du Quartier latin.",
  ideal: "Bar culturel du Quartier latin.",
};

function archShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, h - w * 0.6);
  s.quadraticCurveTo(-w / 2, h, 0, h + w * 0.15);
  s.quadraticCurveTo(w / 2, h, w / 2, h - w * 0.6);
  s.lineTo(w / 2, 0);
  s.closePath();
  return s;
}

function gableShape(w: number, h: number, peak: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.lineTo(0, h + peak);
  s.lineTo(-w / 2, h);
  s.closePath();
  return s;
}

function circlePoly(x: number, z: number, r: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < 12; i++) out.push([x + Math.cos((i / 12) * Math.PI * 2) * r, z + Math.sin((i / 12) * Math.PI * 2) * r]);
  return out;
}

/** Charpente métallique en forme de maison (hommage aux sculptures de Charney). */
function houseFrame(w: number, h: number, d: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const t = 0.12;
  const beam = (a: THREE.Vector3, b: THREE.Vector3) => {
    const L = a.distanceTo(b);
    const g = new THREE.BoxGeometry(t, L, t);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q);
    g.translate(mid.x, mid.y, mid.z);
    parts.push(g);
  };
  const roof = h + w * 0.55;
  for (const z of [-d / 2, d / 2]) {
    const bl = new THREE.Vector3(-w / 2, 0, z);
    const br = new THREE.Vector3(w / 2, 0, z);
    const tl = new THREE.Vector3(-w / 2, h, z);
    const tr = new THREE.Vector3(w / 2, h, z);
    const pk = new THREE.Vector3(0, roof, z);
    beam(bl, tl);
    beam(br, tr);
    beam(tl, pk);
    beam(tr, pk);
    beam(tl, tr);
    beam(new THREE.Vector3(-w / 2, h * 0.5, z), new THREE.Vector3(w / 2, h * 0.5, z));
  }
  for (const [x, y] of [
    [-w / 2, h],
    [w / 2, h],
    [0, roof],
    [-w / 2, 0.02],
    [w / 2, 0.02],
  ])
    beam(new THREE.Vector3(x, y, -d / 2), new THREE.Vector3(x, y, d / 2));
  return mergeGeometries(parts)!;
}

function adirondack(color: number): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.7), m);
  seat.position.set(0, 0.38, 0);
  seat.rotation.x = -0.12;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.06), m);
  back.position.set(0, 0.75, -0.38);
  back.rotation.x = -0.35;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.8), m);
  armL.position.set(-0.4, 0.6, 0);
  const armR = armL.clone();
  armR.position.x = 0.4;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.38, 0.06), m);
  legs.position.set(0, 0.19, 0.3);
  g.add(seat, back, armL, armR, legs);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

export function segDist(x: number, z: number, a: V2, b: V2) {
  return distToSegment(x, z, a, b).d;
}
