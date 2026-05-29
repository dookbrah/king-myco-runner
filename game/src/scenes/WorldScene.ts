import Phaser from "phaser";
import { REALMS, TILE_SIZE, REALM_DEFAULT_SPAWNS } from "../data/realms";
import { BASE_ENEMIES, ENEMY_PALETTES } from "../data/enemies";
import { CLAN_PROFILES } from "../data/clans";
import type { GameState } from "../systems/GameState";
import { saveGameState } from "../systems/GameState";

interface RuntimeEnemy {
  def: typeof BASE_ENEMIES[0];
  sprite: Phaser.GameObjects.Rectangle;
  accent: Phaser.GameObjects.Rectangle;
  eyes: Phaser.GameObjects.Rectangle[];
  label?: Phaser.GameObjects.Text;
  active: boolean;
  walkDist: number;
  wanderDirX: number;
  wanderDirY: number;
  directionShiftAt: number;
  hp: number;
  maxHp: number;
}

export class WorldScene extends Phaser.Scene {
  private hero!: Phaser.GameObjects.Container;
  private heroBody!: Phaser.GameObjects.Rectangle;
  private heroCrown!: Phaser.GameObjects.Rectangle;
  private heroEyeL!: Phaser.GameObjects.Rectangle;
  private heroEyeR!: Phaser.GameObjects.Rectangle;
  private heroRobe!: Phaser.GameObjects.Rectangle;
  private heroStaff!: Phaser.GameObjects.Rectangle;
  private heroShadow!: Phaser.GameObjects.Rectangle;
  private heroFeetL!: Phaser.GameObjects.Rectangle;
  private heroFeetR!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private enemies: RuntimeEnemy[] = [];
  private realmLabel!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "WorldScene" });
  }

  create(): void {
    const state = this.registry.get("gameState") as GameState;
    const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];
    const spawn = REALM_DEFAULT_SPAWNS[realm.id] ?? { x: realm.x + 100, y: realm.y + 100 };

    if (state.hero.x < realm.x || state.hero.x > realm.x + realm.w) {
      state.hero.x = spawn.x;
      state.hero.y = spawn.y;
    }

    this.drawTerrain(realm);

    const clan = CLAN_PROFILES[state.playerClan] ?? CLAN_PROFILES.myco;

    this.heroShadow = this.add.rectangle(0, 14, 24, 5, 0x020617, 0.3);
    this.heroCrown = this.add.rectangle(0, -22, 14, 4, 0xfacc15);
    this.heroBody = this.add.rectangle(0, -6, 16, 11, Phaser.Display.Color.HexStringToColor(clan.colors.cap).color);
    this.heroEyeL = this.add.rectangle(-4, -7, 3, 3, 0x86efac);
    this.heroEyeR = this.add.rectangle(3, -7, 3, 3, 0x86efac);
    this.heroRobe = this.add.rectangle(0, 7, 20, 14, Phaser.Display.Color.HexStringToColor(clan.colors.robe).color);
    this.heroStaff = this.add.rectangle(13, -2, 3, 22, 0x713f12);
    this.heroFeetL = this.add.rectangle(-6, 14, 4, 2, Phaser.Display.Color.HexStringToColor(clan.colors.primary).color);
    this.heroFeetR = this.add.rectangle(6, 14, 4, 2, Phaser.Display.Color.HexStringToColor(clan.colors.primary).color);

    this.hero = this.add.container(state.hero.x, state.hero.y, [
      this.heroShadow, this.heroRobe, this.heroBody, this.heroCrown,
      this.heroEyeL, this.heroEyeR, this.heroStaff, this.heroFeetL, this.heroFeetR,
    ]);
    this.hero.setDepth(10);

    this.spawnEnemies(state, realm);

    this.realmLabel = this.add.text(realm.x + 20, realm.y + 20, realm.name, {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "14px",
      color: "#94a3b8",
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
      };
    }

    this.addMobileControls();
    state.mode = "explore";
    state.audio.musicMode = "overworld";
  }

  update(_time: number, delta: number): void {
    const state = this.registry.get("gameState") as GameState;
    if (state.mode !== "explore") return;

    const dt = delta / 1000;
    this.moveHero(state, dt);
    this.updateEnemies(state, dt);
    this.animateHeroFeet(state);
  }

  private moveHero(state: GameState, dt: number): void {
    let xAxis = 0;
    let yAxis = 0;

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
    const nx = Phaser.Math.Clamp(state.hero.x + vx, realm.x + 20, realm.x + realm.w - 20);
    const ny = Phaser.Math.Clamp(state.hero.y + vy, realm.y + 20, realm.y + realm.h - 20);

    state.hero.x = nx;
    state.hero.y = ny;
    state.hero.facingX = xAxis / mag;
    state.hero.facingY = yAxis / mag;
    state.hero.walkFrame = (state.hero.walkFrame + dt * 8) % 4;

    this.hero.setPosition(nx, ny);
  }

  private animateHeroFeet(state: GameState): void {
    const frame = Math.floor(state.hero.walkFrame) % 4;
    if (frame === 1) {
      this.heroFeetL.setPosition(-7, 15);
      this.heroFeetR.setPosition(6, 13);
    } else if (frame === 3) {
      this.heroFeetL.setPosition(-6, 13);
      this.heroFeetR.setPosition(7, 15);
    } else {
      this.heroFeetL.setPosition(-6, 14);
      this.heroFeetR.setPosition(6, 14);
    }
  }

  private spawnEnemies(state: GameState, realm: typeof REALMS[0]): void {
    const realmEnemies = BASE_ENEMIES.filter((e) => e.region === realm.id);

    for (const def of realmEnemies) {
      const [baseColor, accentColor] = ENEMY_PALETTES[def.kind] ?? ["#f97316", "#7c2d12"];
      const base = Phaser.Display.Color.HexStringToColor(baseColor).color;
      const accent = Phaser.Display.Color.HexStringToColor(accentColor).color;

      const body = this.add.rectangle(def.x, def.y, 24, 24, base).setDepth(5);
      const accentRect = this.add.rectangle(def.x, def.y - 2, 20, 10, accent).setDepth(6);
      const eyeL = this.add.rectangle(def.x - 4, def.y, 3, 3, 0x020617).setDepth(7);
      const eyeR = this.add.rectangle(def.x + 4, def.y, 3, 3, 0x020617).setDepth(7);

      let label: Phaser.GameObjects.Text | undefined;
      if (def.boss) {
        label = this.add.text(def.x, def.y - 20, "★ BOSS", {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#facc15",
        }).setOrigin(0.5).setDepth(8);
      }

      this.enemies.push({
        def,
        sprite: body,
        accent: accentRect,
        eyes: [eyeL, eyeR],
        label,
        active: true,
        walkDist: 0,
        wanderDirX: Phaser.Math.FloatBetween(-1, 1),
        wanderDirY: Phaser.Math.FloatBetween(-1, 1),
        directionShiftAt: this.time.now + Phaser.Math.Between(1000, 3000),
        hp: def.boss ? 220 : 60,
        maxHp: def.boss ? 220 : 60,
      });
    }
  }

  private updateEnemies(state: GameState, dt: number): void {
    const now = this.time.now;
    const realm = REALMS.find((r) => r.id === state.currentRealmId) ?? REALMS[0];

    for (const enemy of this.enemies) {
      if (!enemy.active) continue;

      if (now >= enemy.directionShiftAt) {
        enemy.wanderDirX = Phaser.Math.FloatBetween(-1, 1);
        enemy.wanderDirY = Phaser.Math.FloatBetween(-1, 1);
        enemy.directionShiftAt = now + Phaser.Math.Between(1000, 3200);
      }

      const speed = enemy.def.boss ? 26 : 36;
      const nx = enemy.sprite.x + enemy.wanderDirX * speed * dt;
      const ny = enemy.sprite.y + enemy.wanderDirY * speed * dt;

      if (nx > realm.x + 20 && nx < realm.x + realm.w - 20 &&
          ny > realm.y + 20 && ny < realm.y + realm.h - 20) {
        enemy.sprite.setPosition(nx, ny);
        enemy.accent.setPosition(nx, ny - 2);
        enemy.eyes[0].setPosition(nx - 4, ny);
        enemy.eyes[1].setPosition(nx + 4, ny);
        if (enemy.label) enemy.label.setPosition(nx, ny - 20);
        enemy.walkDist += speed * dt;
      } else {
        enemy.wanderDirX *= -1;
        enemy.wanderDirY *= -1;
      }

      const heroDistSq = Phaser.Math.Distance.Squared(state.hero.x, state.hero.y, enemy.sprite.x, enemy.sprite.y);
      if (heroDistSq < (enemy.def.boss ? 38 * 38 : 32 * 32)) {
        state.mode = "battle";
        state.audio.musicMode = enemy.def.boss ? "boss" : "battle";
        this.scene.launch("BattleScene", { enemy: enemy.def });
        this.scene.pause();
        break;
      }
    }
  }

  private drawTerrain(realm: typeof REALMS[0]): void {
    const gfx = this.add.graphics();
    const tile = TILE_SIZE;
    const colorA = Phaser.Display.Color.HexStringToColor(realm.colorA).color;
    const colorB = Phaser.Display.Color.HexStringToColor(realm.colorB).color;

    for (let y = realm.y; y < realm.y + realm.h; y += tile) {
      for (let x = realm.x; x < realm.x + realm.w; x += tile) {
        const checker = ((Math.floor(x / tile) + Math.floor(y / tile)) % 2) === 0;
        gfx.fillStyle(checker ? colorA : colorB);
        gfx.fillRect(x, y, tile, tile);
      }
    }

    gfx.lineStyle(2, 0x2f4678);
    gfx.strokeRect(realm.x, realm.y, realm.w, realm.h);
    gfx.setDepth(0);
  }

  private addMobileControls(): void {
    if (!("ontouchstart" in window)) return;

    const cam = this.cameras.main;
    const btnStyle = {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#f8fafc",
      backgroundColor: "rgba(12, 25, 49, 0.85)",
      padding: { x: 16, y: 10 },
    };

    const attackBtn = this.add.text(0, 0, "Attack", btnStyle)
      .setScrollFactor(0)
      .setDepth(100)
      .setInteractive()
      .on("pointerdown", () => { /* overworld attack */ });

    const engageBtn = this.add.text(0, 0, "Engage", btnStyle)
      .setScrollFactor(0)
      .setDepth(100)
      .setInteractive()
      .on("pointerdown", () => { /* interact */ });

    const padding = 12;
    attackBtn.setPosition(cam.width - attackBtn.width - engageBtn.width - padding * 3, cam.height - 50);
    engageBtn.setPosition(cam.width - engageBtn.width - padding, cam.height - 50);
  }
}
