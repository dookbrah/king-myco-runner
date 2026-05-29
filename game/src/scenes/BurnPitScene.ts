import Phaser from "phaser";
import type { GameState } from "../systems/GameState";
import { saveGameState } from "../systems/GameState";
import type { AudioManager } from "../systems/AudioManager";

export class BurnPitScene extends Phaser.Scene {
  private burnAmount = 0;
  private burnedToday = 0;
  private dailyLimit = 1000;
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "BurnPitScene" });
  }

  create(): void {
    const { width, height } = this.scale;
    const state = this.registry.get("gameState") as GameState;

    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0806);

    this.add.text(width / 2, 30, "🔥 SPORE BURN PIT 🔥", {
      fontFamily: "monospace", fontSize: "18px", color: "#f97316",
    }).setOrigin(0.5);

    this.add.text(width / 2, 60, "Sacrifice spores to strengthen the realm network.", {
      fontFamily: "monospace", fontSize: "11px", color: "#94a3b8",
    }).setOrigin(0.5);

    const sporesAvail = state.hero.spores;
    this.add.text(width / 2, 100, `Available: ${sporesAvail} spores`, {
      fontFamily: "monospace", fontSize: "14px", color: "#fbbf24",
    }).setOrigin(0.5);

    this.add.text(width / 2, 120, `Burned today: ${this.burnedToday} / ${this.dailyLimit}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#64748b",
    }).setOrigin(0.5);

    const burnAmounts = [25, 50, 100, 250];
    burnAmounts.forEach((amount, i) => {
      const bx = width / 2 - 120 + i * 80;
      const btn = this.add.text(bx, 160, `${amount}`, {
        fontFamily: "monospace", fontSize: "14px", fontStyle: "bold",
        color: amount <= sporesAvail ? "#f97316" : "#4b5563",
        backgroundColor: "rgba(5,7,10,0.9)", padding: { x: 14, y: 8 },
      }).setOrigin(0.5).setInteractive();

      if (amount <= sporesAvail) {
        btn.on("pointerdown", () => this.burnSpores(amount, state));
      }
    });

    this.statusText = this.add.text(width / 2, 210, "", {
      fontFamily: "monospace", fontSize: "12px", color: "#22c55e",
    }).setOrigin(0.5);

    const exitBtn = this.add.text(width / 2, height - 40, "[ LEAVE BURN PIT ]", {
      fontFamily: "monospace", fontSize: "12px", color: "#ef4444",
      backgroundColor: "rgba(5,7,10,0.8)", padding: { x: 10, y: 6 },
    }).setOrigin(0.5).setInteractive();
    exitBtn.on("pointerdown", () => {
      state.mode = "explore";
      this.scene.stop();
      this.scene.resume("WorldScene");
    });

    const flameGfx = this.add.graphics();
    for (let i = 0; i < 20; i++) {
      const fx = width / 2 + Phaser.Math.Between(-60, 60);
      const fy = height / 2 + Phaser.Math.Between(20, 80);
      const size = Phaser.Math.Between(4, 10);
      flameGfx.fillStyle(Math.random() < 0.5 ? 0xf97316 : 0xfbbf24, 0.4 + Math.random() * 0.4);
      flameGfx.fillRect(fx, fy, size, size);
    }
  }

  private burnSpores(amount: number, state: GameState): void {
    if (state.hero.spores < amount) return;
    if (this.burnedToday + amount > this.dailyLimit) {
      this.statusText.setText("Daily burn limit reached!");
      return;
    }
    state.hero.spores -= amount;
    this.burnedToday += amount;
    const audio = this.registry.get("audio") as AudioManager | undefined;
    audio?.playSfx("coin");
    this.statusText.setText(`Burned ${amount} spores! Realm network strengthened.`);
    saveGameState(state);
  }
}
