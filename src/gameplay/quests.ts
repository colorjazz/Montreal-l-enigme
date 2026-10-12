import type { V2 } from "../world/geom";

/** Contexte passé aux conditions et effets des quêtes et des dialogues. */
export interface Ctx {
  [k: string]: unknown;
}

export interface QuestStep<C> {
  id: string;
  /** Objectif affiché (HTML permis). */
  text: string | ((c: C) => string);
  /** Position cible pour la carte et la flèche. */
  target?: (c: C) => V2 | null;
  /** Condition de réussite vérifiée en continu (facultative). */
  done?: (c: C) => boolean;
}

export interface QuestDef<C> {
  id: string;
  title: string;
  main?: boolean;
  giver: string;
  summary: string;
  steps: QuestStep<C>[];
  reward?: { money?: number; item?: string; text?: string };
  /** Appelé à la fin (avant la récompense). */
  onComplete?: (c: C) => void;
}

export type QuestStatus = "available" | "active" | "done";

export interface QuestRuntime {
  status: QuestStatus;
  step: number;
  startedAt: number;
  doneAt?: number;
}

/** Gestionnaire de quêtes : démarrage, étapes, récompenses, suivi. */
export class QuestManager<C> {
  readonly defs = new Map<string, QuestDef<C>>();
  readonly rt = new Map<string, QuestRuntime>();
  tracked: string | null = null;
  onStart: ((q: QuestDef<C>) => void) | null = null;
  onStep: ((q: QuestDef<C>, step: QuestStep<C>) => void) | null = null;
  onComplete: ((q: QuestDef<C>) => void) | null = null;
  time = 0;

  constructor(
    defs: QuestDef<C>[],
    private ctx: () => C,
  ) {
    for (const d of defs) {
      this.defs.set(d.id, d);
      this.rt.set(d.id, { status: "available", step: 0, startedAt: 0 });
    }
  }

  status(id: string): QuestStatus {
    return this.rt.get(id)?.status ?? "available";
  }
  isActive(id: string) {
    return this.status(id) === "active";
  }
  isDone(id: string) {
    return this.status(id) === "done";
  }
  stepId(id: string): string | null {
    const r = this.rt.get(id);
    const d = this.defs.get(id);
    if (!r || !d || r.status !== "active") return null;
    return d.steps[r.step]?.id ?? null;
  }
  /** Vrai si la quête est active et à l'étape donnée. */
  at(id: string, step: string) {
    return this.stepId(id) === step;
  }

  start(id: string) {
    const r = this.rt.get(id);
    const d = this.defs.get(id);
    if (!r || !d || r.status !== "available") return;
    r.status = "active";
    r.step = 0;
    r.startedAt = this.time;
    if (!this.tracked || d.main || this.status(this.tracked) !== "active") this.tracked = id;
    this.onStart?.(d);
  }

  /** Passe à l'étape suivante (ou termine). */
  advance(id: string, expectStep?: string) {
    const r = this.rt.get(id);
    const d = this.defs.get(id);
    if (!r || !d || r.status !== "active") return;
    if (expectStep && d.steps[r.step]?.id !== expectStep) return;
    r.step++;
    if (r.step >= d.steps.length) this.complete(id);
    else {
      this.tracked = id;
      this.onStep?.(d, d.steps[r.step]);
    }
  }

  /** Saute directement à une étape nommée. */
  goto(id: string, step: string) {
    const r = this.rt.get(id);
    const d = this.defs.get(id);
    if (!r || !d || r.status !== "active") return;
    const i = d.steps.findIndex((s) => s.id === step);
    if (i >= 0 && i !== r.step) {
      r.step = i;
      this.onStep?.(d, d.steps[i]);
    }
  }

  complete(id: string) {
    const r = this.rt.get(id);
    const d = this.defs.get(id);
    if (!r || !d || r.status === "done") return;
    r.status = "done";
    r.doneAt = this.time;
    d.onComplete?.(this.ctx());
    this.onComplete?.(d);
    if (this.tracked === id) this.tracked = this.firstActive();
  }

  firstActive(): string | null {
    let best: string | null = null;
    for (const [id, r] of this.rt) {
      if (r.status !== "active") continue;
      if (!best || this.defs.get(id)!.main) best = id;
    }
    return best;
  }

  active(): QuestDef<C>[] {
    return [...this.defs.values()].filter((d) => this.isActive(d.id));
  }

  currentStep(id: string): QuestStep<C> | null {
    const r = this.rt.get(id);
    const d = this.defs.get(id);
    if (!r || !d || r.status !== "active") return null;
    return d.steps[r.step] ?? null;
  }

  stepText(id: string): string {
    const s = this.currentStep(id);
    if (!s) return "";
    return typeof s.text === "function" ? s.text(this.ctx()) : s.text;
  }

  /** Vérifie les conditions automatiques des étapes actives. */
  update(dt: number) {
    this.time += dt;
    const c = this.ctx();
    for (const d of this.defs.values()) {
      const r = this.rt.get(d.id)!;
      if (r.status !== "active") continue;
      const s = d.steps[r.step];
      if (s?.done?.(c)) this.advance(d.id);
    }
  }

  serialize() {
    return { rt: [...this.rt], tracked: this.tracked };
  }

  load(o: ReturnType<QuestManager<C>["serialize"]>) {
    for (const [id, r] of o.rt) if (this.rt.has(id)) this.rt.set(id, r);
    this.tracked = o.tracked;
  }
}
