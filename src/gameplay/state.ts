/** État de la partie : argent, inventaire, drapeaux, statistiques. Sauvegardé localement. */

export const ITEMS: Record<string, { name: string; icon: string; desc: string }> = {
  opus: { name: "Carte OPUS", icon: "🎫", desc: "Carte de transport de la STM, chargée d'un passage." },
  cafe: { name: "Café allongé", icon: "☕", desc: "Un café allongé bien chaud des Jardins Gamelin." },
  billet: { name: "Billet de spectacle", icon: "🎟️", desc: "Un billet pour le Théâtre St-Denis, perdu par une spectatrice." },
  livre: { name: "Livre de la BAnQ", icon: "📕", desc: "« Poésies » d'Émile Nelligan, emprunté à la Grande Bibliothèque." },
  indice1: { name: "Indice n° 1", icon: "📜", desc: "« Là où l'on rit et chante depuis 1916. »" },
  indice2: { name: "Indice n° 2", icon: "📜", desc: "« Sous la terre, trois lignes se croisent. »" },
  indice3: { name: "Indice n° 3", icon: "📜", desc: "« Là où les cloches ne sonnent plus pour la messe, mais pour le savoir. »" },
  indice4: { name: "Indice n° 4", icon: "📜", desc: "« Cherche la musique sur la place où l'on se rassemble. »" },
  vaisseau: { name: "Le Vaisseau d'or", icon: "⛵", desc: "Une petite caravelle dorée, cachée depuis 1966 par des étudiants du Quartier latin." },
  portefeuille: { name: "Portefeuille", icon: "👛", desc: "Un portefeuille brun trouvé sur le trottoir. Il contient une carte au nom de Mariama Diallo." },
  depliant: { name: "Dépliant du festival", icon: "📰", desc: "Programme des spectacles du Quartier latin." },
  poutine: { name: "Poutine", icon: "🍟", desc: "Frites, fromage en grains et sauce brune." },
};

export interface Stats {
  talks: number;
  questsDone: number;
  eventsSeen: number;
  conesPlaced: number;
  distance: number;
}

export class GameState {
  money = 20;
  inv = new Map<string, number>();
  flags = new Set<string>();
  stats: Stats = { talks: 0, questsDone: 0, eventsSeen: 0, conesPlaced: 0, distance: 0 };
  /** Rappels pour l'interface. */
  onChange: (() => void) | null = null;
  onItem: ((id: string, delta: number) => void) | null = null;

  has(id: string, n = 1) {
    return (this.inv.get(id) ?? 0) >= n;
  }

  give(id: string, n = 1) {
    this.inv.set(id, (this.inv.get(id) ?? 0) + n);
    this.onItem?.(id, n);
    this.onChange?.();
  }

  take(id: string, n = 1): boolean {
    const c = this.inv.get(id) ?? 0;
    if (c < n) return false;
    if (c === n) this.inv.delete(id);
    else this.inv.set(id, c - n);
    this.onItem?.(id, -n);
    this.onChange?.();
    return true;
  }

  pay(amount: number): boolean {
    if (this.money + 1e-6 < amount) return false;
    this.money = Math.round((this.money - amount) * 100) / 100;
    this.onChange?.();
    return true;
  }

  earn(amount: number) {
    this.money = Math.round((this.money + amount) * 100) / 100;
    this.onChange?.();
  }

  flag(f: string) {
    this.flags.add(f);
  }

  is(f: string) {
    return this.flags.has(f);
  }

  serialize() {
    return { money: this.money, inv: [...this.inv], flags: [...this.flags], stats: this.stats };
  }

  load(o: ReturnType<GameState["serialize"]>) {
    this.money = o.money;
    this.inv = new Map(o.inv);
    this.flags = new Set(o.flags);
    this.stats = { ...this.stats, ...o.stats };
  }
}

export function money(n: number) {
  return `${n.toFixed(2).replace(".", ",")} $`;
}
