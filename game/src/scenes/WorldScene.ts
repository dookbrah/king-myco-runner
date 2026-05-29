import Phaser from "phaser";
import { REALMS, TILE_SIZE, REALM_DEFAULT_SPAWNS } from "../data/realms";
import { BASE_ENEMIES, ENEMY_PALETTES } from "../data/enemies";
import { NPCS, NPC_TASKS, NPC_PALETTES } from "../data/npcs";
import { PORTALS } from "../data/portals";
import { STRUCTURES } from "../data/structures";
import { CLAN_PROFILES } from "../data/clans";
import type { GameState } from "../systems/GameState";
import { saveGameState } from "../systems/GameState";
import { AudioManager } from "../systems/AudioManager";
import { linkIdentity } from "../systems/ApiClient";
import type { DialoguePayload } from "./DialogueScene";
import type { StructureDef } from "../data/structures";
import { generateHeroTexture, generateEnemyTexture, generateNpcTexture, generatePickupTexture } from "../systems/SpriteFactory";
import { OverworldCombat } from "../systems/OverworldCombat";
import { createSporeParticles, createPickupMagnet, createPortalFlash, createBattleTransition } from "../systems/Particles";
import { saveGameState } from "../systems/GameState";

interface RuntimeEnemy {
  def: (typeof BASE_ENEMIES)[0];
  container: Phaser.GameObjects.Container;
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
  container: Phaser.GameObjects.Container;
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

export class WorldScene extends Phaser.Scene {
  private hero!: Phaser.GameObjects.Container;
  private heroFeetL!: Phaser.GameObjects.Rectangle;
  private heroFeetR!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private enemies: RuntimeEnemy[] = [];
  private npcs: RuntimeNpc[] = [];
  private pickups: { sprite: Phaser.GameObjects.Sprite; x: number; y: number; value: number; golden: boolean; collected: boolean }[] = [];
  private audio!: AudioManager;
  private combat!: OverworldCombat;
  private realmGfx!: Phaser.GameObjects.Graphics;

  constructor() {
    super({ key: "WorldScene" });
  }

  create(): void {
    const state = this.registry.get("gameState") as GameState;
    const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];
    const spawn = REALM_DEFAULT_SPAWNS[realm.id] ?? { x: realm.x + 100, y: realm.y + 100 };

    if (state.hero.x < realm.x || state.hero.x > realm.x + realm.w || state.hero.y < realm.y || state.hero.y > realm.y + realm.h) {
      state.hero.x = spawn.x;
      state.hero.y = spawn.y;
    }

    this.audio = new AudioManager();
    this.audio.init();
    this.audio.setMode("overworld");
    this.registry.set("audio", this.audio);

    this.drawTerrain(realm);
    this.drawStructures(realm);
    this.drawPortals(realm);
    this.createHero(state);
    this.spawnEnemies(state, realm);
    this.spawnNpcs(realm);

    this.add.text(realm.x + 20, realm.y + 14, realm.name + " // " + realm.label, {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "11px",
      color: "#64748b",
      wordWrap: { width: realm.w - 40 },
    }).setDepth(1);

    this.cameras.main.startFollow(this.hero, true, 0.12, 0.12);
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
      };
    }

    this.addMobileControls();
    this.combat = new OverworldCombat(this);
    this.spawnPickups(realm, state);
    state.mode = "explore";
    this.scene.launch("HudScene");
    linkIdentity(state).catch(() => {});
  }

  update(_time: number, delta: number): void {
    const state = this.registry.get("gameState") as GameState;
    if (state.mode !== "explore") return;
    const dt = delta / 1000;
    this.moveHero(state, dt);
    this.updateEnemies(state, dt);
    this.updateNpcs(dt);
    this.checkPortals(state);
    this.checkNpcInteraction(state);
    this.checkStructureInteraction(state);
    this.updatePickups(state);
    this.combat.update(dt, state, this.enemies.map((e) => ({ x: e.container.x, y: e.container.y, hp: e.hp, active: e.active })));
    if (this.input.keyboard && this.input.keyboard.addKey("SPACE").isDown) {
      this.combat.heroShoot(state);
    }
    this.animateHeroFeet(state);
    if (this.time.now % 60000 < 100) saveGameState(state);
  }

  private createHero(state: GameState): void {
    const clan = CLAN_PROFILES[state.playerClan] ?? CLAN_PROFILES.myco;
    const c = (hex: string) => Phaser.Display.Color.HexStringToColor(hex).color;

    const shadow = this.add.rectangle(0, 14, 24, 5, 0x020617, 0.3);
    const crown = this.add.rectangle(0, -22, 14, 4, 0xfacc15);
    const body = this.add.rectangle(0, -6, 16, 11, c(clan.colors.cap));
    const eyeL = this.add.rectangle(-4, -7, 3, 3, 0x86efac);
    const eyeR = this.add.rectangle(3, -7, 3, 3, 0x86efac);
    const robe = this.add.rectangle(0, 7, 20, 14, c(clan.colors.robe));
    const staff = this.add.rectangle(13, -2, 3, 22, 0x713f12);
    this.heroFeetL = this.add.rectangle(-6, 14, 4, 2, c(clan.colors.primary));
    this.heroFeetR = this.add.rectangle(6, 14, 4, 2, c(clan.colors.primary));
    const staffGem = this.add.rectangle(13, -14, 6, 4, 0x22c55e);

    this.hero = this.add.container(state.hero.x, state.hero.y, [
      shadow, robe, body, crown, eyeL, eyeR, staff, staffGem,
      this.heroFeetL, this.heroFeetR,
    ]).setDepth(10);
  }

  private moveHero(state: GameState, dt: number): void {
    let xAxis = 0, yAxis = 0;
    if (this.cursors) {
      if (this.cursors.up.isDown || this.wasd?.w?.isDown) yAxis -= 1;
      if (this.cursors.down.isDown || this.wasd?.s?.isDown) yAxis += 1;
      if (this.cursors.left.isDown || this.wasd?.a?.isDown) xAxis -= 1;
      if (this.cursors.right.isDown || this.wasd?.d?.isDown) xAxis += 1;
    }
    if (xAxis === 0 && yAxis === 0) return;

    const mag = Math.hypot(xAxis, yAxis) || 1;
    const sprint = this.cursors?.shift?.isDown ? 1.34 : 1;
    const speed = state.hero.speed * sprint;
    const vx = (xAxis / mag) * speed * dt;
    const vy = (yAxis / mag) * speed * dt;

    const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];
    let nx = state.hero.x + vx;
    let ny = state.hero.y + vy;

    const blocked = STRUCTURES.filter((s) => s.solid && s.region === realm.id).some((s) =>
      nx - 7 < s.x + s.w && nx + 7 > s.x && ny - 8 < s.y + s.h && ny + 8 > s.y);

    if (!blocked) {
      nx = Phaser.Math.Clamp(nx, realm.x + 20, realm.x + realm.w - 20);
      ny = Phaser.Math.Clamp(ny, realm.y + 20, realm.y + realm.h - 20);
      state.hero.x = nx;
      state.hero.y = ny;
    }

    state.hero.facingX = xAxis / mag;
    state.hero.facingY = yAxis / mag;
    state.hero.walkFrame = (state.hero.walkFrame + dt * 8) % 4;
    this.hero.setPosition(state.hero.x, state.hero.y);
  }

  private animateHeroFeet(state: GameState): void {
    const f = Math.floor(state.hero.walkFrame) % 4;
    this.heroFeetL.setPosition(f === 1 ? -7 : -6, f === 1 ? 15 : 14);
    this.heroFeetR.setPosition(f === 3 ? 7 : 6, f === 3 ? 15 : 14);
  }

  private spawnEnemies(state: GameState, realm: (typeof REALMS)[0]): void {
    for (const def of BASE_ENEMIES.filter((e) => e.region === realm.id)) {
      const [baseHex, accentHex] = ENEMY_PALETTES[def.kind] ?? ["#f97316", "#7c2d12"];
      const base = Phaser.Display.Color.HexStringToColor(baseHex).color;
      const accent = Phaser.Display.Color.HexStringToColor(accentHex).color;

      const body = this.add.rectangle(0, 0, 24, 24, base);
      const acc = this.add.rectangle(0, -2, 20, 10, accent);
      const eyeL = this.add.rectangle(-4, 0, 3, 3, 0x020617);
      const eyeR = this.add.rectangle(4, 0, 3, 3, 0x020617);
      const shadow = this.add.rectangle(0, 14, 22, 4, 0x020617, 0.25);
      const parts: Phaser.GameObjects.GameObject[] = [shadow, body, acc, eyeL, eyeR];

      if (def.boss) {
        const ring = this.add.rectangle(0, 0, 36, 36).setStrokeStyle(2, 0xfacc15);
        parts.push(ring);
      }

      const container = this.add.container(def.x, def.y, parts).setDepth(5);
      const regionScale: Record<string, number> = { "myco-kingdom": 1, "rougarou-fen": 1.2, "tri-drake-peaks": 1.45, "crimson-tide": 1.35, "solana-chainlands": 1.7, "verdant-commons": 1.1, "obsidian-wilds": 1.55 };
      const hp = Math.round((def.boss ? 220 : 60) * (regionScale[def.region] ?? 1));

      this.enemies.push({
        def, container, active: true, walkDist: 0,
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
      const nx = e.container.x + e.wanderDirX * speed * dt;
      const ny = e.container.y + e.wanderDirY * speed * dt;
      if (nx > realm.x + 20 && nx < realm.x + realm.w - 20 && ny > realm.y + 20 && ny < realm.y + realm.h - 20) {
        e.container.setPosition(nx, ny);
        e.walkDist += speed * dt;
      } else {
        e.wanderDirX *= -1;
        e.wanderDirY *= -1;
      }
      if (Phaser.Math.Distance.Between(state.hero.x, state.hero.y, e.container.x, e.container.y) < (e.def.boss ? 38 : 32)) {
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
    for (const def of NPCS.filter((n) => n.region === realm.id)) {
      const palette = NPC_PALETTES[def.id.split("").reduce((s, c) => s + c.charCodeAt(0), 0) % NPC_PALETTES.length];
      const cloak = Phaser.Display.Color.HexStringToColor(palette[0]).color;
      const accent = Phaser.Display.Color.HexStringToColor(palette[1]).color;

      const body = this.add.rectangle(0, 0, 20, 22, cloak);
      const acc = this.add.rectangle(0, -3, 14, 8, accent);
      const eyeL = this.add.rectangle(-3, -1, 2, 2, 0xf8fafc);
      const eyeR = this.add.rectangle(3, -1, 2, 2, 0xf8fafc);
      const shadow = this.add.rectangle(0, 12, 18, 4, 0x020617, 0.25);

      const container = this.add.container(def.x, def.y, [shadow, body, acc, eyeL, eyeR]).setDepth(8);
      const task = NPC_TASKS[Math.floor(Math.random() * NPC_TASKS.length)];
      const label = this.add.text(def.x, def.y - 20, task, {
        fontFamily: "monospace", fontSize: "8px", color: "#94a3b8",
      }).setOrigin(0.5).setDepth(9);

      this.npcs.push({
        def, container, label, walkDist: 0,
        wanderDirX: 0, wanderDirY: 0,
        wanderShiftAt: this.time.now + Math.random() * 3000,
        task, taskChangeAt: this.time.now + 15000 + Math.random() * 30000,
        homeX: def.x, homeY: def.y,
      });
    }
  }

  private updateNpcs(dt: number): void {
    const now = this.time.now;
    const realm = REALMS.find((r) => r.id === (this.registry.get("gameState") as GameState).currentRealmId) ?? REALMS[0];
    for (const npc of this.npcs) {
      if (now >= npc.wanderShiftAt) {
        const angle = Math.random() * Math.PI * 2;
        npc.wanderDirX = Math.cos(angle) * 0.6;
        npc.wanderDirY = Math.sin(angle) * 0.6;
        npc.wanderShiftAt = now + 2000 + Math.random() * 4000;
        if (Math.random() < 0.15) { npc.wanderDirX = 0; npc.wanderDirY = 0; }
      }
      if (now >= npc.taskChangeAt) {
        npc.task = NPC_TASKS[Math.floor(Math.random() * NPC_TASKS.length)];
        npc.taskChangeAt = now + 15000 + Math.random() * 30000;
        npc.label.setText(npc.task);
      }
      const homeDist = Phaser.Math.Distance.Between(npc.container.x, npc.container.y, npc.homeX, npc.homeY);
      let dx = npc.wanderDirX, dy = npc.wanderDirY;
      if (homeDist > 80) {
        dx += (npc.homeX - npc.container.x) / homeDist * 0.5;
        dy += (npc.homeY - npc.container.y) / homeDist * 0.5;
      }
      const nx = npc.container.x + dx * 22 * dt;
      const ny = npc.container.y + dy * 22 * dt;
      if (nx > realm.x + 10 && nx < realm.x + realm.w - 10 && ny > realm.y + 10 && ny < realm.y + realm.h - 10) {
        npc.container.setPosition(nx, ny);
        npc.label.setPosition(nx, ny - 20);
        npc.walkDist += Math.abs(dx * 22 * dt) + Math.abs(dy * 22 * dt);
      }
    }
  }

  private checkPortals(state: GameState): void {
    const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];
    for (const portal of PORTALS) {
      const px = portal.x + portal.w / 2;
      const py = portal.y + portal.h / 2;
      if (portal.destRealm === realm.id) continue;
      if (Phaser.Math.Distance.Between(state.hero.x, state.hero.y, px, py) < 36) {
        this.audio.playSfx("portal");
        createPortalFlash(this);
        state.currentRealmId = portal.destRealm;
        state.hero.x = portal.destX;
        state.hero.y = portal.destY;
        saveGameState(state);
        this.scene.restart();
        break;
      }
    }
  }

  private drawTerrain(realm: (typeof REALMS)[0]): void {
    const gfx = this.add.graphics();
    const tile = TILE_SIZE;
    const colorA = Phaser.Display.Color.HexStringToColor(realm.colorA).color;
    const colorB = Phaser.Display.Color.HexStringToColor(realm.colorB).color;
    for (let y = realm.y; y < realm.y + realm.h; y += tile) {
      for (let x = realm.x; x < realm.x + realm.w; x += tile) {
        gfx.fillStyle(((Math.floor(x / tile) + Math.floor(y / tile)) % 2) === 0 ? colorA : colorB);
        gfx.fillRect(x, y, tile, tile);
      }
    }
    gfx.lineStyle(2, 0x2f4678);
    gfx.strokeRect(realm.x, realm.y, realm.w, realm.h);
    gfx.setDepth(0);
  }

  private drawStructures(realm: (typeof REALMS)[0]): void {
    const gfx = this.add.graphics();
    const colors: Record<string, number> = {
      house: 0x92400e, castle: 0x1e3a5f, "mushroom-shop": 0x7c2d12, tower: 0x1f2937,
      cave: 0x374151, dungeon: 0x1e1b4b, "burn-pit": 0x451a03, shrine: 0x4c1d95,
    };
    for (const s of STRUCTURES.filter((st) => st.region === realm.id)) {
      gfx.fillStyle(colors[s.type] ?? 0x374151);
      gfx.fillRect(s.x, s.y, s.w, s.h);
      gfx.fillStyle(colors[s.type] ? colors[s.type] + 0x222222 : 0x555555);
      gfx.fillRect(s.x + 4, s.y - 6, s.w - 8, 8);
      this.add.text(s.x + s.w / 2, s.y - 10, s.name, {
        fontFamily: "monospace", fontSize: "8px", color: "#94a3b8",
      }).setOrigin(0.5).setDepth(3);
    }
    gfx.setDepth(2);
  }

  private drawPortals(realm: (typeof REALMS)[0]): void {
    const gfx = this.add.graphics();
    for (const p of PORTALS.filter((pt) => {
      const cx = pt.x + pt.w / 2;
      const cy = pt.y + pt.h / 2;
      return cx >= realm.x && cx <= realm.x + realm.w && cy >= realm.y && cy <= realm.y + realm.h;
    })) {
      gfx.fillStyle(0x22d3ee, 0.5);
      gfx.fillRect(p.x, p.y, p.w, p.h);
      gfx.fillStyle(0xf8fafc);
      gfx.fillRect(p.x + p.w / 2 - 1, p.y + 4, 2, p.h - 8);
      gfx.fillRect(p.x + 4, p.y + p.h / 2 - 1, p.w - 8, 2);
      this.add.text(p.x + p.w / 2, p.y + p.h + 6, p.name, {
        fontFamily: "monospace", fontSize: "7px", color: "#7dd3fc",
      }).setOrigin(0.5).setDepth(3);
    }
    gfx.setDepth(2);
  }

  private checkNpcInteraction(state: GameState): void {
    if (!this.wasd?.e?.isDown) return;
    if (this.wasd.e.getDuration() > 100) return;
    for (const npc of this.npcs) {
      if (Phaser.Math.Distance.Between(state.hero.x, state.hero.y, npc.container.x, npc.container.y) < 56) {
        this.audio.playSfx("talk");
        state.mode = "dialogue" as GameState["mode"];
        this.scene.pause();
        this.scene.launch("DialogueScene", {
          title: npc.def.name,
          portrait: "🧙",
          body: npc.def.intro,
          choices: [
            { id: "myco", label: "Mycoside", color: "#22c55e" },
            { id: "dark", label: "Darkside", color: "#ef4444" },
            { id: "close", label: "Leave", color: "#94a3b8" },
          ],
          onChoice: (id: string) => {
            if (id === "myco") state.hero.morality += 3;
            else if (id === "dark") state.hero.morality -= 3;
            state.progress.interactedNpcs.add(npc.def.id);
          },
          onClose: () => { state.mode = "explore"; },
        } satisfies DialoguePayload);
        return;
      }
    }
  }

  private spawnPickups(realm: (typeof REALMS)[0], state: GameState): void {
    const positions = [
      { x: realm.x + 200, y: realm.y + 200, value: 12, golden: false },
      { x: realm.x + realm.w * 0.3, y: realm.y + realm.h * 0.4, value: 14, golden: false },
      { x: realm.x + realm.w * 0.7, y: realm.y + realm.h * 0.3, value: 16, golden: false },
      { x: realm.x + realm.w * 0.5, y: realm.y + realm.h * 0.6, value: 10, golden: false },
      { x: realm.x + realm.w * 0.2, y: realm.y + realm.h * 0.8, value: 18, golden: false },
      { x: realm.x + realm.w * 0.8, y: realm.y + realm.h * 0.7, value: 20, golden: false },
      { x: realm.x + realm.w * 0.5, y: realm.y + realm.h * 0.2, value: 8, golden: true },
      { x: realm.x + realm.w * 0.9, y: realm.y + realm.h * 0.5, value: 5, golden: true },
    ];
    for (const pos of positions) {
      const key = generatePickupTexture(this, pos.golden);
      const sprite = this.add.sprite(pos.x, pos.y, key).setDepth(4);
      this.pickups.push({ sprite, x: pos.x, y: pos.y, value: pos.value, golden: pos.golden, collected: false });
    }
  }

  private updatePickups(state: GameState): void {
    const magnetRange = 48;
    for (const pickup of this.pickups) {
      if (pickup.collected) continue;
      const dist = Phaser.Math.Distance.Between(state.hero.x, state.hero.y, pickup.x, pickup.y);
      if (dist < magnetRange) {
        pickup.collected = true;
        createPickupMagnet(this, pickup.sprite, state.hero.x, state.hero.y, () => {
          if (pickup.golden) {
            state.hero.goldenSpores += pickup.value;
          } else {
            state.hero.spores += pickup.value;
          }
          this.audio.playSfx("pickup");
          createSporeParticles(this, state.hero.x, state.hero.y, pickup.golden);
        });
      }
    }
  }

  private checkStructureInteraction(state: GameState): void {
    if (!this.wasd?.e?.isDown) return;
    if (this.wasd.e.getDuration() > 100) return;
    const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];
    for (const s of STRUCTURES.filter((st) => st.region === realm.id)) {
      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      if (Phaser.Math.Distance.Between(state.hero.x, state.hero.y, cx, cy) < 50) {
        this.audio.playSfx("portal");
        if (s.type === "burn-pit" || s.type === "shrine") {
          state.mode = "burn-pit" as GameState["mode"];
          this.scene.pause();
          this.scene.launch("BurnPitScene");
          return;
        }
        state.mode = "interior" as GameState["mode"];
        this.scene.pause();
        this.scene.launch("InteriorScene", { structure: s });
        return;
      }
    }
  }

  private addMobileControls(): void {
    if (!("ontouchstart" in window)) return;
    const cam = this.cameras.main;

    const attackBtn = this.add.text(cam.width - 140, cam.height - 50, "Attack", {
      fontFamily: "monospace", fontSize: "13px", color: "#f8fafc",
      backgroundColor: "rgba(12, 25, 49, 0.85)", padding: { x: 14, y: 10 },
    }).setScrollFactor(0).setDepth(100).setInteractive();

    const engageBtn = this.add.text(cam.width - 68, cam.height - 50, "Engage", {
      fontFamily: "monospace", fontSize: "13px", color: "#f8fafc",
      backgroundColor: "rgba(12, 25, 49, 0.85)", padding: { x: 14, y: 10 },
    }).setScrollFactor(0).setDepth(100).setInteractive();

    attackBtn.on("pointerdown", () => this.audio?.playSfx("strike"));
    engageBtn.on("pointerdown", () => this.audio?.playSfx("talk"));

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.x < cam.width * 0.5 && pointer.y > cam.height * 0.6) {
        (this as unknown as { _touchOrigin: { x: number; y: number } })._touchOrigin = { x: pointer.x, y: pointer.y };
      }
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const origin = (this as unknown as { _touchOrigin?: { x: number; y: number } })._touchOrigin;
      if (!origin || !pointer.isDown) return;
      const dx = pointer.x - origin.x;
      const dy = pointer.y - origin.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 8) return;
      const state = this.registry.get("gameState") as GameState;
      const norm = Math.max(dist, 1);
      state.hero.facingX = dx / norm;
      state.hero.facingY = dy / norm;
    });
    this.input.on("pointerup", () => {
      (this as unknown as { _touchOrigin?: null })._touchOrigin = null;
    });
  }
}
