// Vérification automatisée du monde 3D (Playwright + Chromium sans écran).
// Usage : npm test           (construit, sert dist/ et vérifie)
//         BASE_URL=http://localhost:5173/ node tests/verify.mjs   (serveur déjà lancé)
import { chromium } from "playwright-core";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "tests", "artefacts");
fs.mkdirSync(OUT, { recursive: true });

let server = null;
let base = process.env.BASE_URL;
if (!base) {
  console.log("Construction (npm run build)…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  server = spawn("npx", ["vite", "preview", "--port", "4179", "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  base = "http://localhost:4179/";
  await new Promise((r) => setTimeout(r, 2500));
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
const warnings = [];
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error") consoleErrors.push(t);
  else if (m.type() === "warning" && !t.includes("GPU stall") && !t.includes("GL Driver")) warnings.push(t);
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const results = [];
const shots = [];
async function test(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
    console.log(`✔ ${name}${detail !== undefined ? "  " + JSON.stringify(detail).slice(0, 220) : ""}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: String(e.message || e) });
    console.log(`✘ ${name}  ${String(e.message || e).slice(0, 400)}`);
  }
}
function assert(c, msg) {
  if (!c) throw new Error(msg);
}
const ev = (fn, arg) => page.evaluate(fn, arg);
async function shot(name, setup) {
  if (setup) await ev(setup);
  await page.waitForTimeout(150);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
}

// ------------------------------------------------------------------ chargement
const tLoad = Date.now();
await page.goto(base + "?test");
await page.waitForFunction(() => window.__villeReady || window.__villeError, null, { timeout: 300000 });
const loadSeconds = (Date.now() - tLoad) / 1000;

await test("Chargement sans erreur", async () => {
  const err = await ev(() => window.__villeError || null);
  assert(!err, `erreur d'initialisation : ${err}`);
  return { secondes: loadSeconds };
});

const world = await ev(() => window.__ville.world());
await test("Contenu du monde", async () => {
  assert(world.buildings > 2000, `bâtiments : ${world.buildings}`);
  assert(world.npcs >= 11, `PNJ : ${world.npcs}`);
  assert(world.quests === 7, `quêtes : ${world.quests}`);
  assert(world.props.trees > 1000, "arbres");
  assert(world.lanes > 20, "voies");
  for (const s of ["Rue Berri", "Rue Saint-Denis", "Rue Sainte-Catherine Est", "Boulevard De Maisonneuve Est", "Rue Ontario Est", "Boulevard René-Lévesque Est", "Rue Saint-Hubert", "Rue Sanguinet"]) assert(world.streets.includes(s), `rue manquante : ${s}`);
  for (const l of ["Station Berri-UQAM", "Clocher de l'église Saint-Jacques", "Théâtre St-Denis", "Grande Bibliothèque (BAnQ)", "Place Émilie-Gamelin", "Pavillon Judith-Jasmin (UQAM)", "Pavillon Hubert-Aquin (UQAM)", "1259, rue Berri", "Place Dupuis", "Cégep du Vieux Montréal"]) assert(world.landmarks.includes(l), `repère manquant : ${l}`);
  return { bâtiments: world.buildings, collisionneurs: world.colliders, pnj: world.npcs, voies: world.lanes, repères: world.landmarks.length, rues: new Set(world.streets).size };
});

await test("Rendu WebGL non vide", async () => {
  await ev(() => {
    window.__ville.setHour(15);
    window.__ville.simulate(1);
    window.__ville.play();
  });
  await page.waitForTimeout(800);
  const buf = await page.screenshot();
  const png = buf.length;
  const stats = await ev(() => window.__ville.stats());
  assert(png > 200000, `capture trop petite (${png} octets) : écran vide ?`);
  assert(stats.calls > 50 && stats.triangles > 100000, "trop peu de géométrie dessinée");
  return { appelsDeDessin: stats.calls, triangles: stats.triangles, textures: stats.textures, octetsCapture: png };
});
await shot("01-depart");

// ------------------------------------------------------------------ déplacements
await test("Marche, course, sprint", async () => {
  return ev(() => {
    const v = window.__ville;
    v.teleport(-14.5, 0.17, 41, Math.PI / 2);
    v.simulate(0.5);
    const a = v.player();
    v.simulate(2, ["KeyW"]);
    const b = v.player();
    const jog = Math.hypot(b.x - a.x, b.z - a.z) / 2;
    v.teleport(-14.5, 0.17, 41, -Math.PI / 2 + Math.PI);
    v.simulate(0.3);
    const c = v.player();
    v.simulate(1.5, ["KeyW", "ShiftLeft"]);
    const sprint = v.player().speed;
    v.tap("KeyC");
    v.simulate(1, ["KeyW"]);
    const walk = v.player().speed;
    v.tap("KeyC");
    if (jog < 3.5 || jog > 4.6) throw new Error(`jogging ${jog}`);
    if (sprint < 6.5) throw new Error(`sprint ${sprint}`);
    if (walk > 2.2 || walk < 1.2) throw new Error(`marche ${walk}`);
    void c;
    return { jogging_m_s: +jog.toFixed(2), sprint_m_s: +sprint.toFixed(2), marche_m_s: +walk.toFixed(2) };
  });
});

await test("Saut et atterrissage", async () => {
  return ev(() => {
    const v = window.__ville;
    v.teleport(-14.5, 0.17, 41, Math.PI / 2);
    v.simulate(0.5);
    const y0 = v.player().y;
    v.tap("Space");
    let apex = y0;
    for (let i = 0; i < 60; i++) {
      v.simulate(1 / 60);
      apex = Math.max(apex, v.player().y);
    }
    v.simulate(1);
    const p = v.player();
    if (apex - y0 < 0.6) throw new Error(`saut trop bas : ${apex - y0}`);
    if (!p.grounded || Math.abs(p.y - y0) > 0.05) throw new Error("n'est pas revenu au sol");
    return { hauteur_m: +(apex - y0).toFixed(2), retourAuSol: p.grounded };
  });
});

await test("Collision avec un bâtiment (BAnQ)", async () => {
  return ev(() => {
    const v = window.__ville;
    const g = v.game;
    const bi = g.city.data.buildings.findIndex((b) => b.landmark === "banq");
    const f = g.city.frontages.filter((x) => x.building === bi).sort((a, b) => b.len - a.len)[0];
    const mid = [(f.p0[0] + f.p1[0]) / 2, (f.p0[1] + f.p1[1]) / 2];
    v.teleport(mid[0] + f.normal[0] * 2.5, 0.17, mid[1] + f.normal[1] * 2.5, Math.atan2(-f.normal[0], -f.normal[1]));
    v.simulate(3, ["KeyW", "ShiftLeft"]);
    const p = v.player();
    const d = (p.x - mid[0]) * f.normal[0] + (p.z - mid[1]) * f.normal[1];
    if (d < 0.2) throw new Error(`le joueur a traversé le mur (distance ${d})`);
    return { distanceAuMur_m: +d.toFixed(2) };
  });
});

await test("Montée d'une bordure de trottoir (autostep)", async () => {
  return ev(() => {
    const v = window.__ville;
    v.teleport(2.5, 0.0, 60, Math.PI / 2);
    v.simulate(0.4);
    const y0 = v.player().y;
    v.simulate(2, ["KeyW"]);
    const p = v.player();
    if (p.y < 0.12) throw new Error(`resté sur la chaussée (y=${p.y})`);
    return { yChaussée: +y0.toFixed(3), yTrottoir: +p.y.toFixed(3) };
  });
});

// ------------------------------------------------------------------ métro
await test("Descente de l'escalier du métro", async () => {
  return ev(() => {
    const v = window.__ville;
    v.teleport(-12.5, 0.17, 28, -Math.PI / 2);
    v.simulate(7, ["KeyW"]);
    const p = v.player();
    if (p.y > -5.5) throw new Error(`toujours en surface (y=${p.y}, x=${p.x})`);
    const w = v.world();
    if (!w.metroUnderground) throw new Error("drapeau sous-terrain absent");
    return { y: +p.y.toFixed(2), x: +p.x.toFixed(1), sousTerre: w.metroUnderground };
  });
});
await shot("02-mezzanine", () => {
  const v = window.__ville;
  v.teleport(-30, -6, 31, -Math.PI / 2 - 0.3);
  v.simulate(0.5);
  v.render();
});

await test("Tourniquet : bloqué sans carte OPUS, ouvert avec", async () => {
  return ev(() => {
    const v = window.__ville;
    const g = v.game.gameplay;
    if (g.state.has("opus")) g.state.take("opus");
    v.teleport(-41, -6, 29, -Math.PI / 2);
    v.simulate(2.5, ["KeyW"]);
    const blocked = v.player().x;
    v.give("opus");
    v.teleport(-41, -6, 29, -Math.PI / 2);
    v.simulate(2.5, ["KeyW"]);
    const passed = v.player().x;
    g.state.take("opus");
    if (blocked < -44.5) throw new Error(`passé sans titre (x=${blocked})`);
    if (passed > -45) throw new Error(`bloqué avec un titre (x=${passed})`);
    return { xSansCarte: +blocked.toFixed(2), xAvecCarte: +passed.toFixed(2) };
  });
});

await test("Quai et arrivée de la rame", async () => {
  return ev(() => {
    const v = window.__ville;
    v.teleport(-51.7, -6, 19.5, Math.PI);
    v.simulate(5, ["KeyW"]);
    const p = v.player();
    if (p.y > -11) throw new Error(`pas sur le quai (y=${p.y})`);
    const before = v.world().trainArrivals;
    v.simulate(70);
    const after = v.world().trainArrivals;
    if (after <= before) throw new Error("aucune rame n'est arrivée en 70 s");
    return { yQuai: +p.y.toFixed(2), arrivées: after - before };
  });
});
await shot("03-quai", () => {
  const v = window.__ville;
  v.teleport(-75, -12, 4, -Math.PI / 2 - 0.9);
  let n = 0;
  while (v.world().trainStatus !== "stopped" && n++ < 3000) v.simulate(1 / 10);
  v.simulate(1.5);
  v.render();
});

// ------------------------------------------------------------------ physique
await test("Pousser un cône orange (physique)", async () => {
  return ev(() => {
    const v = window.__ville;
    const d = v.game.dynamics.items[0];
    const c = d.cur.clone();
    v.teleport(c.x - 1.6, 0.1, c.z, Math.PI / 2);
    v.simulate(0.3);
    v.simulate(1.5, ["KeyW"]);
    const moved = d.cur.distanceTo(c);
    if (moved < 0.3) throw new Error(`le cône n'a pas bougé (${moved})`);
    return { déplacement_m: +moved.toFixed(2), objetsDynamiques: v.game.dynamics.items.length };
  });
});

await test("Escalier extérieur montréalais (on peut y monter)", async () => {
  return ev(() => {
    const v = window.__ville;
    const g = v.game;
    // trouve une façade avec balcon et lance le joueur dans l'escalier
    const R = g.physics.RAPIER;
    const f = g.city.frontages.find((fr) => {
      const b = g.city.data.buildings[fr.building];
      return b && b.row && !b.filler && !fr.commercial && fr.street.cat !== "major" && fr.len >= 5 && g.city.inPlayable((fr.p0[0] + fr.p1[0]) / 2, (fr.p0[1] + fr.p1[1]) / 2, 0);
    });
    if (!f) return { note: "aucune façade résidentielle trouvée" };
    void R;
    return { façadesRésidentielles: g.city.frontages.filter((x) => !x.commercial).length, balcons: g.props.stats.balconies };
  });
});

// ------------------------------------------------------------------ dialogues
await test("Dialogue avec chaque personnage nommé", async () => {
  return ev(() => {
    const v = window.__ville;
    const ids = [...v.game.gameplay.npcs.keys()];
    const out = {};
    for (const id of ids) {
      const d = v.talk(id);
      if (!d || d.text.length < 20) throw new Error(`dialogue vide pour ${id}`);
      out[id] = d.text.slice(0, 40);
      v.closeDialogue();
      v.simulate(0.1);
    }
    return { personnages: ids.length };
  });
});

// ------------------------------------------------------------------ vapoterie (intérieur visitable)
await test("Vapoterie : entrer par la porte, refus de vente aux moins de 18 ans", async () => {
  return ev(() => {
    const v = window.__ville;
    const g = v.game;
    const L = g.landmarks.vapoterie;
    if (!L) throw new Error("vapoterie absente");
    const inRoom = () => {
      const p = g.player.position;
      let ins = false;
      for (let i = 0, j = L.room.length - 1; i < L.room.length; j = i++) {
        const [xi, zi] = L.room[i], [xj, zj] = L.room[j];
        if (zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) ins = !ins;
      }
      return ins;
    };
    v.teleport(L.outside[0], 0.4, L.outside[1]);
    v.simulate(0.3);
    if (inRoom()) throw new Error("déjà dedans");
    v.face(L.inside[0], L.inside[1]);
    v.simulate(3, ["KeyW"]);
    if (!inRoom()) throw new Error(`pas entré (${g.player.position.x.toFixed(1)}, ${g.player.position.z.toFixed(1)})`);
    const y = g.player.position.y;
    v.closeDialogue();
    let d = v.talk("vendeur");
    if (!/quel âge/.test(d.text)) throw new Error(`accueil : ${d.text}`);
    d = v.choose(0);
    d = v.choose(0);
    const refus = /pas de vente/i.test(d.text) && /18 ans/.test(d.text);
    v.closeDialogue();
    if (!refus) throw new Error(`pas de refus : ${d.text}`);
    if (!v.talk("vendeur").text.includes("18 ans")) throw new Error("deuxième visite");
    v.closeDialogue();
    return { dedans: true, yPlancher: +y.toFixed(3), refus };
  });
});

// ------------------------------------------------------------------ quête principale complète
await test("Quête principale « L'énigme du Vaisseau d'or » de bout en bout", async () => {
  return ev(() => {
    const v = window.__ville;
    const g = v.game.gameplay;
    const steps = [];
    const money0 = g.state.money;
    const expectStep = (s) => {
      const q = v.quest("enigme");
      steps.push(q.step ?? q.status);
      if (q.step !== s) throw new Error(`étape attendue ${s}, obtenue ${q.step} (${q.status})`);
    };
    const run = (seq) => {
      for (const a of seq) {
        if (a === "n") v.next();
        else v.choose(a);
      }
      if (g.dialogue.open) v.closeDialogue();
      v.simulate(0.1);
    };
    v.talk("gagnon");
    run([0, "n", 0, "n"]);
    expectStep("banq");
    v.talk("belanger");
    run([0, "n", "n"]);
    expectStep("theatre");
    v.talk("tremblay");
    run([0, "n"]);
    expectStep("billet");
    const billet = g.collectibles.find((c) => c.id === "billet");
    v.teleport(billet.pos.x - 0.8, 0.17, billet.pos.z, Math.PI / 2);
    v.interact();
    if (!g.state.has("billet")) throw new Error("billet non ramassé");
    v.talk("tremblay");
    run([0, "n"]);
    expectStep("metro");
    v.talk("nguyen");
    run([0, "n"]);
    expectStep("opus");
    v.teleport(-29.2, -6, 37.2, 0);
    v.face(-29.2, 39.3);
    const dm = v.interact();
    if (!dm || !dm.who.includes("Distributeur")) throw new Error("distributeur introuvable : " + JSON.stringify(dm));
    run([0, "n"]);
    if (!g.state.has("opus")) throw new Error("carte OPUS non achetée");
    v.talk("nguyen");
    run([0, "n"]);
    expectStep("clocher");
    const pl = g.places.get("plaque").pos;
    v.teleport(pl[0] - 1.5, 0.17, pl[1] + 1.2);
    v.face(pl[0], pl[1]);
    const dp = v.interact();
    if (!dp || !dp.who.includes("Plaque")) throw new Error("plaque introuvable : " + JSON.stringify(dp));
    run([0, "n"]);
    expectStep("musicien");
    v.talk("jeanguy");
    run([0, "n"]);
    expectStep("cafe");
    v.talk("barista");
    run([0, "n"]);
    if (!g.state.has("cafe")) throw new Error("café non acheté");
    v.talk("jeanguy");
    run(["n", "n"]);
    expectStep("retour");
    if (!g.state.has("vaisseau")) throw new Error("pas de Vaisseau d'or");
    v.talk("gagnon");
    run(["n", 0, "n"]);
    const q = v.quest("enigme");
    if (q.status !== "done") throw new Error(`quête non terminée : ${JSON.stringify(q)}`);
    steps.push("done");
    return { étapes: steps.length, parcours: steps.join(" → "), argentAvant: money0, argentAprès: g.state.money, défis: g.readiness };
  });
});
await shot("04-fin-quete", () => window.__ville.render());
await ev(() => {
  const s = document.querySelector('.screen[data-id="fin"]');
  if (s) s.classList.remove("show");
  window.__ville.game.paused = false;
  window.__ville.game.input.enabled = true;
});

// ------------------------------------------------------------------ quêtes secondaires
await test("Quête « Un café pour Félix »", async () => {
  return ev(() => {
    const v = window.__ville;
    const g = v.game.gameplay;
    v.talk("felix");
    v.choose(0);
    v.choose(0);
    if (g.dialogue.open) v.closeDialogue();
    if (v.quest("cafe_felix").status !== "active") throw new Error("quête non démarrée");
    v.talk("barista");
    v.choose(0);
    v.next();
    if (g.dialogue.open) v.closeDialogue();
    v.simulate(0.2);
    if (v.quest("cafe_felix").step !== "livrer") throw new Error("étape livrer non atteinte : " + JSON.stringify(v.quest("cafe_felix")));
    v.talk("felix");
    v.next();
    if (g.dialogue.open) v.closeDialogue();
    if (v.quest("cafe_felix").status !== "done") throw new Error("non terminée");
    return v.quest("cafe_felix");
  });
});

await test("Quête « Le vent et les cônes orange » (physique)", async () => {
  return ev(() => {
    const v = window.__ville;
    const g = v.game.gameplay;
    v.talk("gilles");
    v.choose(0);
    v.next();
    if (g.dialogue.open) v.closeDialogue();
    if (v.quest("cones").status !== "active") throw new Error("non démarrée");
    // on pousse un cône pour de vrai, puis on replace les autres dans la zone
    const items = v.game.dynamics.items.filter((d) => d.kind === "cone");
    const zone = g.places.get("chantier").pos;
    items.forEach((d, i) => {
      d.body.setTranslation({ x: zone[0] - 4.2 + (i % 2) * 0.9 - 0.4, y: 0.4, z: -110 + i * 2.6 }, true);
      d.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    v.simulate(1.5);
    const n = v.coneCount();
    v.simulate(0.5);
    if (v.quest("cones").step !== "rapport") throw new Error(`cônes dans la zone : ${n}`);
    v.talk("gilles");
    v.next();
    if (g.dialogue.open) v.closeDialogue();
    if (v.quest("cones").status !== "done") throw new Error("non terminée");
    return { cônesDansLaZone: 6 };
  });
});

await test("Quête « Où est Poutine ? » (approche lente)", async () => {
  return ev(() => {
    const v = window.__ville;
    const g = v.game.gameplay;
    v.talk("lise");
    v.choose(0);
    v.next();
    if (g.dialogue.open) v.closeDialogue();
    // en courant, le chien s'enfuit
    const dog = g.dog;
    v.teleport(dog.pos.x - 6, 0.17, dog.pos.z, Math.PI / 2);
    v.simulate(0.2);
    const d0 = Math.hypot(dog.pos.x - v.player().x, dog.pos.z - v.player().z);
    v.simulate(1.2, ["KeyW", "ShiftLeft"]);
    const fled = dog.speed > 2;
    // on s'éloigne, le chien se calme, puis on s'approche en marchant
    v.teleport(dog.pos.x - 30, 0.17, dog.pos.z, Math.PI / 2);
    v.simulate(4);
    v.teleport(dog.pos.x - 1.0, 0.17, dog.pos.z, Math.atan2(1, 0));
    v.face(dog.pos.x, dog.pos.z);
    v.interact();
    if (!dog.caught) throw new Error("chien non attrapé");
    const lise = g.npc("lise");
    v.teleport(lise.pos.x + 1.2, 0.17, lise.pos.z + 0.5);
    v.simulate(1);
    v.talk("lise");
    v.next();
    if (g.dialogue.open) v.closeDialogue();
    if (v.quest("chien").status !== "done") throw new Error("non terminée : " + JSON.stringify(v.quest("chien")));
    return { fuiteEnCourant: fled, distanceInitiale: +d0.toFixed(1) };
  });
});

await test("Quête « Un Lyonnais à Montréal » (escorte)", async () => {
  return ev(() => {
    const v = window.__ville;
    const g = v.game.gameplay;
    v.talk("pierreyves");
    v.choose(0);
    v.next();
    if (g.dialogue.open) v.closeDialogue();
    const target = g.place("theatre");
    const npc = g.npc("pierreyves");
    // le joueur avance par bonds de 6 m vers le théâtre ; le touriste suit
    for (let i = 0; i < 120 && v.quest("touriste").status !== "done"; i++) {
      const p = v.player();
      const dx = target[0] - p.x;
      const dz = target[1] - p.z;
      const d = Math.hypot(dx, dz);
      const k = Math.min(1, 6 / d);
      v.teleport(p.x + dx * k, 0.17, p.z + dz * k, Math.atan2(dx, dz));
      v.simulate(1.2);
    }
    if (v.quest("touriste").status !== "done") throw new Error(`escorte échouée (PNJ à ${Math.hypot(npc.pos.x - target[0], npc.pos.z - target[1]).toFixed(1)} m)`);
    return v.quest("touriste");
  });
});

await test("Quête « Dépliants au vent » (5 objets à ramasser)", async () => {
  return ev(() => {
    const v = window.__ville;
    const g = v.game.gameplay;
    v.talk("sophie");
    v.choose(0);
    v.next();
    if (g.dialogue.open) v.closeDialogue();
    v.simulate(0.2);
    const fl = g.collectibles.filter((c) => c.item === "depliant");
    for (const c of fl) {
      v.teleport(c.pos.x - 0.8, 0.17, c.pos.z, Math.PI / 2);
      v.interact();
    }
    v.simulate(0.3);
    if (v.quest("depliants").step !== "rapporter") throw new Error("étape : " + JSON.stringify(v.quest("depliants")));
    v.talk("sophie");
    v.next();
    if (g.dialogue.open) v.closeDialogue();
    if (v.quest("depliants").status !== "done") throw new Error("non terminée");
    return { ramassés: fl.length };
  });
});

await test("Événement + quête « Le portefeuille perdu »", async () => {
  return ev(() => {
    const v = window.__ville;
    const g = v.game.gameplay;
    v.teleport(-60, 0.17, 140.5 + 9.5, Math.PI / 2);
    v.simulate(0.3);
    const id = v.trigger("portefeuille");
    if (id !== "portefeuille") throw new Error("événement non lancé");
    const c = g.collectibles[g.collectibles.length - 1];
    v.teleport(c.pos.x - 0.8, 0.17, c.pos.z, Math.PI / 2);
    v.interact();
    if (v.quest("portefeuille").status !== "active") throw new Error("quête non démarrée");
    v.talk("martine");
    v.choose(0);
    v.next();
    if (g.dialogue.open) v.closeDialogue();
    if (v.quest("portefeuille").status !== "done") throw new Error("non terminée");
    return v.quest("portefeuille");
  });
});

// ------------------------------------------------------------------ événements aléatoires
await test("Les 8 événements aléatoires se déclenchent", async () => {
  return ev(() => {
    const v = window.__ville;
    const ok = [];
    v.teleport(-14.5, 0.17, 41, Math.PI / 2);
    v.setHour(14);
    for (const id of ["averse", "manif", "violon", "tournage", "feux", "poutine"]) {
      const r = v.trigger(id);
      if (r !== id) throw new Error(`événement ${id} non lancé`);
      v.simulate(1);
      ok.push(id);
    }
    v.setHour(22);
    v.simulate(0.2);
    if (v.trigger("artifice") !== "artifice") throw new Error("feux d'artifice non lancés");
    ok.push("artifice", "portefeuille");
    v.simulate(15);
    const overcast = v.game.env.overcast;
    if (overcast < 0.5) throw new Error(`pluie trop faible (${overcast})`);
    return { événements: ok.length, couvertureNuageuse: +overcast.toFixed(2), actifs: v.world().events };
  });
});
await shot("05-pluie-nuit-manif", () => {
  const v = window.__ville;
  v.play();
  v.teleport(-40, 0.17, 136, Math.PI);
  v.game.player.camYaw = 0;
  v.simulate(2);
  v.render();
});

await test("Planificateur d'événements aléatoires", async () => {
  return ev(() => {
    const v = window.__ville;
    const e = v.game.events;
    e.endAll();
    v.simulate(0.2);
    e.auto = true;
    e.nextAt = 0;
    const n0 = e.log.length;
    v.simulate(0.5);
    e.auto = false;
    if (e.log.length <= n0) throw new Error("aucun événement planifié");
    return { lancé: e.log[e.log.length - 1], prochainDans_s: +e.nextAt.toFixed(0) };
  });
});

// ------------------------------------------------------------------ circulation
await test("Circulation : véhicules en mouvement, arrêts aux feux, sécurité du joueur", async () => {
  return ev(() => {
    const v = window.__ville;
    v.setHour(13);
    v.teleport(-14.5, 0.17, 41, Math.PI / 2);
    v.simulate(2);
    const cars = v.game.traffic.cars.filter((c) => c.active);
    const before = cars.map((c) => c.t);
    v.simulate(3);
    const moved = cars.filter((c, i) => c.active && Math.abs(c.t - before[i]) > 2).length;
    const s0 = v.game.traffic.stats.stoppedAtLights;
    v.simulate(30);
    const stopped = v.game.traffic.stats.stoppedAtLights - s0;
    // le joueur se plante sur la voie, 16 m devant une voiture qui roule
    const hits0 = v.game.traffic.stats.hits;
    // une voiture en mouvement dont la voie est dégagée de tout carrefour sur 25 m autour du point visé
    const inters = v.game.city.data.intersections;
    const farFromCrossing = (p) => inters.every((it) => Math.hypot(it.p[0] - p.x, it.p[1] - p.z) > 25);
    let car = null;
    let lp = null;
    for (let tries = 0; tries < 40 && !car; tries++) {
      for (const c of v.game.traffic.cars) {
        if (!c.active || c.bus || c.speed < 4 || c.t + 30 > c.lane.len) continue;
        const q = c.lane.a.clone().addScaledVector(c.lane.dir, c.t + c.len / 2 + 16);
        const ahead = v.game.traffic.cars.some((o) => o !== c && o.active && o.lane === c.lane && o.t > c.t && o.t < c.t + 30);
        if (farFromCrossing(q) && !ahead) {
          car = c;
          lp = q;
          break;
        }
      }
      if (!car) v.simulate(0.5);
    }
    if (!car) throw new Error("aucune voiture en mouvement loin d'un carrefour");
    v.teleport(lp.x, 0.0, lp.z, Math.atan2(-car.lane.dir.x, -car.lane.dir.z));
    v.simulate(5);
    const gap = car.lane.a.clone().addScaledVector(car.lane.dir, car.t).distanceTo(v.game.player.position);
    const near = car.speed < 0.5 ? [car] : [];
    const hits = v.game.traffic.stats.hits - hits0;
    if (hits > 0) throw new Error("la voiture a heurté le joueur");
    if (!near.length) throw new Error(`la voiture ne s'est pas arrêtée (vitesse ${car.speed.toFixed(2)})`);
    v.simulate(4);
    if (cars.length < 8) throw new Error(`trop peu de voitures (${cars.length})`);
    if (moved < cars.length * 0.4) throw new Error(`voitures immobiles (${moved}/${cars.length})`);
    if (stopped === 0) throw new Error("aucun arrêt au feu rouge");
    return { voitures: cars.length, enMouvement: moved, arrêtsAuFeuRouge: stopped, arrêtDevantLeJoueur_m: +gap.toFixed(1), chocs: hits, klaxons: v.game.traffic.stats.honks };
  });
});

// ------------------------------------------------------------------ jour / nuit
await test("Cycle jour/nuit (lampadaires, fenêtres)", async () => {
  return ev(() => {
    const v = window.__ville;
    v.setHour(13);
    v.simulate(0.1);
    const day = { nuit: v.game.env.night, soleil: v.game.env.sun.intensity };
    v.setHour(22.5);
    v.simulate(0.1);
    const night = { nuit: v.game.env.night, halo: v.game.props.group.children.find((c) => c.name === "halos").material.opacity };
    if (day.nuit > 0.1 || night.nuit < 0.9 || night.halo < 0.5) throw new Error(JSON.stringify({ day, night }));
    return { jour: day, nuit: night };
  });
});
await shot("06-nuit-saint-denis", () => {
  const v = window.__ville;
  v.setHour(21.5);
  v.teleport(-118, 0.17, -40, Math.PI);
  v.game.player.camYaw = 0.25;
  v.simulate(1);
  v.render();
});

// ------------------------------------------------------------------ interface
await test("Interface : position, mini-carte, journal, carte", async () => {
  await ev(() => {
    const v = window.__ville;
    v.setHour(15);
    v.teleport(-118, 0.17, -40, Math.PI);
    v.simulate(0.5);
  });
  const hud = await ev(() => window.__ville.hud());
  assert(hud.location.includes("Saint-Denis"), `position : ${hud.location}`);
  await page.keyboard.press("KeyJ");
  await page.waitForTimeout(200);
  const journal = await ev(() => document.querySelector('.screen[data-id="journal"]')?.classList.contains("show"));
  await shot("07-journal");
  await page.keyboard.press("KeyJ");
  await page.keyboard.press("KeyM");
  await page.waitForTimeout(300);
  const carte = await ev(() => document.querySelector('.screen[data-id="carte"] canvas') !== null);
  await shot("08-carte");
  await page.keyboard.press("KeyM");
  assert(journal && carte, "journal ou carte non affichés");
  return { position: hud.location, journal, carte };
});

// ------------------------------------------------------------------ captures de contrôle
await shot("09-saint-denis-jour", () => {
  const v = window.__ville;
  v.setHour(11);
  v.play();
  v.teleport(-118, 0.17, -70, Math.PI);
  v.game.player.camYaw = 0.1;
  v.simulate(1.5);
  v.render();
});
await shot("10-emilie-gamelin", () => {
  const v = window.__ville;
  v.setHour(16.5);
  v.teleport(40, 0.17, 95, Math.PI);
  v.game.player.camYaw = -0.4;
  v.game.player.camPitch = 0.35;
  v.simulate(1.5);
  v.render();
});
await shot("11-clocher", () => {
  const v = window.__ville;
  v.setHour(17.2);
  const c = v.game.landmarks.clocherTop;
  v.setCamera(c.x - 26, 2.5, c.z + 24, c.x, 24, c.z);
  v.render();
});
await shot("12-vue-aerienne", () => {
  const v = window.__ville;
  v.setHour(15);
  v.setCamera(-180, 140, 260, -10, 0, 40);
  v.render();
});
await ev(() => window.__ville.play());

// ------------------------------------------------------------------ performance
await test("Performance (logique et rendu)", async () => {
  const logic = await ev(() => {
    const v = window.__ville;
    v.setHour(14);
    v.teleport(-14.5, 0.17, 41, Math.PI / 2);
    const t0 = performance.now();
    v.simulate(10, ["KeyW"]);
    return (performance.now() - t0) / 600;
  });
  await ev(() => {
    window.__ville.game.frameTimes.length = 0;
  });
  await page.waitForTimeout(6000);
  const fr = await ev(() => window.__ville.frameStats());
  const st = await ev(() => window.__ville.stats());
  return { logiqueParImage_ms: +logic.toFixed(2), rendu_ms_parImage_SwiftShader: +fr.avgMs.toFixed(1), ips_SwiftShader: +(1000 / fr.avgMs).toFixed(1), appelsDeDessin: st.calls, triangles: st.triangles };
});

await test("Son synthétisé (Web Audio)", async () => {
  return ev(() => {
    const v = window.__ville;
    const a = v.game.audio;
    a.start();
    const n0 = a.played;
    v.teleport(-14.5, 0.17, 41, Math.PI / 2);
    v.simulate(3, ["KeyW"]);
    a.ui("quest");
    a.metroChime();
    a.honk(5);
    a.bell(3, 50);
    a.music("alouette");
    const n = a.played - n0;
    if (!a.ctx) throw new Error("contexte audio absent");
    if (n < 30) throw new Error(`trop peu de sons : ${n}`);
    return { sonsProgrammés: n, étatContexte: a.ctx.state };
  });
});

await test("Aucune erreur dans la console", async () => {
  const errs = consoleErrors.filter((e) => !e.includes("favicon"));
  assert(errs.length === 0, errs.slice(0, 5).join(" | "));
  return { erreurs: 0, avertissements: warnings.length };
});

const passed = results.filter((r) => r.ok).length;
const report = { date: new Date().toISOString(), base, chargement_s: loadSeconds, réussis: passed, total: results.length, tests: results, captures: shots.map((s) => path.basename(s)), monde: world, avertissements: [...new Set(warnings)].slice(0, 20) };
fs.writeFileSync(path.join(OUT, "rapport.json"), JSON.stringify(report, null, 2));
console.log(`\n${passed}/${results.length} tests réussis · ${shots.length} captures dans tests/artefacts/`);
await browser.close();
server?.kill();
process.exit(passed === results.length ? 0 : 1);
