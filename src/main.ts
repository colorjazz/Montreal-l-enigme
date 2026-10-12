import "./style.css";
import * as THREE from "three";
import { Game } from "./game";
import { Screens } from "./ui/screens";
import { installTouch } from "./ui/touch";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;
const params = new URLSearchParams(location.search);
const test = params.has("test");

const loader = document.createElement("div");
loader.className = "loader";
loader.innerHTML = `<div class="loader-card"><div class="metro-logo"></div><h1>Montréal, l'énigme</h1><p class="loader-sub">Quartier latin · Station Berri-UQAM</p><div class="bar"><div class="fill"></div></div><p class="loader-label">Chargement…</p></div>`;
ui.appendChild(loader);
const fill = loader.querySelector(".fill") as HTMLElement;
const label = loader.querySelector(".loader-label") as HTMLElement;

const game = new Game({
  canvas,
  ui,
  test,
  onProgress: (l, f) => {
    label.textContent = l;
    fill.style.width = `${Math.round(f * 100)}%`;
  },
});
let screens: Screens | null = null;

// API de débogage et de vérification automatisée (tests/verify.mjs)
const w = window as unknown as Record<string, unknown>;
const api = {
  game,
  THREE,
  setCamera(x: number, y: number, z: number, tx: number, ty: number, tz: number) {
    game.debugCamera = true;
    game.camera.position.set(x, y, z);
    game.camera.lookAt(tx, ty, tz);
    game.focus.set(tx, 0, tz);
  },
  /** Revient à la caméra du joueur. */
  play() {
    game.debugCamera = false;
  },
  setHour(h: number) {
    game.env.hours = h;
    game.env.refreshEnv();
  },
  render() {
    game.renderNow();
  },
  /** Avance la simulation de n secondes (pas de 1/60 s) avec des touches maintenues. */
  simulate(seconds: number, keys: string[] = []) {
    for (const k of keys) game.input.hold(k);
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) game.step(1 / 60);
    for (const k of keys) game.input.release(k);
  },
  tap(code: string) {
    game.input.tap(code);
    game.step(1 / 60);
  },
  player() {
    const p = game.player;
    return { x: p.position.x, y: p.position.y, z: p.position.z, grounded: p.grounded, state: p.state, facing: p.facing, speed: p.actualSpeed, jumps: p.jumps };
  },
  teleport(x: number, y: number, z: number, facing?: number) {
    game.player.teleport(new THREE.Vector3(x, y, z), facing);
    game.step(1 / 60);
  },
  /** Fait face à un point. */
  face(x: number, z: number) {
    const p = game.player.position;
    game.player.facing = Math.atan2(x - p.x, z - p.z);
    game.player.camYaw = game.player.facing + Math.PI;
  },
  stats() {
    const info = game.renderer.info;
    return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, fps: game.fps };
  },
  world() {
    const g = game.gameplay;
    return {
      buildings: game.city.buildingCount,
      colliders: game.physics.world.colliders.len(),
      bodies: game.physics.world.bodies.len(),
      npcs: g.npcs.size,
      pedsActive: g.peds.activeCount(),
      pedsPool: g.peds.peds.length,
      cars: game.traffic.activeCount(),
      lanes: game.traffic.lanes.length,
      trafficStats: game.traffic.stats,
      quests: g.quests.defs.size,
      interactables: g.interactions.list.length,
      dynamics: game.dynamics.items.length,
      props: game.props.stats,
      landmarks: game.landmarks.info.map((i) => i.name),
      streets: game.city.data.streets.filter((s) => s.name).map((s) => s.name),
      metroUnderground: game.metro.underground,
      trainArrivals: game.metro.arrivals,
      trainStatus: game.metro.trainStatus,
      hour: game.env.hours,
      money: g.state.money,
      inventory: [...g.state.inv],
      events: game.events.active.map((e) => e.id),
      eventLog: game.events.log,
      audioPlayed: game.audio.played,
      readiness: g.readiness,
    };
  },
  quest(id: string) {
    const q = game.gameplay.quests;
    return { status: q.status(id), step: q.stepId(id), text: q.stepText(id) };
  },
  /** Parle au PNJ (téléporte le joueur à côté). */
  talk(id: string) {
    const n = game.gameplay.npc(id);
    game.player.teleport(new THREE.Vector3(n.pos.x + 1.2, n.pos.y + 0.02, n.pos.z + 0.6));
    game.step(1 / 60);
    game.gameplay.talk(id);
    game.step(1 / 60);
    return api.dialogue();
  },
  /** État du dialogue ouvert : texte et choix. */
  dialogue() {
    const d = ui.querySelector(".dialogue") as HTMLElement | null;
    if (!d || d.style.display === "none") return null;
    game.gameplay.hud.update(10);
    return {
      who: (d.querySelector(".who")?.textContent ?? "").trim(),
      text: (d.querySelector(".text")?.textContent ?? "").trim(),
      choices: [...d.querySelectorAll("button")].map((b) => (b.textContent ?? "").replace(/^\d/, "").trim()),
      node: game.gameplay.dialogue.currentId,
    };
  },
  choose(i: number) {
    game.gameplay.hud.update(10);
    game.gameplay.hud.choose(i);
    game.step(1 / 60);
    return api.dialogue();
  },
  next() {
    game.gameplay.hud.update(10);
    game.gameplay.hud.advance();
    game.step(1 / 60);
    return api.dialogue();
  },
  closeDialogue() {
    game.gameplay.dialogue.close();
  },
  trigger(id?: string) {
    return game.events.trigger(id);
  },
  give(item: string, n = 1) {
    game.gameplay.state.give(item, n);
  },
  earn(n: number) {
    game.gameplay.state.earn(n);
  },
  interact() {
    game.input.tap("KeyE");
    game.step(1 / 60);
    return api.dialogue();
  },
  prompt() {
    const el = ui.querySelector(".hud-prompt") as HTMLElement | null;
    return el && el.style.display !== "none" ? el.textContent : null;
  },
  coneCount() {
    let n = 0;
    const g = game.gameplay;
    const step = g.quests.stepText("cones");
    const m = step.match(/(\d+) \/ 6/);
    if (m) n = Number(m[1]);
    return n;
  },
  hud() {
    return {
      location: (ui.querySelector(".hud-loc")?.textContent ?? "").trim(),
      sub: (ui.querySelector(".hud-sub")?.textContent ?? "").trim(),
      tracker: (ui.querySelector(".hud-tracker")?.textContent ?? "").trim(),
      toasts: [...ui.querySelectorAll(".toast")].map((t) => (t.textContent ?? "").trim()),
    };
  },
  frameStats() {
    const ft = game.frameTimes.slice(-300);
    const avg = ft.reduce((a, b) => a + b, 0) / Math.max(1, ft.length);
    return { frames: game.frame, avgMs: avg * 1000, fps: game.fps };
  },
};
w.__ville = api;

game
  .init()
  .then(() => {
    loader.remove();
    screens = new Screens(game, game.gameplay);
    game.onMainQuestDone = () => screens?.ending();
    installTouch(game, ui);
    game.start();
    canvas.addEventListener("click", () => {
      game.audio.start();
      if (!screens?.open && !game.gameplay.dialogue.open) game.input.requestLock();
    });
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.code === "Escape") {
        if (game.gameplay.dialogue.open) return;
        screens?.togglePause();
      } else if (e.code === "KeyJ" && !game.gameplay.dialogue.open && !game.gameplay.hud.isScreenOpen("pause")) screens?.journal();
      else if (e.code === "KeyM" && !game.gameplay.dialogue.open && !game.gameplay.hud.isScreenOpen("pause")) screens?.map();
      else if (e.code === "KeyN") {
        const m = game.audio.toggleMute();
        game.gameplay.toast(m ? "Son coupé" : "Son activé", "", "info");
      }
    });
    if (!test) {
      screens.intro(() => {
        game.audio.start();
        game.input.requestLock();
        game.gameplay.toast("Bienvenue au Quartier latin !", "La professeure Gagnon (<b style='color:#e8b923'>!</b>) t'attend juste à côté.", "quest");
      });
    }
    w.__villeReady = true;
  })
  .catch((err) => {
    console.error(err);
    label.textContent = `Erreur : ${(err as Error).message}`;
    w.__villeError = String(err);
  });
