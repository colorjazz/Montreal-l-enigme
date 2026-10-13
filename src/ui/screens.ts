import type { Game } from "../game";
import type { Gameplay } from "../gameplay/world";
import { ITEMS, money } from "../gameplay/state";
import { esc } from "./hud";

const CONTROLS = `
<div class="controls">
  <div><span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span> se déplacer</div>
  <div><span class="key">Souris</span> regarder (clic pour verrouiller)</div>
  <div><span class="key">Maj</span> courir</div>
  <div><span class="key">C</span> marcher lentement</div>
  <div><span class="key">Espace</span> sauter</div>
  <div><span class="key">E</span> parler / interagir</div>
  <div><span class="key">1</span>–<span class="key">4</span> choisir une réponse</div>
  <div><span class="key">J</span> journal des quêtes</div>
  <div><span class="key">M</span> carte du quartier</div>
  <div><span class="key">Molette</span> zoom de la caméra</div>
  <div><span class="key">Échap</span> pause et réglages</div>
  <div><span class="key">N</span> couper le son</div>
</div>`;

/** Écrans plein format : accueil, pause, journal, carte. */
export class Screens {
  constructor(
    private game: Game,
    private g: Gameplay,
  ) {}

  get open() {
    return this.g.hud.isScreenOpen();
  }

  private setPaused(p: boolean) {
    this.game.paused = p;
    this.game.input.enabled = !p;
    if (p) this.game.input.releaseLock();
    // retour au jeu : on reprend le contrôle de la caméra (le clic ou la touche est le geste requis)
    else if (!this.open && !this.g.dialogue.open) this.game.input.requestLock();
  }

  intro(onStart: () => void) {
    const s = this.g.hud.screen(
      "intro",
      `<div class="intro-hero"><div class="metro-logo"></div><div><h1>Montréal, l'énigme</h1><div style="opacity:.8">Quartier latin · autour de la station Berri-UQAM</div></div></div>
      <p>Lundi 12 octobre, jour de l'Action de grâce. Les érables de la Place Émilie-Gamelin ont pris leurs couleurs d'automne, les Jardins Gamelin vivent leur dernière fin de semaine… et une vieille énigme refait surface au Quartier latin.</p>
      <p>Promène-toi, parle aux gens (tout se passe en français), aide le quartier et perce le mystère du <em>Vaisseau d'or</em>. La professeure Hélène Gagnon t'attend juste devant l'UQAM, à côté de l'entrée du métro.</p>
      <h2>Commandes</h2>${CONTROLS}
      <div class="row" style="margin-top:20px"><button class="btn" data-go>Commencer l'exploration</button><span style="opacity:.6;font-size:13px">Astuce : la caméra suit la souris une fois le pointeur verrouillé.</span></div>`,
    );
    this.setPaused(true);
    (s.querySelector("[data-go]") as HTMLButtonElement).addEventListener("click", () => {
      this.g.hud.hideScreen("intro");
      this.setPaused(false);
      onStart();
    });
  }

  togglePause() {
    if (this.g.hud.isScreenOpen("pause")) {
      this.g.hud.hideScreen("pause");
      this.setPaused(false);
      return;
    }
    if (this.open) {
      for (const id of ["journal", "carte"]) this.g.hud.hideScreen(id);
      this.setPaused(false);
      return;
    }
    const a = this.game.audio;
    const env = this.game.env;
    const s = this.g.hud.screen(
      "pause",
      `<h1>Pause</h1>
      <div class="row" style="margin:10px 0 4px"><button class="btn" data-resume>Reprendre</button><button class="btn ghost" data-journal>Journal (J)</button><button class="btn ghost" data-map>Carte (M)</button></div>
      <h2>Réglages</h2>
      <div class="settings">
        <label>Volume <input type="range" min="0" max="1" step="0.05" value="${a?.volume ?? 0.8}" data-vol></label>
        <label>Heure de la journée <input type="range" min="0" max="23.9" step="0.1" value="${env.hours.toFixed(1)}" data-hour> <span data-hourtxt>${env.clockText()}</span></label>
        <label>Vitesse du temps <select data-speed><option value="0">Arrêté</option><option value="1" selected>Normale (1 min = 1 h)</option><option value="6">Rapide</option></select></label>
        <label>Qualité graphique <select data-q><option value="hi">Élevée (ombres)</option><option value="lo">Rapide (sans ombres)</option></select></label>
        <label>Sensibilité de la souris <input type="range" min="0.4" max="2" step="0.1" value="${this.game.player.mouseSens}" data-sens></label>
      </div>
      <h2>Commandes</h2>${CONTROLS}`,
    );
    this.setPaused(true);
    s.querySelector("[data-resume]")!.addEventListener("click", () => this.togglePause());
    s.querySelector("[data-journal]")!.addEventListener("click", () => {
      this.g.hud.hideScreen("pause");
      this.journal();
    });
    s.querySelector("[data-map]")!.addEventListener("click", () => {
      this.g.hud.hideScreen("pause");
      this.map();
    });
    s.querySelector("[data-vol]")!.addEventListener("input", (e) => a?.setVolume(Number((e.target as HTMLInputElement).value)));
    s.querySelector("[data-hour]")!.addEventListener("input", (e) => {
      env.hours = Number((e.target as HTMLInputElement).value);
      env.refreshEnv();
      env.apply(this.game.focus);
      (s.querySelector("[data-hourtxt]") as HTMLElement).textContent = env.clockText();
    });
    s.querySelector("[data-speed]")!.addEventListener("change", (e) => (env.timeScale = Number((e.target as HTMLSelectElement).value)));
    const q = s.querySelector("[data-q]") as HTMLSelectElement;
    q.value = this.game.renderer.shadowMap.enabled ? "hi" : "lo";
    q.addEventListener("change", () => this.game.setQuality(q.value as "hi" | "lo"));
    s.querySelector("[data-sens]")!.addEventListener("input", (e) => (this.game.player.mouseSens = Number((e.target as HTMLInputElement).value)));
  }

  journal() {
    if (this.g.hud.isScreenOpen("journal")) {
      this.g.hud.hideScreen("journal");
      this.setPaused(false);
      return;
    }
    const qm = this.g.quests;
    const list = [...qm.defs.values()]
      .filter((d) => qm.status(d.id) !== "available")
      .sort((a, b) => Number(qm.isDone(a.id)) - Number(qm.isDone(b.id)) || Number(!!b.main) - Number(!!a.main))
      .map((d) => {
        const r = qm.rt.get(d.id)!;
        const steps = d.steps
          .map((s, i) => {
            if (i > r.step && r.status !== "done") return "";
            const txt = typeof s.text === "function" ? s.text(this.g) : s.text;
            return `<li class="${i < r.step || r.status === "done" ? "ok" : ""}">${txt}</li>`;
          })
          .join("");
        return `<div class="q ${d.main ? "main" : ""} ${r.status === "done" ? "done" : ""}"><h4>${esc(d.title)}<span class="tag">${d.main ? "principale" : "secondaire"} · ${r.status === "done" ? "terminée" : "en cours"}</span></h4><div style="font-size:14px;opacity:.85">${esc(d.summary)}</div><ol>${steps}</ol></div>`;
      })
      .join("");
    const avail = [...qm.defs.values()].filter((d) => qm.status(d.id) === "available" && d.giver !== "evenement").length;
    const inv = [...this.g.state.inv]
      .map(([id, n]) => `<span title="${esc(ITEMS[id]?.desc ?? "")}">${ITEMS[id]?.icon ?? "•"} ${esc(ITEMS[id]?.name ?? id)}${n > 1 ? ` ×${n}` : ""}</span>`)
      .join("");
    const st = this.g.state.stats;
    this.g.hud.screen(
      "journal",
      `<h1>Journal</h1>
      <div class="row" style="opacity:.85;font-size:14px;margin-bottom:8px"><span>Argent : <b>${money(this.g.state.money)}</b></span><span>Quêtes terminées : <b>${st.questsDone}</b></span><span>Conversations : <b>${st.talks}</b></span><span>Défis de français : <b>${this.g.readiness.right} / ${this.g.readiness.tried}</b></span><span>Événements vus : <b>${st.eventsSeen}</b></span></div>
      <h2>Quêtes</h2><div class="quest-list">${list || "<p>Aucune quête pour l'instant. Parle aux gens qui ont un <b style='color:#e8b923'>!</b> au-dessus de la tête.</p>"}</div>
      ${avail ? `<p style="opacity:.7;font-size:14px">${avail} autre(s) personne(s) du quartier ont besoin d'aide : cherche les <b style="color:#e8b923">!</b> sur la carte.</p>` : ""}
      <h2>Sac à dos</h2><div class="inv">${inv || "<span>Vide</span>"}</div>
      <div class="row" style="margin-top:18px"><button class="btn" data-close>Fermer (J)</button></div>`,
    );
    this.setPaused(true);
    this.g.hud.screens.journal.querySelector("[data-close]")!.addEventListener("click", () => this.journal());
  }

  map() {
    if (this.g.hud.isScreenOpen("carte")) {
      this.g.hud.hideScreen("carte");
      this.setPaused(false);
      return;
    }
    const p = this.game.player;
    const s = this.g.hud.screen("carte", `<h1>Quartier latin</h1><div style="opacity:.75;font-size:14px;margin-bottom:8px">Nord de la grille montréalaise vers le haut · <span style="color:#e8b923">●</span> quête · <span style="color:#6fd08c">●</span> à rapporter · <span style="color:#ff6b6b">●</span> objectif · <span style="color:#7fb2ff">●</span> événement · <span style="color:#c9a0ff">●</span> lieu</div><div class="bigmap"></div><div class="row" style="margin-top:12px"><button class="btn" data-close>Fermer (M)</button></div>`);
    const lm = this.game.landmarks.info.map((i) => ({ name: i.name, pos: i.pos }));
    const canvas = this.g.hud.renderBigMap(p.position.x, p.position.z, p.facing, this.g.mapMarkers(), lm);
    s.querySelector(".bigmap")!.appendChild(canvas);
    this.setPaused(true);
    s.querySelector("[data-close]")!.addEventListener("click", () => this.map());
  }

  ending() {
    const st = this.g.state.stats;
    this.g.hud.screen(
      "fin",
      `<h1>Le Vaisseau d'or est retrouvé !</h1>
      <div class="poem">Ce fut un grand Vaisseau taillé dans l'or massif :<br>Ses mâts touchaient l'azur, sur des mers inconnues ;<br>La Cyprine d'amour, cheveux épars, chairs nues,<br>S'étalait à sa proue, au soleil excessif.<br><span style="opacity:.7">— Émile Nelligan, « Le Vaisseau d'or » (1899)</span></div>
      <p>Bravo ! Tu as percé l'énigme du Quartier latin en ${Math.round(this.g.time / 60)} minutes, après ${st.talks} conversations. Le quartier continue de vivre : d'autres personnes ont peut-être besoin de toi.</p>
      <div class="row"><button class="btn" data-close>Continuer à explorer</button></div>`,
    );
    this.setPaused(true);
    this.g.hud.screens.fin.querySelector("[data-close]")!.addEventListener("click", () => {
      this.g.hud.hideScreen("fin");
      this.setPaused(false);
    });
  }
}
