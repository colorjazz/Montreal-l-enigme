import * as THREE from "three";
import { MapImage, drawStreetLabels } from "./maprender";
import type { CityData } from "../world/city";
import type { V2 } from "../world/geom";

export interface MapMarker {
  x: number;
  z: number;
  kind: "quest" | "turnin" | "target" | "npc" | "landmark" | "event";
  label?: string;
}

export interface DialogueChoiceView {
  text: string;
  disabled?: boolean;
}

export interface DialogueView {
  speaker: string;
  role?: string;
  color?: string;
  text: string;
  choices?: DialogueChoiceView[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Interface en français : position, horloge, mini-carte, quêtes, dialogues, écrans. */
export class Hud {
  readonly root = el("div", "hud");
  private loc = el("div", "hud-loc");
  private sub = el("div", "hud-sub");
  private minimap = el("div", "hud-minimap");
  private mmCanvas = el("canvas");
  private compass = el("div", "hud-compass");
  private tracker = el("div", "hud-tracker panel");
  private promptEl = el("div", "hud-prompt panel");
  private toasts = el("div", "hud-toasts");
  readonly bubbleLayer = el("div", "bubbles");
  private dialogueEl = el("div", "dialogue panel");
  readonly screens: Record<string, HTMLDivElement> = {};
  private map!: MapImage;
  private bigMapCanvas = el("canvas");
  private lastLoc = "";
  private bubbles: { el: HTMLDivElement; pos: () => THREE.Vector3 | null; until: number }[] = [];
  private markerEls: HTMLDivElement[] = [];
  /** Choix du dialogue courant (rappel). */
  private onChoice: ((i: number) => void) | null = null;
  private onAdvance: (() => void) | null = null;
  private typing = { full: "", shown: 0, done: true };
  private selected = 0;
  private choiceCount = 0;
  dialogueOpen = false;
  time = 0;

  constructor(
    private parent: HTMLElement,
    private data: CityData,
    footprints: { poly: V2[]; landmark?: string }[],
    private inPlayable: (x: number, z: number) => boolean,
  ) {
    const tl = el("div", "hud-topleft panel");
    tl.append(this.loc, this.sub);
    this.minimap.appendChild(this.mmCanvas);
    this.mmCanvas.width = 420;
    this.mmCanvas.height = 420;
    this.tracker.style.display = "none";
    this.root.append(this.bubbleLayer, tl, this.minimap, this.compass, this.tracker, this.promptEl, this.toasts, el("div", "hud-crosshair"));
    parent.append(this.root, this.dialogueEl);
    this.map = new MapImage(data, footprints);
    this.dialogueEl.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).tagName !== "BUTTON") this.advance();
    });
  }

  // ------------------------------------------------------------ bandeau d'information
  setInfo(location: string, street: string | null, clock: string, weather: string, money: number) {
    const key = `${location}|${street}`;
    if (key !== this.lastLoc) {
      this.lastLoc = key;
      this.loc.innerHTML = street ? `<span class="street-chip">${esc(street)}</span>${location && location !== street ? `<span>${esc(location)}</span>` : ""}` : esc(location);
    }
    this.sub.innerHTML = `<span>🕒 ${clock}</span><span>${weather}</span><span class="hud-money">${money.toFixed(2).replace(".", ",")} $</span>`;
  }

  setTracker(title: string | null, step: string, dist: number | null, main: boolean) {
    if (!title) {
      this.tracker.style.display = "none";
      return;
    }
    this.tracker.style.display = "block";
    this.tracker.innerHTML = `<h3>${main ? "Quête principale" : "Quête"}</h3><div class="q-title">${esc(title)}</div><div class="q-step">▸ ${step}</div>${dist !== null ? `<div class="q-dist">à ${Math.round(dist)} m · [J] journal · [M] carte</div>` : ""}`;
  }

  prompt(html: string | null) {
    if (!html) {
      this.promptEl.style.display = "none";
      return;
    }
    this.promptEl.style.display = "block";
    if (this.promptEl.innerHTML !== html) this.promptEl.innerHTML = html;
  }

  toast(title: string, body = "", kind: "quest" | "done" | "event" | "info" = "info", seconds = 4.5) {
    const t = el("div", `toast panel ${kind}`, `<b>${esc(title)}</b>${body ? `<span>${body}</span>` : ""}`);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild!.remove();
    setTimeout(() => {
      t.classList.add("out");
      setTimeout(() => t.remove(), 450);
    }, seconds * 1000);
  }

  // ------------------------------------------------------------ bulles et marqueurs 3D
  say(pos: () => THREE.Vector3 | null, text: string, seconds = 3.5) {
    const b = el("div", "bubble", esc(text));
    this.bubbleLayer.appendChild(b);
    this.bubbles.push({ el: b, pos, until: this.time + seconds });
    while (this.bubbles.length > 8) this.bubbles.shift()!.el.remove();
  }

  /** Projette bulles et marqueurs à l'écran. */
  updateOverlay(camera: THREE.Camera, markers: { pos: THREE.Vector3; text: string; cls: string }[]) {
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    const v = new THREE.Vector3();
    const camPos = (camera as THREE.PerspectiveCamera).position;
    this.bubbles = this.bubbles.filter((b) => {
      const p = b.pos();
      if (!p || this.time > b.until) {
        b.el.remove();
        return false;
      }
      v.copy(p).project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && p.distanceTo(camPos) < 45;
      b.el.style.display = vis ? "block" : "none";
      if (vis) {
        b.el.style.left = `${((v.x + 1) / 2) * w}px`;
        b.el.style.top = `${((1 - v.y) / 2) * h}px`;
      }
      return true;
    });
    while (this.markerEls.length < markers.length) {
      const m = el("div", "marker");
      this.bubbleLayer.appendChild(m);
      this.markerEls.push(m);
    }
    this.markerEls.forEach((m, i) => {
      const mk = markers[i];
      if (!mk) {
        m.style.display = "none";
        return;
      }
      v.copy(mk.pos).project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      m.style.display = vis ? "block" : "none";
      if (!vis) return;
      if (m.textContent !== mk.text) m.textContent = mk.text;
      const cls = `marker ${mk.cls}`;
      if (m.className !== cls) m.className = cls;
      m.style.left = `${((v.x + 1) / 2) * w}px`;
      m.style.top = `${((1 - v.y) / 2) * h + Math.sin(this.time * 3 + i) * 3}px`;
    });
  }

  // ------------------------------------------------------------ mini-carte
  drawMinimap(px: number, pz: number, heading: number, camYaw: number, markers: MapMarker[]) {
    const ctx = this.mmCanvas.getContext("2d")!;
    const W = this.mmCanvas.width;
    const zoom = 1.25; // pixels canvas par pixel de carte
    ctx.save();
    ctx.fillStyle = "#1b2128";
    ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2, W / 2);
    // carte orientée selon la caméra (le haut = la direction regardée)
    ctx.rotate(camYaw);
    ctx.scale(zoom, zoom);
    const [mx, my] = this.map.toPx(px, pz);
    ctx.drawImage(this.map.canvas, -mx, -my);
    // marqueurs
    for (const m of markers) {
      const [x, y] = this.map.toPx(m.x, m.z);
      let dx = x - mx;
      let dy = y - my;
      const r = Math.hypot(dx, dy);
      const maxR = (W / 2 - 14) / zoom;
      const clamped = r > maxR;
      if (clamped) {
        dx = (dx / r) * maxR;
        dy = (dy / r) * maxR;
      }
      ctx.save();
      ctx.translate(dx, dy);
      ctx.rotate(-camYaw);
      const col = m.kind === "quest" ? "#e8b923" : m.kind === "turnin" ? "#6fd08c" : m.kind === "target" ? "#ff6b6b" : m.kind === "event" ? "#7fb2ff" : m.kind === "npc" ? "#ffffff" : "#c9a0ff";
      ctx.fillStyle = col;
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      if (m.kind === "npc") ctx.arc(0, 0, 3 / zoom + 1.5, 0, Math.PI * 2);
      else ctx.arc(0, 0, (clamped ? 6 : 7) / zoom + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (m.kind === "quest" || m.kind === "turnin") {
        ctx.fillStyle = "#111";
        ctx.font = `bold ${11 / zoom + 3}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(m.kind === "quest" ? "!" : "?", 0, 0.5);
      }
      ctx.restore();
    }
    ctx.restore();
    // flèche du joueur
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(-(heading - camYaw) + Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#0a4ea2";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 11);
    ctx.lineTo(0, 5);
    ctx.lineTo(-10, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // boussole (points cardinaux de la grille montréalaise)
    const deg = ((((-camYaw * 180) / Math.PI) % 360) + 360) % 360;
    const idx = Math.round(deg / 45) % 8;
    const names = ["nord", "nord-est", "est", "sud-est", "sud", "sud-ouest", "ouest", "nord-ouest"];
    const n = names[idx];
    const txt = `Vers ${/^[eo]/.test(n) ? "l'" : "le "}${n}`;
    if (this.compass.textContent !== txt) this.compass.textContent = txt;
  }

  // ------------------------------------------------------------ dialogue
  showDialogue(v: DialogueView, onChoice: (i: number) => void, onAdvance: () => void) {
    this.dialogueOpen = true;
    this.onChoice = onChoice;
    this.onAdvance = onAdvance;
    this.dialogueEl.style.display = "block";
    const color = v.color ?? "#e8b923";
    this.typing = { full: v.text, shown: 0, done: false };
    this.selected = 0;
    this.choiceCount = v.choices?.length ?? 0;
    const choices = (v.choices ?? [])
      .map((c, i) => `<button data-i="${i}" ${c.disabled ? "disabled style='opacity:.45'" : ""} class="${i === 0 ? "sel" : ""}"><span class="key">${i + 1}</span>${c.text}</button>`)
      .join("");
    this.dialogueEl.innerHTML = `<div class="who"><span class="avatar" style="background:${color}"></span>${esc(v.speaker)}${v.role ? ` <small>· ${esc(v.role)}</small>` : ""}</div><div class="text"></div><div class="choices">${choices}</div><div class="hint">${this.choiceCount ? "Choisis une réponse (1 à " + this.choiceCount + ", ou clique)" : "[Espace] ou [E] pour continuer"}</div>`;
    this.dialogueEl.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const i = Number((b as HTMLButtonElement).dataset.i);
        if (!this.typing.done) this.finishTyping();
        this.onChoice?.(i);
      }),
    );
    (this.dialogueEl.querySelector(".choices") as HTMLElement).style.visibility = "hidden";
  }

  hideDialogue() {
    this.dialogueOpen = false;
    this.dialogueEl.style.display = "none";
    this.onChoice = null;
    this.onAdvance = null;
  }

  private finishTyping() {
    this.typing.shown = this.typing.full.length;
    this.typing.done = true;
    const t = this.dialogueEl.querySelector(".text");
    if (t) t.innerHTML = this.typing.full;
    const c = this.dialogueEl.querySelector(".choices") as HTMLElement | null;
    if (c) c.style.visibility = "visible";
  }

  /** Espace / E : termine le texte ou passe à la suite. */
  advance() {
    if (!this.dialogueOpen) return;
    if (!this.typing.done) {
      this.finishTyping();
      return;
    }
    if (this.choiceCount === 0) this.onAdvance?.();
    else this.onChoice?.(this.selected);
  }

  choose(i: number) {
    if (!this.dialogueOpen || i >= this.choiceCount) return;
    if (!this.typing.done) this.finishTyping();
    const btn = this.dialogueEl.querySelectorAll("button")[i] as HTMLButtonElement | undefined;
    if (btn?.disabled) return;
    this.onChoice?.(i);
  }

  moveSelection(d: number) {
    if (!this.choiceCount) return;
    this.selected = (this.selected + d + this.choiceCount) % this.choiceCount;
    this.dialogueEl.querySelectorAll("button").forEach((b, i) => b.classList.toggle("sel", i === this.selected));
  }

  update(dt: number) {
    this.time += dt;
    if (this.dialogueOpen && !this.typing.done) {
      this.typing.shown += dt * 75;
      // affiche le texte progressivement sans couper les balises
      const full = this.typing.full;
      let n = Math.floor(this.typing.shown);
      if (n >= full.length) {
        this.finishTyping();
      } else {
        // saute les balises HTML
        const open = full.lastIndexOf("<", n);
        const close = full.lastIndexOf(">", n);
        if (open > close) n = full.indexOf(">", n) + 1;
        const t = this.dialogueEl.querySelector(".text");
        if (t) t.innerHTML = full.slice(0, n);
      }
    }
  }

  // ------------------------------------------------------------ écrans
  screen(id: string, html: string, show = true): HTMLDivElement {
    let s = this.screens[id];
    if (!s) {
      s = el("div", "screen");
      s.dataset.id = id;
      this.parent.appendChild(s);
      this.screens[id] = s;
    }
    s.innerHTML = `<div class="card">${html}</div>`;
    s.classList.toggle("show", show);
    return s;
  }

  hideScreen(id: string) {
    this.screens[id]?.classList.remove("show");
  }

  isScreenOpen(id?: string) {
    if (id) return !!this.screens[id]?.classList.contains("show");
    return Object.values(this.screens).some((s) => s.classList.contains("show"));
  }

  /** Grande carte avec noms de rues, repères et marqueurs de quête. */
  renderBigMap(px: number, pz: number, heading: number, markers: MapMarker[], landmarks: { name: string; pos: V2 }[]): HTMLCanvasElement {
    const c = this.bigMapCanvas;
    const src = this.map.canvas;
    // recadrage sur la zone jouable
    const xs = this.data.walkable.map((p) => p[0]);
    const zs = this.data.walkable.map((p) => p[1]);
    const [x0, y0] = this.map.toPx(Math.min(...xs) - 20, Math.min(...zs) - 20);
    const [x1, y1] = this.map.toPx(Math.max(...xs) + 20, Math.max(...zs) + 20);
    const sw = x1 - x0;
    const sh = y1 - y0;
    const k = Math.min(1500 / sw, 1500 / sh);
    c.width = Math.round(sw * k);
    c.height = Math.round(sh * k);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(src, x0, y0, sw, sh, 0, 0, c.width, c.height);
    const toPx = (x: number, z: number): [number, number] => {
      const [mx, my] = this.map.toPx(x, z);
      return [(mx - x0) * k, (my - y0) * k];
    };
    drawStreetLabels(ctx, this.data, toPx, this.inPlayable, 15);
    ctx.font = 'bold 14px "Trebuchet MS", "DejaVu Sans", sans-serif';
    ctx.textAlign = "center";
    for (const l of landmarks) {
      const [x, y] = toPx(l.pos[0], l.pos[1]);
      ctx.fillStyle = "#c9a0ff";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(l.name, x, y - 12);
      ctx.fillStyle = "#f1e6ff";
      ctx.fillText(l.name, x, y - 12);
    }
    for (const m of markers) {
      if (m.kind === "npc") continue;
      const [x, y] = toPx(m.x, m.z);
      ctx.fillStyle = m.kind === "quest" ? "#e8b923" : m.kind === "turnin" ? "#6fd08c" : m.kind === "event" ? "#7fb2ff" : "#ff6b6b";
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
      if (m.label) {
        ctx.fillStyle = "#fff";
        ctx.strokeText(m.label, x, y + 24);
        ctx.fillText(m.label, x, y + 24);
      }
    }
    const [ppx, ppy] = toPx(px, pz);
    ctx.save();
    ctx.translate(ppx, ppy);
    ctx.rotate(-heading + Math.PI);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#0a4ea2";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(11, 12);
    ctx.lineTo(0, 6);
    ctx.lineTo(-11, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return c;
  }

  get choicesVisible() {
    return this.choiceCount;
  }
}
