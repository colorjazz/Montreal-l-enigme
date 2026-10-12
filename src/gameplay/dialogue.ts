import type { Hud } from "../ui/hud";

type Val<C, T> = T | ((c: C) => T);

export interface DChoice<C> {
  text: Val<C, string>;
  next?: Val<C, string | null>;
  if?: (c: C) => boolean;
  do?: (c: C) => void;
}

export interface DNode<C> {
  /** Remplace le nom de l'interlocuteur (ex. « Toi »). */
  speaker?: string;
  text: Val<C, string>;
  choices?: DChoice<C>[];
  next?: Val<C, string | null>;
  do?: (c: C) => void;
}

export type DTree<C> = Record<string, DNode<C>>;

export interface Speaker {
  name: string;
  role?: string;
  color?: string;
}

function val<C, T>(v: Val<C, T>, c: C): T {
  return typeof v === "function" ? (v as (c: C) => T)(c) : v;
}

/** Exécute un arbre de dialogue dans la boîte de dialogue de l'interface. */
export class DialogueRunner<C> {
  private tree: DTree<C> | null = null;
  private speaker: Speaker | null = null;
  private onClose: (() => void) | null = null;
  private visible: DChoice<C>[] = [];
  private node: DNode<C> | null = null;
  /** Historique (tests et journal). */
  readonly log: { speaker: string; text: string }[] = [];
  currentId: string | null = null;

  constructor(
    private hud: Hud,
    private ctx: () => C,
  ) {}

  get open() {
    return this.tree !== null;
  }

  start(speaker: Speaker, tree: DTree<C>, startId: string, onClose?: () => void) {
    this.tree = tree;
    this.speaker = speaker;
    this.onClose = onClose ?? null;
    this.show(startId);
  }

  private show(id: string | null) {
    if (!id || !this.tree || !this.tree[id]) {
      this.close();
      return;
    }
    const c = this.ctx();
    const node = this.tree[id];
    this.node = node;
    this.currentId = id;
    node.do?.(c);
    // l'effet a pu fermer ou relancer un dialogue
    if (this.node !== node) return;
    const text = val(node.text, c);
    this.visible = (node.choices ?? []).filter((ch) => !ch.if || ch.if(c));
    const name = node.speaker ?? this.speaker!.name;
    this.log.push({ speaker: name, text: text.replace(/<[^>]+>/g, "") });
    this.hud.showDialogue(
      {
        speaker: name,
        role: node.speaker ? undefined : this.speaker!.role,
        color: node.speaker === "Toi" ? "#4ea3ff" : this.speaker!.color,
        text,
        choices: this.visible.map((ch) => ({ text: val(ch.text, c) })),
      },
      (i) => this.choose(i),
      () => this.next(),
    );
  }

  choose(i: number) {
    const ch = this.visible[i];
    if (!ch) return;
    const c = this.ctx();
    this.log.push({ speaker: "Toi", text: val(ch.text, c).replace(/<[^>]+>/g, "") });
    ch.do?.(c);
    if (!this.tree) return;
    this.show(ch.next === undefined ? null : val(ch.next, c));
  }

  next() {
    if (!this.node) return;
    const c = this.ctx();
    this.show(this.node.next === undefined ? null : val(this.node.next, c));
  }

  /** Va directement à un nœud (depuis un effet). */
  goto(id: string) {
    this.show(id);
  }

  close() {
    const cb = this.onClose;
    this.tree = null;
    this.node = null;
    this.currentId = null;
    this.onClose = null;
    this.hud.hideDialogue();
    cb?.();
  }
}
