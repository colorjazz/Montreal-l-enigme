import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { GeoBuilder, offsetRing, polyArea, pointInPoly, distToSegment, centroid, type V2 } from "./geom";
import { FACADE_LAYERS, LAYER } from "../core/textures";
import { createFacadeMaterial, createGroundMaterials, type GroundMaterials } from "./materials";
import { hash01, Rng } from "../core/rng";
import type { Physics } from "../core/physics";

// ------------------------------------------------------------ données
export interface PolyRec {
  outer: V2[];
  holes: V2[][];
}
export interface StreetRec {
  id: string;
  name: string;
  a: V2;
  b: V2;
  w: number;
  sw: number;
  oneway: number;
  cat: "major" | "medium" | "minor";
}
export interface BuildingRec {
  poly: V2[];
  floors: number;
  style: string;
  landmark?: string;
  name?: string;
  sign?: string;
  row?: boolean;
  filler?: boolean;
}
export interface IntersectionRec {
  p: V2;
  s: [string, string];
  kind: "light" | "stop";
  inData: boolean;
}
export interface CrosswalkRec {
  a: V2;
  b: V2;
  c: V2;
  street: string;
  w: number;
  width: number;
  dir: V2;
}
export interface CityData {
  dataRegion: V2[];
  walkable: V2[];
  outer: V2[];
  streets: StreetRec[];
  roads: PolyRec[];
  land: PolyRec[];
  median: PolyRec[];
  sidewalks: PolyRec[];
  lots: PolyRec[];
  plazas: PolyRec[];
  parks: { id: string; name: string; poly: V2[] }[];
  buildings: BuildingRec[];
  intersections: IntersectionRec[];
  crosswalks: CrosswalkRec[];
  trees: [number, number, number][];
  lamps: [number, number, number][];
  nav: { nodes: V2[]; edges: [number, number][] };
  poi: Record<string, V2>;
}

export const SIDEWALK_Y = 0.15;
const CHUNK = 160;

/** Façade donnant sur une rue : utilisée pour les vitrines, enseignes, balcons. */
export interface Frontage {
  building: number;
  p0: V2;
  p1: V2;
  normal: V2; // vers la rue
  street: StreetRec;
  len: number;
  commercial: boolean;
  groundH: number;
  height: number;
}

const COMMERCIAL_STREETS = new Set(["stdenis", "stecath", "ontario", "sthubert", "berri", "emery", "maisonneuve", "labelle", "sanguinet"]);

const STYLE_TINTS: Record<string, string[]> = {
  brick_red: ["#ffffff", "#f4e4dc", "#e8d2c8", "#ffe9df", "#d9c4bb"],
  brick_brown: ["#ffffff", "#e9ddd4", "#d8c8bb"],
  greystone: ["#ffffff", "#f1ede6", "#e0ddd6"],
  brick_cream: ["#ffffff", "#f6efe2", "#ece2cc"],
  painted: ["#9ec1d9", "#e7c36f", "#c97b63", "#9fc59a", "#d9a7c7", "#f0ead6", "#7fa7a1", "#e39b5b"],
  concrete: ["#ffffff", "#ebe8e2", "#dcd9d2"],
  modern: ["#ffffff", "#d7dde3", "#c6ccd4"],
  glass: ["#ffffff", "#dbe9ee", "#cfe0e6"],
  uqam: ["#ffffff"],
  banq: ["#ffffff"],
  dupuis: ["#ffffff"],
  theatre: ["#ffffff"],
};

const CORNICE_COLORS = ["#2b2b2b", "#3b4a3a", "#5a3b2e", "#d8d2c4", "#4a4f5a", "#6b2f2a"];

export class City {
  readonly group = new THREE.Group();
  readonly facadeMat: THREE.MeshStandardMaterial;
  readonly ground: GroundMaterials;
  readonly frontages: Frontage[] = [];
  readonly streetById = new Map<string, StreetRec>();
  /** Polygones de bâtiments (zone jouable), pour la mini-carte et les requêtes. */
  readonly footprints: { poly: V2[]; h: number; name?: string; landmark?: string }[] = [];
  buildingCount = 0;
  colliderCount = 0;

  constructor(
    readonly data: CityData,
    private physics: Physics,
  ) {
    this.group.name = "ville";
    this.facadeMat = createFacadeMaterial();
    this.ground = createGroundMaterials();
    for (const s of data.streets) this.streetById.set(s.id, s);
    this.buildGround();
    this.buildMarkings();
    this.buildBuildings();
    this.buildBoundary();
  }

  /** La zone jouable (avec une marge) : sert à décider des collisions. */
  inPlayable(x: number, z: number, margin = 0): boolean {
    if (pointInPoly(x, z, this.data.walkable)) return true;
    if (margin <= 0) return false;
    const w = this.data.walkable;
    for (let i = 0; i < w.length; i++) {
      if (distToSegment(x, z, w[i], w[(i + 1) % w.length]).d < margin) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- sol
  private buildGround() {
    const white = new THREE.Color(1, 1, 1);
    const mk = (polys: PolyRec[], y: number, uvScale: number, mat: THREE.Material, name: string, receive = true) => {
      // découpe par tranches pour le frustum culling
      const buckets = new Map<string, GeoBuilder>();
      for (const p of polys) {
        const c = centroid(p.outer);
        const key = `${Math.floor(c[0] / (CHUNK * 2))},${Math.floor(c[1] / (CHUNK * 2))}`;
        let gb = buckets.get(key);
        if (!gb) buckets.set(key, (gb = new GeoBuilder()));
        gb.polygon(p.outer, p.holes, y, uvScale, white);
      }
      for (const gb of buckets.values()) {
        if (!gb.idx.length) continue;
        const mesh = new THREE.Mesh(gb.build(), mat);
        mesh.receiveShadow = receive;
        mesh.name = name;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
      }
    };
    mk(this.data.roads, 0, 7, this.ground.asphalt, "chaussée");
    mk(this.data.sidewalks, SIDEWALK_Y, 3, this.ground.sidewalk, "trottoirs");
    mk(this.data.lots, SIDEWALK_Y - 0.005, 8, this.ground.lot, "terrains");
    mk(this.data.plazas, SIDEWALK_Y + 0.004, 1.6, this.ground.pavers, "parvis");
    mk(this.data.median, SIDEWALK_Y + 0.02, 4, this.ground.grass, "terre-plein");
    mk(
      this.data.parks.map((p) => ({ outer: p.poly, holes: [] })),
      SIDEWALK_Y + 0.01,
      4,
      this.ground.grass,
      "parcs",
    );

    // bordures de trottoir : faces verticales le long de la chaussée
    const curb = new GeoBuilder();
    const gray = new THREE.Color(1, 1, 1);
    const addCurbRing = (ring: V2[]) => {
      // anneaux orientés : intérieur de la chaussée à gauche → la bordure regarde vers la gauche
      for (let i = 0; i < ring.length; i++) {
        const p0 = ring[i];
        const p1 = ring[(i + 1) % ring.length];
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (L < 0.01) continue;
        curb.wall(p0, p1, 0, SIDEWALK_Y, 0, L / 2, 0, 0.1, gray, 0, true);
      }
    };
    for (const r of this.data.roads) {
      addCurbRing(r.outer);
      for (const h of r.holes) addCurbRing(h);
    }
    const curbMesh = new THREE.Mesh(curb.build(), this.ground.curb);
    curbMesh.receiveShadow = true;
    curbMesh.matrixAutoUpdate = false;
    this.group.add(curbMesh);

    // ---------------- collisions du sol (zone jouable seulement)
    const R = this.physics.RAPIER;
    const near = (p: PolyRec) => p.outer.some(([x, z]) => this.inPlayable(x, z, 60));
    const tris = new GeoBuilder();
    for (const r of this.data.roads) tris.polygon(r.outer, r.holes, 0, 1, white);
    const landPolys = [...this.data.land, ...this.data.median].filter(near);
    for (const l of landPolys) tris.polygon(l.outer, l.holes, SIDEWALK_Y, 1, white);
    for (const r of this.data.roads) {
      for (const ring of [r.outer, ...r.holes]) {
        for (let i = 0; i < ring.length; i++) {
          const p0 = ring[i];
          const p1 = ring[(i + 1) % ring.length];
          if (!this.inPlayable(p0[0], p0[1], 60)) continue;
          tris.wall(p0, p1, -0.01, SIDEWALK_Y, 0, 1, 0, 1, white, 0, true);
        }
      }
    }
    const verts = new Float32Array(tris.pos);
    const idx = new Uint32Array(tris.idx);
    const desc = R.ColliderDesc.trimesh(verts, idx, R.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.9);
    this.physics.world.createCollider(desc, this.physics.fixedBody);
    this.colliderCount++;
  }

  // ---------------------------------------------------------------- marquage
  private buildMarkings() {
    const white = new GeoBuilder();
    const yellow = new GeoBuilder();
    const c = new THREE.Color(1, 1, 1);
    const Y = 0.012;
    const strip = (gb: GeoBuilder, a: V2, b: V2, w: number) => {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const L = Math.hypot(dx, dz) || 1;
      const nx = (-dz / L) * (w / 2);
      const nz = (dx / L) * (w / 2);
      gb.polygon(
        [
          [a[0] + nx, a[1] + nz],
          [b[0] + nx, b[1] + nz],
          [b[0] - nx, b[1] - nz],
          [a[0] - nx, a[1] - nz],
        ],
        [],
        Y,
        1,
        c,
      );
    };
    const inters = this.data.intersections;
    for (const s of this.data.streets) {
      const A = s.a;
      const B = s.b;
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const dir: V2 = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      const nrm: V2 = [-dir[1], dir[0]];
      // zones de carrefour à éviter (paramètre t le long de la rue)
      const blocked: [number, number][] = [];
      for (const it of inters) {
        if (!it.s.includes(s.id)) continue;
        const other = this.streetById.get(it.s[0] === s.id ? it.s[1] : it.s[0])!;
        const t = (it.p[0] - A[0]) * dir[0] + (it.p[1] - A[1]) * dir[1];
        const half = other.w / 2 + other.sw + 3.5;
        blocked.push([t - half, t + half]);
      }
      const free = (t0: number, t1: number) => !blocked.some(([b0, b1]) => t1 > b0 && t0 < b1);
      const at = (t: number, off: number): V2 => [A[0] + dir[0] * t + nrm[0] * off, A[1] + dir[1] * t + nrm[1] * off];
      const step = 1.5;
      if (s.w >= 8) {
        if (s.oneway === 2 && s.id !== "rene") {
          // double ligne jaune centrale
          for (let t = 0; t < L; t += step) {
            const t1 = Math.min(L, t + step);
            if (!free(t, t1)) continue;
            strip(yellow, at(t, 0.12), at(t1, 0.12), 0.1);
            strip(yellow, at(t, -0.12), at(t1, -0.12), 0.1);
          }
        }
        // pointillés blancs entre voies
        const lanes = s.id === "rene" ? [-9.5, -5.5, 5.5, 9.5] : s.w >= 14 ? (s.oneway === 2 ? [-3.6, 3.6] : [-2.5, 2.5]) : s.oneway !== 2 ? [0] : [];
        for (const off of lanes) {
          for (let t = 0; t < L; t += 9) {
            if (!free(t, t + 3)) continue;
            strip(white, at(t, off), at(t + 3, off), 0.12);
          }
        }
      }
      // lignes d'arrêt avant les carrefours
      for (const [b0, b1] of blocked) {
        for (const [t, side] of [
          [b0 - 0.4, 1],
          [b1 + 0.4, -1],
        ] as [number, number][]) {
          if (t < 2 || t > L - 2) continue;
          // voie entrante : à droite du sens de circulation
          const o0 = s.oneway === 2 ? 0 : -s.w / 2 + 0.3;
          const o1 = s.w / 2 - 0.3;
          const sgn = side;
          strip(white, at(t, sgn > 0 ? o0 : -o1), at(t, sgn > 0 ? o1 : -o0), 0.0001);
          const pA = at(t - 0.25, sgn > 0 ? o0 : -o1);
          const pB = at(t - 0.25, sgn > 0 ? o1 : -o0);
          const pC = at(t + 0.25, sgn > 0 ? o1 : -o0);
          const pD = at(t + 0.25, sgn > 0 ? o0 : -o1);
          white.polygon([pA, pB, pC, pD], [], Y, 1, c);
        }
      }
    }
    // passages piétons (bandes jaunes, à la québécoise)
    for (const cw of this.data.crosswalks) {
      const ax = cw.a;
      const bx = cw.b;
      const L = Math.hypot(bx[0] - ax[0], bx[1] - ax[1]);
      const u: V2 = [(bx[0] - ax[0]) / L, (bx[1] - ax[1]) / L];
      const v: V2 = [cw.dir[0], cw.dir[1]];
      for (let t = 1.6; t < L - 1.6; t += 1.2) {
        const p: V2 = [ax[0] + u[0] * t, ax[1] + u[1] * t];
        const hw = 0.3;
        const hl = 1.5;
        yellow.polygon(
          [
            [p[0] - u[0] * hw - v[0] * hl, p[1] - u[1] * hw - v[1] * hl],
            [p[0] + u[0] * hw - v[0] * hl, p[1] + u[1] * hw - v[1] * hl],
            [p[0] + u[0] * hw + v[0] * hl, p[1] + u[1] * hw + v[1] * hl],
            [p[0] - u[0] * hw + v[0] * hl, p[1] - u[1] * hw + v[1] * hl],
          ],
          [],
          Y + 0.002,
          1,
          c,
        );
      }
    }
    for (const [gb, mat] of [
      [white, this.ground.paint],
      [yellow, this.ground.paintYellow],
    ] as [GeoBuilder, THREE.Material][]) {
      if (!gb.idx.length) continue;
      const m = new THREE.Mesh(gb.build(), mat);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.name = "marquage";
      this.group.add(m);
    }
  }

  // ---------------------------------------------------------------- bâtiments
  private frontageFor(poly: V2[], groundH: number, height: number, bi: number): Frontage[] {
    const out: Frontage[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
      const dx = p1[0] - p0[0];
      const dz = p1[1] - p0[1];
      const L = Math.hypot(dx, dz);
      if (L < 3.5) continue;
      const n: V2 = [dz / L, -dx / L];
      const mid: V2 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      let best: StreetRec | null = null;
      let bestD = 1e9;
      for (const s of this.data.streets) {
        const { d, t } = distToSegment(mid[0], mid[1], s.a, s.b);
        if (t <= 0 || t >= 1) continue;
        const sx = s.b[0] - s.a[0];
        const sz = s.b[1] - s.a[1];
        const sl = Math.hypot(sx, sz);
        // la façade doit être parallèle à la rue et la regarder
        const par = Math.abs((dx * sx + dz * sz) / (L * sl));
        if (par < 0.93) continue;
        const toLine = d - s.w / 2 - s.sw;
        if (toLine > 3.5 || toLine < -1) continue;
        // la normale pointe vers l'axe de la rue ?
        const q = distToSegment(mid[0] + n[0] * 2, mid[1] + n[1] * 2, s.a, s.b);
        if (q.d >= d) continue;
        if (toLine < bestD) {
          bestD = toLine;
          best = s;
        }
      }
      if (best) {
        out.push({
          building: bi,
          p0,
          p1,
          normal: n,
          street: best,
          len: L,
          commercial: COMMERCIAL_STREETS.has(best.id),
          groundH,
          height,
        });
      }
    }
    return out;
  }

  private buildBuildings() {
    const R = this.physics.RAPIER;
    const chunks = new Map<string, GeoBuilder>();
    const colliderChunks = new Map<string, { pos: number[]; idx: number[] }>();
    const rng = new Rng(4242);
    const getChunk = (x: number, z: number) => {
      const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let gb = chunks.get(key);
      if (!gb) chunks.set(key, (gb = new GeoBuilder()));
      return gb;
    };
    const tint = new THREE.Color();
    const cornice = new THREE.Color();
    const shopA = LAYER.shop_a;
    const shopB = LAYER.shop_b;
    const lobby = LAYER.lobby;
    const roof = LAYER.roof;
    const plain = LAYER.plain;

    this.data.buildings.forEach((b, bi) => {
      let poly = b.poly;
      if (poly.length < 3) return;
      if (polyArea(poly) < 0) poly = [...poly].reverse();
      const c = centroid(poly);
      const style = b.style in LAYER ? b.style : "brick_red";
      const layer = LAYER[style];
      const L = FACADE_LAYERS[layer];
      const h = hash01(bi * 7919 + 13);
      const tints = STYLE_TINTS[style] ?? ["#ffffff"];
      tint.set(tints[Math.floor(h * tints.length) % tints.length]);
      const residentialRow = !!b.row && !b.landmark;
      const front = this.frontageFor(poly, 0, 0, bi);
      const commercial = !b.filler && front.some((f) => f.commercial) && style !== "glass";
      const groundH = commercial || style === "glass" || style === "modern" ? 4.2 : L.tileH;
      const floors = Math.max(1, b.floors);
      const height = groundH + (floors - 1) * L.tileH;
      const parapet = style === "glass" || style === "banq" ? 0.4 : 0.7;
      const gb = getChunk(c[0], c[1]);
      // décalages entiers d'UV : chaque bâtiment a ses propres fenêtres allumées
      const seedU = Math.floor(hash01(bi * 31 + 7) * 900);
      const seedV = Math.floor(hash01(bi * 17 + 3) * 900);
      const frontSet = new Set(front.map((f) => `${f.p0[0]},${f.p0[1]}`));

      let s = 0;
      for (let i = 0; i < poly.length; i++) {
        const p0 = poly[i];
        const p1 = poly[(i + 1) % poly.length];
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (len < 0.05) continue;
        const isFront = frontSet.has(`${p0[0]},${p0[1]}`);
        // largeur de travée ajustée pour tomber juste sur le mur
        const bays = Math.max(1, Math.round(len / L.tileW));
        const u0 = seedU + s;
        const u1 = u0 + bays;
        // rez-de-chaussée
        let gLayer = layer;
        let gBays = bays;
        if (commercial && isFront) {
          gLayer = hash01(bi * 3 + i) < 0.5 ? shopA : shopB;
          gBays = Math.max(1, Math.round(len / 4.0));
        } else if (groundH === 4.2) {
          gLayer = style === "glass" || style === "modern" ? lobby : layer;
          gBays = gLayer === lobby ? Math.max(1, Math.round(len / 4.0)) : bays;
        }
        const groundTint = gLayer === layer ? tint : new THREE.Color(1, 1, 1);
        if (groundH === 4.2 && gLayer === layer) {
          // grand rez-de-chaussée sans vitrine : étire la texture
          gb.wall(p0, p1, SIDEWALK_Y, groundH, u0, u0 + gBays, seedV, seedV + 1, groundTint, gLayer);
        } else {
          gb.wall(p0, p1, SIDEWALK_Y, groundH, u0, u0 + gBays, seedV, seedV + (groundH - SIDEWALK_Y) / (gLayer === layer ? L.tileH : 4.2), groundTint, gLayer);
        }
        // étages
        if (floors > 1) {
          // murs mitoyens aveugles pour les rangées (côtés non visibles de la rue)
          const blind = residentialRow && !isFront && rng.chance(0.55) && (style === "brick_red" || style === "brick_cream");
          gb.wall(p0, p1, groundH, height, u0, u1, seedV + 1, seedV + floors, tint, blind ? LAYER.brick_blank : layer);
        }
        // parapet : bas de la tuile (mur plein)
        gb.wall(p0, p1, height, height + parapet, u0, u1, 0, (parapet / L.tileH) * 0.9, tint, layer === LAYER.glass ? LAYER.modern : layer);
        s += bays;
      }
      // toit
      gb.polygon(poly, [], height + 0.25, 6, new THREE.Color(1, 1, 1), roof);
      // dessus du parapet : anneau mince (simplifié : petit toit)
      // corniche des immeubles en rangée
      if (!b.filler && (style === "brick_red" || style === "greystone" || style === "brick_cream" || style === "painted" || style === "brick_brown" || style === "theatre")) {
        cornice.set(CORNICE_COLORS[Math.floor(hash01(bi * 101) * CORNICE_COLORS.length)]);
        const outer = offsetRing(poly, 0.35);
        for (let i = 0; i < poly.length; i++) {
          const j = (i + 1) % poly.length;
          const isFront = frontSet.has(`${poly[i][0]},${poly[i][1]}`);
          if (!isFront) continue;
          const y0 = height + parapet - 0.05;
          const y1 = height + parapet + 0.45;
          gb.wall(outer[i], outer[j], y0, y1, 0, 1, 0, 0.3, cornice, plain);
          gb.polygon([poly[i], poly[j], outer[j], outer[i]], [], y1, 2, cornice, plain);
          gb.polygon([poly[i], poly[j], outer[j], outer[i]], [], y0, 2, cornice, plain, true);
          // consoles
          const n = Math.floor(Math.hypot(poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]) / 1.6);
          for (let k = 1; k < n; k++) {
            const t = k / n;
            const px = poly[i][0] + (poly[j][0] - poly[i][0]) * t;
            const pz = poly[i][1] + (poly[j][1] - poly[i][1]) * t;
            const ox = outer[i][0] + (outer[j][0] - outer[i][0]) * t;
            const oz = outer[i][1] + (outer[j][1] - outer[i][1]) * t;
            const ang = Math.atan2(ox - px, oz - pz);
            gb.box((px + ox) / 2, y0 - 0.25, (pz + oz) / 2, 0.08, 0.22, 0.17, ang, cornice, plain);
          }
        }
      }

      for (const f of front) {
        f.groundH = groundH;
        f.height = height;
        f.commercial = commercial && f.commercial;
        this.frontages.push(f);
      }
      if (!b.filler) this.footprints.push({ poly, h: height, name: b.name, landmark: b.landmark });
      this.buildingCount++;

      // collisions (zone jouable uniquement)
      if (!b.filler && poly.some(([x, z]) => this.inPlayable(x, z, 40))) {
        const key = `${Math.floor(c[0] / CHUNK)},${Math.floor(c[1] / CHUNK)}`;
        let cc = colliderChunks.get(key);
        if (!cc) colliderChunks.set(key, (cc = { pos: [], idx: [] }));
        const base = cc.pos.length / 3;
        for (const [x, z] of poly) cc.pos.push(x, -1, z, x, height + parapet, z);
        const n = poly.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const a = base + i * 2;
          const bb = base + j * 2;
          cc.idx.push(a, bb + 1, bb, a, a + 1, bb + 1);
        }
        // toit (pour marcher dessus si l'on y grimpe)
        const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
        try {
          for (const f of THREE.ShapeUtils.triangulateShape(contour, [])) cc.idx.push(base + f[0] * 2 + 1, base + f[2] * 2 + 1, base + f[1] * 2 + 1);
        } catch {
          /* polygone dégénéré */
        }
      }
    });

    for (const gb of chunks.values()) {
      const geo = gb.build({ layer: true, uvName: "fuv" });
      const mesh = new THREE.Mesh(geo, this.facadeMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = "bâtiments";
      this.group.add(mesh);
    }
    for (const cc of colliderChunks.values()) {
      const desc = R.ColliderDesc.trimesh(new Float32Array(cc.pos), new Uint32Array(cc.idx)).setFriction(0.4);
      this.physics.world.createCollider(desc, this.physics.fixedBody);
      this.colliderCount++;
    }
  }

  // ---------------------------------------------------------------- limites du monde
  private buildBoundary() {
    // murs invisibles le long de la zone jouable
    const R = this.physics.RAPIER;
    const w = this.data.walkable;
    for (let i = 0; i < w.length; i++) {
      const a = w[i];
      const b = w[(i + 1) % w.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const desc = R.ColliderDesc.cuboid(L / 2 + 1, 30, 0.5)
        .setTranslation((a[0] + b[0]) / 2, 15, (a[1] + b[1]) / 2)
        .setRotation(quatY(-ang));
      this.physics.world.createCollider(desc, this.physics.fixedBody);
      this.colliderCount++;
    }
  }

  /** Nom de la rue la plus proche (pour l'affichage de la position). */
  nearestStreet(x: number, z: number): { street: StreetRec; d: number } | null {
    let best: StreetRec | null = null;
    let bd = 1e9;
    for (const s of this.data.streets) {
      if (!s.name) continue;
      const { d, t } = distToSegment(x, z, s.a, s.b);
      if (t <= 0 || t >= 1) continue;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? { street: best, d: bd } : null;
  }
}

export function quatY(angle: number): RAPIER.Rotation {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}
