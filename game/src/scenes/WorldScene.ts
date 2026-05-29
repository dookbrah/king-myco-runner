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
import { generatePickupTexture, generateProjectileTexture, generateHeroSprites, generateEnemySprite, generateNpcSprite, generateStructureSprite, generateTerrainTile, generatePortalTexture } from "../systems/SpriteFactory";
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
  respawnAt: number;
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
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private enemies: RuntimeEnemy[] = [];
  private npcs: RuntimeNpc[] = [];
  private pickups: Pickup[] = [];
  private audio!: AudioManager;
  private projectiles: { sprite: Phaser.GameObjects.Rectangle; vx: number; vy: number; damage: number; isHero: boolean; life: number }[] = [];
  private lastShotAt = 0;
  private contactCooldownUntil = 0;
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

    this.cameras.main.startFollow(this.heroSprite, true, 0.12, 0.12);
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
    this.contactCooldownUntil = this.time.now + 800;
    this.scene.launch("HudScene");

    this.events.on("resume", () => {
      state.mode = "explore";
      this.contactCooldownUntil = this.time.now + 2000;
      const battleIdx = this.registry.get("battleEnemyIdx") as number | undefined;
      if (typeof battleIdx === "number" && battleIdx >= 0 && battleIdx < this.enemies.length) {
        const e = this.enemies[battleIdx];
        if (e.active) {
          e.active = false;
          e.respawnAt = this.time.now + (e.def.boss ? 120000 : 45000);
          this.tweens.add({ targets: e.body, alpha: 0, scaleX: 1.8, scaleY: 1.8, duration: 300, onComplete: () => e.body.setVisible(false) });
          const dt = this.add.text(e.body.x, e.body.y - 12, "DEFEATED", { fontFamily: "monospace", fontSize: "9px", fontStyle: "bold", color: "#facc15" }).setOrigin(0.5).setDepth(20);
          this.tweens.add({ targets: dt, y: e.body.y - 28, alpha: 0, duration: 800, onComplete: () => dt.destroy() });
        }
      }
      this.registry.set("battleEnemyIdx", -1);
    });
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
    generateHeroSprites(this, { cap: c(clan.colors.cap), robe: c(clan.colors.robe), primary: c(clan.colors.primary) });
    this.heroSprite = this.add.sprite(state.hero.x, state.hero.y, "hero-down-0").setDepth(10);
  }

  private heroSprite!: Phaser.GameObjects.Sprite;

  private moveHero(state: GameState, dt: number): void {
    let ax = 0, ay = 0;
    if (this.cursors?.up?.isDown || this.wasd?.w?.isDown) ay = -1;
    else if (this.cursors?.down?.isDown || this.wasd?.s?.isDown) ay = 1;
    else if (this.cursors?.left?.isDown || this.wasd?.a?.isDown) ax = -1;
    else if (this.cursors?.right?.isDown || this.wasd?.d?.isDown) ax = 1;
    if (ax === 0 && ay === 0) return;

    state.hero.facingX = ax;
    state.hero.facingY = ay;
    const sprint = this.cursors?.shift?.isDown ? 1.34 : 1;
    const speed = state.hero.speed * sprint;
    const nx = state.hero.x + ax * speed * dt;
    const ny = state.hero.y + ay * speed * dt;

    const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];
    const blocked = STRUCTURES.filter((s) => s.solid && s.region === realm.id).some((s) =>
      nx - 7 < s.x + s.w && nx + 7 > s.x && ny - 8 < s.y + s.h && ny + 8 > s.y);

    if (!blocked) {
      state.hero.x = Phaser.Math.Clamp(nx, realm.x + 16, realm.x + realm.w - 16);
      state.hero.y = Phaser.Math.Clamp(ny, realm.y + 16, realm.y + realm.h - 16);
    }
    state.hero.walkFrame = (state.hero.walkFrame + dt * 10) % 4;
    this.syncHeroPosition(state);
  }

  private syncHeroPosition(state: GameState): void {
    this.heroSprite.setPosition(state.hero.x, state.hero.y);
    const dir = state.hero.facingY < 0 ? "up" : state.hero.facingY > 0 ? "down" : state.hero.facingX < 0 ? "left" : state.hero.facingX > 0 ? "right" : "down";
    const frame = Math.floor(state.hero.walkFrame) % 4;
    this.heroSprite.setTexture(`hero-${dir}-${frame}`);
  }

  private animateWalking(state: GameState): void {

  }

  private spawnEnemies(realm: (typeof REALMS)[0]): void {
    const regionScale: Record<string, number> = { "myco-kingdom": 1, "rougarou-fen": 1.2, "tri-drake-peaks": 1.45, "crimson-tide": 1.35, "solana-chainlands": 1.7, "verdant-commons": 1.1, "obsidian-wilds": 1.55 };

    for (const def of BASE_ENEMIES.filter((e) => e.region === realm.id)) {
      const [bHex, aHex] = ENEMY_PALETTES[def.kind] ?? ["#f97316", "#7c2d12"];
      const bc = Phaser.Display.Color.HexStringToColor(bHex).color;
      const ac = Phaser.Display.Color.HexStringToColor(aHex).color;

      const texKey = generateEnemySprite(this, def.kind, bc, ac);
      const body = this.add.sprite(def.x, def.y, texKey).setDepth(5);
      const accent = body;
      const eyeL = body;
      const eyeR = body;
      const feetL = body;
      const feetR = body;

      if (def.boss) {
        this.add.rectangle(def.x, def.y, 26, 26).setStrokeStyle(2, 0xfacc15).setDepth(8);
        this.add.text(def.x, def.y - 16, "★ BOSS", { fontFamily: "monospace", fontSize: "8px", color: "#facc15" }).setOrigin(0.5).setDepth(8);
      }

      const hp = Math.round((def.boss ? 220 : 60) * (regionScale[def.region] ?? 1));
      this.enemies.push({
        def, body, accent, eyeL, eyeR, feetL, feetR,
        active: true, walkDist: 0, respawnAt: 0,
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
      if (!e.active) {
        if (e.respawnAt > 0 && now >= e.respawnAt) {
          e.active = true;
          e.respawnAt = 0;
          e.hp = e.maxHp;
          e.body.setVisible(true);
          e.body.setAlpha(1);
          e.body.setScale(1);
          e.body.setPosition(e.def.x, e.def.y);
        }
        continue;
      }
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
        e.walkDist += speed * dt;
      } else {
        e.wanderDirX *= -1;
        e.wanderDirY *= -1;
      }
      if (this.time.now >= this.contactCooldownUntil && Phaser.Math.Distance.Between(state.hero.x, state.hero.y, e.body.x, e.body.y) < (e.def.boss ? 36 : 30)) {
        this.contactCooldownUntil = this.time.now + 2000;
        this.registry.set("battleEnemyIdx", this.enemies.indexOf(e));
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
      const texKey = generateNpcSprite(this, def.id, cloak, accent);
      const body = this.add.sprite(def.x, def.y, texKey).setDepth(8);
      const acc = body;
      const feetL = body;
      const feetR = body;
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
        n.label.setPosition(nx, ny - 14);
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
            if (e.hp <= 0) { e.active = false;
            this.tweens.add({ targets: e.body, alpha: 0, scaleX: 1.8, scaleY: 1.8, duration: 300, onComplete: () => e.body.setVisible(false) });
            const deathLabel = this.add.text(e.body.x, e.body.y - 12, "+20", { fontFamily: "monospace", fontSize: "11px", fontStyle: "bold", color: "#22c55e" }).setOrigin(0.5).setDepth(20);
            this.tweens.add({ targets: deathLabel, y: e.body.y - 30, alpha: 0, duration: 600, onComplete: () => deathLabel.destroy() }); state.hero.spores += 20; this.audio.playSfx("coin"); }
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
    if (this.time.now < this.contactCooldownUntil) return;
    for (const n of this.npcs) {
      if (Phaser.Math.Distance.Between(state.hero.x, state.hero.y, n.body.x, n.body.y) < 22) {
        this.audio.playSfx("talk");
        this.scene.pause();
        const npcPortraits: Record<string, string> = {
          "elder-myca": "🧙", "spore-weaver": "🧵", "crown-archivist": "📜",
          "fen-witch": "🧪", "moss-hermit": "🌿", "ember-smith": "🔥",
          "peak-scout": "🏔️", "reef-diver": "🌊", "coral-singer": "🎵",
          "chain-oracle": "⛓️", "hash-monk": "📿", "green-trader": "💰",
          "root-sage": "🌱", "ash-wanderer": "🌋",
        };
        this.scene.launch("DialogueScene", {
          title: n.def.name,
          portrait: npcPortraits[n.def.id] ?? "🧙",
          body: n.def.intro,
          npcId: n.def.id,
          onChoice: (id: string) => { state.progress.interactedNpcs.add(n.def.id); },
          onClose: () => { state.mode = "explore"; },
        } satisfies DialoguePayload);
        return;
      }
    }
    const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];
    for (const s of STRUCTURES.filter((st) => st.region === realm.id)) {
      const dx = state.hero.x - (s.x + s.w / 2);
      const dy = state.hero.y - (s.y + s.h / 2);
      if (Math.abs(dx) < s.w / 2 + 8 && Math.abs(dy) < s.h / 2 + 8) {
        this.contactCooldownUntil = this.time.now + 1500;
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
    const tileKey = generateTerrainTile(this, colorA, colorB, realm.id);
    const tw = 32;
    for (let y = realm.y; y < realm.y + realm.h; y += tw) {
      for (let x = realm.x; x < realm.x + realm.w; x += tw) {
        this.add.image(x + tw / 2, y + tw / 2, tileKey).setDepth(0);
      }
    }
    const border = this.add.graphics().setDepth(0);
    border.lineStyle(2, 0x2f4678);
    border.strokeRect(realm.x, realm.y, realm.w, realm.h);
  }

  private drawStructuresOnce(realm: (typeof REALMS)[0]): void {
    for (const s of STRUCTURES.filter((st) => st.region === realm.id)) {
      const texKey = generateStructureSprite(this, s.type, s.w, s.h);
      this.add.image(s.x + s.w / 2, s.y + s.h / 2, texKey).setDepth(2);
      this.add.text(s.x + s.w / 2, s.y - 6, s.name, { fontFamily: "monospace", fontSize: "7px", color: "#bfdbfe" }).setOrigin(0.5).setDepth(3);
    }
  }

  private drawPortalsOnce(realm: (typeof REALMS)[0]): void {
    generatePortalTexture(this);
    for (const p of PORTALS) {
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      if (!(cx >= realm.x && cx <= realm.x + realm.w && cy >= realm.y && cy <= realm.y + realm.h)) continue;
      this.add.image(cx, cy, "portal").setDepth(2);
      this.add.text(cx, cy + 14, p.name, { fontFamily: "monospace", fontSize: "6px", color: "#7dd3fc" }).setOrigin(0.5).setDepth(3);
    }
  }
}
