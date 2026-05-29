type OscType = "square" | "triangle" | "sawtooth" | "sine";

interface MusicConfig {
  lead: number[];
  bass: number[];
  step: number;
  dur: number;
  bassDur: number;
  gain: number;
  bassGain: number;
  leadType: OscType;
  arp: boolean;
  drumBeat: number;
  drumFreq: number;
  drumGain: number;
}

const TITLE_LEAD = [
  196.0, 261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 261.63,
  220.0, 293.66, 349.23, 440.0, 523.25, 659.25, 523.25, 440.0,
  261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 659.25, 523.25,
  392.0, 440.0, 523.25, 659.25, 783.99, 880.0, 783.99, 659.25,
  523.25, 440.0, 392.0, 329.63, 293.66, 261.63, 220.0, 196.0,
  220.0, 261.63, 329.63, 392.0, 440.0, 523.25, 440.0, 392.0,
];
const TITLE_BASS = [
  65.41, 82.41, 98.0, 110.0, 130.81, 110.0, 98.0, 82.41,
  73.42, 87.31, 110.0, 130.81, 146.83, 130.81, 110.0, 87.31,
  65.41, 98.0, 130.81, 164.81, 130.81, 98.0, 82.41, 65.41,
];
const OVERWORLD_LEAD = [329.63, 392.0, 440.0, 523.25, 440.0, 392.0, 349.23, 329.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 523.25, 440.0, 392.0, 349.23, 329.63, 293.66, 261.63, 293.66, 329.63, 392.0];
const OVERWORLD_BASS = [130.81, 164.81, 174.61, 196.0, 164.81, 146.83, 130.81, 110.0, 130.81, 164.81, 196.0, 164.81, 130.81, 146.83, 130.81, 110.0];
const INTERIOR_LEAD = [220.0, 246.94, 261.63, 220.0, 196.0, 220.0, 246.94, 220.0, 207.65, 220.0, 246.94, 261.63, 293.66, 261.63, 246.94, 220.0, 196.0, 207.65, 220.0, 196.0, 174.61, 196.0, 207.65, 220.0];
const INTERIOR_BASS = [110.0, 123.47, 130.81, 110.0, 98.0, 110.0, 87.31, 98.0, 110.0, 123.47, 110.0, 98.0, 87.31, 98.0, 110.0, 123.47];
const BATTLE_LEAD = [164.81, 196.0, 220.0, 246.94, 293.66, 329.63, 293.66, 261.63, 220.0, 196.0, 174.61, 196.0, 220.0, 246.94, 261.63, 293.66];
const BATTLE_BASS = [82.41, 98.0, 110.0, 123.47, 98.0, 87.31, 73.42, 98.0];
const BOSS_LEAD = [146.83, 174.61, 196.0, 220.0, 261.63, 293.66, 329.63, 293.66, 261.63, 220.0, 196.0, 174.61, 146.83, 164.81, 196.0, 220.0, 261.63, 329.63, 392.0, 329.63, 293.66, 261.63, 220.0, 196.0, 174.61, 164.81, 146.83, 130.81, 146.83, 174.61, 196.0, 220.0];
const BOSS_BASS = [73.42, 87.31, 98.0, 110.0, 73.42, 82.41, 73.42, 65.41, 73.42, 87.31, 98.0, 73.42, 82.41, 73.42, 65.41, 73.42];

const MUSIC_CONFIGS: Record<string, MusicConfig> = {
  title: { lead: TITLE_LEAD, bass: TITLE_BASS, step: 0.30, dur: 0.26, bassDur: 0.28, gain: 0.038, bassGain: 0.022, leadType: "square", arp: false, drumBeat: 4, drumFreq: 90, drumGain: 0.012 },
  overworld: { lead: OVERWORLD_LEAD, bass: OVERWORLD_BASS, step: 0.22, dur: 0.18, bassDur: 0.20, gain: 0.042, bassGain: 0.022, leadType: "square", arp: true, drumBeat: 0, drumFreq: 0, drumGain: 0 },
  interior: { lead: INTERIOR_LEAD, bass: INTERIOR_BASS, step: 0.32, dur: 0.28, bassDur: 0.30, gain: 0.030, bassGain: 0.018, leadType: "triangle", arp: false, drumBeat: 0, drumFreq: 0, drumGain: 0 },
  battle: { lead: BATTLE_LEAD, bass: BATTLE_BASS, step: 0.19, dur: 0.14, bassDur: 0.16, gain: 0.050, bassGain: 0.028, leadType: "sawtooth", arp: false, drumBeat: 2, drumFreq: 68, drumGain: 0.022 },
  boss: { lead: BOSS_LEAD, bass: BOSS_BASS, step: 0.16, dur: 0.12, bassDur: 0.14, gain: 0.058, bassGain: 0.035, leadType: "sawtooth", arp: true, drumBeat: 1, drumFreq: 58, drumGain: 0.032 },
};

const SFX_TABLE: Record<string, [number, number, OscType, number]> = {
  pickup: [740, 0.09, "square", 0.05],
  talk: [420, 0.08, "triangle", 0.04],
  portal: [540, 0.2, "square", 0.07],
  battle: [180, 0.18, "sawtooth", 0.07],
  hit: [140, 0.1, "sawtooth", 0.06],
  coin: [880, 0.12, "square", 0.05],
  error: [180, 0.15, "square", 0.04],
  victory: [660, 0.2, "square", 0.06],
  death: [120, 0.22, "sawtooth", 0.05],
  strike: [260, 0.1, "sawtooth", 0.06],
};

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private scheduler: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private themeIndex = 0;
  private currentMode = "title";
  public musicOn = true;
  public sfxOn = true;

  async init(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8;
    this.masterGain.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.9;
    this.musicGain.connect(this.masterGain);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1.0;
    this.sfxGain.connect(this.masterGain);
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.scheduler = setInterval(() => this.scheduleNotes(), 120);
    await this.ctx.resume();
  }

  setMode(mode: string): void {
    if (mode !== this.currentMode) {
      this.currentMode = mode;
      this.themeIndex = 0;
      if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.05;
    }
  }

  playSfx(kind: string): void {
    if (!this.sfxOn || !this.ctx || this.ctx.state !== "running" || !this.sfxGain) return;
    const entry = SFX_TABLE[kind];
    if (!entry) return;
    const [freq, dur, type, gain] = entry;
    this.scheduleTone(this.sfxGain, freq, this.ctx.currentTime + 0.005, dur, gain, type);
  }

  playTextBlip(charIndex: number): void {
    if (!this.sfxOn || !this.ctx || this.ctx.state !== "running" || !this.sfxGain) return;
    const freq = 380 + (charIndex % 5) * 40;
    this.scheduleTone(this.sfxGain, freq, this.ctx.currentTime + 0.002, 0.035, 0.018, "square");
  }

  private scheduleNotes(): void {
    if (!this.musicOn || !this.ctx || this.ctx.state !== "running" || !this.musicGain) return;
    const cfg = MUSIC_CONFIGS[this.currentMode] ?? MUSIC_CONFIGS.overworld;
    while (this.nextNoteTime < this.ctx.currentTime + 0.7) {
      const note = cfg.lead[this.themeIndex % cfg.lead.length];
      const bass = cfg.bass[this.themeIndex % cfg.bass.length];
      this.scheduleTone(this.musicGain, note, this.nextNoteTime, cfg.dur, cfg.gain, cfg.leadType);
      this.scheduleTone(this.musicGain, bass / 2, this.nextNoteTime, cfg.bassDur, cfg.bassGain, "triangle");
      if (cfg.arp && this.themeIndex % 3 === 0) {
        this.scheduleTone(this.musicGain, note * 1.5, this.nextNoteTime + cfg.step * 0.33, cfg.dur * 0.6, cfg.gain * 0.4, "square");
      }
      if (cfg.drumBeat > 0 && this.themeIndex % cfg.drumBeat === 0) {
        this.scheduleTone(this.musicGain, cfg.drumFreq, this.nextNoteTime + cfg.step * 0.5, 0.07, cfg.drumGain, "square");
      }
      this.nextNoteTime += cfg.step;
      this.themeIndex++;
    }
  }

  private scheduleTone(dest: GainNode, freq: number, start: number, dur: number, gain: number, type: OscType): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(amp);
    amp.connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }
}
