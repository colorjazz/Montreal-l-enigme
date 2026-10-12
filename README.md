# Montréal, l'énigme

Monde 3D explorable à la troisième personne, en français, du **Quartier
latin de Montréal** autour de la **station Berri-UQAM** : rues, bâtiments,
Place Émilie-Gamelin, métro souterrain, passants, circulation, quêtes et
événements aléatoires. Tout tourne dans le navigateur (Three.js + physique
Rapier), sans serveur ni image externe.

> Lundi 12 octobre, jour de l'Action de grâce. Les érables ont pris leurs
> couleurs d'automne… et une vieille énigme refait surface : où les
> étudiants de 1966 ont-ils caché le *Vaisseau d'or* ?

## Lancer le jeu

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # version de production dans dist/
npm test           # construit, sert dist/ et lance la vérification automatisée
```

Déploiement : `netlify.toml` est prêt (dossier publié : `dist`). Le site est
entièrement statique, il peut aussi être servi par GitHub Pages ou tout
autre hébergeur.

## Commandes

| Touche | Action |
| --- | --- |
| W A S D / flèches | se déplacer (positions physiques des touches : fonctionne aussi en AZERTY) |
| Souris | regarder (cliquer pour verrouiller le pointeur) |
| Maj | courir · **C** marcher lentement · **Espace** sauter |
| E | parler, ramasser, interagir |
| 1 à 4 | choisir une réponse dans un dialogue |
| J | journal des quêtes et sac à dos |
| M | carte du quartier |
| Molette | zoom de la caméra |
| Échap | pause et réglages (volume, heure du jour, qualité graphique) |
| N | couper le son |

Sur tablette ou téléphone : joystick à gauche, zone de regard à droite,
boutons E / saut / course.

## Ce qu'on trouve dans le monde

**La ville** est reconstruite à partir de la carte fournie
(`tools/carte-berri-uqam.webp`) : 22 axes de rue relevés sur la carte
(Berri, Saint-Denis, Sainte-Catherine, De Maisonneuve, Ontario,
René-Lévesque avec son terre-plein, Sanguinet, Saint-Hubert, etc.),
225 empreintes de bâtiments vectorisées à partir de la carte, complétées par
des rangées de bâtiments mitoyens typiques du quartier et une ceinture de
ville au-delà des limites. Plaques de rue bleues, panneaux « ARRÊT », feux
de circulation, lampadaires, érables d'automne, stations BIXI, abribus STM,
bornes-fontaines, balcons et escaliers extérieurs montréalais (on peut y
monter), voitures stationnées, enseignes de commerces en français
(dépanneur, boulangerie, poutinerie, friperie…).

**Les repères** : édicule et station Berri-UQAM (escalier, mezzanine,
distributeur OPUS, tourniquets, quai de la ligne verte, rame bleue qui entre
en gare), clocher de l'église Saint-Jacques intégré au pavillon
Judith-Jasmin de l'UQAM, pavillon Hubert-Aquin, 1259 rue Berri, Grande
Bibliothèque (BAnQ), gare d'autocars, Théâtre St-Denis et sa marquise,
Place Dupuis, Place Émilie-Gamelin (allées, sculptures, Jardins Gamelin et
leurs guirlandes), Place Pasteur, Cégep du Vieux Montréal ; au loin, le
mont Royal et sa croix illuminée, le centre-ville, le pont Jacques-Cartier.

**La vie du quartier** : 11 personnages nommés avec dialogues à choix,
une quarantaine de passants qui circulent sur les trottoirs et traversent
aux passages piétons (on peut les saluer), une vingtaine de voitures, taxis
et autobus de la STM qui respectent les feux et les arrêts, freinent devant
les piétons et klaxonnent. Cycle jour/nuit (fenêtres et vitrines qui
s'allument, halos des lampadaires, lune, étoiles), cloches du clocher à
chaque heure, pigeons, feuilles qui tombent, ambiance sonore synthétisée.

**Quêtes** (journal : touche J)

- *L'énigme du Vaisseau d'or* (principale, 9 étapes) : professeure Gagnon →
  Grande Bibliothèque → Théâtre St-Denis (billet perdu) → métro Berri-UQAM
  (acheter une carte OPUS) → plaque du clocher Saint-Jacques → musicien de
  la Place Émilie-Gamelin (lui apporter un café) → retour à la professeure.
  S'appuie sur le sonnet d'Émile Nelligan (1899, domaine public).
- *Un café pour Félix* · *Le vent et les cônes orange* (pousser physiquement
  six cônes dans la zone de chantier) · *Où est Poutine ?* (attraper un
  chien qui fuit si l'on court) · *Un Lyonnais à Montréal* (escorte) ·
  *Dépliants au vent* · *Le portefeuille perdu* (déclenchée par un
  événement).

**Événements aléatoires** (toutes les 1 à 2 minutes) : averse (chaussée
mouillée, parapluies), manifestation étudiante sur Sainte-Catherine,
violoniste de rue, portefeuille perdu, tournage de film rue Saint-Denis,
panne des feux avec une policière, camion de poutine, feux d'artifice la
nuit.

## Ajouter le contenu pédagogique

Le contenu est séparé du moteur : tout se trouve dans
`src/content/story.ts`.

- **Dialogues** : chaque personnage a un arbre de nœuds `{ text, choices,
  next, do }`. Un choix peut appeler `g.challenge(true|false)`, qui compte
  les réponses justes (affiché dans le journal sous « Défis de français »).
  Exemple de défi :

  ```ts
  question: {
    text: "Complète : « Hier, nous ___ au métro. »",
    choices: [
      { text: "sommes allés", next: "bravo", do: (g) => g.challenge(true) },
      { text: "avons allé", next: "explication", do: (g) => g.challenge(false) },
    ],
  },
  ```
- **Quêtes** : tableau `QuestDef` (titre, étapes, cible sur la carte,
  condition de réussite, récompense). `g.quests.start(id)`,
  `g.quests.advance(id, étape)`.
- **Personnages** : `g.addNpc({ id, name, role, look, at, barks }, arbre,
  nœudDeDépart, marqueur)`. L'apparence est générée (peau, cheveux,
  vêtements, tuque, foulard, sac à dos…).
- **Objets** : `g.addCollectible(id, objet, x, z)` ; objets connus dans
  `src/gameplay/state.ts`.

## Architecture

```
tools/generate_city.py   carte → src/data/city.json (rues, îlots, bâtiments, arbres, réseau piéton)
src/world/               ville, textures procédurales, repères, mobilier, métro, circulation, ciel
src/actors/              personnage articulé (squelette procédural), joueur, PNJ, passants, chien
src/gameplay/            état, quêtes, dialogues, interactions, événements
src/content/story.ts     textes, personnages et quêtes (en français)
src/ui/                  interface : bandeau, mini-carte, dialogues, journal, carte, écrans
src/core/                physique (Rapier), entrées, son (Web Audio), textures
tests/verify.mjs         vérification automatisée (Playwright)
```

Le repère du monde suit la grille montréalaise : X = « est » (le long de
Sainte-Catherine), Z = « sud » (le long de Berri), origine au coin Berri /
De Maisonneuve. Le soleil suit sa vraie course de la mi-octobre (la grille
est tournée de 57° par rapport au nord vrai).

Régénérer la ville (Python 3 avec `numpy opencv-python-headless shapely
pillow`) : `python tools/generate_city.py`.

## Vérification

`npm test` construit le jeu, le sert, ouvre Chromium sans écran et exécute
28 tests : chargement, contenu du monde, rendu, marche / course / saut,
collision avec un bâtiment, montée d'une bordure, descente dans le métro,
tourniquet (bloqué sans carte OPUS), arrivée de la rame, objets physiques,
dialogues des 11 personnages, la quête principale de bout en bout, les 6
quêtes secondaires, les 8 événements, le planificateur d'événements, la
circulation (arrêts aux feux, arrêt devant le joueur, aucun choc), le cycle
jour/nuit, l'interface, le son, les performances et l'absence d'erreurs.
Le rapport (`tests/artefacts/rapport.json`) et des captures d'écran sont
écrits dans `tests/artefacts/`.

## Notes

- Textures, personnages, sons et musique sont générés par le code : aucun
  fichier tiers. Les commerces sont fictifs ; les lieux publics portent
  leur vrai nom.
- Les hauteurs de bâtiments sont estimées (la carte n'en donne pas) et la
  rue en bordure nord-ouest de la carte n'est pas nommée faute de
  certitude.
