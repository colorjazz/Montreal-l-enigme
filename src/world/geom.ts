import * as THREE from "three";

export type V2 = [number, number];

/**
 * Accumulateur de géométrie : positions, normales, uv (« fuv » pour les
 * façades), couleurs et calque de texture, fusionnés en un seul tampon.
 */
export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  layer: number[] = [];
  idx: number[] = [];

  get vertexCount() {
    return this.pos.length / 3;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: THREE.Color, layer = 0): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    this.layer.push(layer);
    return this.vertexCount - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  /** Quadrilatère a-b-c-d (sens trigonométrique vu depuis la normale). */
  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }

  /**
   * Mur vertical de p0 à p1 (dans le plan XZ), entre y0 et y1, face
   * orientée selon la normale « droite » de p0→p1 (extérieur d'un anneau CCW).
   */
  wall(p0: V2, p1: V2, y0: number, y1: number, u0: number, u1: number, v0: number, v1: number, c: THREE.Color, layer = 0, flip = false) {
    const dx = p1[0] - p0[0];
    const dz = p1[1] - p0[1];
    const len = Math.hypot(dx, dz) || 1;
    let nx = dz / len;
    let nz = -dx / len;
    if (flip) {
      nx = -nx;
      nz = -nz;
    }
    const a = this.vertex(p0[0], y0, p0[1], nx, 0, nz, u0, v0, c, layer);
    const b = this.vertex(p1[0], y0, p1[1], nx, 0, nz, u1, v0, c, layer);
    const cc = this.vertex(p1[0], y1, p1[1], nx, 0, nz, u1, v1, c, layer);
    const d = this.vertex(p0[0], y1, p0[1], nx, 0, nz, u0, v1, c, layer);
    if (!flip) this.idx.push(a, cc, b, a, d, cc);
    else this.idx.push(a, b, cc, a, cc, d);
  }

  /** Polygone horizontal (avec trous) à la hauteur y, normale +Y ou -Y. */
  polygon(outer: V2[], holes: V2[][], y: number, uvScale: number, c: THREE.Color, layer = 0, down = false, uvOff: V2 = [0, 0]) {
    const contour = outer.map((p) => new THREE.Vector2(p[0], p[1]));
    const hs = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    let faces: number[][];
    try {
      faces = THREE.ShapeUtils.triangulateShape(contour, hs);
    } catch {
      return;
    }
    const all = [...contour, ...hs.flat()];
    const base = this.vertexCount;
    const ny = down ? -1 : 1;
    for (const p of all) this.vertex(p.x, y, p.y, 0, ny, 0, p.x / uvScale + uvOff[0], -p.y / uvScale + uvOff[1], c, layer);
    for (const f of faces) {
      // orientation : on veut une face vers +Y (ou -Y)
      const A = all[f[0]];
      const B = all[f[1]];
      const C = all[f[2]];
      const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
      // dans XZ, cross > 0 => triangle CCW en (x,z) => normale -Y en main droite
      const up = cross < 0;
      if (up !== down) this.idx.push(base + f[0], base + f[1], base + f[2]);
      else this.idx.push(base + f[0], base + f[2], base + f[1]);
    }
  }

  /** Boîte orientée : centre, demi-tailles, rotation autour de Y. */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rotY: number, c: THREE.Color, layer = 0, uvScale = 1) {
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const h = [hx, hy, hz];
    const faces: number[][][] = [
      [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
      [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
      [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    const rot = (x: number, y: number, z: number): [number, number, number] => [x * cos + z * sin, y, -x * sin + z * cos];
    for (const [n, u, v] of faces) {
      const nn = rot(n[0], n[1], n[2]);
      const ul = Math.abs(u[0] * h[0] + u[1] * h[1] + u[2] * h[2]);
      const vl = Math.abs(v[0] * h[0] + v[1] * h[1] + v[2] * h[2]);
      const ids: number[] = [];
      for (const [s1, s2] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const l = [0, 1, 2].map((k) => (n[k] + s1 * u[k] + s2 * v[k]) * h[k]);
        const p = rot(l[0], l[1], l[2]);
        ids.push(this.vertex(cx + p[0], cy + p[1], cz + p[2], nn[0], nn[1], nn[2], (s1 * ul) / uvScale, (s2 * vl) / uvScale, c, layer));
      }
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }

  build(opts: { layer?: boolean; uvName?: string } = {}): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute(opts.uvName ?? "uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    if (opts.layer) g.setAttribute("aLayer", new THREE.Float32BufferAttribute(this.layer, 1));
    const n = this.vertexCount;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export function polyArea(p: V2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, z0] = p[i];
    const [x1, z1] = p[(i + 1) % p.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

export function centroid(p: V2[]): V2 {
  let x = 0;
  let z = 0;
  for (const q of p) {
    x += q[0];
    z += q[1];
  }
  return [x / p.length, z / p.length];
}

export function pointInPoly(x: number, z: number, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance d'un point au segment AB, et paramètre t. */
export function distToSegment(px: number, pz: number, a: V2, b: V2): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz || 1;
  let t = ((px - a[0]) * dx + (pz - a[1]) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  const qx = a[0] + dx * t;
  const qz = a[1] + dz * t;
  return { d: Math.hypot(px - qx, pz - qz), t };
}

/** Décalage d'un anneau (onglets bornés) ; d > 0 vers l'extérieur d'un anneau CCW. */
export function offsetRing(ring: V2[], d: number): V2[] {
  const n = ring.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const a = ring[(i - 1 + n) % n];
    const b = ring[(i + 1) % n];
    const e1 = [p[0] - a[0], p[1] - a[1]];
    const e2 = [b[0] - p[0], b[1] - p[1]];
    const l1 = Math.hypot(e1[0], e1[1]) || 1;
    const l2 = Math.hypot(e2[0], e2[1]) || 1;
    const n1 = [e1[1] / l1, -e1[0] / l1];
    const n2 = [e2[1] / l2, -e2[0] / l2];
    let mx = n1[0] + n2[0];
    let mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cosHalf = Math.max(0.5, mx * n1[0] + mz * n1[1]);
    out.push([p[0] + (mx * d) / cosHalf, p[1] + (mz * d) / cosHalf]);
  }
  return out;
}
