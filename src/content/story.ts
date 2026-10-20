import * as THREE from "three";
import type { Gameplay } from "../gameplay/world";
import type { DTree } from "../gameplay/dialogue";
import type { QuestDef } from "../gameplay/quests";
import { Dog } from "../actors/dog";
import { SIDEWALK_Y } from "../world/city";
import { METRO } from "../world/metroLayout";
import { pointInPoly, type V2 } from "../world/geom";
import { money } from "../gameplay/state";

/**
 * Contenu du jeu (en français) : personnages, dialogues et quêtes.
 *
 * La quête principale, « L'énigme du Vaisseau d'or », s'appuie sur le
 * sonnet d'Émile Nelligan (1899, domaine public) et fait visiter les lieux
 * marquants autour de la station Berri-UQAM. Chaque dialogue peut accueillir
 * plus tard des défis pédagogiques (voir g.challenge()).
 */

type G = Gameplay;

const POEM = `Ce fut un grand Vaisseau taillé dans l'or massif :<br>Ses mâts touchaient l'azur, sur des mers inconnues ;<br>…<br>Qu'est devenu mon cœur, navire déserté ?<br>Hélas ! Il a sombré dans l'abîme du Rêve !`;

const COFFEE_PRICE = 2.75;
/** Entrée de l'édicule (côté rue Berri). */
const METRO_DOOR: V2 = [-12.2, 28];
const OPUS_PRICE = 3.75;

export function installStory(g: G) {
  const L = g.game.landmarks;
  const data = g.game.city.data;
  const park = data.parks.find((p) => p.id === "emilie")!;
  const pxs = park.poly.map((p) => p[0]);
  const pzs = park.poly.map((p) => p[1]);
  const P = { x0: Math.min(...pxs), x1: Math.max(...pxs), z0: Math.min(...pzs), z1: Math.max(...pzs) };
  const gamelinC: V2 = [(P.x0 + P.x1) / 2, (P.z0 + P.z1) / 2];
  const kiosk = L.kioskPos;
  const clocher: V2 = [L.clocherTop.x - 5.6, L.clocherTop.z + 5.6];
  g.places.set("plaque", { name: "Plaque du clocher Saint-Jacques", pos: clocher });
  const pasteur = g.place("pasteur");
  const benches = g.game.props.benchSpots;
  const felixBench = benches.reduce((b, s) => (Math.hypot(s.x - pasteur[0], s.z - pasteur[1]) < Math.hypot(b.x - pasteur[0], b.z - pasteur[1]) ? s : b), benches[0]);
  const felixSits = Math.hypot(felixBench.x - pasteur[0], felixBench.z - pasteur[1]) < 40;
  // chantier de la rue Saint-Denis (voie est, entre Émery et De Maisonneuve)
  const sd = g.game.city.streetById.get("stdenis")!;
  const sdX = (z: number) => sd.a[0] + ((z - sd.a[1]) / (sd.b[1] - sd.a[1])) * (sd.b[0] - sd.a[0]);
  const zoneZ0 = -112;
  const zoneZ1 = -94;
  const zoneX = sdX(-103) + 5.4;
  g.places.set("chantier", { name: "Chantier de la rue Saint-Denis", pos: [zoneX + 4.2, -103] });

  // ================================================================ PNJ
  // ---------------- Professeure Hélène Gagnon (quête principale)
  g.addNpc(
    {
      id: "gagnon",
      name: "Hélène Gagnon",
      role: "professeure de littérature, UQAM",
      color: "#8e44ad",
      seed: 11,
      look: { skin: "#f2d3b8", hair: "#9a9a9a", hairStyle: "bun", top: "#6d2e46", topStyle: "coat", bottom: "#22223b", bottomStyle: "pants", glasses: true, scarf: "#e9c46a", hat: "none", height: 0.97 },
      at: () => ({ x: -21, z: 44.5, facing: Math.PI * 0.6 }),
      holding: "book",
      barks: ["Ah, la poésie de Nelligan… quel mystère !", "Pssst ! Toi, là ! Aimes-tu les énigmes ?", "Le Quartier latin cache bien des secrets."],
    },
    gagnonTree(),
    (g) => (g.quests.isDone("enigme") ? "fin" : g.quests.at("enigme", "retour") && g.state.has("vaisseau") ? "retour" : g.quests.isActive("enigme") ? "encours" : "debut"),
    (g) => (g.quests.status("enigme") === "available" ? "quest" : g.quests.at("enigme", "retour") ? "turnin" : "talk"),
  );

  // ---------------- Antoine Bélanger, bibliothécaire (BAnQ)
  const banq = g.place("banq");
  g.addNpc(
    {
      id: "belanger",
      name: "Antoine Bélanger",
      role: "bibliothécaire, Grande Bibliothèque",
      color: "#2a9d8f",
      seed: 22,
      look: { skin: "#c68a63", hair: "#1b1410", hairStyle: "short", top: "#264653", topStyle: "sweater", bottom: "#3a5a78", bottomStyle: "pants", glasses: true, beard: true, hat: "none" },
      at: () => ({ x: banq[0] + 1.5, z: banq[1] - 1, facing: 0 }),
      holding: "book",
      barks: ["Chut… On parle doucement près de la bibliothèque !", "Avez-vous votre carte d'abonné ?"],
    },
    belangerTree(),
    (g) => (g.quests.at("enigme", "banq") ? "enigme" : g.quests.isDone("enigme") || g.state.has("indice1") ? "apres" : "defaut"),
    (g) => (g.quests.at("enigme", "banq") ? "turnin" : "talk"),
  );

  // ---------------- Lucie Tremblay, billetterie du Théâtre St-Denis
  const theatre = g.place("theatre");
  g.addNpc(
    {
      id: "tremblay",
      name: "Lucie Tremblay",
      role: "billetterie, Théâtre St-Denis",
      color: "#c0392b",
      seed: 33,
      look: { skin: "#e8be9c", hair: "#7a2a14", hairStyle: "ponytail", top: "#b3121a", topStyle: "vest", bottom: "#111111", bottomStyle: "skirt", hat: "none" },
      at: () => ({ x: theatre[0] - 1.2, z: theatre[1] + 1.5, facing: Math.PI / 2 }),
      barks: ["Ce soir : grande soirée d'humour ! Il reste des places !", "Billets, billets ! Venez voir le spectacle !"],
    },
    tremblayTree(),
    (g) => (g.quests.at("enigme", "theatre") ? "enigme" : g.quests.at("enigme", "billet") ? (g.state.has("billet") ? "retour" : "attente") : g.state.has("indice2") || g.quests.isDone("enigme") ? "apres" : "defaut"),
    (g) => (g.quests.at("enigme", "theatre") || (g.quests.at("enigme", "billet") && g.state.has("billet")) ? "turnin" : "talk"),
  );
  // le billet perdu, emporté par le vent sur la rue Saint-Denis
  g.addCollectible("billet", "billet", sdX(-40) - 9.4, -40, SIDEWALK_Y, () => {
    if (g.quests.at("enigme", "billet")) g.toast("Le billet de Mme Tremblay !", "Rapporte-le à la billetterie du Théâtre St-Denis.", "quest");
  }, "ticket");

  // ---------------- Kevin Nguyen, agent de station STM
  g.addNpc(
    {
      id: "nguyen",
      name: "Kevin Nguyen",
      role: "agent de station, STM",
      color: "#0a4ea2",
      seed: 44,
      look: { skin: "#d9a27e", hair: "#1b1410", hairStyle: "short", top: "#0a4ea2", topStyle: "jacket", bottom: "#1b263b", bottomStyle: "pants", hat: "cap", hatColor: "#0a4ea2" },
      at: () => ({ x: METRO.booth[0] - 1.6, z: METRO.booth[1] - 1.2, y: METRO.mezz.y, facing: Math.PI / 2 }),
      barks: ["Bienvenue à Berri-UQAM ! Attention à la marche.", "Prochain train vers Honoré-Beaugrand dans deux minutes."],
    },
    nguyenTree(),
    (g) => (g.quests.at("enigme", "metro") ? "enigme" : g.quests.at("enigme", "opus") ? (g.state.has("opus") ? "carte" : "attente") : g.state.has("indice3") || g.quests.isDone("enigme") ? "apres" : "defaut"),
    (g) => (g.quests.at("enigme", "metro") || (g.quests.at("enigme", "opus") && g.state.has("opus")) ? "turnin" : "talk"),
  );
  // distributeur de titres
  g.addInteractable({
    id: "distributeur",
    pos: () => new THREE.Vector3(METRO.machine[0], METRO.mezz.y, METRO.machine[1]),
    radius: 2.2,
    label: () => `<span class="key">E</span>Distributeur de titres STM`,
    action: () => g.talkObject({ name: "Distributeur de titres", role: "STM", color: "#0a4ea2" }, distributeurTree(), "debut"),
  });

  // ---------------- Plaque du clocher Saint-Jacques
  g.addInteractable({
    id: "plaque",
    pos: () => new THREE.Vector3(clocher[0], SIDEWALK_Y, clocher[1]),
    radius: 2.6,
    label: () => `<span class="key">E</span>Lire la plaque du clocher`,
    action: () => g.talkObject({ name: "Plaque commémorative", role: "clocher de l'église Saint-Jacques", color: "#9a948a" }, plaqueTree(), g.quests.at("enigme", "clocher") ? "enigme" : "lecture"),
    marker: () => (g.quests.at("enigme", "clocher") ? { text: "?", cls: "turnin", height: 2.4 } : null),
  });
  buildPlaque(g, clocher);

  // ---------------- Jean-Guy, accordéoniste de la place Émilie-Gamelin
  g.addNpc(
    {
      id: "jeanguy",
      name: "Jean-Guy Lapointe",
      role: "accordéoniste",
      color: "#e76f51",
      seed: 55,
      look: { skin: "#f2d3b8", hair: "#e8e2d6", hairStyle: "curly", top: "#3d405b", topStyle: "vest", bottom: "#5c4033", bottomStyle: "pants", hat: "beret", hatColor: "#1d1d1d", beard: true, height: 1.0 },
      at: () => ({ x: gamelinC[0] + 5, z: gamelinC[1] - 3, facing: -Math.PI / 2 }),
      holding: "accordion",
      pose: "idle",
      barks: ["♪ Alouette, gentille alouette… ♪", "Une petite pièce pour le musicien ?", "♪ À la claire fontaine, m'en allant promener… ♪"],
    },
    jeanguyTree(),
    (g) => (g.quests.at("enigme", "musicien") ? "enigme" : g.quests.at("enigme", "cafe") ? (g.state.has("cafe") ? "cafe" : "attente") : g.quests.isDone("enigme") || g.state.has("vaisseau") ? "apres" : "defaut"),
    (g) => (g.quests.at("enigme", "musicien") || (g.quests.at("enigme", "cafe") && g.state.has("cafe")) ? "turnin" : "talk"),
  );

  // ---------------- Yasmine, barista des Jardins Gamelin (originaire d'Alger)
  g.addNpc(
    {
      id: "barista",
      name: "Yasmine Belkacem",
      role: "barista, Jardins Gamelin",
      color: "#6d4c41",
      seed: 66,
      look: { skin: "#a96d48", hair: "#1b1410", hairStyle: "curly", top: "#2b2d42", topStyle: "tshirt", bottom: "#3a5a78", bottomStyle: "jeans", hat: "tuque", hatColor: "#e63946" },
      at: () => ({ x: kiosk[0], z: kiosk[1], facing: Math.PI }),
      barks: ["Café, chocolat chaud, venez vous réchauffer !", "C'est la dernière fin de semaine des Jardins !", "Chez nous, à Alger, on boirait un thé à la menthe… mais ici, c'est café !"],
    },
    baristaTree(),
    () => "debut",
    () => "talk",
  );

  // ---------------- Félix, étudiant (quête secondaire du café)
  g.addNpc(
    {
      id: "felix",
      name: "Félix Bouchard",
      role: "étudiant en génie, UQAM",
      color: "#2a9d8f",
      seed: 77,
      look: { skin: "#e8be9c", hair: "#d9b77a", hairStyle: "short", top: "#e07a5f", topStyle: "hoodie", bottom: "#2b2d42", bottomStyle: "jeans", backpack: "#264653", hat: "none" },
      at: () => (felixSits ? { x: felixBench.x, z: felixBench.z, facing: felixBench.rot } : { x: pasteur[0] + 3, z: pasteur[1], facing: -Math.PI / 2 }),
      pose: felixSits ? "sit" : "idle",
      holding: "book",
      barks: ["Ouf… mon examen de calcul est dans une heure.", "Je tuerais pour un café…"],
    },
    felixTree(),
    (g) => (g.quests.isDone("cafe_felix") ? "apres" : g.quests.isActive("cafe_felix") ? (g.state.has("cafe") ? "livraison" : "attente") : "debut"),
    (g) => (g.quests.status("cafe_felix") === "available" ? "quest" : g.quests.isActive("cafe_felix") && g.state.has("cafe") ? "turnin" : "talk"),
  );

  // ---------------- Gilles, contremaître (quête des cônes)
  g.addNpc(
    {
      id: "gilles",
      name: "Gilles Lavoie",
      role: "contremaître, Ville de Montréal",
      color: "#f77f00",
      seed: 88,
      look: { skin: "#e8be9c", hair: "#4a3020", hairStyle: "short", top: "#3a3a3a", topStyle: "jacket", bottom: "#2f3e46", bottomStyle: "jeans", hat: "helmet", hatColor: "#f2b705", vest: "#ff7b00", beard: true, build: 1.12 },
      at: () => ({ x: zoneX + 4.6, z: -103, facing: -Math.PI / 2 }),
      holding: "clipboard",
      barks: ["Maudit vent ! Mes cônes sont partis partout !", "Attention, chantier ! Rue Saint-Denis fermée à droite."],
    },
    gillesTree(),
    (g) => (g.quests.isDone("cones") ? "apres" : g.quests.isActive("cones") ? (coneCount(g) >= 6 ? "fini" : "attente") : "debut"),
    (g) => (g.quests.status("cones") === "available" ? "quest" : g.quests.isActive("cones") && coneCount(g) >= 6 ? "turnin" : "talk"),
  );

  // ---------------- Mme Lise Lavoie et Poutine le chien
  const lisePos: V2 = [P.x0 + 9, P.z0 + 48];
  g.addNpc(
    {
      id: "lise",
      name: "Lise Lavoie",
      role: "retraitée du Plateau",
      color: "#e9c46a",
      seed: 99,
      look: { skin: "#f5dccb", hair: "#e8e2d6", hairStyle: "short", top: "#7fa7a1", topStyle: "coat", bottom: "#4a4e69", bottomStyle: "skirt", hat: "beret", hatColor: "#6d2e46", glasses: true, scarf: "#e76f51", height: 0.94 },
      at: () => ({ x: lisePos[0], z: lisePos[1], facing: Math.PI / 2 }),
      holding: "leash",
      barks: ["Poutine ! Poutine ! Reviens ici, mon pitou !", "Mon chien s'est sauvé, l'avez-vous vu ?"],
    },
    liseTree(),
    (g) => (g.quests.isDone("chien") ? "apres" : g.quests.isActive("chien") ? (g.dog?.follow ? "retour" : "attente") : "debut"),
    (g) => (g.quests.status("chien") === "available" ? "quest" : g.quests.isActive("chien") && g.dog?.follow ? "turnin" : "talk"),
  );
  g.dog = new Dog(g.game.scene, new THREE.Vector3(gamelinC[0] + 14, SIDEWALK_Y, gamelinC[1] + 20), park.poly);
  g.dog.onBark = () => {
    if (g.dog && g.dog.pos.distanceTo(g.player.position) < 25) g.hud.say(() => g.dog!.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), "Wouf ! Wouf !", 1.6);
  };
  g.addInteractable({
    id: "poutine",
    pos: () => g.dog!.pos,
    radius: 2.0,
    label: () => (g.dog && !g.dog.caught ? `<span class="key">E</span>Attraper Poutine` : null),
    action: () => {
      const dog = g.dog!;
      if (g.player.actualSpeed > 2.6) {
        g.hud.say(() => dog.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), "Grrr… Wouf !", 1.5);
        g.toast("Poutine a eu peur !", "Approche-toi lentement (touche C pour marcher).", "info");
        return;
      }
      dog.caught = true;
      dog.follow = g.player.position;
      g.game.audio?.ui("pickup");
      g.toast("Tu as attrapé Poutine !", g.quests.isActive("chien") ? "Ramène-le à Mme Lavoie." : "Quel bon chien !", "quest");
      if (!g.quests.isActive("chien") && !g.quests.isDone("chien")) g.quests.start("chien");
      if (g.quests.at("chien", "attraper")) g.quests.advance("chien");
    },
    priority: 1,
  });

  // ---------------- Pierre-Yves, touriste français (escorte)
  const gare = g.place("gare");
  g.addNpc(
    {
      id: "pierreyves",
      name: "Pierre-Yves Lemaire",
      role: "touriste de Lyon",
      color: "#457b9d",
      seed: 111,
      look: { skin: "#f2d3b8", hair: "#6b4a2b", hairStyle: "short", top: "#f1faee", topStyle: "jacket", bottom: "#c9ada7", bottomStyle: "pants", backpack: "#d62828", hat: "cap", hatColor: "#f1faee", glasses: true },
      at: () => ({ x: gare[0] - 1, z: gare[1] + 1, facing: -Math.PI / 2 }),
      holding: "phone",
      barks: ["Excusez-moi, c'est par où, le Théâtre St-Denis ?", "Mon téléphone n'a plus de batterie… zut !"],
    },
    pierreYvesTree(),
    (g) => (g.quests.isDone("touriste") ? "apres" : g.quests.isActive("touriste") ? "route" : "debut"),
    (g) => (g.quests.status("touriste") === "available" ? "quest" : "talk"),
  );

  // ---------------- Fabienne, bénévole du festival (dépliants), originaire de Port-au-Prince
  const sophiePos: V2 = [P.x1 + 7.5, P.z1 - 6];
  g.addNpc(
    {
      id: "sophie",
      name: "Fabienne Jean-Baptiste",
      role: "bénévole, Festival du Quartier latin",
      color: "#ff006e",
      seed: 122,
      look: { skin: "#8a5536", hair: "#1b1410", hairStyle: "long", top: "#ff006e", topStyle: "tshirt", bottom: "#22223b", bottomStyle: "jeans", hat: "cap", hatColor: "#ffbe0b" },
      at: () => ({ x: sophiePos[0], z: sophiePos[1], facing: -Math.PI / 2 }),
      holding: "clipboard",
      barks: ["Le vent a emporté mes dépliants !", "Programme du festival, gratuit !", "Bonjou ! Euh… bonjour ! Programme du festival ?"],
    },
    sophieTree(),
    (g) => (g.quests.isDone("depliants") ? "apres" : g.quests.isActive("depliants") ? (g.state.has("depliant", 5) ? "fini" : "attente") : "debut"),
    (g) => (g.quests.status("depliants") === "available" ? "quest" : g.quests.isActive("depliants") && g.state.has("depliant", 5) ? "turnin" : "talk"),
  );

  // ---------------- Steve, vendeur du Daron Fumant (rue Saint-Denis) : pas de vente aux mineurs
  const vape = g.game.landmarks.vapoterie;
  if (vape) {
    g.addNpc(
      {
        id: "vendeur",
        name: "Steve Bergeron",
        role: "vendeur, vapoterie Le Daron Fumant",
        color: "#7b5cc4",
        seed: 1808,
        look: { skin: "#e3b48f", hair: "#3b2a1e", hairStyle: "short", beard: true, top: "#2c2442", topStyle: "hoodie", bottom: "#22223b", bottomStyle: "jeans", hat: "cap", hatColor: "#8a6bd1" },
        at: () => vape.vendor,
        barks: ["Bonjour ! Juste avant : as-tu 18 ans ?", "Pièce d'identité avec photo, s'il vous plaît.", "Ici, c'est 18 ans et plus. Pas d'exception."],
      },
      vendeurTree(),
      (g) => (g.state.is("vape_refus") ? "revenu" : "debut"),
      () => "talk",
    );
    // en entrant : rappel affiché une fois par visite
    let inside = false;
    g.tickers.push(() => {
      const p = g.player.position;
      const now = p.y > -1 && pointInPoly(p.x, p.z, vape.room);
      if (now && !inside) g.toast(vape.name, "Vente interdite aux moins de 18 ans · pièce d'identité exigée.", "info");
      inside = now;
    });
  }
  const flyerSpots: V2[] = [
    [P.x0 + 20, P.z0 + 60],
    [P.x1 - 6, P.z0 + 30],
    [gamelinC[0] - 12, P.z1 - 10],
    [P.x1 + 6, P.z0 + 70],
    [P.x0 - 7, P.z0 + 85],
  ];
  flyerSpots.forEach((p, i) => {
    const c = g.addCollectible(`depliant${i}`, "depliant", p[0], p[1], SIDEWALK_Y, () => {
      const n = g.state.inv.get("depliant") ?? 0;
      if (g.quests.isActive("depliants")) g.toast(`Dépliant ${n} sur 5`, n >= 5 ? "Rapporte-les à Fabienne !" : "Il en reste d'autres dans le coin…", "quest");
    });
    c.mesh.visible = false;
    c.active = false;
  });

  // ================================================================ QUÊTES
  const q: QuestDef<G>[] = [
    {
      id: "enigme",
      title: "L'énigme du Vaisseau d'or",
      main: true,
      giver: "gagnon",
      summary: "En 1966, des étudiants du Quartier latin ont caché un « Vaisseau d'or » en hommage au poème d'Émile Nelligan. Suis les indices de lieu en lieu pour le retrouver.",
      steps: [
        { id: "banq", text: "Va à la <b>Grande Bibliothèque</b> et parle au bibliothécaire.", target: (g) => g.place("banq") },
        { id: "theatre", text: "Rends-toi au <b>Théâtre St-Denis</b>, « là où l'on rit et chante depuis 1916 ».", target: (g) => g.place("theatre") },
        { id: "billet", text: "Retrouve le <b>billet perdu</b> sur la rue Saint-Denis, puis rapporte-le à Lucie.", target: (g) => (g.state.has("billet") ? g.place("theatre") : billetPos(g)) },
        { id: "metro", text: "Descends dans la <b>station Berri-UQAM</b> et parle à l'agent de la STM.", target: (g) => (g.player.position.y > -2 ? METRO_DOOR : [METRO.booth[0], METRO.booth[1]]) },
        { id: "opus", text: "Achète une <b>carte OPUS</b> au distributeur, puis montre-la à Kevin.", target: (g) => (g.player.position.y > -2 ? METRO_DOOR : [METRO.machine[0], METRO.machine[1]]) },
        { id: "clocher", text: "Trouve la plaque au pied du <b>clocher Saint-Jacques</b> (Saint-Denis et Sainte-Catherine).", target: (g) => g.place("plaque") },
        { id: "musicien", text: "Trouve le <b>musicien</b> de la Place Émilie-Gamelin.", target: () => gamelinC },
        { id: "cafe", text: `Achète un <b>café</b> aux Jardins Gamelin (${money(COFFEE_PRICE)}) pour Jean-Guy.`, target: (g) => (g.state.has("cafe") ? gamelinC : kiosk) },
        { id: "retour", text: "Rapporte le <b>Vaisseau d'or</b> à la professeure Gagnon.", target: () => [-21, 44.5] },
      ],
      reward: { money: 25, text: "Le mystère du Vaisseau d'or est résolu !" },
    },
    {
      id: "cafe_felix",
      title: "Un café pour Félix",
      giver: "felix",
      summary: "Félix étudie pour un examen à la Place Pasteur et rêve d'un café allongé.",
      steps: [
        { id: "acheter", text: `Achète un café allongé aux <b>Jardins Gamelin</b> (${money(COFFEE_PRICE)}).`, target: () => kiosk, done: (g) => g.state.has("cafe") },
        { id: "livrer", text: "Apporte le café à <b>Félix</b>, Place Pasteur.", target: (g) => [g.npc("felix").pos.x, g.npc("felix").pos.z] },
      ],
      reward: { money: 6, text: "Félix réussira son examen !" },
    },
    {
      id: "cones",
      title: "Le vent et les cônes orange",
      giver: "gilles",
      summary: "Le vent a renversé les cônes du chantier de la rue Saint-Denis. Pousse-les dans la zone de travaux.",
      steps: [
        { id: "pousser", text: (g) => `Pousse les cônes orange dans la zone du chantier : <b>${coneCount(g)} / 6</b>.`, target: (g) => g.place("chantier"), done: (g) => coneCount(g) >= 6 },
        { id: "rapport", text: "Retourne voir <b>Gilles</b>.", target: (g) => [g.npc("gilles").pos.x, g.npc("gilles").pos.z] },
      ],
      reward: { money: 10, text: "Gilles te remercie : la rue est sécuritaire." },
    },
    {
      id: "chien",
      title: "Où est Poutine ?",
      giver: "lise",
      summary: "Le petit chien de Mme Lavoie s'est échappé dans la Place Émilie-Gamelin. Il a peur quand on court !",
      steps: [
        { id: "attraper", text: "Attrape <b>Poutine</b> en t'approchant lentement (touche <b>C</b> pour marcher).", target: (g) => (g.dog ? [g.dog.pos.x, g.dog.pos.z] : null) },
        { id: "ramener", text: "Ramène Poutine à <b>Mme Lavoie</b>.", target: () => lisePos },
      ],
      reward: { money: 8, text: "Poutine est de retour dans les bras de Lise." },
    },
    {
      id: "touriste",
      title: "Un Lyonnais à Montréal",
      giver: "pierreyves",
      summary: "Pierre-Yves arrive de la gare d'autocars et veut voir le Théâtre St-Denis. Guide-le !",
      steps: [{ id: "guider", text: "Guide <b>Pierre-Yves</b> jusqu'au Théâtre St-Denis (il te suit).", target: (g) => g.place("theatre") }],
      reward: { money: 12, text: "Pierre-Yves a eu le temps d'acheter son billet." },
    },
    {
      id: "depliants",
      title: "Dépliants au vent",
      giver: "sophie",
      summary: "Une bourrasque a dispersé les dépliants du festival autour de la Place Émilie-Gamelin.",
      steps: [
        { id: "ramasser", text: (g) => `Ramasse les dépliants envolés : <b>${Math.min(5, g.state.inv.get("depliant") ?? 0)} / 5</b>.`, target: (g) => nearestFlyer(g), done: (g) => g.state.has("depliant", 5) },
        { id: "rapporter", text: "Rapporte les dépliants à <b>Fabienne</b> (Berri et Sainte-Catherine).", target: () => sophiePos },
      ],
      reward: { money: 7, text: "Le festival peut continuer !" },
    },
    {
      id: "portefeuille",
      title: "Le portefeuille perdu",
      giver: "evenement",
      summary: "Tu as trouvé un portefeuille sur le trottoir. Une carte au nom de Mariama Diallo s'y trouve.",
      steps: [{ id: "rendre", text: "Rends le portefeuille à <b>Mariama Diallo</b>, qui le cherche près de Sainte-Catherine.", target: (g) => (g.npcs.has("martine") ? [g.npc("martine").pos.x, g.npc("martine").pos.z] : null) }],
      reward: { money: 15, text: "Mariama te remercie de ton honnêteté." },
    },
  ];
  g.startQuests(q);

  // les cônes du chantier
  setupCones(g, zoneX, zoneZ0, zoneZ1);

  // dépliants visibles quand la quête commence
  g.tickers.push(() => {
    if (g.quests.isActive("depliants") && !g.state.is("depliants_vus")) {
      g.state.flag("depliants_vus");
      for (const c of g.collectibles) if (c.item === "depliant") {
        c.mesh.visible = true;
        c.active = true;
      }
    }
  });
}

// ================================================================ utilitaires
function billetPos(g: G): V2 | null {
  const c = g.collectibles.find((c) => c.id === "billet");
  return c && c.active ? [c.pos.x, c.pos.z] : null;
}

function nearestFlyer(g: G): V2 | null {
  let best: V2 | null = null;
  let bd = Infinity;
  for (const c of g.collectibles) {
    if (c.item !== "depliant" || !c.active) continue;
    const d = g.playerDist([c.pos.x, c.pos.z]);
    if (d < bd) {
      bd = d;
      best = [c.pos.x, c.pos.z];
    }
  }
  return best;
}

let coneZone: { x0: number; x1: number; z0: number; z1: number } | null = null;
let coneBodies: { pos: () => THREE.Vector3 }[] = [];

export function coneCount(_g: G): number {
  if (!coneZone) return 0;
  let n = 0;
  for (const c of coneBodies) {
    const p = c.pos();
    if (p.x > coneZone.x0 && p.x < coneZone.x1 && p.z > coneZone.z0 && p.z < coneZone.z1) n++;
  }
  return n;
}

function setupCones(g: G, zoneX: number, z0: number, z1: number) {
  const dyn = g.game.dynamics;
  if (!dyn) return;
  coneZone = { x0: zoneX - 1.6, x1: zoneX + 1.6, z0, z1 };
  // marquage au sol de la zone de travaux
  const lines = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xff8c1a });
  const w = coneZone.x1 - coneZone.x0;
  const h = z1 - z0;
  for (const [x, z, sx, sz] of [
    [zoneX, z0, w, 0.15],
    [zoneX, z1, w, 0.15],
    [coneZone.x0, (z0 + z1) / 2, 0.15, h],
    [coneZone.x1, (z0 + z1) / 2, 0.15, h],
  ]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2), mat);
    m.position.set(x, 0.018, z);
    lines.add(m);
  }
  g.game.scene.add(lines);
  dyn.addSign(zoneX, z0 - 1.5, "TRAVAUX");
  dyn.addSign(zoneX, z1 + 1.5, "RUE SAINT-DENIS · VOIE FERMÉE");
  // 6 cônes dispersés par le vent + 2 restés en place (non comptés)
  const spots: [number, number][] = [
    [zoneX + 6, -116],
    [zoneX - 4.5, -108],
    [zoneX + 7.5, -97],
    [zoneX - 6, -90],
    [zoneX + 2, -121],
    [zoneX - 2.5, -86],
  ];
  coneBodies = spots.map(([x, z], i) => dyn.add("cone", x, z, i * 0.7, i % 2 === 0));
  dyn.add("barrel", zoneX, z0 + 1.2, 0);
  dyn.add("barrel", zoneX, z1 - 1.2, 0);
}

function buildPlaque(g: G, p: V2) {
  const grp = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x8f897e, roughness: 0.9 });
  const ped = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.3), stone);
  ped.position.y = 0.5;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.03), new THREE.MeshStandardMaterial({ color: 0x8a6d3b, metalness: 0.7, roughness: 0.35 }));
  plate.position.set(0, 0.85, 0.16);
  plate.rotation.x = -0.35;
  grp.add(ped, plate);
  grp.position.set(p[0], SIDEWALK_Y, p[1]);
  grp.rotation.y = -Math.PI / 4;
  grp.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  g.game.scene.add(grp);
  const R = g.game.physics.RAPIER;
  g.game.physics.world.createCollider(R.ColliderDesc.cuboid(0.3, 0.5, 0.15).setTranslation(p[0], SIDEWALK_Y + 0.5, p[1]), g.game.physics.fixedBody);
}

// ================================================================ DIALOGUES
function gagnonTree(): DTree<G> {
  return {
    debut: {
      text: "Bonjour ! Excuse-moi de t'aborder ainsi… Je suis Hélène Gagnon, professeure de littérature ici, à l'UQAM. Dis-moi : est-ce que tu aimes les énigmes ?",
      choices: [
        { text: "Oui, j'adore les énigmes !", next: "histoire" },
        { text: "Ça dépend… de quoi s'agit-il ?", next: "histoire" },
        { text: "Désolé, je suis un peu pressé.", next: "plustard" },
      ],
    },
    plustard: { text: "Pas de souci ! Si tu changes d'idée, je serai ici, devant le pavillon Judith-Jasmin." },
    histoire: {
      text: "Hier, un collègue de la Grande Bibliothèque a trouvé une vieille note glissée dans un recueil d'<em>Émile Nelligan</em>. Elle date de 1966 ! Des étudiants y auraient caché un « <em>Vaisseau d'or</em> » quelque part dans le Quartier latin…",
      next: "poeme",
    },
    poeme: {
      text: `La note commence par les premiers vers du célèbre sonnet de Nelligan :<div class="poem">${POEM}</div>`,
      choices: [
        { text: "Quel beau poème ! Par où commencer ?", next: "mission" },
        { text: "Qui était Émile Nelligan ?", next: "nelligan" },
      ],
    },
    nelligan: {
      text: "Émile Nelligan est un poète montréalais né en 1879. Il a écrit presque toute son œuvre avant l'âge de vingt ans ! « Le Vaisseau d'or » est son poème le plus connu : un navire magnifique qui fait naufrage… comme les rêves du poète.",
      next: "mission",
    },
    mission: {
      text: "Le premier indice se trouve sûrement à la <em>Grande Bibliothèque</em>, juste au nord, rue Berri. Demande à Antoine Bélanger, le bibliothécaire. Moi, je t'attends ici. Bonne chance, détective !",
      do: (g) => g.quests.start("enigme"),
    },
    encours: {
      text: (g) => `Alors, ton enquête avance ? D'après mes notes, tu dois maintenant : ${g.quests.stepText("enigme")}`,
      choices: [
        { text: "Pouvez-vous me rappeler le poème ?", next: "rappel" },
        { text: "J'y retourne !", next: null },
      ],
    },
    rappel: { text: `<div class="poem">${POEM}</div>` },
    retour: {
      text: "Est-ce que c'est… le Vaisseau d'or ?! Tu l'as trouvé ! Regarde ces détails : ses mâts, sa coque dorée… Les étudiants de 1966 seraient fiers de toi.",
      next: "retour2",
    },
    retour2: {
      text: "Pour terminer, une dernière question de littéraire : dans le dernier vers, où le cœur du poète a-t-il sombré ?",
      choices: [
        { text: "Dans l'abîme du Rêve.", next: "bravo", do: (g) => g.challenge(true) },
        { text: "Dans le fleuve Saint-Laurent.", next: "presque", do: (g) => g.challenge(false) },
        { text: "Dans l'océan Atlantique.", next: "presque", do: (g) => g.challenge(false) },
      ],
    },
    presque: {
      text: "Presque ! Relis bien : « Hélas ! Il a sombré dans l'abîme du <em>Rêve</em> ! » Le naufrage est intérieur : c'est celui de l'âme du poète.",
      next: "bravo",
    },
    bravo: {
      text: "Exactement. Merci, détective : grâce à toi, ce petit trésor ira au musée de l'UQAM. Continue d'explorer le Quartier latin : il reste bien des gens à aider !",
      do: (g) => {
        g.state.take("vaisseau");
        g.quests.advance("enigme", "retour");
      },
    },
    fin: { text: "Le Vaisseau d'or est maintenant exposé à la bibliothèque de l'UQAM. Tu es une vraie légende du Quartier latin !" },
  };
}

function belangerTree(): DTree<G> {
  return {
    defaut: {
      text: "Bonjour ! La Grande Bibliothèque est ouverte jusqu'à 22 h. On y trouve plus de quatre millions de documents… et du Wi-Fi gratuit !",
      choices: [
        { text: "Quatre millions ? Wow !", next: "info" },
        { text: "Merci, bonne journée !", next: null },
      ],
    },
    info: { text: "Eh oui ! Livres, films, partitions, journaux anciens… Et l'édifice, avec ses lames de verre vert, a ouvert en 2005." },
    enigme: {
      text: "Ah ! C'est Hélène qui t'envoie ? Oui, c'est moi qui ai trouvé la note dans le recueil de Nelligan. Mais avant de te la montrer, prouve-moi que tu connais le poème : « Ce fut un grand Vaisseau taillé dans l'or… »",
      choices: [
        { text: "… massif.", next: "bon", do: (g) => g.challenge(true) },
        { text: "… blanc.", next: "mauvais", do: (g) => g.challenge(false) },
        { text: "… du soleil.", next: "mauvais", do: (g) => g.challenge(false) },
      ],
    },
    mauvais: {
      text: "Hum, non. Un vaisseau d'or <em>massif</em> : solide, lourd, précieux ! Allez, je te fais confiance quand même.",
      next: "indice",
    },
    bon: { text: "Bravo ! « Taillé dans l'or <em>massif</em> ». Tu as l'âme d'une poétesse ou d'un poète !", next: "indice" },
    indice: {
      text: "Voici ce qui est écrit au dos de la note : « <em>Là où l'on rit et chante depuis 1916</em> ». Je parie que c'est le Théâtre St-Denis, un peu plus au nord-ouest, sur la rue Saint-Denis.",
      do: (g) => {
        g.state.give("indice1");
        g.quests.advance("enigme", "banq");
      },
    },
    apres: { text: "Alors, ce Vaisseau d'or ? J'ai bien hâte de savoir où il était caché !" },
  };
}

function tremblayTree(): DTree<G> {
  return {
    defaut: {
      text: "Bonsoir ! Ce soir au Théâtre St-Denis : la grande soirée d'humour du Festival. Les billets sont à 45 $, mais il ne reste que le balcon.",
      choices: [
        { text: "Le théâtre est vieux ?", next: "histoire" },
        { text: "Non merci, une autre fois.", next: null },
      ],
    },
    histoire: { text: "Il a ouvert en 1916 ! À l'époque, c'était un cinéma. Aujourd'hui, c'est une des salles de spectacle les plus célèbres de Montréal." },
    enigme: {
      text: "Une note de 1966 ? Ça me dit quelque chose… Mon grand-père travaillait ici et il parlait d'un « secret des étudiants ». Je peux t'aider, mais d'abord… j'ai un problème : le vent a emporté le billet d'une spectatrice !",
      choices: [{ text: "Je vais vous le retrouver.", next: "mission" }],
    },
    mission: {
      text: "Merci ! Il a filé vers le sud, sur le trottoir de la rue Saint-Denis, vers De Maisonneuve. C'est un petit billet blanc.",
      do: (g) => g.quests.advance("enigme", "theatre"),
    },
    attente: { text: "Tu as trouvé le billet ? Il est parti vers le sud, sur la rue Saint-Denis, du côté du théâtre." },
    retour: {
      text: "Mon billet ! Tu es un ange. Comme promis, voici ce que mon grand-père m'a raconté : les étudiants disaient « <em>Sous la terre, trois lignes se croisent</em> ».",
      choices: [
        { text: "Trois lignes… le métro Berri-UQAM !", next: "metro", do: (g) => g.challenge(true) },
        { text: "Des lignes d'écriture ?", next: "indice_aide" },
      ],
    },
    indice_aide: { text: "Hum… Penses-y : sous la terre, à Montréal, ce qui croise des lignes… c'est le métro ! À Berri-UQAM, les lignes verte, orange et jaune se rencontrent.", next: "metro" },
    metro: {
      text: "Va voir Kevin, l'agent de la STM, dans la station Berri-UQAM. Prends l'escalier de l'édicule, au coin de Berri et De Maisonneuve.",
      do: (g) => {
        g.state.take("billet");
        g.state.give("indice2");
        g.quests.advance("enigme", "billet");
      },
    },
    apres: { text: "Merci encore pour le billet ! Reviens voir un spectacle un de ces soirs." },
  };
}

function nguyenTree(): DTree<G> {
  return {
    defaut: {
      text: "Bonjour et bienvenue à Berri-UQAM, la plus grande station du réseau ! Ici se croisent les lignes verte, orange et jaune. Comment puis-je vous aider ?",
      choices: [
        { text: "Où va la ligne verte ?", next: "verte" },
        { text: "Comment acheter un titre de transport ?", next: "titre" },
        { text: "Merci, ça va !", next: null },
      ],
    },
    verte: { text: "La ligne verte va d'Angrignon, à l'ouest, jusqu'à Honoré-Beaugrand, à l'est. Le quai est au niveau inférieur, après les tourniquets." },
    titre: { text: `Au distributeur, juste à côté de la loge : une carte OPUS avec un passage coûte ${money(OPUS_PRICE)}.` },
    enigme: {
      text: "Une énigme de 1966 ? Ah ! Mon prédécesseur me l'a racontée. Mais les règles sont les règles : je ne parle qu'aux usagers munis d'un titre de transport valide !",
      choices: [{ text: "D'accord, je vais acheter une carte OPUS.", next: "go" }],
    },
    go: {
      text: `Le distributeur est derrière toi, près de l'escalier. ${money(OPUS_PRICE)}, et ensuite reviens me voir.`,
      do: (g) => g.quests.advance("enigme", "metro"),
    },
    attente: { text: `Le distributeur est juste là. Une carte OPUS avec un passage : ${money(OPUS_PRICE)}.` },
    carte: {
      text: "Parfait, ta carte est valide ! Petit quiz de métro avant l'indice : quelle ligne va vers Angrignon ?",
      choices: [
        { text: "La ligne verte.", next: "indice", do: (g) => g.challenge(true) },
        { text: "La ligne orange.", next: "rate", do: (g) => g.challenge(false) },
        { text: "La ligne jaune.", next: "rate", do: (g) => g.challenge(false) },
      ],
    },
    rate: { text: "Non, c'est la ligne <em>verte</em>, direction Angrignon ! La jaune va à Longueuil, et l'orange fait un grand U. Allez, je te donne l'indice quand même.", next: "indice" },
    indice: {
      text: "Voici ce que les étudiants avaient gravé près de la loge : « <em>Là où les cloches ne sonnent plus pour la messe, mais pour le savoir</em> ». Une église devenue université… le clocher Saint-Jacques, à Saint-Denis et Sainte-Catherine !",
      do: (g) => {
        g.state.give("indice3");
        g.quests.advance("enigme", "opus");
      },
    },
    apres: { text: "Bon voyage avec la STM ! Le prochain train entre en station dans un instant." },
  };
}

function distributeurTree(): DTree<G> {
  return {
    debut: {
      text: (g) => `SÉLECTIONNEZ VOTRE TITRE. Solde disponible : ${money(g.state.money)}.`,
      choices: [
        { text: `Carte OPUS + 1 passage — ${money(OPUS_PRICE)}`, next: (g) => (g.state.has("opus") ? "deja" : g.state.money >= OPUS_PRICE ? "paye" : "fonds") },
        { text: "Annuler", next: null },
      ],
    },
    paye: {
      text: "TRANSACTION ACCEPTÉE. Prenez votre carte. Merci et bon voyage !",
      do: (g) => {
        g.state.pay(OPUS_PRICE);
        g.state.give("opus");
        g.game.audio?.ui("cash");
      },
    },
    deja: { text: "Vous avez déjà une carte OPUS valide." },
    fonds: { text: "FONDS INSUFFISANTS. Aide des passants ou les gens du quartier pour gagner un peu d'argent !" },
  };
}

function plaqueTree(): DTree<G> {
  return {
    lecture: {
      text: "« Église Saint-Jacques, 1857. Le clocher et le transept sud ont été conservés et intégrés au pavillon Judith-Jasmin de l'Université du Québec à Montréal, inauguré en 1979. »",
    },
    enigme: {
      text: "Sous le texte officiel, quelqu'un a gravé à la main : « Qu'est devenu mon cœur, navire déserté ? Hélas ! Il a sombré dans l'abîme du … » Le dernier mot est effacé. Un cadran à lettres permet de le composer.",
      choices: [
        { text: "R-Ê-V-E", next: "ouvre", do: (g) => g.challenge(true) },
        { text: "M-E-R", next: "non", do: (g) => g.challenge(false) },
        { text: "C-I-E-L", next: "non", do: (g) => g.challenge(false) },
      ],
    },
    non: {
      text: "Rien ne se passe. Souviens-toi du poème que la professeure t'a lu…",
      choices: [
        { text: "Réessayer", next: "enigme" },
        { text: "Partir", next: null },
      ],
    },
    ouvre: {
      text: "Clic ! Un petit compartiment s'ouvre derrière la plaque. À l'intérieur, un papier jauni : « <em>Cherche la musique sur la place où l'on se rassemble.</em> » La Place Émilie-Gamelin est juste en face, de l'autre côté de Berri !",
      do: (g) => {
        g.state.give("indice4");
        g.quests.advance("enigme", "clocher");
      },
    },
  };
}

function jeanguyTree(): DTree<G> {
  return {
    defaut: {
      text: "♪ Alouette, gentille alouette ♪… Bonjour, l'ami ! Ça fait quarante ans que je joue de l'accordéon sur cette place. Tu veux une chanson ?",
      choices: [
        { text: "Oui ! (donner 1,00 $)", next: (g) => (g.state.pay(1) ? "merci" : "pasdargent") },
        { text: "Pourquoi cette place est-elle si importante ?", next: "place" },
        { text: "Non merci.", next: null },
      ],
    },
    merci: { text: "Merci beaucoup ! ♪ Je te plumerai la tête… ♪ C'est une vieille chanson qu'on chante partout au Québec.", do: (g) => g.game.audio?.music("alouette") },
    pasdargent: { text: "Pas grave, l'ami ! La musique, c'est gratuit pour ceux qui l'aiment." },
    place: { text: "La place porte le nom d'Émilie Gamelin, qui aidait les pauvres au 19e siècle. Aujourd'hui, c'est ici que commencent les manifestations, les festivals… tout Montréal se rassemble ici !" },
    enigme: {
      text: "Un indice de 1966 ? Hé hé… J'étais étudiant à cette époque-là ! C'est moi qui ai caché le dernier morceau de l'énigme. Mais j'ai joué toute la matinée et j'ai la gorge sèche…",
      choices: [{ text: "Je vous apporte un café ?", next: "cafe_go" }],
    },
    cafe_go: {
      text: "Tu es bien gentil ! Un café des Jardins Gamelin, là-bas, au kiosque rouge. Avec ça, je retrouverai la mémoire… et le Vaisseau d'or !",
      do: (g) => g.quests.advance("enigme", "musicien"),
    },
    attente: { text: "Le kiosque rouge des Jardins Gamelin, juste au nord de la place. Un café, s'il te plaît !" },
    cafe: {
      text: "Ah, ça fait du bien ! Bon, une promesse est une promesse. J'ai caché le Vaisseau dans l'étui de mon premier accordéon… que je traîne toujours avec moi. Le voici !",
      do: (g) => {
        g.state.take("cafe");
        g.state.give("vaisseau");
        g.quests.advance("enigme", "cafe");
        g.game.audio?.music("alouette");
      },
      next: "fin",
    },
    fin: { text: "Rapporte-le à ta professeure. Et n'oublie jamais : « Ce fut un grand Vaisseau taillé dans l'or massif… »" },
    apres: { text: "♪ Alouette, gentille alouette… ♪ Reviens quand tu veux, l'ami !" },
  };
}

function baristaTree(): DTree<G> {
  return {
    debut: {
      text: "Bienvenue aux Jardins Gamelin ! Qu'est-ce que je te sers ?",
      choices: [
        { text: `« Je voudrais un café allongé, s'il vous plaît. » (${money(COFFEE_PRICE)})`, next: (g) => (g.state.money >= COFFEE_PRICE ? "cafe" : "fonds"), do: (g) => g.challenge(true) },
        { text: "« Donne-moi un café. »", next: "impoli", do: (g) => g.challenge(false) },
        { text: "« Un chocolat chaud, s'il vous plaît. » (3,25 $)", next: (g) => (g.state.money >= 3.25 ? "choco" : "fonds") },
        { text: "« Tu viens d'où ? Tu as un bel accent ! »", next: "origine" },
        { text: "Rien pour le moment, merci.", next: null },
      ],
    },
    origine: {
      text: "Merci ! Je viens d'Alger, en Algérie. Là-bas, on parle arabe, kabyle… et beaucoup français. Je suis arrivée il y a quatre ans pour étudier à l'UQAM. Tout le monde a un accent, à Montréal : c'est ça qui est beau !",
      choices: [
        { text: `« Alors je voudrais un café allongé, s'il vous plaît. » (${money(COFFEE_PRICE)})`, next: (g) => (g.state.money >= COFFEE_PRICE ? "cafe" : "fonds"), do: (g) => g.challenge(true) },
        { text: "Merci, à plus tard !", next: null },
      ],
    },
    impoli: {
      text: "Hum… un petit « s'il vous plaît », peut-être ? Ici, on aime bien la politesse !",
      choices: [
        { text: `« Pardon ! Je voudrais un café allongé, s'il vous plaît. » (${money(COFFEE_PRICE)})`, next: (g) => (g.state.money >= COFFEE_PRICE ? "cafe" : "fonds") },
        { text: "Partir", next: null },
      ],
    },
    cafe: {
      text: "Et voilà, un café allongé bien chaud ! Attention, ça brûle.",
      do: (g) => {
        g.state.pay(COFFEE_PRICE);
        g.state.give("cafe");
        g.game.audio?.ui("cash");
      },
    },
    choco: {
      text: "Un chocolat chaud avec de la guimauve, voilà ! Parfait pour un après-midi d'automne.",
      do: (g) => {
        g.state.pay(3.25);
        g.game.audio?.ui("cash");
        g.toast("☕ Miam !", "Tu bois ton chocolat chaud. Ça réchauffe !", "info");
      },
    },
    fonds: { text: "Oh, il te manque un peu d'argent… Aide des gens du quartier, ils te le rendront bien !" },
  };
}

function felixTree(): DTree<G> {
  return {
    debut: {
      text: "Salut… Excuse-moi, je suis complètement dans la lune. J'ai un examen de calcul dans une heure et je n'ai pas dormi de la nuit.",
      choices: [
        { text: "Je peux t'aider ?", next: "demande" },
        { text: "Bonne chance pour ton examen !", next: null },
      ],
    },
    demande: {
      text: "Sérieux ? Ce qu'il me faudrait, c'est un café allongé des Jardins Gamelin. Je te rembourse et je te donne un petit pourboire, promis !",
      choices: [
        { text: "J'y vais tout de suite.", next: "ok", do: (g) => g.quests.start("cafe_felix") },
        { text: "Désolé, pas maintenant.", next: null },
      ],
    },
    ok: { text: "Merci, tu me sauves la vie ! Le kiosque est dans la Place Émilie-Gamelin, de l'autre côté de la rue Berri." },
    attente: { text: "Le kiosque rouge des Jardins Gamelin, dans le parc. Un café allongé, s'il te plaît !" },
    livraison: {
      text: "Mon café ! Merci mille fois. Tiens, voici ton argent et un petit extra. Tu sais quoi ? Je pense que je vais réussir cet examen !",
      do: (g) => {
        g.state.take("cafe");
        g.quests.advance("cafe_felix", "livrer");
      },
    },
    apres: { text: "Mon examen s'est super bien passé ! Le café, c'est magique." },
  };
}

function gillesTree(): DTree<G> {
  return {
    debut: {
      text: "Maudit vent ! Excuse mon langage… Je suis Gilles, contremaître pour la Ville. Une bourrasque a renversé mes cônes partout dans la rue Saint-Denis !",
      choices: [
        { text: "Je peux vous aider à les replacer.", next: "mission" },
        { text: "Il y a toujours des cônes orange à Montréal, non ?", next: "blague" },
      ],
    },
    blague: {
      text: "Ha ! Tu n'as pas tort : le cône orange, c'est presque notre emblème officiel ! Mais ceux-là, ils doivent rester dans MA zone de travaux.",
      choices: [{ text: "D'accord, je vous aide.", next: "mission" }],
    },
    mission: {
      text: "Pousse les six cônes dans la zone tracée en orange sur la chaussée. Marche contre eux, ils vont glisser. Fais attention aux autos !",
      do: (g) => g.quests.start("cones"),
    },
    attente: { text: (g) => `Il en reste encore ! J'en compte ${coneCount(g)} sur 6 dans la zone.` },
    fini: {
      text: "Les six sont en place ! Beau travail, on va pouvoir réparer la conduite d'eau. Tiens, pour ta peine.",
      do: (g) => g.quests.advance("cones", "rapport"),
    },
    apres: { text: "Grâce à toi, le chantier est sécuritaire. Tu veux un emploi d'été ?" },
  };
}

function liseTree(): DTree<G> {
  return {
    debut: {
      text: "Oh, mon Dieu ! Excusez-moi… Mon petit chien, Poutine, a lâché sa laisse et il court partout dans le parc. Il a peur dès qu'on court vers lui !",
      choices: [
        { text: "Je vais le chercher.", next: "conseil", do: (g) => g.quests.start("chien") },
        { text: "Il s'appelle vraiment Poutine ?", next: "nom" },
      ],
    },
    nom: {
      text: "Hé oui ! Il est brun et blond comme une bonne poutine, avec sa sauce… Mon petit-fils a choisi le nom. Vous m'aidez ?",
      choices: [{ text: "Bien sûr !", next: "conseil", do: (g) => g.quests.start("chien") }],
    },
    conseil: { text: "Approchez-vous doucement en marchant (touche C), sinon il va se sauver. Merci, vous êtes bien fin !" },
    attente: { text: "Doucement, doucement… Marchez vers lui sans courir !" },
    retour: {
      text: "Poutine ! Mon beau pitou ! Merci, merci ! Tenez, prenez ceci pour vous payer un bon café.",
      do: (g) => {
        if (g.dog) {
          g.dog.follow = null;
          g.dog.caught = true;
          g.dog.pos.set(g.npc("lise").pos.x + 0.8, g.dog.pos.y, g.npc("lise").pos.z + 0.6);
        }
        g.quests.advance("chien", "ramener");
      },
    },
    apres: { text: "Poutine ne me quittera plus jamais d'une semelle. N'est-ce pas, mon pitou ?" },
  };
}

function pierreYvesTree(): DTree<G> {
  return {
    debut: {
      text: "Bonjour ! Je viens d'arriver de Lyon en autocar et mon téléphone est mort. Je dois voir un spectacle au Théâtre St-Denis… Vous savez où c'est ?",
      choices: [
        { text: "Suivez-moi, je vous y emmène !", next: "go" },
        { text: "C'est sur la rue Saint-Denis, au nord-ouest.", next: "seul" },
      ],
    },
    seul: {
      text: "Saint-Denis… nord-ouest… Euh, avec la grille de Montréal qui est penchée, je suis perdu. Vous ne voudriez pas m'accompagner ?",
      choices: [{ text: "D'accord, suivez-moi.", next: "go" }],
    },
    go: {
      text: "Génial ! Je vous suis. Au fait, ici on dit « dépanneur » pour une petite épicerie ? Chez nous, c'est une « supérette » !",
      do: (g) => {
        g.quests.start("touriste");
        const n = g.npc("pierreyves");
        const t = g.place("theatre");
        g.escort = {
          npc: n,
          target: t,
          radius: 7,
          onArrive: () => {
            g.say("pierreyves", "Le voilà ! Le Théâtre St-Denis ! Merci infiniment !", 4);
            g.quests.advance("touriste", "guider");
          },
        };
      },
    },
    route: { text: "Je vous suis ! Vous connaissez bien le quartier, dites donc." },
    apres: { text: "Quelle ville magnifique ! Et quel accent charmant, vous les Québécois !" },
  };
}

function sophieTree(): DTree<G> {
  return {
    debut: {
      text: "Salut ! Je suis bénévole pour le Festival du Quartier latin. Une bourrasque vient d'emporter mes dépliants ! Il y en a cinq qui traînent autour de la place…",
      choices: [
        { text: "Je vais les ramasser.", next: "ok", do: (g) => g.quests.start("depliants") },
        { text: "C'est quoi, le festival ?", next: "festival" },
        { text: "Tu viens d'ici ?", next: "origine" },
      ],
    },
    origine: {
      text: "Je suis née à Port-au-Prince, en Haïti. À la maison, on parle créole et français. « Bonjou ! », c'est « bonjour » en créole. Montréal, c'est chez moi depuis dix ans. Tu m'aides à retrouver mes dépliants ?",
      choices: [
        { text: "Bien sûr !", next: "ok", do: (g) => g.quests.start("depliants") },
        { text: "Plus tard, peut-être.", next: null },
      ],
    },
    festival: {
      text: "Des spectacles gratuits, de la musique, de l'humour… tout en français ! Tu m'aides à retrouver mes dépliants ?",
      choices: [{ text: "Bien sûr.", next: "ok", do: (g) => g.quests.start("depliants") }],
    },
    ok: { text: "Merci ! Ils sont blancs et brillent un peu au soleil. Regarde dans le parc et le long de la rue Berri." },
    attente: { text: (g) => `Tu en as trouvé ${g.state.inv.get("depliant") ?? 0} sur 5. Continue !` },
    fini: {
      text: "Les cinq ! Tu es une perle. Tiens, un petit quelque chose pour toi, et reviens au festival ce soir !",
      do: (g) => {
        g.state.take("depliant", 5);
        g.quests.advance("depliants", "rapporter");
      },
    },
    apres: { text: "Le festival commence à 19 h sur la place. On t'attend !" },
  };
}

function vendeurTree(): DTree<G> {
  const refus = (g: G) => g.state.flag("vape_refus");
  return {
    debut: {
      text: "Salut ! Bienvenue au Daron Fumant. Avant toute chose : quel âge as-tu ?",
      choices: [
        { text: "« J'ai 18 ans. »", next: "carte" },
        { text: "« J'ai seize ans. »", next: "mineur" },
        { text: "« Pourquoi vous me demandez ça ? »", next: "pourquoi" },
        { text: "« Je veux juste regarder. »", next: "regarder" },
      ],
    },
    pourquoi: {
      text: "Parce que c'est la loi : au Québec, il est interdit de vendre des produits de vapotage aux personnes de moins de 18 ans. Et je demande une pièce d'identité à tous ceux qui ont l'air jeunes. Alors… tu as quel âge ?",
      choices: [
        { text: "« J'ai 18 ans. »", next: "carte" },
        { text: "« Je n'ai pas encore 18 ans. »", next: "mineur" },
      ],
    },
    regarder: {
      text: "Regarder, oui, mais je ne vendrai rien à quelqu'un qui n'a pas 18 ans. C'est aussi pour ça que nos vitrines sont givrées : les produits ne doivent pas se voir de la rue. Tu as 18 ans ?",
      choices: [
        { text: "« Oui, j'ai 18 ans. »", next: "carte" },
        { text: "« Non… »", next: "mineur" },
      ],
    },
    carte: {
      text: "Parfait. Montre-moi une pièce d'identité avec photo : permis de conduire, carte d'assurance maladie ou passeport.",
      choices: [
        { text: "« Euh… je l'ai oubliée à la maison. »", next: "pasdecarte" },
        { text: "« C'est pour mon grand frère, il a 20 ans ! »", next: "frere" },
        { text: "« Bon, d'accord… j'ai 16 ans. »", next: "mineur" },
      ],
    },
    pasdecarte: {
      text: "Désolé, pas de carte, pas de vente. Tu dois avoir 18 ans pour acheter ici, et tu dois me le prouver. Je ne te vendrai rien aujourd'hui.",
      do: refus,
      choices: [
        { text: "« Allez, juste une fois ! »", next: "insiste" },
        { text: "« D'accord, je comprends. »", next: "fin" },
      ],
    },
    frere: {
      text: "Acheter pour quelqu'un d'autre ? Non plus. Si ton frère veut quelque chose, il viendra lui-même avec sa carte. Je ne vends pas aux mineurs, point final.",
      do: refus,
      choices: [
        { text: "« Allez, juste une fois ! »", next: "insiste" },
        { text: "« D'accord, je comprends. »", next: "fin" },
      ],
    },
    mineur: {
      text: "Merci d'être honnête. Mais je ne peux rien te vendre : tu dois avoir 18 ans. Si je vends à un mineur, je risque une grosse amende, et la boutique aussi.",
      do: refus,
      choices: [
        { text: "« C'est injuste ! »", next: "insiste" },
        { text: "« Je comprends. »", next: "fin" },
      ],
    },
    insiste: {
      text: "Non. C'est non, et ça va rester non. La nicotine crée une dépendance très vite, surtout à ton âge. Garde ton argent : va plutôt te payer un chocolat chaud aux Jardins Gamelin !",
      choices: [{ text: "« Bon… salut. »", next: "fin" }],
    },
    fin: {
      text: "Bonne journée ! Et si tu cherches le Théâtre St-Denis, remonte la rue Saint-Denis vers le nord, de l'autre côté de De Maisonneuve.",
    },
    revenu: {
      text: "Encore toi ? Ma réponse n'a pas changé : pas de vente aux moins de 18 ans. Reviens le jour de tes 18 ans… avec ta carte !",
      choices: [
        { text: "« Je voulais juste dire bonjour. »", next: "fin" },
        { text: "« Pourquoi c'est 18 ans ? »", next: "pourquoi" },
      ],
    },
  };
}
