import Phaser from "phaser";
import type { EnemyDef } from "../data/enemies";
import { ENEMY_PALETTES } from "../data/enemies";
import type { GameState } from "../systems/GameState";

export class BattleScene extends Phaser.Scene {
  private enemyDef!: EnemyDef;
  private battleState = {
    turnNumber: 1,
    playerHp: 100,
    playerMaxHp: 100,
    enemyHp: 80,
    enemyMaxHp: 80,
    status: "active" as "active" | "won" | "lost",
    log: [] as string[],
  };
  private logText!: Phaser.GameObjects.Text;
  private speechText!: Phaser.GameObjects.Text;
  private playerHpBar!: Phaser.GameObjects.Rectangle;
  private enemyHpBar!: Phaser.GameObjects.Rectangle;

  constructor() {
    super({ key: "BattleScene" });
  }

  init(data: { enemy: EnemyDef }): void {
    this.enemyDef = data.enemy;
  }

  create(): void {
    const { width, height } = this.scale;
    const state = this.registry.get("gameState") as GameState;
    const tile = 12;

    const [baseHex] = ENEMY_PALETTES[this.enemyDef.kind] ?? ["#f97316"];
    const baseColor = Phaser.Display.Color.HexStringToColor(baseHex).color;

    this.battleState.playerHp = state.hero.hp;
    this.battleState.playerMaxHp = state.hero.maxHp;
    this.battleState.enemyHp = this.enemyDef.boss ? 220 : 80;
    this.battleState.enemyMaxHp = this.battleState.enemyHp;
    this.battleState.status = "active";
    this.battleState.turnNumber = 1;
    this.battleState.log = [`Battle with ${this.enemyDef.kind}!`];

    const gfx = this.add.graphics();
    for (let y = 0; y < height; y += tile) {
      for (let x = 0; x < width; x += tile) {
        const checker = ((x / tile + y / tile) % 2) === 0;
        const above = y < height * 0.42;
        gfx.fillStyle(above ? (checker ? 0x0f172a : 0x1e293b) : (checker ? 0x1a3424 : 0x143020));
        gfx.fillRect(x, y, tile, tile);
      }
    }

    const laneText = `Lane: ${this.enemyDef.lane.toUpperCase()} | Turn ${this.battleState.turnNumber}`;
    this.add.text(10, 8, laneText, { fontFamily: "monospace", fontSize: "12px", color: "#94a3b8" });

    const playerX = width * 0.23;
    const enemyX = width * 0.77;
    const actorY = height * 0.45;

    this.add.rectangle(playerX, actorY, 30, 40, 0x166534).setDepth(2);
    this.add.rectangle(playerX, actorY - 14, 20, 8, 0xfacc15).setDepth(3);
    this.add.rectangle(playerX - 4, actorY - 4, 3, 3, 0x86efac).setDepth(3);
    this.add.rectangle(playerX + 4, actorY - 4, 3, 3, 0x86efac).setDepth(3);
    this.add.text(playerX, actorY - 28, "King Myco", { fontFamily: "monospace", fontSize: "10px", color: "#dbeafe" }).setOrigin(0.5);

    this.add.rectangle(enemyX, actorY, 30, 30, baseColor).setDepth(2);
    this.add.text(enemyX, actorY - 24, this.enemyDef.kind, { fontFamily: "monospace", fontSize: "10px", color: "#dbeafe" }).setOrigin(0.5);

    const barY = actorY + 30;
    const barW = 80;
    this.add.rectangle(playerX, barY, barW, 8, 0x101827);
    this.playerHpBar = this.add.rectangle(playerX - barW / 2, barY, barW, 8, 0x22c55e).setOrigin(0, 0.5);
    this.add.rectangle(enemyX, barY, barW, 8, 0x101827);
    this.enemyHpBar = this.add.rectangle(enemyX - barW / 2, barY, barW, 8, 0xef4444).setOrigin(0, 0.5);

    const speechY = height * 0.68;
    this.add.rectangle(width / 2, speechY, width - 20, 40, 0x05070a)
      .setStrokeStyle(2, 0xf8fafc);
    this.speechText = this.add.text(20, speechY - 12, "* A hostile presence blocks your path.", {
      fontFamily: "monospace", fontSize: "13px", color: "#f8fafc", wordWrap: { width: width - 50 },
    });

    const btnY = height - 48;
    const btnW = (width - 50) / 4;
    const commands = ["FIGHT", "ACT", "ITEM", "MERCY"];
    commands.forEach((cmd, i) => {
      const bx = 12 + i * (btnW + 8) + btnW / 2;
      const btn = this.add.text(bx, btnY, cmd, {
        fontFamily: "monospace",
        fontSize: "13px",
        fontStyle: "bold",
        color: "#facc15",
        backgroundColor: "rgba(5,7,10,0.95)",
        padding: { x: 10, y: 8 },
      }).setOrigin(0.5).setInteractive();

      btn.on("pointerdown", () => this.executeTurn(cmd, state));
    });

    const logY = height - 20;
    this.logText = this.add.text(10, logY, "", {
      fontFamily: "monospace", fontSize: "9px", color: "#64748b", wordWrap: { width: width - 20 },
    });
    this.updateLog();
  }

  private executeTurn(command: string, state: GameState): void {
    if (this.battleState.status !== "active") return;

    const playerDmg = Math.round(8 + state.hero.attack * 3 + Math.random() * 10);
    const enemyDmg = Math.round(5 + Math.random() * 12);

    if (command === "FIGHT") {
      this.battleState.enemyHp = Math.max(0, this.battleState.enemyHp - playerDmg);
      this.battleState.log.push(`King Myco strikes for ${playerDmg}!`);
    } else if (command === "ACT") {
      this.battleState.log.push("* You try to reason with the enemy...");
    } else if (command === "ITEM") {
      if (state.inventory.mycoPotion > 0) {
        state.inventory.mycoPotion--;
        const heal = Math.min(40, state.hero.maxHp - this.battleState.playerHp);
        this.battleState.playerHp += heal;
        this.battleState.log.push(`Used Myco Potion. +${heal} HP.`);
      } else {
        this.battleState.log.push("No items left!");
      }
    } else if (command === "MERCY") {
      this.battleState.log.push("* You show mercy... the enemy pauses.");
      state.hero.morality += 2;
    }

    if (this.battleState.enemyHp <= 0) {
      this.battleState.status = "won";
      this.battleState.log.push("VICTORY! Enemy defeated.");
      state.hero.spores += this.enemyDef.boss ? 150 : 40;
      state.progress.enemyWins++;
      if (this.enemyDef.boss) state.progress.bossWins++;
    } else if (this.battleState.status === "active") {
      this.battleState.playerHp = Math.max(0, this.battleState.playerHp - enemyDmg);
      this.battleState.log.push(`Enemy hits for ${enemyDmg}.`);

      if (this.battleState.playerHp <= 0) {
        this.battleState.status = "lost";
        this.battleState.log.push("DEFEAT... King Myco falls.");
      }
    }

    this.battleState.turnNumber++;
    state.hero.hp = this.battleState.playerHp;

    this.updateBars();
    this.updateLog();
    this.speechText.setText(`* ${this.battleState.log[this.battleState.log.length - 1]}`);

    if (this.battleState.status !== "active") {
      this.time.delayedCall(1500, () => {
        state.mode = "explore";
        state.audio.musicMode = "overworld";
        this.scene.stop();
        this.scene.resume("WorldScene");
      });
    }
  }

  private updateBars(): void {
    const playerRatio = this.battleState.playerHp / this.battleState.playerMaxHp;
    const enemyRatio = this.battleState.enemyHp / this.battleState.enemyMaxHp;
    this.playerHpBar.setScale(Math.max(0, playerRatio), 1);
    this.enemyHpBar.setScale(Math.max(0, enemyRatio), 1);
  }

  private updateLog(): void {
    this.logText.setText(this.battleState.log.slice(-3).join("\n"));
  }
}
