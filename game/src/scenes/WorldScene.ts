import Phaser from "phaser";
import { REALMS, TILE_SIZE, REALM_DEFAULT_SPAWNS } from "../data/realms";
import { BASE_ENEMIES, ENEMY_PALETTES } from "../data/enemies";
import { NPCS, NPC_TASKS } from "../data/npcs";
import { PORTALS } from "../data/portals";
import { STRUCTURES } from "../data/structures";
import { CLAN_PROFILES } from "../data/clans";
import type { GameState } from "../systems/GameState";
import { saveGameState } from "../systems/GameState";
import { AudioManager } from "../systems/AudioManager";
import { linkIdentity } from "../systems/ApiClient";
import type { DialoguePayload } from "./DialogueScene";
import { generatePickupTexture, generateProjectileTexture } from "../systems/SpriteFactory";
import { createSporeParticles, createPickupMagnet, createPortalFlash, createBattleTransition } from "../systems/Particles";

interface RuntimeEnemy {
  def: (typeof BASE_ENEMIES)[0];
  body: Phaser.GameObjects.Rectangle;
  accent: Phaser.GameObjects.Rectangle;
  eyeL: Phaser.GameObjects.Rectangle;
  eyeR: Phaser.GameObjects.Rectangle;
  feetL: Phaser.GameObjects.Rectangle;
  feetR: Phaser.GameObjects.Rectangle;
  active: boolean;
  walkDist: number;
  wanderDirX: number;
  wanderDirY: number;
  directionShiftAt: number;
  hp: number;
  maxHp: number;
}

interface RuntimeNpc {
  def: (typeof NPCS)[0];
  body: Phaser.GameObjects.Rectangle;
  accent: Phaser.GameObjects.Rectangle;
  feetL: Phaser.GameObjects.Rectangle;
  feetR: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  walkDist: number;
  wanderDirX: number;
  wanderDirY: number;
  wanderShiftAt: number;
  task: string;
  taskChangeAt: number;
  homeX: number;
  homeY: number;
}

interface Pickup {
  sprite: Phaser.GameObjects.Sprite;
  x: number;
  y: number;
  value: number;
  golden: boolean;
  collected: boolean;
}

export class WorldScene extends Phaser.Scene {
  private heroBody!: Phaser.GameObjects.Rectangle;
  private heroCrown!: Phaser.GameObjects.Rectangle;
  private heroRobe!: Phaser.GameObjects.Rectangle;
  private heroFeetL!: Phaser.GameObjects.Rectangle;
  private heroFeetR!: Phaser.GameObjects.Rectangle;
  private heroEyeL!: Phaser.GameObjects.Rectangle;
  private heroEyeR!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private enemies: RuntimeEnemy[] = [];
  private npcs: RuntimeNpc[] = [];
  private pickups: Pickup[] = [];
  private audio!: AudioManager;
  private projectiles: { sprite: Phaser.GameObjects.Rectangle; vx: number; vy: number; damage: number; isHero: boolean; life: number }[] = [];
  private lastShotAt = 0;
  private saveTimer = 0;

  constructor() {
    super({ key: "WorldScene" });
  }

  create(): void {
    const state = this.registry.get("gameState") as GameState;
    const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];
    const spawn = REALM_DEFAULT_SPAWNS[realm.id] ?? { x: realm.x + 100, y: realm.y + 100 };

    if (state.hero.x < realm.x || state.hero.x > realm.x + realm.w ||
        state.hero.y < realm.y || state.hero.y > realm.y + realm.h) {
      state.hero.x = spawn.x;
      state.hero.y = spawn.y;
    }

    this.audio = new AudioManager();
    this.audio.init();
    this.audio.setMode("overworld");
    this.registry.set("audio", this.audio);

    this.drawTerrainOnce(realm);
    this.drawStructuresOnce(realm);
    this.drawPortalsOnce(realm);
    this.createHero(state);
    this.spawnEnemies(realm);
    this.spawnNpcs(realm);
    this.spawnPickups(realm);

    this.cameras.main.startFollow(this.heroBody, true, 0.12, 0.12);
    this.cameras.main.setBounds(realm.x, realm.y, realm.w, realm.h);
    this.cameras.main.setZoom(1.5);
    this.cameras.main.setBackgroundColor(0x040913);

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = {
        w: this.input.keyboard.addKey("W"),
        a: this.input.keyboard.addKey("A"),
        s: this.input.keyboard.addKey("S"),
        d: this.input.keyboard.addKey("D"),
        e: this.input.keyboard.addKey("E"),
        space: this.input.keyboard.addKey("SPACE"),
      };
    }

    state.mode = "explore";
    this.scene.launch("HudScene");
    linkIdentity(state).catch(() => {});
    this.saveTimer = 0;
  }

  update(_time: number, delta: number): void {
    const state = this.registry.get("gameState") as GameState;
    if (state.mode !== "explore") return;
    const dt = delta / 1000;

    this.moveHero(state, dt);
    this.updateEnemies(state, dt);
    this.updateNpcs(dt);
    this.updateProjectiles(state, dt);
    this.checkPickups(state);
    this.checkPortals(state);
    this.checkInteraction(state);
    this.animateWalking(state);

    if (this.wasd?.space?.isDown) this.heroShoot(state);

    this.saveTimer += dt;
    if (this.saveTimer > 60) { saveGameState(state); this.saveTimer = 0; }
  }

  private createHero(state: GameState): void {
    const clan = CLAN_PROFILES[state.playerClan] ?? CLAN_PROFILES.myco;
    const c = (hex: string) => Phaser.Display.Color.HexStringToColor(hex).color;
    const x = state.hero.x, y = state.hero.y;

    this.add.rectangle(x, y + 14, 22, 4, 0x020617, 0.25).setDepth(9);
    this.heroRobe = this.add.rectangle(x, y + 6, 18, 12, c(clan.colors.robe)).setDepth(10);
    this.heroBody = this.add.rectangle(x, y - 4, 14, 10, c(clan.colors.cap)).setDepth(11);
    this.heroCrown = this.add.rectangle(x, y - 12, 12, 4, 0xfacc15).setDepth(12);
    this.heroEyeL = this.add.rectangle(x - 3, y - 4, 3, 3, 0x86efac).setDepth(12);
    this.heroEyeR = this.add.rectangle(x + 3, y - 4, 3, 3, 0x86efac).setDepth(12);
    this.heroFeetL = this.add.rectangle(x - 5, y + 13, 4, 3, c(clan.colors.primary)).setDepth(10);
    this.heroFeetR = this.add.rectangle(x + 5, y + 13, 4, 3, c(clan.colors.primary)).setDepth(10);
    this.add.rectangle(x + 12, y, 2, 18, 0x713f12).setDepth(11);
    this.add.rectangle(x + 12, y - 10, 6, 4, 0x22c55e).setDepth(11);
  }

  private moveHero(state: GameState, dt: number): void {
    let ax = 0, ay = 0;
    if (this.cursors?.up?.isDown || this.wasd?.w?.isDown) ay -= 1;
    if (this.cursors?.down?.isDown || this.wasd?.s?.isDown) ay += 1;
    if (this.cursors?.left?.isDown || this.wasd?.a?.isDown) ax -= 1;
    if (this.cursors?.right?.isDown || this.wasd?.d?.isDown) ax += 1;
    if (ax === 0 && ay === 0) return;

    const mag = Math.hypot(ax, ay) || 1;
    const sprint = this.cursors?.shift?.isDown ? 1.34 : 1;
    const speed = state.hero.speed * sprint;
    const nx = state.hero.x + (ax / mag) * speed * dt;
    const ny = state.hero.y + (ay / mag) * speed * dt;

    const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];
    const blocked = STRUCTURES.filter((s) => s.solid && s.region === realm.id).some((s) =>
      nx - 7 < s.x + s.w && nx + 7 > s.x && ny - 8 < s.y + s.h && ny + 8 > s.y);

    if (!blocked) {
      state.hero.x = Phaser.Math.Clamp(nx, realm.x + 16, realm.x + realm.w - 16);
      state.hero.y = Phaser.Math.Clamp(ny, realm.y + 16, realm.y + realm.h - 16);
    }
    state.hero.facingX = ax / mag;
    state.hero.facingY = ay / mag;
    state.hero.walkFrame = (state.hero.walkFrame + dt * 10) % 4;
    this.syncHeroPosition(state);
  }

  private syncHeroPosition(state: GameState): void {
    const x = state.hero.x, y = state.hero.y;
    this.heroBody.setPosition(x, y - 4);
    this.heroCrown.setPosition(x, y - 12);
    this.heroRobe.setPosition(x, y + 6);
    this.heroEyeL.setPosition(x - 3, y - 4);
    this.heroEyeR.setPosition(x + 3, y - 4);
  }

  private animateWalking(state: GameState): void {
    const f = Math.floor(state.hero.walkFrame) % 4;
    const x = state.hero.x, y = state.hero.y;
    const offL = f === 1 ? -2 : f === 3 ? 1 : 0;
    const offR = f === 3 ? 2 : f === 1 ? -1 : 0;
    this.heroFeetL.setPosition(x - 5 + offL, y + 13 + (f === 1 ? 1 : 0));
    this.heroFeetR.setPosition(x + 5 + offR, y + 13 + (f === 3 ? 1 : 0));

    for (const e of this.enemies) {
      if (!e.active) continue;
      const ef = Math.floor(e.walkDist / 12) % 4;
      const ex = e.body.x, ey = e.body.y;
      e.feetL.setPosition(ex - 6 + (ef === 1 ? -2 : 0), ey + 13 + (ef === 1 ? 1 : 0));
      e.feetR.setPosition(ex + 6 + (ef === 3 ? 2 : 0), ey + 13 + (ef === 3 ? 1 : 0));
    }

    for (const n of this.npcs) {
      const nf = Math.floor(n.walkDist / 12) % 4;
      const nx = n.body.x, ny = n.body.y;
      n.feetL.setPosition(nx - 5 + (nf === 1 ? -1 : 0), ny + 11 + (nf === 1 ? 1 : 0));
      n.feetR.setPosition(nx + 5 + (nf === 3 ? 1 : 0), ny + 11 + (nf === 3 ? 1 : 0));
    }
  }

  private spawnEnemies(realm: (typeof REALMS)[0]): void {
    const regionScale: Record<string, number> = { "myco-kingdom": 1, "rougarou-fen": 1.2, "tri-drake-peaks": 1.45, "crimson-tide": 1.35, "solana-chainlands": 1.7, "verdant-commons": 1.1, "obsidian-wilds": 1.55 };

    for (const def of BASE_ENEMIES.filter((e) => e.region === realm.id)) {
      const [bHex, aHex] = ENEMY_PALETTES[def.kind] ?? ["#f97316", "#7c2d12"];
      const bc = Phaser.Display.Color.HexStringToColor(bHex).color;
      const ac = Phaser.Display.Color.HexStringToColor(aHex).color;

      const body = this.add.rectangle(def.x, def.y, 22, 22, bc).setDepth(5);
      const accent = this.add.rectangle(def.x, def.y - 2, 18, 10, ac).setDepth(6);
      const eyeL = this.add.rectangle(def.x - 4, def.y, 3, 3, 0x020617).setDepth(7);
      const eyeR = this.add.rectangle(def.x + 4, def.y, 3, 3, 0x020617).setDepth(7);
      const feetL = this.add.rectangle(def.x - 6, def.y + 13, 6, 3, bc).setDepth(5);
      const feetR = this.add.rectangle(def.x + 6, def.y + 13, 6, 3, bc).setDepth(5);
      this.add.rectangle(def.x, def.y + 14, 20, 4, 0x020617, 0.2).setDepth(4);

      if (def.boss) {
        this.add.rectangle(def.x, def.y, 34, 34).setStrokeStyle(2, 0xfacc15).setDepth(8);
        this.add.text(def.x, def.y - 22, "★ BOSS", { fontFamily: "monospace", fontSize: "9px", color: "#facc15" }).setOrigin(0.5).setDepth(8);
      }

      const hp = Math.round((def.boss ? 220 : 60) * (regionScale[def.region] ?? 1));
      this.enemies.push({
        def, body, accent, eyeL, eyeR, feetL, feetR,
        active: true, walkDist: 0,
        wanderDirX: Phaser.Math.FloatBetween(-1, 1),
        wanderDirY: Phaser.Math.FloatBetween(-1, 1),
        directionShiftAt: this.time.now + Phaser.Math.Between(1000, 3000),
        hp, maxHp: hp,
      });
    }
  }

  private updateEnemies(state: GameState, dt: number): void {
    const now = this.time.now;
    const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];
    for (const e of this.enemies) {
      if (!e.active) continue;
      if (now >= e.directionShiftAt) {
        e.wanderDirX = Phaser.Math.FloatBetween(-1, 1);
        e.wanderDirY = Phaser.Math.FloatBetween(-1, 1);
        e.directionShiftAt = now + Phaser.Math.Between(1000, 3200);
      }
      const speed = e.def.boss ? 26 : 36;
      const nx = e.body.x + e.wanderDirX * speed * dt;
      const ny = e.body.y + e.wanderDirY * speed * dt;
      if (nx > realm.x + 20 && nx < realm.x + realm.w - 20 && ny > realm.y + 20 && ny < realm.y + realm.h - 20) {
        e.body.setPosition(nx, ny);
        e.accent.setPosition(nx, ny - 2);
        e.eyeL.setPosition(nx - 4, ny);
        e.eyeR.setPosition(nx + 4, ny);
        e.walkDist += speed * dt;
      } else {
        e.wanderDirX *= -1;
        e.wanderDirY *= -1;
      }
      if (Phaser.Math.Distance.Between(state.hero.x, state.hero.y, e.body.x, e.body.y) < (e.def.boss ? 36 : 30)) {
        state.mode = "battle";
        this.audio.setMode(e.def.boss ? "boss" : "battle");
        this.audio.playSfx("battle");
        createBattleTransition(this, () => {
          this.scene.launch("BattleScene", { enemy: e.def });
          this.scene.pause();
        });
        break;
      }
    }
  }

  private spawnNpcs(realm: (typeof REALMS)[0]): void {
    const palettes: [number, number][] = [[0x0f172a, 0x059669], [0x111827, 0x2563eb], [0x1f2937, 0xc026d3]];
    for (const def of NPCS.filter((n) => n.region === realm.id)) {
      const pi = def.id.split("").reduce((s, c) => s + c.charCodeAt(0), 0) % palettes.length;
      const [cloak, accent] = palettes[pi];
      const body = this.add.rectangle(def.x, def.y, 18, 20, cloak).setDepth(8);
      const acc = this.add.rectangle(def.x, def.y - 2, 14, 8, accent).setDepth(8);
      const feetL = this.add.rectangle(def.x - 5, def.y + 11, 5, 2, cloak).setDepth(8);
      const feetR = this.add.rectangle(def.x + 5, def.y + 11, 5, 2, cloak).setDepth(8);
      this.add.rectangle(def.x, def.y + 12, 16, 3, 0x020617, 0.2).setDepth(7);
      const task = NPC_TASKS[Math.floor(Math.random() * NPC_TASKS.length)];
      const label = this.add.text(def.x, def.y - 18, task, { fontFamily: "monospace", fontSize: "7px", color: "#94a3b8" }).setOrigin(0.5).setDepth(9);
      this.npcs.push({ def, body, accent: acc, feetL, feetR, label, walkDist: 0, wanderDirX: 0, wanderDirY: 0, wanderShiftAt: this.time.now + Math.random() * 3000, task, taskChangeAt: this.time.now + 15000 + Math.random() * 30000, homeX: def.x, homeY: def.y });
    }
  }

  private updateNpcs(dt: number): void {
    const now = this.time.now;
    const realm = REALMS.find((r) => r.id === (this.registry.get("gameState") as GameState).currentRealmId) ?? REALMS[0];
    for (const n of this.npcs) {
      if (now >= n.wanderShiftAt) {
        const a = Math.random() * Math.PI * 2;
        n.wanderDirX = Math.cos(a) * 0.6;
        n.wanderDirY = Math.sin(a) * 0.6;
        n.wanderShiftAt = now + 2000 + Math.random() * 4000;
        if (Math.random() < 0.15) { n.wanderDirX = 0; n.wanderDirY = 0; }
      }
      if (now >= n.taskChangeAt) {
        n.task = NPC_TASKS[Math.floor(Math.random() * NPC_TASKS.length)];
        n.taskChangeAt = now + 15000 + Math.random() * 30000;
        n.label.setText(n.task);
      }
      const hd = Phaser.Math.Distance.Between(n.body.x, n.body.y, n.homeX, n.homeY);
      let dx = n.wanderDirX, dy = n.wanderDirY;
      if (hd > 80) { dx += (n.homeX - n.body.x) / hd * 0.5; dy += (n.homeY - n.body.y) / hd * 0.5; }
      const nx = n.body.x + dx * 22 * dt, ny = n.body.y + dy * 22 * dt;
      if (nx > realm.x + 10 && nx < realm.x + realm.w - 10 && ny > realm.y + 10 && ny < realm.y + realm.h - 10) {
        n.body.setPosition(nx, ny);
        n.accent.setPosition(nx, ny - 2);
        n.label.setPosition(nx, ny - 18);
        n.walkDist += Math.abs(dx * 22 * dt) + Math.abs(dy * 22 * dt);
      }
    }
  }

  private heroShoot(state: GameState): void {
    const now = this.time.now;
    if (now - this.lastShotAt < 300) return;
    this.lastShotAt = now;
    const ax = state.hero.facingX || 0, ay = state.hero.facingY || -1;
    const mag = Math.hypot(ax, ay) || 1;
    const sprite = this.add.rectangle(state.hero.x, state.hero.y, 6, 6, 0x22c55e).setDepth(15);
    this.projectiles.push({ sprite, vx: (ax / mag) * 280, vy: (ay / mag) * 280, damage: 8 + state.hero.attack * 3, isHero: true, life: 1.2 });
  }

  private updateProjectiles(state: GameState, dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) { p.sprite.destroy(); this.projectiles.splice(i, 1); continue; }
      if (p.isHero) {
        for (const e of this.enemies) {
          if (!e.active) continue;
          if (Phaser.Math.Distance.Between(p.sprite.x, p.sprite.y, e.body.x, e.body.y) < 20) {
            e.hp -= p.damage;
            if (e.hp <= 0) { e.active = false; e.body.setVisible(false); e.accent.setVisible(false); e.eyeL.setVisible(false); e.eyeR.setVisible(false); e.feetL.setVisible(false); e.feetR.setVisible(false); state.hero.spores += 20; this.audio.playSfx("coin"); }
            p.sprite.destroy(); this.projectiles.splice(i, 1); break;
          }
        }
      } else {
        if (Phaser.Math.Distance.Between(p.sprite.x, p.sprite.y, state.hero.x, state.hero.y) < 12) {
          state.hero.hp = Math.max(0, state.hero.hp - p.damage);
          p.sprite.destroy(); this.projectiles.splice(i, 1);
        }
      }
    }
  }

  private spawnPickups(realm: (typeof REALMS)[0]): void {
    const positions = [
      { dx: 0.15, dy: 0.15, v: 12, g: false }, { dx: 0.3, dy: 0.4, v: 14, g: false },
      { dx: 0.7, dy: 0.3, v: 16, g: false }, { dx: 0.5, dy: 0.6, v: 10, g: false },
      { dx: 0.2, dy: 0.8, v: 18, g: false }, { dx: 0.8, dy: 0.7, v: 20, g: false },
      { dx: 0.5, dy: 0.2, v: 8, g: true }, { dx: 0.9, dy: 0.5, v: 5, g: true },
    ];
    for (const p of positions) {
      const x = realm.x + realm.w * p.dx, y = realm.y + realm.h * p.dy;
      const key = generatePickupTexture(this, p.g);
      const sprite = this.add.sprite(x, y, key).setDepth(4);
      this.pickups.push({ sprite, x, y, value: p.v, golden: p.g, collected: false });
    }
  }

  private checkPickups(state: GameState): void {
    for (const p of this.pickups) {
      if (p.collected) continue;
      if (Phaser.Math.Distance.Between(state.hero.x, state.hero.y, p.x, p.y) < 44) {
        p.collected = true;
        createPickupMagnet(this, p.sprite, state.hero.x, state.hero.y, () => {
          if (p.golden) state.hero.goldenSpores += p.value; else state.hero.spores += p.value;
          this.audio.playSfx("pickup");
          createSporeParticles(this, state.hero.x, state.hero.y, p.golden);
        });
      }
    }
  }

  private checkPortals(state: GameState): void {
    for (const portal of PORTALS) {
      const px = portal.x + portal.w / 2, py = portal.y + portal.h / 2;
      const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];
      if (!(px >= realm.x && px <= realm.x + realm.w && py >= realm.y && py <= realm.y + realm.h)) continue;
      if (Phaser.Math.Distance.Between(state.hero.x, state.hero.y, px, py) < 34) {
        this.audio.playSfx("portal");
        createPortalFlash(this);
        state.currentRealmId = portal.destRealm;
        state.hero.x = portal.destX;
        state.hero.y = portal.destY;
        saveGameState(state);
        this.scene.restart();
        return;
      }
    }
  }

  private checkInteraction(state: GameState): void {
    if (!this.wasd?.e?.isDown) return;
    if (this.wasd.e.getDuration() > 100) return;
    for (const n of this.npcs) {
      if (Phaser.Math.Distance.Between(state.hero.x, state.hero.y, n.body.x, n.body.y) < 50) {
        this.audio.playSfx("talk");
        this.scene.pause();
        this.scene.launch("DialogueScene", {
          title: n.def.name, portrait: "🧙", body: n.def.intro,
          choices: [{ id: "myco", label: "Mycoside", color: "#22c55e" }, { id: "dark", label: "Darkside", color: "#ef4444" }, { id: "close", label: "Leave", color: "#94a3b8" }],
          onChoice: (id: string) => { if (id === "myco") state.hero.morality += 3; else if (id === "dark") state.hero.morality -= 3; state.progress.interactedNpcs.add(n.def.id); },
          onClose: () => { state.mode = "explore"; },
        } satisfies DialoguePayload);
        return;
      }
    }
    const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];
    for (const s of STRUCTURES.filter((st) => st.region === realm.id)) {
      if (Phaser.Math.Distance.Between(state.hero.x, state.hero.y, s.x + s.w / 2, s.y + s.h / 2) < 46) {
        this.audio.playSfx("portal");
        this.scene.pause();
        if (s.type === "burn-pit" || s.type === "shrine") { this.scene.launch("BurnPitScene"); }
        else { this.scene.launch("InteriorScene", { structure: s }); }
        return;
      }
    }
  }

  private drawTerrainOnce(realm: (typeof REALMS)[0]): void {
    const colorA = Phaser.Display.Color.HexStringToColor(realm.colorA).color;
    const colorB = Phaser.Display.Color.HexStringToColor(realm.colorB).color;
    const tileKey = `terrain-tile-${realm.id}`;
    if (!this.textures.exists(tileKey)) {
      const tileGfx = this.make.graphics({ x: 0, y: 0 });
      const t = 64;
      tileGfx.fillStyle(colorA);
      tileGfx.fillRect(0, 0, t, t);
      tileGfx.fillStyle(colorB);
      tileGfx.fillRect(t, 0, t, t);
      tileGfx.fillStyle(colorB);
      tileGfx.fillRect(0, t, t, t);
      tileGfx.fillStyle(colorA);
      tileGfx.fillRect(t, t, t, t);
      tileGfx.generateTexture(tileKey, t * 2, t * 2);
      tileGfx.destroy();
    }
    for (let y = realm.y; y < realm.y + realm.h; y += 128) {
      for (let x = realm.x; x < realm.x + realm.w; x += 128) {
        this.add.image(x + 64, y + 64, tileKey).setDepth(0);
      }
    }
    const border = this.add.graphics().setDepth(0);
    border.lineStyle(2, 0x2f4678);
    border.strokeRect(realm.x, realm.y, realm.w, realm.h);
  }

  private drawStructuresOnce(realm: (typeof REALMS)[0]): void {
    const gfx = this.add.graphics().setDepth(2);
    const colors: Record<string, number> = { house: 0x92400e, castle: 0x1e3a5f, "mushroom-shop": 0x7c2d12, tower: 0x1f2937, cave: 0x374151, dungeon: 0x1e1b4b, "burn-pit": 0x451a03, shrine: 0x4c1d95 };
    for (const s of STRUCTURES.filter((st) => st.region === realm.id)) {
      gfx.fillStyle(colors[s.type] ?? 0x374151);
      gfx.fillRect(s.x, s.y, s.w, s.h);
      gfx.fillStyle((colors[s.type] ?? 0x374151) + 0x181818);
      gfx.fillRect(s.x + 3, s.y - 5, s.w - 6, 6);
      this.add.text(s.x + s.w / 2, s.y - 8, s.name, { fontFamily: "monospace", fontSize: "7px", color: "#94a3b8" }).setOrigin(0.5).setDepth(3);
    }
  }

  private drawPortalsOnce(realm: (typeof REALMS)[0]): void {
    const gfx = this.add.graphics().setDepth(2);
    for (const p of PORTALS) {
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      if (!(cx >= realm.x && cx <= realm.x + realm.w && cy >= realm.y && cy <= realm.y + realm.h)) continue;
      gfx.fillStyle(0x22d3ee, 0.4);
      gfx.fillRect(p.x, p.y, p.w, p.h);
      gfx.fillStyle(0xf8fafc);
      gfx.fillRect(cx - 1, p.y + 4, 2, p.h - 8);
      gfx.fillRect(p.x + 4, cy - 1, p.w - 8, 2);
      this.add.text(cx, p.y + p.h + 5, p.name, { fontFamily: "monospace", fontSize: "6px", color: "#7dd3fc" }).setOrigin(0.5).setDepth(3);
    }
  }
}
