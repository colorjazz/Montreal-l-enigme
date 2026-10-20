import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { City } from "./city";
import { SIDEWALK_Y } from "./city";
import type { Physics } from "../core/physics";
import { makeCanvasTexture, FONT } from "../core/textures";
import { quatY } from "./props";
import { Rng } from "../core/rng";
import type { V2 } from "./geom";

/** Ce que le reste du jeu doit savoir de la boutique (vendeur, porte, intérieur). */
export interface VapoterieLayout {
  name: string;
  /** Position et orientation du vendeur derrière le comptoir. */
  vendor: { x: number; z: number; facing: number };
  /** Devant la porte, sur le trottoir. */
  outside: V2;
  /** Juste à l'intérieur, devant le comptoir. */
  inside: V2;
  /** Polygone de la salle (pour savoir si le joueur est dedans). */
  room: V2[];
  glow: THREE.MeshStandardMaterial[];
  light: THREE.PointLight;
}

const NAME = "Le Daron Fumant";

/** Panneau texte sur une seule texture (enseignes, affiches). */
function panel(lines: { text: string; px: number; color: string; bold?: boolean }[], w: number, h: number, bg: string, border?: string) {
  const H = 256;
  const W = Math.min(2048, Math.round((H * w) / h));
  const tex = makeCanvasTexture(W, H, (ctx, cw, ch) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 10;
      ctx.strokeRect(10, 10, cw - 20, ch - 20);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const total = lines.reduce((a, l) => a + l.px * 1.25, 0);
    let y = (ch - total) / 2;
    for (const l of lines) {
      let size = l.px;
      ctx.font = `${l.bold === false ? "" : "bold "}${size}px ${FONT}`;
      while (ctx.measureText(l.text).width > cw - 40 && size > 10) {
        size -= 2;
        ctx.font = `${l.bold === false ? "" : "bold "}${size}px ${FONT}`;
      }
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, cw / 2, y + l.px * 0.62);
      y += l.px * 1.25;
    }
  });
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

/**
 * Vapoterie de la rue Saint-Denis : rez-de-chaussée creux de l'immeuble choisi par la ville
 * (`City.vapoterie`), avec porte ouverte, vitrine givrée (les produits ne doivent pas être
 * visibles de la rue), comptoir, présentoirs et affiches « 18 ans et plus ».
 */
export function buildVapoterie(city: City, physics: Physics, parent: THREE.Group): VapoterieLayout | null {
  const shell = city.vapoterie;
  if (!shell) return null;
  const R = physics.RAPIER;
  const f = shell.front;
  const n = f.normal;
  const mid: V2 = [(f.p0[0] + f.p1[0]) / 2, (f.p0[1] + f.p1[1]) / 2];
  const rot = Math.atan2(n[0], n[1]);
  const W = f.len;
  // profondeur : point de l'empreinte le plus éloigné de la façade
  const D = Math.max(...shell.poly.map(([x, z]) => -((x - mid[0]) * n[0] + (z - mid[1]) * n[1])));
  const H = shell.groundH;
  const CEIL = 3.3;
  const T = 0.2;

  const g = new THREE.Group();
  g.name = "vapoterie";
  g.position.set(mid[0], SIDEWALK_Y, mid[1]);
  g.rotation.y = rot;
  parent.add(g);
  g.updateMatrixWorld(true);
  const q = quatY(rot);
  const toWorld = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyMatrix4(g.matrixWorld);
  const v2 = (lx: number, lz: number): V2 => {
    const p = toWorld(lx, 0, lz);
    return [p.x, p.z];
  };

  // matériaux
  const ext = new THREE.MeshStandardMaterial({ color: 0x24202c, roughness: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x8a6bd1, roughness: 0.4, metalness: 0.3 });
  const plaster = new THREE.MeshStandardMaterial({ color: 0xe8e4ee, roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x2c2442, roughness: 0.8 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4d36, roughness: 0.65 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3b3a40, roughness: 0.55, metalness: 0.05 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xcfe6ff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false });

  /** Boîte visible + collision (coordonnées locales, y au-dessus du trottoir). */
  const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: THREE.Material | null, collide = true) => {
    if (mat) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(cx, cy, cz);
      m.castShadow = mat !== glassMat;
      m.receiveShadow = true;
      g.add(m);
    }
    if (collide) {
      const p = toWorld(cx, cy, cz);
      physics.world.createCollider(R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(p.x, p.y, p.z).setRotation(q), physics.fixedBody);
    }
  };

  // ---------------- façade : vitrine givrée à gauche, porte à droite
  const doorW = 1.4;
  const doorH = 2.5;
  const doorX0 = W / 2 - 0.7 - doorW; // bord gauche de la porte
  const doorX1 = W / 2 - 0.7;
  const winX0 = -W / 2;
  const fz = -T / 2;
  // pilier droit, linteau, allège et bandeau au-dessus de la vitrine
  box((doorX1 + W / 2) / 2, H / 2, fz, W / 2 - doorX1, H, T, ext);
  box((doorX0 + doorX1) / 2, (doorH + H) / 2, fz, doorW, H - doorH, T, ext);
  box((winX0 + doorX0) / 2, 0.3, fz, doorX0 - winX0, 0.6, T, ext);
  box((winX0 + doorX0) / 2, (2.9 + H) / 2, fz, doorX0 - winX0, H - 2.9, T, ext);
  // cadre violet de la porte
  box(doorX0 - 0.04, doorH / 2, 0.02, 0.08, doorH, 0.12, trim, false);
  box(doorX1 + 0.04, doorH / 2, 0.02, 0.08, doorH, 0.12, trim, false);
  box((doorX0 + doorX1) / 2, doorH + 0.04, 0.02, doorW + 0.16, 0.08, 0.12, trim, false);
  // vitrine givrée (texte collé dans la vitre)
  const frost = panel(
    [
      { text: "VAPOTERIE", px: 54, color: "#4b3c79" },
      { text: "18 ANS ET PLUS", px: 40, color: "#b3122e" },
      { text: "Pièce d'identité avec photo exigée", px: 24, color: "#4b3c79", bold: false },
    ],
    doorX0 - winX0 - 0.1,
    2.3,
    "#eef0f6",
  );
  const fm = frost.material as THREE.MeshStandardMaterial;
  fm.transparent = true;
  fm.opacity = 0.93;
  fm.emissiveIntensity = 0.25;
  frost.position.set((winX0 + doorX0) / 2, 1.75, -0.05);
  g.add(frost);
  fm.opacity = 1;
  fm.transparent = false;
  // revers de la vitre (côté boutique) : film givré uni
  const frostBack = new THREE.Mesh(new THREE.PlaneGeometry(doorX0 - winX0 - 0.1, 2.3), new THREE.MeshStandardMaterial({ color: 0xeef0f6, roughness: 0.3, emissive: 0xeef0f6, emissiveIntensity: 0.25 }));
  frostBack.rotation.y = Math.PI;
  frostBack.position.set((winX0 + doorX0) / 2, 1.75, -0.15);
  g.add(frostBack);
  box((winX0 + doorX0) / 2, 1.75, fz, doorX0 - winX0, 2.3, 0.06, null);
  // porte vitrée ouverte vers l'intérieur, contre le mur
  const door = new THREE.Group();
  door.position.set(doorX1, 0, -T);
  door.rotation.y = -Math.PI / 2 + 0.25;
  const dFrame = new THREE.Mesh(new THREE.BoxGeometry(doorW - 0.1, doorH - 0.1, 0.05), glassMat);
  dFrame.position.set(-(doorW - 0.1) / 2, (doorH - 0.1) / 2, 0);
  const dRail = new THREE.Mesh(new THREE.BoxGeometry(doorW - 0.1, 0.12, 0.07), trim);
  dRail.position.set(-(doorW - 0.1) / 2, 0.06, 0);
  const sticker = panel([{ text: "18+", px: 120, color: "#ffffff" }], 0.45, 0.45, "#b3122e");
  sticker.position.set(-(doorW - 0.1) / 2, 1.5, 0.03);
  door.add(dFrame, dRail, sticker);
  g.add(door);
  // enseigne lumineuse au-dessus
  const sign = panel(
    [
      { text: NAME.toUpperCase(), px: 92, color: "#f3e9ff" },
      { text: "PRODUITS DE VAPOTAGE · 18+", px: 40, color: "#ffd2f4" },
    ],
    Math.min(W - 0.6, 6.6),
    1.0,
    "#3a2a66",
    "#c39bff",
  );
  sign.position.set(0, 3.55, 0.06);
  g.add(sign);
  const glow = [sign.material as THREE.MeshStandardMaterial];

  // ---------------- salle : murs intérieurs, plancher, plafond
  const inX = W / 2 - 0.12;
  box(-inX - T / 2, H / 2, -D / 2 - T / 2, T, H, D - T, plaster);
  box(inX + T / 2, H / 2, -D / 2 - T / 2, T, H, D - T, plaster);
  box(0, H / 2, -D + 0.12 + T / 2, W, H, T, accent);
  // plancher (légèrement au-dessus du trottoir pour éviter le scintillement)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, D - 0.3), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.012, -D / 2 - 0.1);
  floor.receiveShadow = true;
  g.add(floor);
  box(0, -0.05, -D / 2, W, 0.1, D, null);
  // plafond suspendu et néons
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), plaster);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, CEIL, -D / 2);
  ceil.castShadow = true;
  g.add(ceil);
  box(0, CEIL + 0.05, -D / 2, W, 0.1, D, null);
  // bandeau entre le plafond et le linteau (vu de l'intérieur)
  box(0, (CEIL + H) / 2, -T - 0.05, W - 0.3, H - CEIL, 0.1, plaster, false);
  const tube = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4ecff, emissiveIntensity: 1.6 });
  for (const lx of [-W / 4, W / 4]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, D - 3), tube);
    t.position.set(lx, CEIL - 0.03, -D / 2);
    g.add(t);
  }
  const light = new THREE.PointLight(0xfff1e6, 18, 16, 1.6);
  light.position.set(0, CEIL - 0.4, -D / 2);
  g.add(light);

  // ---------------- comptoir et présentoir vitré
  const cz = -D + 3.0;
  const cw = W - 2.4;
  const cx = -W / 2 + 0.25 + cw / 2;
  box(cx, 0.5, cz, cw, 1.0, 0.65, wood);
  box(cx, 1.03, cz, cw + 0.1, 0.06, 0.75, trim, false);
  box(cx, 1.35, cz + 0.12, cw - 0.2, 0.55, 0.35, glassMat, false);
  // portillon entre le comptoir et le mur : le client reste devant le comptoir
  box((cx + cw / 2 + inX) / 2, 0.5, cz, inX - (cx + cw / 2), 1.0, 0.08, wood);
  // caisse et terminal de paiement
  box(cx + cw / 2 - 0.5, 1.2, cz - 0.05, 0.4, 0.28, 0.3, ext, false);
  box(cx + cw / 2 - 0.5, 1.42, cz - 0.15, 0.36, 0.22, 0.04, new THREE.MeshStandardMaterial({ color: 0x223, emissive: 0x3355ff, emissiveIntensity: 0.6 }), false);
  // petite affiche sur le comptoir
  const counterSign = panel(
    [
      { text: "PAS DE CARTE,", px: 50, color: "#ffffff" },
      { text: "PAS DE VENTE.", px: 50, color: "#ffffff" },
      { text: "18 ans et plus seulement", px: 30, color: "#ffd6d6", bold: false },
    ],
    0.7,
    0.5,
    "#b3122e",
  );
  counterSign.position.set(cx - cw / 2 + 0.7, 1.32, cz + 0.39);
  counterSign.rotation.x = -0.2;
  g.add(counterSign);

  // ---------------- étagères derrière le comptoir et sur le mur gauche (boîtes colorées)
  const rng = new Rng(1808);
  const COLORS = [0x7bdff2, 0xb2f7ef, 0xf7d6e0, 0xf2b5d4, 0xffd166, 0x06d6a0, 0xef476f, 0x8e7dbe, 0xf4a261, 0x90be6d];
  const boxes: THREE.BufferGeometry[] = [];
  const shelves: THREE.BufferGeometry[] = [];
  const addShelf = (x0: number, x1: number, z: number, depth: number, along: "x" | "z") => {
    for (let k = 0; k < 4; k++) {
      const y = 0.55 + k * 0.48;
      const len = Math.abs(x1 - x0);
      const sg = along === "x" ? new THREE.BoxGeometry(len, 0.04, depth) : new THREE.BoxGeometry(depth, 0.04, len);
      sg.translate(along === "x" ? (x0 + x1) / 2 : z, y, along === "x" ? z : (x0 + x1) / 2);
      shelves.push(sg);
      let t = 0.08;
      while (t < len - 0.12) {
        const bw = 0.07 + rng.float() * 0.08;
        const bh = 0.12 + rng.float() * 0.2;
        const bg = new THREE.BoxGeometry(along === "x" ? bw : depth * 0.6, bh, along === "x" ? depth * 0.6 : bw);
        const pos = Math.min(x0, x1) + t + bw / 2;
        bg.translate(along === "x" ? pos : z, y + 0.02 + bh / 2, along === "x" ? z : pos);
        const c = new THREE.Color(COLORS[Math.floor(rng.float() * COLORS.length)]);
        const cnt = bg.attributes.position.count;
        const col = new Float32Array(cnt * 3);
        for (let j = 0; j < cnt; j++) col.set([c.r, c.g, c.b], j * 3);
        bg.setAttribute("color", new THREE.BufferAttribute(col, 3));
        boxes.push(bg.index ? bg.toNonIndexed() : bg);
        t += bw + 0.02 + (rng.float() < 0.15 ? 0.12 : 0);
      }
    }
  };
  addShelf(-W / 2 + 0.6, W / 2 - 0.6, -D + 0.45, 0.35, "x");
  addShelf(-D + 4.2, -1.6, -W / 2 + 0.35, 0.35, "z");
  box(0, 1.3, -D + 0.45, W - 1.1, 2.6, 0.38, null);
  box(-W / 2 + 0.35, 1.3, (-D + 4.2 - 1.6) / 2, 0.38, 2.6, D - 5.8, null);
  if (shelves.length) {
    const sm = new THREE.Mesh(mergeGeometries(shelves.map((s) => (s.index ? s.toNonIndexed() : s)))!, new THREE.MeshStandardMaterial({ color: 0xd9d4e4, roughness: 0.5, metalness: 0.4 }));
    sm.receiveShadow = true;
    g.add(sm);
  }
  if (boxes.length) {
    const bm = new THREE.Mesh(mergeGeometries(boxes)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }));
    g.add(bm);
  }
  // vitre devant l'étagère de gauche (produits sous clé)
  box(-W / 2 + 0.56, 1.4, (-D + 4.2 - 1.6) / 2, 0.03, 2.0, D - 5.8, glassMat, false);

  // ---------------- enseigne néon du fond et affiches réglementaires
  const neon = panel([{ text: "☁ LE DARON FUMANT ☁", px: 110, color: "#e9d7ff" }], 3.6, 0.7, "#1d1530");
  (neon.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9;
  neon.position.set(0, 2.95, -D + 0.12 + T + 0.01);
  g.add(neon);
  const law = panel(
    [
      { text: "AVIS", px: 46, color: "#b3122e" },
      { text: "La vente de produits de vapotage", px: 26, color: "#1b1b1b", bold: false },
      { text: "aux personnes de moins de 18 ans", px: 26, color: "#1b1b1b", bold: false },
      { text: "est interdite.", px: 26, color: "#1b1b1b", bold: false },
      { text: "Une pièce d'identité avec photo peut être exigée.", px: 20, color: "#444", bold: false },
    ],
    1.1,
    1.0,
    "#fbfbf6",
    "#b3122e",
  );
  law.position.set(inX - 0.01, 1.65, -D + 5.2);
  law.rotation.y = -Math.PI / 2;
  g.add(law);
  const health = panel(
    [
      { text: "La nicotine crée", px: 38, color: "#ffffff" },
      { text: "une forte dépendance.", px: 38, color: "#ffffff" },
      { text: "Santé Québec rappelle que le vapotage n'est pas sans risque.", px: 18, color: "#ffe9a8", bold: false },
    ],
    1.3,
    0.8,
    "#1f3b57",
  );
  health.position.set(inX - 0.01, 1.7, -D + 7.2);
  health.rotation.y = -Math.PI / 2;
  g.add(health);
  // tapis d'entrée
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.9), new THREE.MeshStandardMaterial({ color: 0x3a2a66, roughness: 1 }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set((doorX0 + doorX1) / 2, 0.02, -0.8);
  g.add(mat);

  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
  });

  const vf = toWorld(cx, 0, cz - 0.9);
  const room: V2[] = [v2(-W / 2, -0.1), v2(W / 2, -0.1), v2(W / 2, -D), v2(-W / 2, -D)];
  return {
    name: NAME,
    vendor: { x: vf.x, z: vf.z, facing: rot },
    outside: v2((doorX0 + doorX1) / 2, 1.6),
    inside: v2(cx + 0.4, cz + 1.3),
    room,
    glow,
    light,
  };
}
