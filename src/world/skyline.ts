import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Rng } from "../core/rng";

/**
 * Horizon lointain (hors brouillard) : mont Royal et sa croix illuminée,
 * gratte-ciel du centre-ville, pont Jacques-Cartier, mât du Stade olympique.
 * Directions exprimées dans le repère de la grille (−Z = « nord » montréalais).
 */
export class Skyline {
  readonly group = new THREE.Group();
  private hazeMats: { mat: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial; day: THREE.Color; night: THREE.Color }[] = [];
  private crossMat: THREE.MeshBasicMaterial;
  private windowMat: THREE.MeshBasicMaterial;
  private bridgeLights: THREE.PointsMaterial;

  constructor() {
    this.group.name = "horizon";
    const rng = new Rng(2026);

    // ---------------- mont Royal (au nord-ouest de la grille, ~2,2 km)
    const mtGeo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    const pos = mtGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const n = 1 + 0.08 * Math.sin(x * 9 + z * 5) + 0.05 * Math.sin(z * 13 - x * 4);
      pos.setXYZ(i, x * n, y * (0.9 + 0.12 * Math.sin(x * 6)), z * n);
    }
    mtGeo.computeVertexNormals();
    const mtMat = new THREE.MeshBasicMaterial({ color: 0x5d6b52, fog: false });
    const mt = new THREE.Mesh(mtGeo, mtMat);
    mt.scale.set(1500, 210, 900);
    mt.position.set(-650, -10, -2350);
    mt.rotation.y = 0.5;
    this.group.add(mt);
    this.hazeMats.push({ mat: mtMat, day: new THREE.Color(0x7d8a7a), night: new THREE.Color(0x10141c) });
    // la croix du mont Royal (illuminée la nuit)
    this.crossMat = new THREE.MeshBasicMaterial({ color: 0xbfc5cc, fog: false });
    const cross = new THREE.Group();
    const v = new THREE.Mesh(new THREE.BoxGeometry(3, 31, 3), this.crossMat);
    v.position.y = 15.5;
    const h = new THREE.Mesh(new THREE.BoxGeometry(11, 3, 3), this.crossMat);
    h.position.y = 22;
    cross.add(v, h);
    cross.position.set(-520, 192, -2050);
    cross.scale.setScalar(1.6);
    this.group.add(cross);

    // ---------------- centre-ville (ouest-nord-ouest de la grille, 1,5–2,5 km)
    const towers: THREE.BufferGeometry[] = [];
    const windows: THREE.BufferGeometry[] = [];
    const towerColors = [0x7c8794, 0x8d96a0, 0x6d7a88, 0x9aa3ab, 0x5f6b78];
    for (let i = 0; i < 46; i++) {
      const ang = THREE.MathUtils.degToRad(rng.range(-118, -70)); // angle depuis le nord de la grille
      const dist = rng.range(1300, 2400);
      const x = Math.sin(ang) * dist;
      const z = -Math.cos(ang) * dist;
      const hgt = rng.range(60, 200) * (rng.chance(0.2) ? 1.2 : 1);
      const w = rng.range(28, 55);
      const d = rng.range(28, 55);
      towers.push(colored(new THREE.BoxGeometry(w, hgt, d).translate(x, hgt / 2, z), rng.pick(towerColors)));
      // couronnement en pyramide de cuivre (clin d'œil au 1000 De La Gauchetière)
      if (i === 3) towers.push(colored(new THREE.ConeGeometry(w * 0.5, 30, 4).rotateY(Math.PI / 4).translate(x, hgt + 15, z), 0x9c6b3c));
      // fenêtres éclairées la nuit : quelques bandes
      for (let f = 6; f < hgt - 4; f += rng.range(6, 14)) {
        if (rng.chance(0.55)) windows.push(new THREE.BoxGeometry(w + 0.6, 1.2, d + 0.6).translate(x, f, z));
      }
    }
    // Place Ville Marie (cruciforme)
    const pvmX = -1500;
    const pvmZ = -700;
    towers.push(colored(new THREE.BoxGeometry(70, 188, 22).translate(pvmX, 94, pvmZ), 0x9ea8b2));
    towers.push(colored(new THREE.BoxGeometry(22, 188, 70).translate(pvmX, 94, pvmZ), 0x9ea8b2));
    const tg = mergeGeometries(towers)!;
    const towerMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, color: 0xffffff });
    const tm = new THREE.Mesh(tg, towerMat);
    tm.name = "centre-ville";
    this.group.add(tm);
    this.hazeMats.push({ mat: towerMat, day: new THREE.Color(0xc2cbd6), night: new THREE.Color(0x1a2130) });
    this.windowMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false, transparent: true, opacity: 0 });
    if (windows.length) {
      const wm = new THREE.Mesh(mergeGeometries(windows)!, this.windowMat);
      wm.name = "fenêtres du centre-ville";
      this.group.add(wm);
    }

    // ---------------- pont Jacques-Cartier (au sud de la grille, ~1,4 km)
    const bridge: THREE.BufferGeometry[] = [];
    const bx0 = -400;
    const bx1 = 900;
    const bz = 1450;
    const deckY = 50;
    bridge.push(new THREE.BoxGeometry(bx1 - bx0, 3, 18).translate((bx0 + bx1) / 2, deckY, bz));
    // treillis : arcs principaux
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const x = bx0 + (bx1 - bx0) * t;
      const arch = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.25) / 0.5))) * 45;
      if (arch > 1) bridge.push(new THREE.BoxGeometry(2, arch, 2).translate(x, deckY + arch / 2, bz));
      if (i % 6 === 0) bridge.push(new THREE.BoxGeometry(6, deckY, 6).translate(x, deckY / 2, bz));
    }
    const bm = new THREE.MeshBasicMaterial({ color: 0x4d6b58, fog: false });
    const bmesh = new THREE.Mesh(mergeGeometries(bridge)!, bm);
    bmesh.name = "pont Jacques-Cartier";
    this.group.add(bmesh);
    this.hazeMats.push({ mat: bm, day: new THREE.Color(0x8fa197), night: new THREE.Color(0x121821) });
    // illumination du pont
    const lp: number[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const x = bx0 + (bx1 - bx0) * t;
      const arch = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.25) / 0.5))) * 45;
      lp.push(x, deckY + arch + 1, bz);
      lp.push(x, deckY + 1, bz);
    }
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
    this.bridgeLights = new THREE.PointsMaterial({ color: 0x9fd4ff, size: 2.5, sizeAttenuation: false, fog: false, transparent: true, opacity: 0 });
    this.group.add(new THREE.Points(lgeo, this.bridgeLights));

    // ---------------- mât du Stade olympique (est de la grille, très loin)
    const so = new THREE.Group();
    const mastGeo = new THREE.CylinderGeometry(6, 18, 175, 8).translate(0, 87, 0);
    mastGeo.rotateZ(-0.6);
    const stadium = new THREE.SphereGeometry(140, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.3, 0.25, 1);
    const sm = new THREE.MeshBasicMaterial({ color: 0xb8bfc6, fog: false });
    so.add(new THREE.Mesh(mastGeo, sm), new THREE.Mesh(stadium, sm));
    so.position.set(3600, 0, -1100);
    this.group.add(so);
    this.hazeMats.push({ mat: sm, day: new THREE.Color(0xc9d1d9), night: new THREE.Color(0x151b26) });
  }

  update(focus: THREE.Vector3, night: number, overcast: number) {
    this.group.position.set(focus.x * 0.85, 0, focus.z * 0.85);
    for (const h of this.hazeMats) {
      const c = h.day.clone().lerp(h.night, night);
      c.lerp(new THREE.Color(0x9aa1a8), overcast * 0.6 * (1 - night));
      (h.mat as THREE.MeshBasicMaterial).color.copy(c);
    }
    this.crossMat.color.setRGB(0.75 + night * 0.25, 0.77 + night * 0.23, 0.8 + night * 0.2);
    if (night > 0.5) this.crossMat.color.setRGB(1.6, 1.6, 1.7);
    this.windowMat.opacity = night * 0.55;
    this.bridgeLights.opacity = night;
  }
}

function colored(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = ng.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    a[k * 3] = c.r;
    a[k * 3 + 1] = c.g;
    a[k * 3 + 2] = c.b;
  }
  ng.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return ng;
}
