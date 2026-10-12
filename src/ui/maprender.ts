import type { CityData } from "../world/city";
import type { V2 } from "../world/geom";

/** Pré-rendu du plan de la ville (vue de dessus) pour la mini-carte et la grande carte. */
export class MapImage {
  readonly canvas: HTMLCanvasElement;
  readonly minX: number;
  readonly minZ: number;
  readonly scale: number; // pixels par mètre

  constructor(
    data: CityData,
    footprints: { poly: V2[]; landmark?: string }[],
    scale = 1.4,
  ) {
    const xs = data.walkable.map((p) => p[0]);
    const zs = data.walkable.map((p) => p[1]);
    const pad = 120;
    this.minX = Math.min(...xs) - pad;
    this.minZ = Math.min(...zs) - pad;
    const maxX = Math.max(...xs) + pad;
    const maxZ = Math.max(...zs) + pad;
    this.scale = scale;
    const W = Math.ceil((maxX - this.minX) * scale);
    const H = Math.ceil((maxZ - this.minZ) * scale);
    this.canvas = document.createElement("canvas");
    this.canvas.width = W;
    this.canvas.height = H;
    const ctx = this.canvas.getContext("2d")!;
    const T = (p: V2): [number, number] => [(p[0] - this.minX) * scale, (p[1] - this.minZ) * scale];
    const path = (ring: V2[]) => {
      ring.forEach((p, i) => {
        const [x, y] = T(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    };
    ctx.fillStyle = "#2a2f36";
    ctx.fillRect(0, 0, W, H);
    // îlots
    ctx.fillStyle = "#4a4d52";
    for (const l of data.land) {
      ctx.beginPath();
      path(l.outer);
      for (const h of l.holes) path(h);
      ctx.fill("evenodd");
    }
    // trottoirs
    ctx.fillStyle = "#8b8d90";
    for (const s of data.sidewalks) {
      ctx.beginPath();
      path(s.outer);
      for (const h of s.holes) path(h);
      ctx.fill("evenodd");
    }
    // chaussées
    ctx.fillStyle = "#1c1f24";
    for (const r of data.roads) {
      ctx.beginPath();
      path(r.outer);
      for (const h of r.holes) path(h);
      ctx.fill("evenodd");
    }
    // parcs
    ctx.fillStyle = "#4f8a4a";
    for (const p of data.parks) {
      ctx.beginPath();
      path(p.poly);
      ctx.fill();
    }
    ctx.fillStyle = "#5d8f52";
    for (const m of data.median) {
      ctx.beginPath();
      path(m.outer);
      ctx.fill();
    }
    // bâtiments
    for (const b of footprints) {
      ctx.beginPath();
      path(b.poly);
      ctx.fillStyle = b.landmark ? "#d8c39a" : "#b9b2a6";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // zone hors limites assombrie
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    path(data.walkable);
    ctx.fillStyle = "rgba(10,12,16,0.55)";
    ctx.fill("evenodd");
    ctx.restore();
  }

  toPx(x: number, z: number): [number, number] {
    return [(x - this.minX) * this.scale, (z - this.minZ) * this.scale];
  }
}

/** Noms de rues dessinés le long des axes (pour la grande carte). */
export function drawStreetLabels(ctx: CanvasRenderingContext2D, data: CityData, toPx: (x: number, z: number) => [number, number], walkableTest: (x: number, z: number) => boolean, fontPx: number) {
  ctx.save();
  ctx.font = `bold ${fontPx}px "Trebuchet MS", "DejaVu Sans", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const seen = new Set<string>();
  for (const s of data.streets) {
    if (!s.name || seen.has(s.name + s.id)) continue;
    seen.add(s.name + s.id);
    const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    // trouve un point de la rue dans la zone jouable
    let best: [number, number] | null = null;
    for (let t = 0.2; t <= 0.8; t += 0.05) {
      const x = s.a[0] + (s.b[0] - s.a[0]) * t;
      const z = s.a[1] + (s.b[1] - s.a[1]) * t;
      if (walkableTest(x, z)) {
        best = [x, z];
        if (t > 0.45) break;
      }
    }
    if (!best) continue;
    const [px, py] = toPx(best[0], best[1]);
    let ang = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.strokeText(s.name, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(s.name, 0, 0);
    ctx.restore();
    void L;
  }
  ctx.restore();
}
