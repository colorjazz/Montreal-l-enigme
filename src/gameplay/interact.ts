import * as THREE from "three";

export interface Interactable {
  id: string;
  pos: () => THREE.Vector3;
  radius: number;
  /** Texte de l'invite (null = non disponible pour l'instant). */
  label: () => string | null;
  action: () => void;
  /** Marqueur flottant au-dessus (« ! », « ? », « … »), facultatif. */
  marker?: () => { text: string; cls: string; height: number } | null;
  priority?: number;
}

/** Choisit l'objet interactif le plus pertinent devant le joueur. */
export class Interactions {
  readonly list: Interactable[] = [];
  current: Interactable | null = null;

  add(i: Interactable) {
    this.list.push(i);
    return i;
  }

  remove(id: string) {
    const k = this.list.findIndex((i) => i.id === id);
    if (k >= 0) this.list.splice(k, 1);
  }

  get(id: string) {
    return this.list.find((i) => i.id === id) ?? null;
  }

  update(player: THREE.Vector3, facing: number): Interactable | null {
    let best: Interactable | null = null;
    let bestScore = Infinity;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    for (const it of this.list) {
      const p = it.pos();
      const dx = p.x - player.x;
      const dz = p.z - player.z;
      const dy = Math.abs(p.y - player.y);
      if (dy > 2.5) continue;
      const d = Math.hypot(dx, dz);
      if (d > it.radius) continue;
      if (!it.label()) continue;
      // préfère ce qui est devant le joueur
      const front = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      const score = d * (1.6 - 0.6 * front) - (it.priority ?? 0);
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    this.current = best;
    return best;
  }
}
