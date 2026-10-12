import * as THREE from "three";
import { Rng } from "./rng";

/**
 * Textures procédurales (aucune image externe) : façades montréalaises,
 * vitrines, toitures, chaussée, trottoirs, gazon d'automne, enseignes.
 */

export const TILE = 512;

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h = w): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  return [c, ctx];
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(1)},${s.toFixed(1)}%,${l.toFixed(1)}%)`;
}

/** Grain : bruit additif par pixel. */
function grain(ctx: Ctx, w: number, h: number, amount: number, rng: Rng, mono = true) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.float() - 0.5) * amount;
    if (mono) {
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    } else {
      d[i] += (rng.float() - 0.5) * amount;
      d[i + 1] += (rng.float() - 0.5) * amount;
      d[i + 2] += (rng.float() - 0.5) * amount;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Taches douces (salissures, usure). */
function blotches(ctx: Ctx, w: number, h: number, n: number, rng: Rng, color: string, alpha: number, rmin: number, rmax: number) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = rng.float() * w;
    const y = rng.float() * h;
    const r = rng.range(rmin, rmax);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha * rng.range(0.4, 1);
    ctx.fillStyle = g;
    for (const ox of [-w, 0, w])
      for (const oy of [-h, 0, h]) {
        ctx.setTransform(1, 0, 0, 1, ox, oy);
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
  }
  ctx.restore();
}

interface BrickOpts {
  cols: number;
  rows: number;
  mortar: string;
  hue: [number, number];
  sat: [number, number];
  light: [number, number];
  joint?: number;
}

function bricks(ctx: Ctx, x0: number, y0: number, w: number, h: number, o: BrickOpts, rng: Rng) {
  ctx.fillStyle = o.mortar;
  ctx.fillRect(x0, y0, w, h);
  const bw = TILE / o.cols;
  const bh = TILE / o.rows;
  const j = o.joint ?? 2;
  for (let r = 0; r < o.rows; r++) {
    const off = r % 2 === 0 ? 0 : bw / 2;
    for (let c = -1; c <= o.cols; c++) {
      const bx = c * bw + off;
      const by = r * bh;
      const l = rng.range(o.light[0], o.light[1]);
      ctx.fillStyle = hsl(rng.range(o.hue[0], o.hue[1]), rng.range(o.sat[0], o.sat[1]), l);
      ctx.fillRect(bx + j / 2, by + j / 2, bw - j, bh - j);
      // léger dégradé sur chaque brique
      ctx.fillStyle = `rgba(255,255,255,${rng.range(0, 0.06)})`;
      ctx.fillRect(bx + j / 2, by + j / 2, bw - j, (bh - j) * 0.35);
      if (rng.chance(0.05)) {
        ctx.fillStyle = `rgba(20,10,5,${rng.range(0.1, 0.3)})`;
        ctx.fillRect(bx + j / 2, by + j / 2, bw - j, bh - j);
      }
    }
  }
}

interface WinOpts {
  frame: string;
  frameW: number;
  glassTop: string;
  glassBot: string;
  mullionV?: number;
  mullionH?: number[];
  arch?: boolean;
  recess?: number;
}

function glassGradient(ctx: Ctx, x: number, y: number, w: number, h: number, top: string, bot: string) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bot);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // reflet diagonal
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = "#e8f1ff";
  ctx.beginPath();
  ctx.moveTo(x + w * 0.15, y + h);
  ctx.lineTo(x + w * 0.55, y);
  ctx.lineTo(x + w * 0.75, y);
  ctx.lineTo(x + w * 0.35, y + h);
  ctx.fill();
  ctx.restore();
}

/** Fenêtre : dessine dans ctx (couleur) et mctx (masque de vitrage). */
function windowAt(ctx: Ctx, mctx: Ctx, x: number, y: number, w: number, h: number, o: WinOpts) {
  const f = o.frameW;
  if (o.recess) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x - o.recess, y - o.recess, w + o.recess * 2, h + o.recess * 2);
  }
  ctx.fillStyle = o.frame;
  if (o.arch) {
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + w / 2);
    ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  } else ctx.fillRect(x, y, w, h);
  const gx = x + f;
  const gy = y + f;
  const gw = w - 2 * f;
  const gh = h - 2 * f;
  ctx.save();
  if (o.arch) {
    ctx.beginPath();
    ctx.moveTo(gx, gy + gh);
    ctx.lineTo(gx, gy + gw / 2);
    ctx.arc(gx + gw / 2, gy + gw / 2, gw / 2, Math.PI, 0);
    ctx.lineTo(gx + gw, gy + gh);
    ctx.closePath();
    ctx.clip();
  }
  glassGradient(ctx, gx, gy, gw, gh, o.glassTop, o.glassBot);
  ctx.restore();
  mctx.fillStyle = "#fff";
  if (o.arch) {
    mctx.beginPath();
    mctx.moveTo(gx, gy + gh);
    mctx.lineTo(gx, gy + gw / 2);
    mctx.arc(gx + gw / 2, gy + gw / 2, gw / 2, Math.PI, 0);
    mctx.lineTo(gx + gw, gy + gh);
    mctx.closePath();
    mctx.fill();
  } else mctx.fillRect(gx, gy, gw, gh);
  ctx.fillStyle = o.frame;
  mctx.fillStyle = "#000";
  if (o.mullionV) {
    const n = o.mullionV;
    for (let i = 1; i <= n; i++) {
      const mx = gx + (gw * i) / (n + 1) - f * 0.35;
      ctx.fillRect(mx, gy, f * 0.7, gh);
      mctx.fillRect(mx, gy, f * 0.7, gh);
    }
  }
  for (const t of o.mullionH ?? []) {
    const my = gy + gh * t - f * 0.4;
    ctx.fillRect(gx, my, gw, f * 0.8);
    mctx.fillRect(gx, my, gw, f * 0.8);
  }
}

function sill(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(x, y, w, 2);
}

// ------------------------------------------------------------ calques de façade
export interface FacadeLayer {
  name: string;
  tileW: number; // largeur d'une travée (m)
  tileH: number; // hauteur d'un étage (m)
  draw: (ctx: Ctx, mctx: Ctx, rng: Rng) => void;
}

const px = (m: number, tile: number) => (m / tile) * TILE;

function brickFacade(palette: Pick<BrickOpts, "hue" | "sat" | "light" | "mortar">, win: Partial<WinOpts> & { w?: number; h?: number; sillY?: number; lintel?: string; arch?: boolean }) {
  return (ctx: Ctx, mctx: Ctx, rng: Rng) => {
    const tw = 3.0;
    const th = 3.1;
    bricks(ctx, 0, 0, TILE, TILE, { cols: 14, rows: 40, ...palette }, rng);
    blotches(ctx, TILE, TILE, 10, rng, "rgba(30,20,15,1)", 0.12, 40, 140);
    const ww = px(win.w ?? 1.15, tw);
    const wh = px(win.h ?? 1.75, th);
    const sy = TILE - px(win.sillY ?? 0.9, th); // bas de la fenêtre
    const wx = (TILE - ww) / 2;
    const wy = sy - wh;
    // linteau et allège en pierre
    if (!win.arch) sill(ctx, wx - 10, wy - 26, ww + 20, 22, win.lintel ?? "#b9b2a4");
    windowAt(ctx, mctx, wx, wy, ww, wh, {
      frame: win.frame ?? "#efece6",
      frameW: win.frameW ?? 9,
      glassTop: win.glassTop ?? "#6f8396",
      glassBot: win.glassBot ?? "#26313d",
      mullionH: win.mullionH ?? [0.55],
      mullionV: win.mullionV,
      arch: win.arch,
      recess: 4,
    });
    sill(ctx, wx - 8, sy, ww + 16, 14, win.lintel ?? "#b9b2a4");
  };
}

export const FACADE_LAYERS: FacadeLayer[] = [
  {
    name: "brick_red",
    tileW: 3.0,
    tileH: 3.1,
    draw: brickFacade({ hue: [6, 16], sat: [38, 55], light: [30, 42], mortar: "#b8afa2" }, {}),
  },
  {
    name: "brick_brown",
    tileW: 3.0,
    tileH: 3.1,
    draw: brickFacade(
      { hue: [14, 24], sat: [22, 34], light: [22, 32], mortar: "#9a9289" },
      { w: 1.3, h: 1.9, frame: "#2b2b2b", frameW: 7, mullionH: [], mullionV: 1, lintel: "#7d776e" },
    ),
  },
  {
    name: "greystone",
    tileW: 3.0,
    tileH: 3.1,
    draw: (ctx, mctx, rng) => {
      // pierre grise de Montréal : assises irrégulières
      ctx.fillStyle = "#6e6a62";
      ctx.fillRect(0, 0, TILE, TILE);
      const courses = [0, 0.42, 0.78, 1.18, 1.55, 1.98, 2.36, 2.72, 3.1];
      for (let i = 0; i < courses.length - 1; i++) {
        const y0 = TILE - px(courses[i + 1], 3.1);
        const y1 = TILE - px(courses[i], 3.1);
        let x = -rng.range(0, 120);
        while (x < TILE) {
          const w = rng.range(0.55, 1.25) * (TILE / 3);
          const l = rng.range(52, 62);
          ctx.fillStyle = hsl(rng.range(35, 48), rng.range(5, 10), l);
          ctx.fillRect(x + 2, y0 + 2, w - 4, y1 - y0 - 4);
          // bossage : bord plus clair en haut, ombre en bas
          ctx.fillStyle = "rgba(255,255,255,0.12)";
          ctx.fillRect(x + 2, y0 + 2, w - 4, 4);
          ctx.fillStyle = "rgba(0,0,0,0.12)";
          ctx.fillRect(x + 2, y1 - 6, w - 4, 4);
          x += w;
        }
      }
      grain(ctx, TILE, TILE, 26, rng);
      blotches(ctx, TILE, TILE, 14, rng, "rgba(40,38,30,1)", 0.12, 30, 120);
      const ww = px(1.2, 3.0);
      const wh = px(1.85, 3.1);
      const sy = TILE - px(0.85, 3.1);
      const wx = (TILE - ww) / 2;
      const wy = sy - wh;
      // linteau sculpté avec clé de voûte
      sill(ctx, wx - 16, wy - 34, ww + 32, 30, "#a9a497");
      ctx.fillStyle = "#b8b3a6";
      ctx.beginPath();
      ctx.moveTo(TILE / 2 - 16, wy - 38);
      ctx.lineTo(TILE / 2 + 16, wy - 38);
      ctx.lineTo(TILE / 2 + 10, wy - 2);
      ctx.lineTo(TILE / 2 - 10, wy - 2);
      ctx.fill();
      windowAt(ctx, mctx, wx, wy, ww, wh, {
        frame: "#2f3b33",
        frameW: 9,
        glassTop: "#71879a",
        glassBot: "#232d38",
        mullionH: [0.58],
        recess: 6,
      });
      sill(ctx, wx - 12, sy, ww + 24, 16, "#a9a497");
    },
  },
  {
    name: "brick_cream",
    tileW: 3.0,
    tileH: 3.1,
    draw: brickFacade(
      { hue: [36, 44], sat: [30, 45], light: [62, 72], mortar: "#cfc6b4" },
      { frame: "#3d5a3f", lintel: "#9c9486" },
    ),
  },
  {
    name: "painted",
    tileW: 3.0,
    tileH: 3.1,
    draw: (ctx, mctx, rng) => {
      // déclin de bois peint (teinté par la couleur de sommet)
      ctx.fillStyle = "#e9e6df";
      ctx.fillRect(0, 0, TILE, TILE);
      const n = 26;
      for (let i = 0; i < n; i++) {
        const y = (i * TILE) / n;
        ctx.fillStyle = "rgba(0,0,0,0.13)";
        ctx.fillRect(0, y + TILE / n - 3, TILE, 3);
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(0, y, TILE, 3);
      }
      grain(ctx, TILE, TILE, 14, rng);
      const ww = px(1.1, 3.0);
      const wh = px(1.7, 3.1);
      const sy = TILE - px(0.95, 3.1);
      const wx = (TILE - ww) / 2;
      // chambranle clair
      ctx.fillStyle = "#f7f5f0";
      ctx.fillRect(wx - 18, sy - wh - 18, ww + 36, wh + 36);
      windowAt(ctx, mctx, wx, sy - wh, ww, wh, {
        frame: "#ffffff",
        frameW: 8,
        glassTop: "#7790a4",
        glassBot: "#2a3440",
        mullionH: [0.5],
        mullionV: 1,
      });
    },
  },
  {
    name: "concrete",
    tileW: 3.6,
    tileH: 3.4,
    draw: (ctx, mctx, rng) => {
      ctx.fillStyle = "#a7a49d";
      ctx.fillRect(0, 0, TILE, TILE);
      grain(ctx, TILE, TILE, 30, rng);
      blotches(ctx, TILE, TILE, 20, rng, "rgba(60,58,50,1)", 0.15, 20, 100);
      // joints de panneaux
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, TILE, 4);
      ctx.fillRect(0, 0, 3, TILE);
      // bandeau de fenêtres en longueur
      const y0 = TILE - px(2.65, 3.4);
      const y1 = TILE - px(0.95, 3.4);
      ctx.fillStyle = "#3a3d40";
      ctx.fillRect(0, y0 - 6, TILE, y1 - y0 + 12);
      glassGradient(ctx, 0, y0, TILE, y1 - y0, "#7b8ea0", "#2b3542");
      mctx.fillStyle = "#fff";
      mctx.fillRect(0, y0, TILE, y1 - y0);
      for (let i = 0; i < 3; i++) {
        const x = (i * TILE) / 3;
        ctx.fillStyle = "#3a3d40";
        ctx.fillRect(x - 4, y0, 8, y1 - y0);
        mctx.fillStyle = "#000";
        mctx.fillRect(x - 4, y0, 8, y1 - y0);
      }
    },
  },
  {
    name: "modern",
    tileW: 3.0,
    tileH: 3.5,
    draw: (ctx, mctx, rng) => {
      ctx.fillStyle = "#4b4f55";
      ctx.fillRect(0, 0, TILE, TILE);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = `rgba(255,255,255,${rng.range(0.02, 0.07)})`;
        ctx.fillRect((i * TILE) / 4 + 2, 0, TILE / 4 - 4, TILE);
      }
      grain(ctx, TILE, TILE, 10, rng);
      const ww = px(2.3, 3.0);
      const wh = px(2.4, 3.5);
      const sy = TILE - px(0.6, 3.5);
      windowAt(ctx, mctx, (TILE - ww) / 2, sy - wh, ww, wh, {
        frame: "#25282c",
        frameW: 7,
        glassTop: "#8aa0b4",
        glassBot: "#2c3a48",
        mullionV: 1,
      });
    },
  },
  {
    name: "glass",
    tileW: 1.6,
    tileH: 3.6,
    draw: (ctx, mctx) => {
      glassGradient(ctx, 0, 0, TILE, TILE, "#7d97ab", "#2d4052");
      mctx.fillStyle = "#fff";
      mctx.fillRect(0, 0, TILE, TILE);
      // allège opaque au niveau de la dalle
      ctx.fillStyle = "#24313c";
      ctx.fillRect(0, TILE - px(0.9, 3.6), TILE, px(0.9, 3.6));
      mctx.fillStyle = "#000";
      mctx.fillRect(0, TILE - px(0.9, 3.6), TILE, px(0.9, 3.6));
      ctx.fillStyle = "#9aa4ad";
      ctx.fillRect(0, 0, 10, TILE);
      ctx.fillRect(0, TILE - px(0.9, 3.6) - 6, TILE, 8);
      mctx.fillRect(0, 0, 10, TILE);
    },
  },
  {
    name: "uqam",
    tileW: 3.6,
    tileH: 3.6,
    draw: (ctx, mctx, rng) => {
      bricks(ctx, 0, 0, TILE, TILE, { cols: 16, rows: 44, hue: [14, 24], sat: [28, 38], light: [20, 27], mortar: "#6d645b" }, rng);
      blotches(ctx, TILE, TILE, 10, rng, "rgba(20,10,5,1)", 0.12, 40, 160);
      // fenêtres étroites en meurtrière, typiques du pavillon
      const ww = px(0.75, 3.6);
      const wh = px(2.1, 3.6);
      const sy = TILE - px(0.8, 3.6);
      for (const cx of [0.27, 0.73]) {
        windowAt(ctx, mctx, TILE * cx - ww / 2, sy - wh, ww, wh, {
          frame: "#2a2420",
          frameW: 6,
          glassTop: "#6d7f8f",
          glassBot: "#1f2731",
          recess: 7,
        });
      }
    },
  },
  {
    name: "banq",
    tileW: 1.2,
    tileH: 4.2,
    draw: (ctx, mctx, rng) => {
      // verre en U teinté vert de la Grande Bibliothèque
      const n = 4;
      for (let i = 0; i < n; i++) {
        const x = (i * TILE) / n;
        const g = ctx.createLinearGradient(x, 0, x + TILE / n, 0);
        const l = rng.range(42, 50);
        g.addColorStop(0, hsl(150, 28, l - 10));
        g.addColorStop(0.5, hsl(148, 30, l + 8));
        g.addColorStop(1, hsl(150, 28, l - 12));
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, TILE / n, TILE);
      }
      grain(ctx, TILE, TILE, 10, rng);
      ctx.fillStyle = "rgba(220,240,230,0.25)";
      ctx.fillRect(0, TILE - 10, TILE, 10);
      mctx.fillStyle = "rgb(150,150,150)";
      mctx.fillRect(0, 0, TILE, TILE);
    },
  },
  {
    name: "dupuis",
    tileW: 3.0,
    tileH: 3.2,
    draw: (ctx, mctx, rng) => {
      ctx.fillStyle = "#7c6552";
      ctx.fillRect(0, 0, TILE, TILE);
      grain(ctx, TILE, TILE, 18, rng);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, 4, TILE);
      const y0 = TILE - px(2.5, 3.2);
      const y1 = TILE - px(0.9, 3.2);
      glassGradient(ctx, 18, y0, TILE - 36, y1 - y0, "#5f6f80", "#1d252e");
      mctx.fillStyle = "#fff";
      mctx.fillRect(18, y0, TILE - 36, y1 - y0);
      ctx.fillStyle = "#2b2420";
      ctx.fillRect(TILE / 2 - 4, y0, 8, y1 - y0);
    },
  },
  {
    name: "theatre",
    tileW: 3.0,
    tileH: 3.6,
    draw: (ctx, mctx, rng) => {
      bricks(ctx, 0, 0, TILE, TILE, { cols: 14, rows: 44, hue: [2, 10], sat: [45, 60], light: [30, 38], mortar: "#c2b8aa" }, rng);
      // pilastres
      ctx.fillStyle = "#d7cfbf";
      ctx.fillRect(0, 0, 26, TILE);
      ctx.fillRect(TILE - 26, 0, 26, TILE);
      const ww = px(1.2, 3.0);
      const wh = px(2.2, 3.6);
      const sy = TILE - px(0.8, 3.6);
      windowAt(ctx, mctx, (TILE - ww) / 2, sy - wh, ww, wh, {
        frame: "#e6dfd2",
        frameW: 10,
        glassTop: "#7a8797",
        glassBot: "#2a2f37",
        arch: true,
        mullionH: [0.65],
      });
      sill(ctx, (TILE - ww) / 2 - 10, sy, ww + 20, 14, "#d7cfbf");
    },
  },
  // ------------------------------------------- rez-de-chaussée commerciaux
  {
    name: "shop_a",
    tileW: 4.0,
    tileH: 4.2,
    draw: (ctx, mctx, rng) => shopfront(ctx, mctx, rng, false),
  },
  {
    name: "shop_b",
    tileW: 4.0,
    tileH: 4.2,
    draw: (ctx, mctx, rng) => shopfront(ctx, mctx, rng, true),
  },
  {
    name: "lobby",
    tileW: 4.0,
    tileH: 4.2,
    draw: (ctx, mctx) => {
      ctx.fillStyle = "#3c4046";
      ctx.fillRect(0, 0, TILE, TILE);
      const top = px(0.7, 4.2);
      glassGradient(ctx, 10, top, TILE - 20, TILE - top - 4, "#8fa2b2", "#3a4651");
      mctx.fillStyle = "#fff";
      mctx.fillRect(10, top, TILE - 20, TILE - top - 4);
      ctx.fillStyle = "#2a2d31";
      for (const x of [0.25, 0.5, 0.75]) ctx.fillRect(TILE * x - 4, top, 8, TILE - top);
      ctx.fillRect(10, top + (TILE - top) * 0.25, TILE - 20, 6);
    },
  },
  {
    name: "roof",
    tileW: 6,
    tileH: 6,
    draw: (ctx, _m, rng) => {
      ctx.fillStyle = "#3f3f40";
      ctx.fillRect(0, 0, TILE, TILE);
      grain(ctx, TILE, TILE, 30, rng);
      blotches(ctx, TILE, TILE, 10, rng, "rgba(25,25,28,1)", 0.12, 40, 140);
      blotches(ctx, TILE, TILE, 5, rng, "rgba(120,118,110,1)", 0.06, 40, 120);
      ctx.strokeStyle = "rgba(20,20,20,0.35)";
      ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (i * TILE) / 4 + 1);
        ctx.lineTo(TILE, (i * TILE) / 4 + 1);
        ctx.stroke();
      }
    },
  },
  {
    name: "plain",
    tileW: 2,
    tileH: 2,
    draw: (ctx, _m, rng) => {
      ctx.fillStyle = "#e4e2dc";
      ctx.fillRect(0, 0, TILE, TILE);
      grain(ctx, TILE, TILE, 12, rng);
    },
  },
  {
    name: "brick_blank",
    tileW: 3.0,
    tileH: 3.1,
    draw: (ctx, _m, rng) => {
      bricks(ctx, 0, 0, TILE, TILE, { cols: 14, rows: 40, hue: [8, 18], sat: [35, 50], light: [30, 40], mortar: "#b0a79a" }, rng);
      blotches(ctx, TILE, TILE, 14, rng, "rgba(30,20,15,1)", 0.15, 40, 160);
    },
  },
];

export const LAYER: Record<string, number> = Object.fromEntries(FACADE_LAYERS.map((l, i) => [l.name, i]));

function shopfront(ctx: Ctx, mctx: Ctx, rng: Rng, door: boolean) {
  const signH = px(0.95, 4.2);
  const bulk = px(0.55, 4.2);
  // bandeau d'enseigne (les enseignes réelles sont des objets séparés)
  ctx.fillStyle = "#2c2b2a";
  ctx.fillRect(0, 0, TILE, signH);
  // cadre / pilastres
  ctx.fillStyle = "#1f2326";
  ctx.fillRect(0, signH, TILE, TILE - signH);
  // vitrine
  const gx = 22;
  const gy = signH + 14;
  const gw = TILE - 44;
  const gh = TILE - signH - bulk - 14;
  // intérieur suggéré : étagères chaudes derrière la vitre
  const g = ctx.createLinearGradient(0, gy, 0, gy + gh);
  g.addColorStop(0, "#9a8f7f");
  g.addColorStop(1, "#4b4339");
  ctx.fillStyle = g;
  ctx.fillRect(gx, gy, gw, gh);
  for (let i = 0; i < 4; i++) {
    const y = gy + gh * (0.25 + i * 0.2);
    ctx.fillStyle = "rgba(40,30,20,0.6)";
    ctx.fillRect(gx, y, gw, 6);
    for (let k = 0; k < 14; k++) {
      ctx.fillStyle = hsl(rng.range(0, 360), rng.range(30, 70), rng.range(35, 65));
      const w = rng.range(10, 26);
      const h = rng.range(14, 40);
      ctx.fillRect(gx + rng.range(0, gw - w), y - h, w, h);
    }
  }
  // reflet du verre
  ctx.save();
  ctx.globalAlpha = 0.35;
  glassGradient(ctx, gx, gy, gw, gh, "#b9c8d6", "#4a5866");
  ctx.restore();
  mctx.fillStyle = "#fff";
  mctx.fillRect(gx, gy, gw, gh);
  if (door) {
    const dw = px(1.05, 4.0);
    const dx = TILE * 0.62;
    ctx.fillStyle = "#1a1d20";
    ctx.fillRect(dx - 8, gy - 4, dw + 16, TILE - gy + 4);
    glassGradient(ctx, dx, gy + 6, dw, TILE - gy - 12, "#8a9aab", "#2e3946");
    ctx.fillStyle = "#c9c2b0";
    ctx.fillRect(dx + 8, gy + (TILE - gy) * 0.5, 6, 30);
  }
  // soubassement
  ctx.fillStyle = "#3b332c";
  ctx.fillRect(0, TILE - bulk, TILE, bulk);
  mctx.fillStyle = "#000";
  mctx.fillRect(0, TILE - bulk, TILE, bulk);
  grain(ctx, TILE, TILE, 10, rng);
}

/** Tableau de textures (une couche par style) : RGB = couleur, A = masque du vitrage. */
export function buildFacadeArray(): THREE.DataArrayTexture {
  const n = FACADE_LAYERS.length;
  const data = new Uint8Array(TILE * TILE * 4 * n);
  FACADE_LAYERS.forEach((layer, i) => {
    const [, ctx] = canvas(TILE);
    const [, mctx] = canvas(TILE);
    mctx.fillStyle = "#000";
    mctx.fillRect(0, 0, TILE, TILE);
    layer.draw(ctx, mctx, new Rng(1000 + i * 77));
    const c = ctx.getImageData(0, 0, TILE, TILE).data;
    const m = mctx.getImageData(0, 0, TILE, TILE).data;
    const base = i * TILE * TILE * 4;
    for (let y = 0; y < TILE; y++) {
      const srcRow = (TILE - 1 - y) * TILE * 4; // retournement vertical
      const dstRow = base + y * TILE * 4;
      for (let x = 0; x < TILE * 4; x += 4) {
        data[dstRow + x] = c[srcRow + x];
        data[dstRow + x + 1] = c[srcRow + x + 1];
        data[dstRow + x + 2] = c[srcRow + x + 2];
        data[dstRow + x + 3] = m[srcRow + x];
      }
    }
  });
  const tex = new THREE.DataArrayTexture(data, TILE, TILE, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------ sols
function toTexture(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function asphaltTexture(): THREE.CanvasTexture {
  const S = 1024;
  const [c, ctx] = canvas(S);
  const rng = new Rng(7);
  ctx.fillStyle = "#3d3e41";
  ctx.fillRect(0, 0, S, S);
  grain(ctx, S, S, 34, rng);
  // granulats
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(${rng.int(120, 190)},${rng.int(120, 190)},${rng.int(120, 190)},${rng.range(0.15, 0.4)})`;
    ctx.fillRect(rng.float() * S, rng.float() * S, rng.range(1, 3), rng.range(1, 3));
  }
  blotches(ctx, S, S, 22, rng, "rgba(15,15,18,1)", 0.25, 40, 180);
  blotches(ctx, S, S, 10, rng, "rgba(110,110,110,1)", 0.12, 60, 200);
  // fissures et rapiéçages
  ctx.strokeStyle = "rgba(15,15,15,0.55)";
  for (let i = 0; i < 9; i++) {
    ctx.lineWidth = rng.range(1, 2.5);
    ctx.beginPath();
    let x = rng.float() * S;
    let y = rng.float() * S;
    ctx.moveTo(x, y);
    for (let k = 0; k < 12; k++) {
      x += rng.range(-30, 30);
      y += rng.range(-30, 30);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = `rgba(28,28,31,${rng.range(0.12, 0.22)})`;
    ctx.beginPath();
    const cx = rng.float() * S;
    const cy = rng.float() * S;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const r = rng.range(40, 110);
      ctx.lineTo(cx + Math.cos(a) * r * 1.6, cy + Math.sin(a) * r);
    }
    ctx.fill();
  }
  return toTexture(c);
}

export function sidewalkTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  const rng = new Rng(11);
  ctx.fillStyle = "#8f8d87";
  ctx.fillRect(0, 0, S, S);
  // dalles de béton de 1,5 m
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = hsl(38, 4, rng.range(50, 57));
      ctx.fillRect(i * 256 + 3, j * 256 + 3, 250, 250);
    }
  grain(ctx, S, S, 22, rng);
  blotches(ctx, S, S, 16, rng, "rgba(60,58,50,1)", 0.16, 20, 90);
  // gomme à mâcher et taches
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(50,50,50,${rng.range(0.15, 0.4)})`;
    ctx.beginPath();
    ctx.arc(rng.float() * S, rng.float() * S, rng.range(1.5, 4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(40,40,38,0.55)";
  ctx.fillRect(0, 0, S, 3);
  ctx.fillRect(0, 0, 3, S);
  ctx.fillRect(0, 255, S, 2);
  ctx.fillRect(255, 0, 2, S);
  return toTexture(c);
}

export function grassTexture(autumn = true): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  const rng = new Rng(13);
  ctx.fillStyle = "#4e6b2f";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) {
    const x = rng.float() * S;
    const y = rng.float() * S;
    ctx.strokeStyle = hsl(rng.range(70, 100), rng.range(30, 55), rng.range(22, 42));
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-2, 2), y - rng.range(3, 8));
    ctx.stroke();
  }
  blotches(ctx, S, S, 14, rng, "rgba(90,80,40,1)", 0.2, 30, 100);
  if (autumn) {
    // feuilles mortes d'érable
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = hsl(rng.pick([8, 18, 28, 38, 45]), rng.range(60, 85), rng.range(35, 55));
      ctx.save();
      ctx.translate(rng.float() * S, rng.float() * S);
      ctx.rotate(rng.float() * 6.28);
      ctx.beginPath();
      ctx.ellipse(0, 0, rng.range(3, 6), rng.range(2, 4), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  return toTexture(c);
}

export function paversTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  const rng = new Rng(17);
  ctx.fillStyle = "#6d6862";
  ctx.fillRect(0, 0, S, S);
  const n = 16;
  const s = S / n;
  for (let r = 0; r < n; r++)
    for (let k = -1; k < n / 2 + 1; k++) {
      const off = r % 2 ? s : 0;
      const x = k * 2 * s + off;
      ctx.fillStyle = hsl(rng.range(18, 30), rng.range(6, 14), rng.range(42, 52));
      ctx.fillRect(x + 1.5, r * s + 1.5, 2 * s - 3, s - 3);
    }
  grain(ctx, S, S, 20, rng);
  return toTexture(c);
}

export function gravelTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  const rng = new Rng(19);
  ctx.fillStyle = "#9a8c76";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 12000; i++) {
    ctx.fillStyle = hsl(rng.range(25, 40), rng.range(10, 25), rng.range(40, 70));
    ctx.beginPath();
    ctx.arc(rng.float() * S, rng.float() * S, rng.range(0.8, 2.2), 0, 6.28);
    ctx.fill();
  }
  return toTexture(c);
}

export function lotTexture(): THREE.CanvasTexture {
  // dalles de béton d'esplanade (cours, parvis, terrains)
  const S = 512;
  const [c, ctx] = canvas(S);
  const rng = new Rng(23);
  ctx.fillStyle = "#7d7a74";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      ctx.fillStyle = hsl(36, rng.range(3, 6), rng.range(44, 50));
      ctx.fillRect(i * 128 + 2, j * 128 + 2, 124, 124);
    }
  grain(ctx, S, S, 24, rng);
  blotches(ctx, S, S, 16, rng, "rgba(40,38,32,1)", 0.14, 30, 110);
  return toTexture(c);
}

// ------------------------------------------------------------ enseignes
export interface AtlasCell {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export class TextAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx;
  readonly texture: THREE.CanvasTexture;
  private n = 0;
  constructor(
    readonly size: number,
    readonly cellW: number,
    readonly cellH: number,
  ) {
    [this.canvas, this.ctx] = canvas(size);
    this.texture = toTexture(this.canvas, false);
    this.texture.generateMipmaps = true;
  }
  get cols() {
    return Math.floor(this.size / this.cellW);
  }
  /** Réserve une case et appelle draw(ctx, w, h) dans un repère local. */
  add(draw: (ctx: Ctx, w: number, h: number) => void): AtlasCell {
    const i = this.n++;
    const cx = (i % this.cols) * this.cellW;
    const cy = Math.floor(i / this.cols) * this.cellH;
    if (cy + this.cellH > this.size) throw new Error("atlas plein");
    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.beginPath();
    this.ctx.rect(0, 0, this.cellW, this.cellH);
    this.ctx.clip();
    draw(this.ctx, this.cellW, this.cellH);
    this.ctx.restore();
    this.texture.needsUpdate = true;
    const S = this.size;
    return { u0: (cx + 1) / S, u1: (cx + this.cellW - 1) / S, v0: 1 - (cy + this.cellH - 1) / S, v1: 1 - (cy + 1) / S };
  }
}

export const FONT = `"Trebuchet MS", "Segoe UI", "DejaVu Sans", "Helvetica Neue", Arial, sans-serif`;
export const FONT_SERIF = `Georgia, "DejaVu Serif", "Times New Roman", serif`;

export function fitText(ctx: Ctx, text: string, maxW: number, size: number, font: string, weight = "bold"): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${font}`;
  while (ctx.measureText(text).width > maxW && s > 8) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${font}`;
  }
  return s;
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Logo du métro de Montréal : flèche blanche vers le bas dans un cercle bleu. */
export function drawMetroLogo(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.fillStyle = "#0a4ea2";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = r * 0.08;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.93, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  const w = r * 0.42;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.45, cy - r * 0.62);
  ctx.lineTo(cx + w * 0.45, cy - r * 0.62);
  ctx.lineTo(cx + w * 0.45, cy + r * 0.02);
  ctx.lineTo(cx + w * 1.15, cy + r * 0.02);
  ctx.lineTo(cx, cy + r * 0.66);
  ctx.lineTo(cx - w * 1.15, cy + r * 0.02);
  ctx.lineTo(cx - w * 0.45, cy + r * 0.02);
  ctx.closePath();
  ctx.fill();
}

export function makeCanvasTexture(w: number, h: number, draw: (ctx: Ctx, w: number, h: number) => void, repeat = false): THREE.CanvasTexture {
  const [c, ctx] = canvas(w, h);
  draw(ctx, w, h);
  return toTexture(c, repeat);
}
