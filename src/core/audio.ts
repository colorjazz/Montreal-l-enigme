/**
 * Son entièrement synthétisé (Web Audio) : ambiance urbaine, oiseaux, pluie,
 * pas, klaxons, carillon du métro, cloches, accordéon (« Alouette »).
 */

type Surface = "pavé" | "herbe" | "bois" | "métal";

const NOTE: Record<string, number> = {};
{
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  for (let o = 2; o <= 6; o++) names.forEach((n, i) => (NOTE[`${n}${o}`] = 440 * Math.pow(2, (i - 9 + (o - 4) * 12) / 12)));
}

// Mélodies traditionnelles (domaine public) : [note, durée en temps]
const ALOUETTE: [string, number][] = [
  ["C4", 1], ["C4", 0.5], ["D4", 0.5], ["E4", 1], ["E4", 1],
  ["D4", 0.5], ["C4", 0.5], ["D4", 0.5], ["E4", 0.5], ["C4", 1], ["G3", 1],
  ["C4", 1], ["C4", 0.5], ["D4", 0.5], ["E4", 1], ["E4", 1],
  ["D4", 0.5], ["C4", 0.5], ["D4", 0.5], ["E4", 0.5], ["C4", 2],
  ["G4", 0.5], ["G4", 0.5], ["G4", 0.5], ["G4", 0.5], ["F4", 0.5], ["E4", 0.5], ["D4", 0.5], ["C4", 0.5],
  ["G4", 0.5], ["G4", 0.5], ["G4", 0.5], ["G4", 0.5], ["F4", 0.5], ["E4", 0.5], ["D4", 1],
];
const FONTAINE: [string, number][] = [
  ["G4", 1], ["G4", 0.5], ["B4", 0.5], ["B4", 0.5], ["A4", 0.5], ["B4", 0.5], ["A4", 0.5], ["G4", 1],
  ["G4", 0.5], ["B4", 0.5], ["B4", 0.5], ["A4", 0.5], ["B4", 2],
  ["B4", 1], ["A4", 0.5], ["G4", 0.5], ["B4", 0.5], ["D5", 0.5], ["B4", 0.5], ["D5", 0.5], ["D5", 1],
  ["B4", 0.5], ["G4", 0.5], ["B4", 0.5], ["A4", 0.5], ["G4", 2],
];

export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private amb!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private city!: GainNode;
  private wind!: GainNode;
  private rain!: GainNode;
  private hum!: GainNode;
  private birdTimer = 0;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  muted = false;
  volume = 0.8;
  /** Statistiques (tests). */
  played = 0;
  /** Musique de rue positionnelle. */
  private street: { gain: GainNode; melody: [string, number][]; t: number; idx: number; nextAt: number; kind: "accordion" | "violin" } | null = null;

  /** Démarre le contexte audio (doit suivre un geste de l'utilisateur). */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.amb = ctx.createGain();
    this.sfx = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.amb.connect(this.master);
    this.sfx.connect(this.master);
    this.musicBus.connect(this.master);
    // bruit blanc partagé
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // réverbération synthétique (métro, rues étroites)
    this.reverb = ctx.createConvolver();
    const irLen = ctx.sampleRate * 2.2;
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const c = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) c[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.15;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.sfx.connect(this.reverbSend);
    this.musicBus.connect(this.reverbSend);
    // ambiances en boucle
    this.city = this.loopNoise(220, "lowpass", 0.0);
    this.wind = this.loopNoise(900, "bandpass", 0.0, 0.6);
    this.rain = this.loopNoise(2600, "highpass", 0.0);
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    for (const f of [55, 110, 165]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f === 55 ? 0.5 : 0.18;
      o.connect(g).connect(this.hum);
      o.start();
    }
    this.hum.connect(this.amb);
  }

  private loopNoise(freq: number, type: BiquadFilterType, gain: number, q = 0.7): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.amb);
    src.start();
    return g;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
    return this.muted;
  }

  /** Mise à jour de l'ambiance selon l'environnement. */
  ambience(dt: number, o: { traffic: number; park: number; rain: number; underground: boolean; night: number; wind: number }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const ug = o.underground ? 1 : 0;
    this.city.gain.setTargetAtTime((0.12 + o.traffic * 0.35) * (1 - ug * 0.7) * (1 - o.night * 0.3), t, 0.5);
    this.wind.gain.setTargetAtTime((0.03 + o.wind * 0.06) * (1 - ug), t, 0.8);
    this.rain.gain.setTargetAtTime(o.rain * 0.22 * (1 - ug * 0.8), t, 0.6);
    this.hum.gain.setTargetAtTime(ug * 0.05, t, 0.6);
    this.reverbSend.gain.setTargetAtTime(0.12 + ug * 0.45, t, 0.5);
    // oiseaux le jour, dans les parcs
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 0.6 + Math.random() * 2.5;
      const p = o.park * (1 - o.night) * (1 - o.rain) * (1 - ug);
      if (Math.random() < 0.15 + p * 0.85 && p > 0.05) this.bird(p);
    }
  }

  private env(g: GainNode, t: number, a: number, peak: number, dec: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  private bird(vol: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 2200;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const st = t + i * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base, st);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.5), st + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, st + 0.09);
      this.env(g, st, 0.01, 0.05 * vol, 0.08);
      o.connect(g).connect(this.amb);
      o.start(st);
      o.stop(st + 0.12);
    }
  }

  private noiseHit(freq: number, type: BiquadFilterType, vol: number, dur: number, when = 0, bus?: AudioNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, 0.003, vol, dur);
    src.connect(f).connect(g).connect(bus ?? this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    this.played++;
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = "sine", when = 0, bus?: AudioNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, 0.01, vol, dur);
    o.connect(g).connect(bus ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
    this.played++;
  }

  step(surface: Surface, run: boolean) {
    if (!this.ctx) return;
    const v = run ? 0.16 : 0.1;
    if (surface === "herbe") this.noiseHit(700, "lowpass", v * 0.8, 0.09);
    else if (surface === "bois") {
      this.noiseHit(420, "lowpass", v * 1.2, 0.07);
      this.tone(140, 0.06, v * 0.4, "sine");
    } else if (surface === "métal") this.noiseHit(3200, "bandpass", v, 0.08);
    else this.noiseHit(1700, "bandpass", v, 0.06);
  }

  land(strength: number) {
    if (!this.ctx) return;
    this.noiseHit(500, "lowpass", Math.min(0.4, 0.1 + strength * 0.03), 0.15);
  }

  impact(strength: number, dist: number) {
    if (!this.ctx || dist > 40) return;
    const v = Math.min(0.35, strength * 0.04) * (1 - dist / 40);
    this.noiseHit(600 + Math.random() * 600, "bandpass", v, 0.12);
  }

  honk(dist: number) {
    if (!this.ctx || dist > 60) return;
    const v = 0.12 * (1 - dist / 60);
    this.tone(415, 0.35, v, "square");
    this.tone(523, 0.35, v * 0.8, "square");
  }

  bell(count: number, dist: number) {
    if (!this.ctx || dist > 400) return;
    const v = 0.22 * Math.max(0.15, 1 - dist / 400);
    for (let i = 0; i < count; i++) {
      const w = i * 1.6;
      for (const [r, a] of [
        [1, 1],
        [2.0, 0.5],
        [2.4, 0.35],
        [3.0, 0.25],
        [4.2, 0.15],
      ]) this.tone(196 * r, 2.8, v * a, "sine", w, this.musicBus);
    }
  }

  /** Carillon de départ du métro de Montréal (trois notes montantes). */
  metroChime() {
    if (!this.ctx) return;
    [NOTE.E4, NOTE.A4, NOTE["C#5"]].forEach((f, i) => this.tone(f, 0.5, 0.16, "triangle", i * 0.28));
  }

  train(approach: number) {
    if (!this.ctx) return;
    // grondement du train : bruit grave filtré
    this.noiseHit(180, "lowpass", 0.35 * approach, 2.5);
    this.noiseHit(3500, "bandpass", 0.05 * approach, 1.8, 1.2);
  }

  ui(kind: "open" | "step" | "quest" | "complete" | "good" | "bad" | "pickup" | "cash") {
    if (!this.ctx) return;
    switch (kind) {
      case "open":
        this.tone(660, 0.08, 0.06, "sine");
        break;
      case "pickup":
        [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => this.tone(f, 0.12, 0.07, "triangle", i * 0.06));
        break;
      case "cash":
        this.tone(1800, 0.08, 0.06, "square");
        this.tone(2400, 0.25, 0.06, "sine", 0.08);
        break;
      case "good":
        this.tone(NOTE.E5, 0.12, 0.08, "triangle");
        this.tone(NOTE.A5, 0.2, 0.08, "triangle", 0.1);
        break;
      case "bad":
        this.tone(NOTE.C4, 0.25, 0.07, "sawtooth");
        break;
      case "step":
        this.tone(NOTE.G4, 0.12, 0.07, "triangle");
        this.tone(NOTE.D5, 0.2, 0.07, "triangle", 0.1);
        break;
      case "quest":
        [NOTE.C4, NOTE.G4, NOTE.C5].forEach((f, i) => this.tone(f, 0.25, 0.08, "triangle", i * 0.12));
        break;
      case "complete":
        [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5, NOTE.E5].forEach((f, i) => this.tone(f, 0.4, 0.08, "triangle", i * 0.1));
        break;
    }
  }

  /** Lance une mélodie courte (non positionnelle). */
  music(name: "alouette" | "fontaine") {
    if (!this.ctx) return;
    const mel = name === "alouette" ? ALOUETTE : FONTAINE;
    let t = 0;
    const beat = 0.36;
    for (const [n, d] of mel) {
      this.accordionNote(NOTE[n], d * beat * 0.95, 0.07, t, this.musicBus);
      t += d * beat;
    }
  }

  private accordionNote(f: number, dur: number, vol: number, when: number, bus: AudioNode, kind: "accordion" | "violin" = "accordion") {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.04);
    g.gain.setValueAtTime(vol, t + Math.max(0.05, dur - 0.05));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = kind === "violin" ? 3200 : 2200;
    const det = kind === "violin" ? [1] : [1, 1.006, 0.5];
    for (const k of det) {
      const o = ctx.createOscillator();
      o.type = kind === "violin" ? "sawtooth" : k === 0.5 ? "square" : "sawtooth";
      o.frequency.value = f * k;
      const vib = ctx.createOscillator();
      vib.frequency.value = kind === "violin" ? 5.5 : 6;
      const vg = ctx.createGain();
      vg.gain.value = f * (kind === "violin" ? 0.008 : 0.004);
      vib.connect(vg).connect(o.frequency);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
      vib.start(t);
      vib.stop(t + dur + 0.05);
    }
    lp.connect(g).connect(bus);
    this.played++;
  }

  /** Musicien de rue : volume selon la distance, joue en boucle. */
  streetMusic(kind: "accordion" | "violin" | null, dist: number, dt: number) {
    if (!this.ctx) return;
    if (!kind || dist > 45) {
      if (this.street) this.street.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      if (!kind) return;
    }
    if (!this.street || this.street.kind !== kind) {
      const gain = this.ctx.createGain();
      gain.connect(this.musicBus);
      this.street = { gain, melody: kind === "accordion" ? ALOUETTE : FONTAINE, t: 0, idx: 0, nextAt: 0, kind };
    }
    const s = this.street;
    const vol = Math.max(0, 1 - dist / 45);
    s.gain.gain.setTargetAtTime(vol * vol, this.ctx.currentTime, 0.3);
    s.t += dt;
    if (dist < 45 && s.t >= s.nextAt) {
      const [n, d] = s.melody[s.idx % s.melody.length];
      const beat = 0.38;
      this.accordionNote(NOTE[n], d * beat * 0.95, 0.09, 0, s.gain, kind);
      s.nextAt = s.t + d * beat + (s.idx % s.melody.length === s.melody.length - 1 ? 1.2 : 0);
      s.idx++;
    }
  }
}
