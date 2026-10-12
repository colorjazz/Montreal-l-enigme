import * as THREE from "three";
import cityJson from "./data/city.json";
import { Physics } from "./core/physics";
import { Input } from "./core/input";
import { AudioSys } from "./core/audio";
import { City, type CityData, SIDEWALK_Y } from "./world/city";
import { Environment } from "./world/environment";
import { worldUniforms } from "./world/materials";
import { StreetProps } from "./world/props";
import { Landmarks } from "./world/landmarks";
import { Skyline } from "./world/skyline";
import { Metro } from "./world/metro";
import { Dynamics } from "./world/dynamics";
import { Traffic } from "./world/traffic";
import { Player } from "./actors/player";
import { Pedestrians } from "./actors/npcs";
import { Gameplay } from "./gameplay/world";
import { Events } from "./gameplay/events";
import { installStory } from "./content/story";
import { pointInPoly, distToSegment } from "./world/geom";

export interface GameOptions {
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  onProgress?: (label: string, frac: number) => void;
  test?: boolean;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2600);
  readonly physics = new Physics();
  readonly input: Input;
  readonly audio = new AudioSys();
  env!: Environment;
  city!: City;
  props!: StreetProps;
  landmarks!: Landmarks;
  skyline!: Skyline;
  metro!: Metro;
  dynamics!: Dynamics;
  traffic!: Traffic;
  player!: Player;
  gameplay!: Gameplay;
  events!: Events;
  readonly timer = new THREE.Timer();
  frame = 0;
  fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  /** Caméra libre pilotée par l'API de test. */
  debugCamera = false;
  /** Pause (menu, journal) : la simulation s'arrête. */
  paused = false;
  readonly focus = new THREE.Vector3();
  private running = false;
  elapsed = 0;
  frameTimes: number[] = [];
  private dummyCam = new THREE.PerspectiveCamera();
  private mmTimer = 0;
  private majorStreets: { a: [number, number]; b: [number, number] }[] = [];
  /** Rappel quand la quête principale se termine (écran de fin). */
  onMainQuestDone: (() => void) | null = null;

  constructor(readonly opts: GameOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.name = "Montréal";
    this.input = new Input(opts.canvas);
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  async init() {
    const p = this.opts.onProgress ?? (() => {});
    p("Moteur physique", 0.05);
    await this.physics.init();
    await tick();
    p("Ciel et lumière", 0.1);
    this.env = new Environment(this.scene, this.renderer);
    await tick();
    p("Rues et bâtiments du Quartier latin", 0.18);
    this.city = new City(cityJson as unknown as CityData, this.physics);
    this.scene.add(this.city.group);
    this.majorStreets = this.city.data.streets.filter((s) => s.cat !== "minor").map((s) => ({ a: s.a, b: s.b }));
    await tick();
    p("Repères : métro, clocher, théâtre, bibliothèque", 0.34);
    this.landmarks = new Landmarks(this.city, this.physics);
    this.scene.add(this.landmarks.group);
    this.skyline = new Skyline();
    this.scene.add(this.skyline.group);
    await tick();
    p("Arbres, lampadaires et mobilier urbain", 0.44);
    this.props = new StreetProps(this.city, this.physics, this.landmarks.clearZones);
    this.scene.add(this.props.group);
    await tick();
    p("Station Berri-UQAM", 0.54);
    this.metro = new Metro(this.physics);
    this.scene.add(this.metro.group);
    this.dynamics = new Dynamics(this.physics);
    this.scene.add(this.dynamics.group);
    await tick();
    p("Circulation automobile", 0.62);
    this.traffic = new Traffic(this.city, this.physics, this.props);
    this.scene.add(this.traffic.group);
    await tick();
    p("Personnage", 0.7);
    const spawn = this.city.data.poi.spawn;
    this.player = new Player(this.physics, this.scene, new THREE.Vector3(spawn[0], SIDEWALK_Y, spawn[1]));
    this.player.teleport(new THREE.Vector3(spawn[0], SIDEWALK_Y + 0.05, spawn[1]), Math.PI * 0.5);
    this.player.surfaceAt = (x, z, y) => this.surfaceAt(x, z, y);
    this.player.onStep = (s) => this.audio.step(s, this.player.actualSpeed > 5);
    this.player.onLand = (v) => this.audio.land(v);
    await tick();
    p("Habitants du quartier", 0.8);
    this.gameplay = new Gameplay(this);
    this.gameplay.peds = new Pedestrians(this.physics, this.scene, this.city.data, 40, (x, z) => this.city.inPlayable(x, z, -8));
    installStory(this.gameplay);
    this.events = new Events(this.gameplay);
    if (this.opts.test) this.events.auto = false;
    this.gameplay.extraMarkers.push(() => this.events.markers());
    await tick();
    p("Derniers préparatifs", 0.92);
    this.wire();
    this.focus.copy(this.player.position);
    this.env.apply(this.focus);
    this.physics.world.step();
  }

  /** Branche les systèmes entre eux (sons, événements). */
  private wire() {
    const g = this.gameplay;
    this.metro.hasValidTicket = () => g.state.has("opus");
    this.metro.onGateRefused = () => g.toast("Tourniquet verrouillé", "Il te faut une carte OPUS (distributeur près de la loge).", "info");
    this.metro.onChime = () => this.metro.underground && this.audio.metroChime();
    this.metro.onRumble = (k) => this.audio.train(k);
    this.metro.onArrive = () => {
      if (this.metro.underground) g.toast("🚇 Ligne verte", "Le train en direction d'Honoré-Beaugrand entre en station.", "info");
    };
    this.traffic.onHonk = (pos) => this.audio.honk(pos.distanceTo(this.player.position));
    this.traffic.onHitPlayer = (dir, speed) => {
      this.player.knock(dir, Math.min(10, speed * 0.9));
      this.audio.honk(0);
      this.audio.impact(6, 0);
      g.toast("Ouch ! Attention aux voitures !", "Traverse aux passages piétons, sur le feu vert.", "info");
    };
    this.dynamics.onImpact = (pos, strength) => this.audio.impact(strength, pos.distanceTo(this.player.position));
    // écran de fin quand la quête principale se termine
    const prev = g.quests.onComplete;
    g.quests.onComplete = (q) => {
      prev?.(q);
      if (q.id === "enigme") setTimeout(() => this.onMainQuestDone?.(), 1500);
    };
  }

  /** Type de surface sous un point (pour le son des pas). */
  surfaceAt(x: number, z: number, y: number): "pavé" | "herbe" | "bois" | "métal" {
    if (y < -1) return "pavé";
    for (const pk of this.city.data.parks) if (pointInPoly(x, z, pk.poly)) return y > 0.2 ? "bois" : "herbe";
    if (y > 0.5) return "métal";
    return "pavé";
  }

  setQuality(q: "hi" | "lo") {
    const hi = q === "hi";
    this.renderer.shadowMap.enabled = hi;
    this.env.sun.castShadow = hi;
    this.renderer.setPixelRatio(hi ? Math.min(window.devicePixelRatio, 1.75) : Math.min(window.devicePixelRatio, 1) * 0.8);
    this.gameplay.peds.target = hi ? 34 : 18;
    this.traffic.target = hi ? 22 : 12;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer.connect(document);
    this.renderer.setAnimationLoop((t) => this.loop(t));
  }

  /** Distance libre entre la cible et la position voulue de la caméra (lancer de sphère). */
  castCamera = (from: THREE.Vector3, to: THREE.Vector3): number => {
    const R = this.physics.RAPIER;
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 0.01) return len;
    dir.divideScalar(len);
    const hit = this.physics.world.castShape(
      { x: from.x, y: from.y, z: from.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: dir.x, y: dir.y, z: dir.z },
      new R.Ball(0.25),
      0,
      len,
      true,
      R.QueryFilterFlags.EXCLUDE_DYNAMIC | R.QueryFilterFlags.EXCLUDE_SENSORS | R.QueryFilterFlags.EXCLUDE_KINEMATIC,
      undefined,
      this.player.collider,
    );
    return hit ? Math.max(0.6, hit.time_of_impact - 0.1) : len;
  };

  private trafficLevel(x: number, z: number) {
    let best = 1e9;
    for (const s of this.majorStreets) best = Math.min(best, distToSegment(x, z, s.a, s.b).d);
    return Math.max(0, 1 - best / 60);
  }

  /** Une image de simulation (aussi utilisée par les tests pour avancer le temps). */
  step(dt: number) {
    worldUniforms.uTime.value += dt;
    this.elapsed += dt;
    const g = this.gameplay;
    if (!this.paused) {
      this.player.readInput(this.input);
      const peds = () => [...g.peds.positions(), ...g.extraObstacles(), ...[...g.npcs.values()].filter((n) => n.visible).map((n) => n.pos)];
      this.physics.update(
        dt,
        (h) => {
          this.player.fixedUpdate(h);
          g.fixedUpdate(h);
          this.traffic.fixedUpdate(h, this.player.position, peds());
        },
        () => this.dynamics.afterStep(),
      );
      this.player.update(dt, this.physics.alpha, this.debugCamera ? this.dummyCam : this.camera, this.castCamera);
      this.dynamics.update(this.physics.alpha);
      this.traffic.update(dt, this.player.position, this.env.night);
      this.metro.update(dt, this.player.position);
      g.update(dt);
      this.events.update(dt);
      if (!this.debugCamera) this.focus.copy(this.player.position);
      this.env.update(dt, this.focus);
      this.applyUnderground();
      // musique de Jean-Guy (accordéon) près de la place
      const jg = g.npcs.get("jeanguy");
      if (jg) this.audio.streetMusic(this.events.has("violon") ? "violin" : "accordion", this.events.has("violon") ? 999 : jg.pos.distanceTo(this.player.position), dt);
      const pp = this.player.position;
      const inPark = this.city.data.parks.some((pk) => pointInPoly(pp.x, pp.z, pk.poly)) ? 1 : 0.15;
      this.audio.ambience(dt, { traffic: this.trafficLevel(pp.x, pp.z), park: inPark, rain: this.env.overcast, underground: this.metro.underground, night: this.env.night, wind: 0.5 + 0.5 * Math.sin(this.elapsed * 0.1) });
      // mini-carte (15 images/s)
      this.mmTimer -= dt;
      if (this.mmTimer <= 0) {
        this.mmTimer = 1 / 15;
        g.hud.drawMinimap(pp.x, pp.z, this.player.facing, this.player.camYaw, g.mapMarkers());
      }
    } else g.hud.update(dt);
    this.props.setNight(this.env.night);
    this.props.updateLod(this.camera.position);
    this.landmarks.update(worldUniforms.uTime.value, this.env.night);
    this.skyline.update(this.focus, this.env.night, this.env.overcast);
    this.input.endFrame();
  }

  /** Éclairage d'intérieur quand le joueur est dans le métro. */
  private applyUnderground() {
    const ug = this.metro.underground;
    if (!ug) return;
    this.env.sun.intensity = 0;
    this.env.hemi.intensity = 0.35;
    this.env.hemi.color.setRGB(1, 0.92, 0.82);
    this.env.hemi.groundColor.setRGB(0.3, 0.25, 0.2);
    this.env.fog.color.setRGB(0.08, 0.07, 0.06);
    this.env.fog.near = 40;
    this.env.fog.far = 180;
  }

  private loop(t: number) {
    this.timer.update(t);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.frame++;
    this.fpsAcc += dt;
    this.fpsFrames++;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 600) this.frameTimes.shift();
    if (this.fpsAcc > 1) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Rendu immédiat (tests, captures). */
  renderNow() {
    this.env.apply(this.focus);
    this.applyUnderground();
    this.props.setNight(this.env.night);
    this.props.updateLod(this.camera.position);
    this.landmarks.update(worldUniforms.uTime.value, this.env.night);
    this.skyline.update(this.focus, this.env.night, this.env.overcast);
    this.renderer.render(this.scene, this.camera);
  }
}

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}
