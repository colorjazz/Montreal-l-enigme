import * as THREE from "three";
import type { Gameplay } from "./world";
import { Character, randomLook, type AnimState } from "../actors/character";
import { attachProp } from "../actors/npcs";
import { Rng } from "../core/rng";
import { SIDEWALK_Y } from "../world/city";
import { worldUniforms } from "../world/materials";
import type { V2 } from "../world/geom";
import { makeCanvasTexture } from "../core/textures";
import type { DTree } from "./dialogue";
import { money } from "./state";

type G = Gameplay;

interface ActiveEvent {
  id: string;
  name: string;
  t: number;
  dur: number;
  pos: V2 | null;
  tick: (dt: number) => void;
  end: () => void;
}

/** Figurant d'événement (marcheur, équipe de tournage...). */
class Extra {
  readonly c: Character;
  pos = new THREE.Vector3();
  facing = 0;
  speed = 0;
  anim: AnimState = "idle";
  constructor(scene: THREE.Scene, seed: number, over = {}) {
    this.c = new Character(randomLook(new Rng(seed), over));
    scene.add(this.c.root);
  }
  update(dt: number) {
    this.c.root.position.copy(this.pos);
    this.c.root.rotation.y = this.facing;
    this.c.anim.update(dt, this.speed, this.speed > 0.2 ? "walk" : this.anim);
  }
  dispose(scene: THREE.Scene) {
    scene.remove(this.c.root);
    this.c.dispose();
  }
}

const PROTEST_SIGNS = ["ÉDUCATION GRATUITE", "SAUVONS LE FRANÇAIS", "LE CLIMAT D'ABORD", "LOGEMENT POUR TOUS", "VIVE LA CULTURE", "LA RUE EST À NOUS"];
const CHANTS = ["So-so-so, solidarité !", "Le français, c'est notre fierté !", "Hé ho ! Le climat, on n'en a qu'un !", "On lâche pas !"];

/** Générateur d'événements aléatoires autour du joueur. */
export class Events {
  readonly active: ActiveEvent[] = [];
  nextAt = 35;
  /** Événements aléatoires automatiques (désactivés pendant les tests). */
  auto = true;
  private rng = new Rng(Date.now() & 0xfff);
  readonly log: string[] = [];
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainAmount = 0;
  private pigeons: { mesh: THREE.InstancedMesh; birds: { home: THREE.Vector3; pos: THREE.Vector3; vel: THREE.Vector3; flying: number; peck: number }[] };
  private fireworks: THREE.Points;
  private fwData: { pos: THREE.Vector3; vel: THREE.Vector3; life: number; col: THREE.Color }[] = [];
  private fwTimer = 0;
  private lastHourBell = -1;
  stats = { started: 0 };

  constructor(private g: G) {
    const scene = g.game.scene;
    // pluie : segments qui tombent autour de la caméra
    const N = 2600;
    this.rainPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 60;
      const y = Math.random() * 30;
      const z = (Math.random() - 0.5) * 60;
      this.rainPos.set([x, y, z, x + 0.05, y - 0.7, z], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.name = "pluie";
    scene.add(this.rain);
    // pigeons de la Place Émilie-Gamelin
    const bird = new THREE.SphereGeometry(0.13, 6, 5).scale(1, 0.85, 1.6);
    const im = new THREE.InstancedMesh(bird, new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.8 }), 18);
    im.castShadow = true;
    im.frustumCulled = false;
    scene.add(im);
    const park = g.game.city.data.parks.find((p) => p.id === "emilie")!;
    const cx = park.poly.reduce((s, p) => s + p[0], 0) / park.poly.length;
    const cz = park.poly.reduce((s, p) => s + p[1], 0) / park.poly.length;
    this.pigeons = {
      mesh: im,
      birds: Array.from({ length: 18 }, () => {
        const home = new THREE.Vector3(cx - 4 + Math.random() * 8, SIDEWALK_Y + 0.12, cz + 8 + Math.random() * 8);
        return { home, pos: home.clone(), vel: new THREE.Vector3(), flying: 0, peck: Math.random() * 6 };
      }),
    };
    // feux d'artifice
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
    fg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
    this.fireworks = new THREE.Points(fg, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.fireworks.frustumCulled = false;
    scene.add(this.fireworks);
  }

  get raining() {
    return this.rainAmount > 0.3;
  }

  private begin(e: ActiveEvent, title: string, body: string) {
    this.active.push(e);
    this.log.push(e.id);
    this.stats.started++;
    this.g.state.stats.eventsSeen++;
    this.g.toast(title, body, "event");
  }

  /** Lance un événement précis (tests, débogage) ou au hasard. */
  trigger(id?: string): string | null {
    const all: [string, () => boolean, () => void][] = [
      ["averse", () => !this.has("averse"), () => this.startRain()],
      ["manif", () => !this.has("manif"), () => this.startProtest()],
      ["violon", () => !this.has("violon"), () => this.startViolin()],
      ["portefeuille", () => !this.g.quests.isActive("portefeuille") && !this.g.quests.isDone("portefeuille") && !this.has("portefeuille"), () => this.startWallet()],
      ["tournage", () => !this.has("tournage"), () => this.startFilm()],
      ["feux", () => !this.has("feux"), () => this.startSignalsOut()],
      ["poutine", () => !this.has("poutine"), () => this.startFoodTruck()],
      ["artifice", () => this.g.game.env.isNight && !this.has("artifice"), () => this.startFireworks()],
    ];
    const ok = all.filter(([k, cond]) => (!id || k === id) && cond());
    if (!ok.length) return null;
    const pick = id ? ok[0] : this.rng.pick(ok);
    pick[2]();
    return pick[0];
  }

  /** Termine tous les événements en cours. */
  endAll() {
    for (const e of [...this.active]) e.t = e.dur + 1;
  }

  has(id: string) {
    return this.active.some((e) => e.id === id);
  }

  update(dt: number) {
    const g = this.g;
    const p = g.player.position;
    this.nextAt -= dt;
    if (this.auto && this.nextAt <= 0 && !g.dialogue.open) {
      this.nextAt = this.rng.range(55, 110);
      if (p.y > -2) this.trigger();
    }
    for (const e of [...this.active]) {
      e.t += dt;
      e.tick(dt);
      if (e.t > e.dur) {
        e.end();
        this.active.splice(this.active.indexOf(e), 1);
      }
    }
    // pluie
    const env = g.game.env;
    const wantRain = this.has("averse") ? 1 : 0;
    this.rainAmount += (wantRain - this.rainAmount) * Math.min(1, dt * 0.25);
    env.overcast = this.rainAmount;
    worldUniforms.uWet.value = Math.min(1, this.rainAmount * 1.3);
    g.peds.raining = this.rainAmount > 0.4;
    const mat = this.rain.material as THREE.LineBasicMaterial;
    mat.opacity = this.rainAmount * 0.55 * (p.y < -2 ? 0 : 1);
    if (this.rainAmount > 0.02) {
      const cam = g.game.camera.position;
      this.rain.position.set(cam.x, Math.max(0, cam.y - 10), cam.z);
      const arr = this.rainPos;
      const fall = dt * 22;
      for (let i = 0; i < arr.length; i += 6) {
        arr[i + 1] -= fall;
        arr[i + 4] -= fall;
        if (arr[i + 4] < 0) {
          const y = 28 + Math.random() * 4;
          arr[i + 1] = y;
          arr[i + 4] = y - 0.7;
        }
      }
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    this.updatePigeons(dt);
    this.updateFireworks(dt);
    // cloches du clocher Saint-Jacques à chaque heure
    const h = Math.floor(env.hours);
    if (h !== this.lastHourBell) {
      if (this.lastHourBell >= 0) {
        const c = g.game.landmarks.clocherTop;
        g.game.audio?.bell(((h + 11) % 12) + 1 > 6 ? 3 : ((h + 11) % 12) + 1, p.distanceTo(c));
      }
      this.lastHourBell = h;
    }
  }

  markers() {
    return this.active.filter((e) => e.pos).map((e) => ({ x: e.pos![0], z: e.pos![1], kind: "event" as const, label: e.name }));
  }

  // ------------------------------------------------------------ averse
  private startRain() {
    const dur = this.rng.range(55, 90);
    this.begin({ id: "averse", name: "Averse", t: 0, dur, pos: null, tick: () => {}, end: () => this.g.toast("Le soleil revient", "L'averse est terminée.", "event") }, "🌧️ Averse soudaine !", "Les passants sortent leurs parapluies. La chaussée devient glissante.");
  }

  // ------------------------------------------------------------ manifestation
  private startProtest() {
    const g = this.g;
    const sc = g.game.city.streetById.get("stecath")!;
    const p = g.player.position;
    // défile sur Sainte-Catherine, d'ouest en est, en passant près du joueur
    const zAt = (x: number) => sc.a[1] + ((x - sc.a[0]) / (sc.b[0] - sc.a[0])) * (sc.b[1] - sc.a[1]);
    const startX = Math.max(-260, Math.min(p.x, 150) - 90);
    const extras: { e: Extra; off: V2 }[] = [];
    for (let i = 0; i < 12; i++) {
      const e = new Extra(g.game.scene, 9000 + i * 13, { backpack: i % 2 ? "#e63946" : undefined });
      if (i % 2 === 0) {
        const sign = attachProp(e.c, "sign");
        const txt = PROTEST_SIGNS[i % PROTEST_SIGNS.length];
        const tex = makeCanvasTexture(256, 160, (ctx, w, h) => {
          ctx.fillStyle = "#fbf5e6";
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = i % 4 === 0 ? "#c0392b" : "#1d3557";
          ctx.font = 'bold 34px "DejaVu Sans", Arial, sans-serif';
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const words = txt.split(" ");
          const mid = Math.ceil(words.length / 2);
          ctx.fillText(words.slice(0, mid).join(" "), w / 2, h * 0.35);
          ctx.fillText(words.slice(mid).join(" "), w / 2, h * 0.7);
        });
        const board = sign.children[1] as THREE.Mesh;
        board.material = new THREE.MeshStandardMaterial({ map: tex });
      }
      extras.push({ e, off: [-(i % 4) * 1.6 - Math.floor(i / 4) * 0.4, (Math.floor(i / 4) - 1) * 1.8] });
    }
    let x = startX;
    let chant = 0;
    const ev: ActiveEvent = {
      id: "manif",
      name: "Manifestation",
      t: 0,
      dur: 150,
      pos: [x, zAt(x)],
      tick: (dt) => {
        x += dt * 1.25;
        ev.pos = [x, zAt(x)];
        for (const { e, off } of extras) {
          e.pos.set(x + off[0], 0.0, zAt(x) + off[1]);
          e.facing = Math.PI / 2;
          e.speed = 1.25;
          e.update(dt);
        }
        chant -= dt;
        if (chant <= 0) {
          chant = 4;
          const who = extras[Math.floor(Math.random() * extras.length)].e;
          g.hud.say(() => who.pos.clone().add(new THREE.Vector3(0, 2.1, 0)), this.rng.pick(CHANTS), 3);
        }
      },
      end: () => extras.forEach(({ e }) => e.dispose(g.game.scene)),
    };
    // les voitures s'arrêtent devant les manifestants
    g.extraObstacles = () => extras.map(({ e }) => e.pos);
    const oldEnd = ev.end;
    ev.end = () => {
      oldEnd();
      g.extraObstacles = () => [];
    };
    this.begin(ev, "📢 Manifestation étudiante", "Un cortège descend la rue Sainte-Catherine. « So-so-so, solidarité ! »");
  }

  // ------------------------------------------------------------ violoniste
  private startViolin() {
    const g = this.g;
    const spots: V2[] = [
      [-112, 150],
      [14, -24],
      [-138, -28],
      [118, 150],
    ];
    const p = g.player.position;
    spots.sort((a, b) => Math.hypot(a[0] - p.x, a[1] - p.z) - Math.hypot(b[0] - p.x, b[1] - p.z));
    const s = spots[0];
    const e = new Extra(g.game.scene, 4242, { hat: "beret", hatColor: "#111111", top: "#2b2d42", topStyle: "coat" });
    attachProp(e.c, "violin");
    e.pos.set(s[0], SIDEWALK_Y, s[1]);
    e.anim = "talk";
    let tipped = false;
    g.addInteractable({
      id: "violoniste",
      pos: () => e.pos,
      radius: 2.5,
      label: () => (this.has("violon") ? `<span class="key">E</span>Donner ${money(2)} au violoniste` : null),
      action: () => {
        if (tipped) {
          g.hud.say(() => e.pos.clone().add(new THREE.Vector3(0, 2.1, 0)), "Merci encore, vous êtes généreux !", 2.5);
          return;
        }
        if (g.state.pay(2)) {
          tipped = true;
          g.state.flag("genereux");
          g.hud.say(() => e.pos.clone().add(new THREE.Vector3(0, 2.1, 0)), "Merci beaucoup ! Voici « À la claire fontaine » !", 3);
          g.game.audio?.ui("cash");
        } else g.toast("Pas assez d'argent", "Il te faut 2,00 $.", "info");
      },
      marker: () => (this.has("violon") ? { text: "♪", cls: "talk", height: 2.4 } : null),
    });
    this.begin(
      {
        id: "violon",
        name: "Violoniste",
        t: 0,
        dur: 120,
        pos: s,
        tick: (dt) => {
          e.update(dt);
          g.game.audio?.streetMusic("violin", g.player.position.distanceTo(e.pos), dt);
        },
        end: () => {
          g.interactions.remove("violoniste");
          e.dispose(g.game.scene);
          g.game.audio?.streetMusic(null, 999, 0);
        },
      },
      "🎻 Musique de rue",
      "Un violoniste joue « À la claire fontaine » non loin d'ici.",
    );
  }

  // ------------------------------------------------------------ portefeuille perdu
  private startWallet() {
    const g = this.g;
    const p = g.player.position;
    // sur le trottoir, quelques mètres devant le joueur
    const ahead = g.player.forward(6);
    const x = ahead.x;
    const z = ahead.z;
    let spawned = false;
    const c = g.addCollectible(`portefeuille${Date.now()}`, "portefeuille", x, z, p.y > 0.1 ? SIDEWALK_Y : p.y, () => {
      g.quests.start("portefeuille");
      if (!spawned) {
        spawned = true;
        spawnMartine(g);
      }
    }, "wallet");
    this.begin({ id: "portefeuille", name: "Portefeuille", t: 0, dur: 90, pos: [x, z], tick: () => {}, end: () => {
      if (c.active) {
        c.active = false;
        c.mesh.visible = false;
      }
    } }, "👛 Tiens, qu'est-ce que c'est ?", "Quelque chose brille sur le trottoir, juste devant toi.");
  }

  // ------------------------------------------------------------ tournage
  private startFilm() {
    const g = this.g;
    const sd = g.game.city.streetById.get("stdenis")!;
    const z = -60;
    const x = sd.a[0] + ((z - sd.a[1]) / (sd.b[1] - sd.a[1])) * (sd.b[0] - sd.a[0]) - 11;
    const crew: Extra[] = [];
    const actor = new Extra(g.game.scene, 777, { top: "#111111", topStyle: "coat", hat: "none", bottom: "#111111" });
    actor.pos.set(x, SIDEWALK_Y, z);
    actor.facing = Math.PI / 2;
    actor.anim = "talk";
    crew.push(actor);
    const cam = new THREE.Group();
    const tripod = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 3, 1, true), new THREE.MeshStandardMaterial({ color: 0x222222, wireframe: true }));
    tripod.position.y = 0.7;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    body.position.y = 1.55;
    cam.add(tripod, body);
    cam.position.set(x + 5, SIDEWALK_Y, z);
    cam.rotation.y = -Math.PI / 2;
    g.game.scene.add(cam);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.2), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d0, emissiveIntensity: 2 }));
    lamp.position.set(x + 3, SIDEWALK_Y + 2.6, z + 3);
    lamp.lookAt(actor.pos);
    g.game.scene.add(lamp);
    const director = new Extra(g.game.scene, 778, { hat: "cap", hatColor: "#111", top: "#6d597a", topStyle: "jacket" });
    director.pos.set(x + 5.5, SIDEWALK_Y, z + 1.6);
    director.facing = -Math.PI / 2;
    crew.push(director);
    let warn = 0;
    let said = false;
    this.begin(
      {
        id: "tournage",
        name: "Tournage",
        t: 0,
        dur: 140,
        pos: [x, z],
        tick: (dt) => {
          crew.forEach((c) => c.update(dt));
          warn -= dt;
          const d = g.player.position.distanceTo(actor.pos);
          if (!said && d < 25) {
            said = true;
            g.hud.say(() => director.pos.clone().add(new THREE.Vector3(0, 2.1, 0)), "Silence, on tourne ! Action !", 3);
          }
          if (d < 4 && warn <= 0) {
            warn = 6;
            g.hud.say(() => director.pos.clone().add(new THREE.Vector3(0, 2.1, 0)), "Coupez ! Hé, vous êtes dans le champ !", 3);
          }
        },
        end: () => {
          crew.forEach((c) => c.dispose(g.game.scene));
          g.game.scene.remove(cam, lamp);
        },
      },
      "🎬 Tournage sur la rue Saint-Denis",
      "Une équipe de cinéma tourne une scène. Montréal, Hollywood du Nord !",
    );
  }

  // ------------------------------------------------------------ feux en panne
  private startSignalsOut() {
    const g = this.g;
    const t = g.game.traffic;
    if (!t) return;
    t.signalsOut = true;
    const cop = new Extra(g.game.scene, 1717, { top: "#1b263b", topStyle: "jacket", bottom: "#1b263b", hat: "cap", hatColor: "#1b263b", vest: "#d4ff00" });
    cop.pos.set(10.5, SIDEWALK_Y, -9.5);
    cop.facing = -Math.PI * 0.75;
    cop.anim = "wave";
    let blow = 0;
    this.begin(
      {
        id: "feux",
        name: "Feux en panne",
        t: 0,
        dur: 60,
        pos: [0, 0],
        tick: (dt) => {
          cop.update(dt);
          blow -= dt;
          if (blow <= 0 && g.player.position.distanceTo(cop.pos) < 40) {
            blow = 7;
            g.hud.say(() => cop.pos.clone().add(new THREE.Vector3(0, 2.1, 0)), "Tuuut ! Avancez, avancez !", 2);
          }
        },
        end: () => {
          t.signalsOut = false;
          cop.dispose(g.game.scene);
          g.toast("Feux réparés", "La circulation reprend normalement.", "event");
        },
      },
      "🚦 Panne de feux de circulation",
      "Une policière dirige la circulation au coin de Berri et De Maisonneuve.",
    );
  }

  // ------------------------------------------------------------ camion de poutine
  private startFoodTruck() {
    const g = this.g;
    const park = g.game.city.data.parks.find((p) => p.id === "emilie")!;
    const x1 = Math.max(...park.poly.map((p) => p[0]));
    const zs = park.poly.map((p) => p[1]);
    const z = (Math.min(...zs) + Math.max(...zs)) / 2 + 25;
    const x = x1 + 5.2;
    const truck = new THREE.Group();
    const tex = makeCanvasTexture(512, 128, (ctx, w, h) => {
      ctx.fillStyle = "#f2b705";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#8c1c13";
      ctx.font = 'bold 50px "DejaVu Sans", Arial, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("LA PATATE VOLANTE", w / 2, h * 0.42);
      ctx.font = '28px "DejaVu Sans", Arial, sans-serif';
      ctx.fillText("Poutine · Hot-dogs steamés", w / 2, h * 0.8);
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 6), [new THREE.MeshStandardMaterial({ map: tex }), new THREE.MeshStandardMaterial({ map: tex }), new THREE.MeshStandardMaterial({ color: 0xf2b705 }), new THREE.MeshStandardMaterial({ color: 0xf2b705 }), new THREE.MeshStandardMaterial({ color: 0xf2b705 }), new THREE.MeshStandardMaterial({ color: 0xf2b705 })]);
    body.position.y = 1.8;
    body.castShadow = true;
    const wheels = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 4.6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    wheels.position.y = 0.35;
    truck.add(body, wheels);
    truck.position.set(x, 0, z);
    g.game.scene.add(truck);
    const R = g.game.physics.RAPIER;
    const col = g.game.physics.world.createCollider(R.ColliderDesc.cuboid(1.2, 1.5, 3).setTranslation(x, 1.5, z), g.game.physics.fixedBody);
    const tree: DTree<G> = {
      d: {
        text: "Bienvenue à La Patate Volante ! Une bonne poutine pour réchauffer l'automne ?",
        choices: [
          { text: `« Une poutine, s'il vous plaît. » (${money(6.5)})`, next: (gg) => (gg.state.pay(6.5) ? "ok" : "non"), do: (gg) => gg.challenge(true) },
          { text: "« C'est quoi, une poutine ? »", next: "quoi" },
          { text: "Non merci.", next: null },
        ],
      },
      quoi: { text: "Des frites, du fromage en grains qui fait « couic-couic » et de la sauce brune. Le plat national du Québec !", next: "d" },
      ok: { text: "Et voilà ! Attention, la sauce est chaude.", do: (gg) => gg.state.give("poutine") },
      non: { text: "Oh, il te manque un peu de monnaie…" },
    };
    g.addInteractable({
      id: "camion",
      pos: () => new THREE.Vector3(x - 1.6, SIDEWALK_Y, z),
      radius: 3,
      label: () => (this.has("poutine") ? `<span class="key">E</span>Commander à La Patate Volante` : null),
      action: () => g.talkObject({ name: "La Patate Volante", role: "camion de cuisine de rue", color: "#f2b705" }, tree, "d"),
      marker: () => (this.has("poutine") ? { text: "🍟", cls: "talk", height: 3.2 } : null),
    });
    this.begin(
      {
        id: "poutine",
        name: "Camion de poutine",
        t: 0,
        dur: 160,
        pos: [x, z],
        tick: () => {},
        end: () => {
          g.game.scene.remove(truck);
          g.game.physics.world.removeCollider(col, true);
          g.interactions.remove("camion");
        },
      },
      "🍟 Camion de cuisine de rue",
      "La Patate Volante est stationnée rue Saint-Hubert, le long de la Place Émilie-Gamelin.",
    );
  }

  // ------------------------------------------------------------ feux d'artifice
  private startFireworks() {
    this.begin({ id: "artifice", name: "Feux d'artifice", t: 0, dur: 50, pos: null, tick: () => {
      this.fwTimer -= 1 / 60;
    }, end: () => {} }, "🎆 Feux d'artifice !", "Regarde vers le pont Jacques-Cartier, au sud.");
  }

  private updateFireworks(dt: number) {
    const on = this.has("artifice");
    if (on) {
      this.fwTimer -= dt;
      if (this.fwTimer <= 0) {
        this.fwTimer = 0.7 + Math.random() * 1.2;
        const center = new THREE.Vector3(this.g.player.position.x + (Math.random() - 0.5) * 500, 160 + Math.random() * 80, 1100);
        const col = new THREE.Color().setHSL(Math.random(), 0.9, 0.6);
        for (let i = 0; i < 70; i++) {
          const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(30 + Math.random() * 15);
          this.fwData.push({ pos: center.clone(), vel: v, life: 2.2, col });
        }
        const d = center.distanceTo(this.g.player.position);
        setTimeout(() => this.g.game.audio?.impact(8, Math.min(39, d / 40)), (d / 343) * 1000);
      }
    }
    const pos = this.fireworks.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.fireworks.geometry.attributes.color as THREE.BufferAttribute;
    this.fwData = this.fwData.filter((f) => (f.life -= dt) > 0).slice(-600);
    for (let i = 0; i < 600; i++) {
      const f = this.fwData[i];
      if (!f) {
        pos.setXYZ(i, 0, -999, 0);
        continue;
      }
      f.vel.y -= 9.8 * dt * 0.6;
      f.vel.multiplyScalar(1 - dt * 0.8);
      f.pos.addScaledVector(f.vel, dt);
      pos.setXYZ(i, f.pos.x, f.pos.y, f.pos.z);
      const k = Math.min(1, f.life);
      col.setXYZ(i, f.col.r * k, f.col.g * k, f.col.b * k);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  // ------------------------------------------------------------ pigeons
  private updatePigeons(dt: number) {
    const p = this.g.player.position;
    const running = this.g.player.actualSpeed > 3;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    this.pigeons.birds.forEach((b, i) => {
      if (b.flying > 0) {
        b.flying -= dt;
        b.vel.y -= dt * 2;
        b.pos.addScaledVector(b.vel, dt);
        if (b.flying <= 0) {
          b.pos.copy(b.home);
          b.vel.set(0, 0, 0);
        }
      } else {
        const d = b.pos.distanceTo(p);
        if (d < (running ? 7 : 2.2)) {
          b.flying = 6;
          const away = b.pos.clone().sub(p).setY(0).normalize();
          b.vel.set(away.x * 6 + (Math.random() - 0.5) * 3, 6 + Math.random() * 3, away.z * 6 + (Math.random() - 0.5) * 3);
        }
        b.peck -= dt;
        if (b.peck < 0) b.peck = 2 + Math.random() * 4;
      }
      const yaw = b.flying > 0 ? Math.atan2(b.vel.x, b.vel.z) : i * 1.7;
      q.setFromEuler(new THREE.Euler(b.flying > 0 ? -0.2 : b.peck < 0.3 ? 0.5 : 0, yaw, 0));
      const bob = b.flying > 0 ? Math.sin(this.g.time * 30 + i) * 0.05 : 0;
      m.compose(new THREE.Vector3(b.pos.x, b.pos.y + bob, b.pos.z), q, new THREE.Vector3(1, 1, 1));
      this.pigeons.mesh.setMatrixAt(i, m);
    });
    this.pigeons.mesh.instanceMatrix.needsUpdate = true;
  }
}

function spawnMartine(g: G) {
  if (g.npcs.has("martine")) return;
  const sc = g.game.city.streetById.get("stecath")!;
  const x = Math.max(-200, Math.min(150, g.player.position.x + 25));
  const zc = sc.a[1] + ((x - sc.a[0]) / (sc.b[0] - sc.a[0])) * (sc.b[1] - sc.a[1]);
  const z = zc - sc.w / 2 - 2.2;
  g.addNpc(
    {
      id: "martine",
      name: "Martine Roy",
      role: "infirmière, CHUM",
      color: "#e76f51",
      seed: 5150,
      look: { topStyle: "coat", top: "#457b9d", hairStyle: "long", hair: "#4a3020", bottomStyle: "pants", hat: "none" },
      at: () => ({ x, z, facing: 0 }),
      barks: ["Mon portefeuille… je l'ai perdu ! Quelqu'un l'a vu ?"],
    },
    {
      debut: {
        text: (gg) => (gg.state.has("portefeuille") ? "Oh ! Est-ce que c'est… mon portefeuille ? Brun, avec ma carte d'infirmière au CHUM ?" : "Je cherche mon portefeuille… Je l'ai échappé en marchant sur Sainte-Catherine."),
        choices: [
          { text: "Oui, je l'ai trouvé sur le trottoir. Le voici !", if: (gg) => gg.state.has("portefeuille"), next: "merci" },
          { text: "Je vais ouvrir l'œil.", next: null },
        ],
      },
      merci: {
        text: "Merci, merci ! Il reste encore des gens honnêtes en ville. Tenez, je tiens à vous donner une récompense.",
        do: (gg) => {
          gg.state.take("portefeuille");
          gg.state.flag("honnete");
          gg.quests.advance("portefeuille", "rendre");
        },
      },
      apres: { text: "Encore merci ! Vous avez sauvé ma journée." },
    },
    (gg) => (gg.quests.isDone("portefeuille") ? "apres" : "debut"),
    (gg) => (gg.quests.isActive("portefeuille") ? "turnin" : "talk"),
  );
}
