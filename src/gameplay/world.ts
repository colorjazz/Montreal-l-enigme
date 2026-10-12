import * as THREE from "three";
import type { Game } from "../game";
import { Hud, esc, type MapMarker } from "../ui/hud";
import { GameState, ITEMS, money } from "./state";
import { QuestManager, type QuestDef } from "./quests";
import { DialogueRunner, type DTree, type Speaker } from "./dialogue";
import { Interactions, type Interactable } from "./interact";
import { NamedNpc, Pedestrians, PED_LINES, type NamedNpcSpec } from "../actors/npcs";
import { Dog } from "../actors/dog";
import { SIDEWALK_Y } from "../world/city";
import type { V2 } from "../world/geom";
import { Rng } from "../core/rng";

/** Objet à ramasser (billet, dépliant, portefeuille...). */
export interface Collectible {
  id: string;
  item: string;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  active: boolean;
  onPick?: () => void;
}

export interface Place {
  name: string;
  pos: V2;
}

/**
 * Couche de jeu : PNJ, quêtes, dialogues, interactions, objets, interface.
 * Le contenu (textes, quêtes) vit dans src/content/.
 */
export class Gameplay {
  readonly state = new GameState();
  readonly hud: Hud;
  readonly interactions = new Interactions();
  readonly dialogue: DialogueRunner<Gameplay>;
  quests!: QuestManager<Gameplay>;
  readonly npcs = new Map<string, NamedNpc>();
  readonly trees = new Map<string, { tree: DTree<Gameplay>; start: (g: Gameplay) => string }>();
  peds!: Pedestrians;
  dog: Dog | null = null;
  readonly collectibles: Collectible[] = [];
  readonly places = new Map<string, Place>();
  readonly rng = new Rng(Date.now() & 0xffff);
  /** Défis de français réussis / tentés (pour la future couche pédagogique). */
  readiness = { right: 0, tried: 0 };
  private barkCooldown = 0;
  /** Escorte en cours : le PNJ suit le joueur. */
  escort: { npc: NamedNpc; target: V2; radius: number; onArrive: () => void } | null = null;
  time = 0;
  /** Systèmes de contenu qui ont besoin de la boucle (événements, cônes...). */
  readonly tickers: ((dt: number) => void)[] = [];
  readonly extraMarkers: (() => MapMarker[])[] = [];
  /** Obstacles supplémentaires pour la circulation (manifestants...). */
  extraObstacles: () => THREE.Vector3[] = () => [];
  private collectMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd166, emissiveIntensity: 0.4, roughness: 0.5 });

  constructor(readonly game: Game) {
    const city = game.city;
    this.hud = new Hud(game.opts.ui, city.data, city.footprints, (x, z) => city.inPlayable(x, z));
    this.dialogue = new DialogueRunner<Gameplay>(this.hud, () => this as Gameplay);
    for (const l of game.landmarks.info) this.places.set(l.id, { name: l.name, pos: l.pos });
    this.state.onItem = (id, d) => {
      const it = ITEMS[id];
      if (!it) return;
      if (d > 0) this.hud.toast(`${it.icon} ${it.name}`, "ajouté à ton sac", "info", 3);
    };
  }

  // ------------------------------------------------------------ utilitaires pour le contenu
  place(id: string): V2 {
    const p = this.places.get(id);
    if (!p) throw new Error(`lieu inconnu : ${id}`);
    return p.pos;
  }

  npc(id: string): NamedNpc {
    const n = this.npcs.get(id);
    if (!n) throw new Error(`PNJ inconnu : ${id}`);
    return n;
  }

  get player() {
    return this.game.player;
  }

  playerDist(p: V2): number {
    return Math.hypot(this.player.position.x - p[0], this.player.position.z - p[1]);
  }

  toast(title: string, body = "", kind: "quest" | "done" | "event" | "info" = "info") {
    this.hud.toast(title, body, kind);
  }

  /** Réponse à un défi de langue (compte pour la future couche pédagogique). */
  challenge(ok: boolean) {
    this.readiness.tried++;
    if (ok) this.readiness.right++;
    this.game.audio?.ui(ok ? "good" : "bad");
  }

  say(npcId: string, text: string, seconds = 3.5) {
    const n = this.npcs.get(npcId);
    if (n) this.hud.say(() => n.headPos(), text, seconds);
  }

  // ------------------------------------------------------------ installation
  addNpc(spec: NamedNpcSpec, tree: DTree<Gameplay>, start: (g: Gameplay) => string, marker?: (g: Gameplay) => "quest" | "turnin" | "talk" | null) {
    const npc = new NamedNpc(spec, this.game.physics, this.game.scene);
    this.npcs.set(spec.id, npc);
    this.trees.set(spec.id, { tree, start });
    this.interactions.add({
      id: `npc:${spec.id}`,
      pos: () => npc.pos,
      radius: 2.8,
      label: () => (npc.visible && !this.dialogue.open ? `<span class="key">E</span>Parler à ${esc(spec.name)}` : null),
      action: () => this.talk(spec.id),
      marker: () => {
        if (!npc.visible) return null;
        const k = marker?.(this) ?? "talk";
        if (!k) return null;
        return { text: k === "quest" ? "!" : k === "turnin" ? "?" : "…", cls: k === "talk" ? "talk" : k, height: 0 };
      },
      priority: 0.5,
    });
    return npc;
  }

  talk(id: string) {
    const npc = this.npc(id);
    const t = this.trees.get(id)!;
    npc.talking = true;
    npc.lookAt(this.player.position);
    this.player.frozen = true;
    this.state.stats.talks++;
    this.game.audio?.ui("open");
    this.dialogue.start({ name: npc.spec.name, role: npc.spec.role, color: npc.spec.color }, t.tree, t.start(this), () => {
      npc.talking = false;
      npc.lookAt(null);
      this.player.frozen = false;
    });
  }

  /** Dialogue avec un objet ou un lieu (plaque, distributeur...). */
  talkObject(speaker: Speaker, tree: DTree<Gameplay>, start: string) {
    this.player.frozen = true;
    this.game.audio?.ui("open");
    this.dialogue.start(speaker, tree, start, () => (this.player.frozen = false));
  }

  addInteractable(i: Interactable) {
    return this.interactions.add(i);
  }

  addCollectible(id: string, item: string, x: number, z: number, y = SIDEWALK_Y, onPick?: () => void, kind: "paper" | "wallet" | "ticket" = "paper"): Collectible {
    const g = new THREE.Group();
    let mesh: THREE.Mesh;
    if (kind === "wallet") mesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.12), new THREE.MeshStandardMaterial({ color: 0x6b4226 }));
    else mesh = new THREE.Mesh(new THREE.BoxGeometry(kind === "ticket" ? 0.18 : 0.24, 0.01, kind === "ticket" ? 0.08 : 0.32), this.collectMat);
    mesh.castShadow = true;
    g.add(mesh);
    // halo pour le repérer
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.7, depthWrite: false }));
    glow.position.y = 0.02;
    g.add(glow);
    g.position.set(x, y + 0.05, z);
    this.game.scene.add(g);
    const c: Collectible = { id, item, mesh: g, pos: g.position, active: true, onPick };
    this.collectibles.push(c);
    this.interactions.add({
      id: `col:${id}`,
      pos: () => c.pos,
      radius: 2.0,
      label: () => (c.active ? `<span class="key">E</span>Ramasser : ${esc(ITEMS[item]?.name ?? item)}` : null),
      action: () => this.pick(c),
      priority: 1,
    });
    return c;
  }

  pick(c: Collectible) {
    if (!c.active) return;
    c.active = false;
    c.mesh.visible = false;
    this.state.give(c.item);
    this.game.audio?.ui("pickup");
    c.onPick?.();
  }

  startQuests(defs: QuestDef<Gameplay>[]) {
    this.quests = new QuestManager<Gameplay>(defs, () => this as Gameplay);
    this.quests.onStart = (q) => {
      this.hud.toast(q.main ? `Quête principale : ${q.title}` : `Nouvelle quête : ${q.title}`, this.quests.stepText(q.id), "quest", 6);
      this.game.audio?.ui("quest");
    };
    this.quests.onStep = (q) => {
      this.hud.toast(q.title, `▸ ${this.quests.stepText(q.id)}`, "quest", 5);
      this.game.audio?.ui("step");
    };
    this.quests.onComplete = (q) => {
      const r = q.reward;
      if (r?.money) this.state.earn(r.money);
      if (r?.item) this.state.give(r.item);
      this.state.stats.questsDone++;
      this.hud.toast(`Quête terminée : ${q.title}`, [r?.money ? `+${money(r.money)}` : "", r?.text ?? ""].filter(Boolean).join(" · "), "done", 6);
      this.game.audio?.ui("complete");
    };
  }

  // ------------------------------------------------------------ boucle
  fixedUpdate(h: number) {
    for (const n of this.npcs.values()) n.fixedUpdate(h);
    this.peds.fixedUpdate(h, this.player.position);
  }

  update(dt: number) {
    this.time += dt;
    const input = this.game.input;
    const p = this.player;
    // escorte
    if (this.escort) {
      const e = this.escort;
      const behind = p.forward(-1.6);
      const d = e.npc.pos.distanceTo(p.position);
      e.npc.goal = d > 2.2 ? new THREE.Vector3(behind.x, p.position.y, behind.z) : null;
      e.npc.goalSpeed = Math.min(7.5, Math.max(1.5, d * 1.3));
      if (Math.hypot(e.npc.pos.x - e.target[0], e.npc.pos.z - e.target[1]) < e.radius) {
        e.npc.goal = null;
        this.escort = null;
        e.onArrive();
      }
    }
    for (const n of this.npcs.values()) n.update(dt);
    this.peds.update(dt, p.position, this.game.camera);
    for (const t of this.tickers) t(dt);
    if (this.dog) this.dog.update(dt, p.position, p.actualSpeed);
    this.quests.update(dt);
    // objets à ramasser : flottent et tournent
    for (const c of this.collectibles) {
      if (!c.active) continue;
      c.mesh.children[0].rotation.y += dt * 1.5;
      c.mesh.children[0].position.y = 0.12 + Math.sin(this.time * 3) * 0.05;
    }

    // ---- entrées de dialogue
    if (this.dialogue.open) {
      if (input.consume("Space") || input.consume("KeyE") || input.consume("Enter")) this.hud.advance();
      for (let i = 0; i < 6; i++) if (input.consume(`Digit${i + 1}`) || input.consume(`Numpad${i + 1}`)) this.hud.choose(i);
      if (input.consume("ArrowDown")) this.hud.moveSelection(1);
      if (input.consume("ArrowUp")) this.hud.moveSelection(-1);
      if (input.consume("Escape")) this.dialogue.close();
      this.hud.prompt(null);
    } else {
      const it = this.interactions.update(p.position, p.facing);
      // piétons : on peut leur parler aussi
      const ped = !it ? this.peds.nearest(p.position.x, p.position.z, 2.2) : null;
      if (it) this.hud.prompt(it.label());
      else if (ped) this.hud.prompt(`<span class="key">E</span>Saluer le passant`);
      else this.hud.prompt(null);
      if (input.wasPressed("KeyE")) {
        if (it) it.action();
        else if (ped) {
          this.peds.talkTo(ped);
          this.hud.say(() => this.peds.headPos(ped), this.rng.pick(PED_LINES), 3.5);
          this.state.stats.talks++;
        }
      }
    }
    this.hud.update(dt);

    // ---- répliques spontanées des PNJ à proximité
    this.barkCooldown -= dt;
    if (this.barkCooldown <= 0) {
      for (const n of this.npcs.values()) {
        if (!n.visible || n.talking || !n.spec.barks?.length) continue;
        const d = n.pos.distanceTo(p.position);
        if (d < 9 && this.time - n.lastBark > 25) {
          n.lastBark = this.time;
          this.hud.say(() => n.headPos(), this.rng.pick(n.spec.barks), 3.5);
          this.barkCooldown = 4;
          break;
        }
      }
    }

    // ---- marqueurs 3D
    const markers: { pos: THREE.Vector3; text: string; cls: string }[] = [];
    for (const it of this.interactions.list) {
      const m = it.marker?.();
      if (!m) continue;
      const pos = it.pos();
      if (pos.distanceTo(p.position) > 60) continue;
      const npcId = it.id.startsWith("npc:") ? it.id.slice(4) : null;
      const top = npcId ? this.npc(npcId).headPos().add(new THREE.Vector3(0, 0.45, 0)) : pos.clone().add(new THREE.Vector3(0, m.height || 1.6, 0));
      markers.push({ pos: top, text: m.text, cls: m.cls });
    }
    // cible de la quête suivie
    const tq = this.quests.tracked;
    let dist: number | null = null;
    const step = tq ? this.quests.currentStep(tq) : null;
    const target = step?.target?.(this) ?? null;
    if (target) {
      dist = this.playerDist(target);
      if (dist > 6) markers.push({ pos: new THREE.Vector3(target[0], SIDEWALK_Y + 4, target[1]), text: `◆ ${Math.round(dist)} m`, cls: "target" });
    }
    this.hud.updateOverlay(this.game.camera, markers);
    const def = tq ? this.quests.defs.get(tq) : null;
    this.hud.setTracker(def ? def.title : null, tq ? this.quests.stepText(tq) : "", dist, !!def?.main);

    // ---- bandeau du haut
    const ns = this.game.city.nearestStreet(p.position.x, p.position.z);
    const lm = this.game.landmarks.nearest(p.position.x, p.position.z, 30);
    const underground = p.position.y < -2;
    const loc = underground ? "Station Berri-UQAM (sous terre)" : lm ? lm.name : "Quartier latin, Montréal";
    const env = this.game.env;
    const weather = env.overcast > 0.3 ? "🌧️ 9 °C, averses" : env.isNight ? "🌙 7 °C, nuit claire" : "🍁 12 °C, ensoleillé";
    this.hud.setInfo(loc, underground ? null : ns && ns.d < 25 ? ns.street.name : null, env.clockText(), weather, this.state.money);
  }

  /** Marqueurs pour la mini-carte et la grande carte. */
  mapMarkers(): MapMarker[] {
    const out: MapMarker[] = [];
    for (const [id, n] of this.npcs) {
      if (!n.visible) continue;
      const it = this.interactions.get(`npc:${id}`);
      const m = it?.marker?.();
      if (m && (m.cls === "quest" || m.cls === "turnin")) out.push({ x: n.pos.x, z: n.pos.z, kind: m.cls === "quest" ? "quest" : "turnin", label: n.spec.name });
    }
    for (const q of this.quests.active()) {
      const s = this.quests.currentStep(q.id);
      const t = s?.target?.(this);
      if (t) out.push({ x: t[0], z: t[1], kind: "target", label: q.title });
    }
    for (const f of this.extraMarkers) out.push(...f());
    // piétons proches (points blancs)
    for (const pp of this.peds.positions()) {
      if (pp.distanceTo(this.player.position) < 70) out.push({ x: pp.x, z: pp.z, kind: "npc" });
    }
    return out;
  }
}
