import Phaser from "phaser";
import type { GameState } from "../systems/GameState";
import { REALMS } from "../data/realms";

export class HudScene extends Phaser.Scene {
  private hpBar!: Phaser.GameObjects.Rectangle;
  private hpBg!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;
  private sporeText!: Phaser.GameObjects.Text;
  private realmText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private minimap!: Phaser.GameObjects.Graphics;
  private minimapW = 140;
  private minimapH = 90;

  constructor() {
    super({ key: "HudScene" });
  }

  create(): void {
    const { width } = this.scale;
    const pad = 10;

    this.hpBg = this.add.rectangle(pad + 60, pad + 8, 120, 14, 0x101827).setOrigin(0, 0.5);
    this.hpBar = this.add.rectangle(pad + 60, pad + 8, 120, 14, 0x22c55e).setOrigin(0, 0.5);
    this.add.text(pad, pad, "HP", {
      fontFamily: "monospace", fontSize: "12px", fontStyle: "bold", color: "#86efac",
    });
    this.hpText = this.add.text(pad + 190, pad, "", {
      fontFamily: "monospace", fontSize: "11px", color: "#94a3b8",
    });

    this.sporeText = this.add.text(pad, pad + 22, "", {
      fontFamily: "monospace", fontSize: "11px", color: "#fbbf24",
    });

    this.realmText = this.add.text(pad, pad + 38, "", {
      fontFamily: "monospace", fontSize: "10px", color: "#64748b",
    });

    this.statusText = this.add.text(width / 2, pad + 8, "", {
      fontFamily: "monospace", fontSize: "10px", color: "#94a3b8",
    }).setOrigin(0.5, 0);

    this.minimap = this.add.graphics();
    this.drawMinimap();
    this.createMenu();

    const { width: w2, height: h2 } = this.scale;
    const menuBtn = this.add.text(w2 - 8, h2 - 8, "☰ MENU", {
      fontFamily: "monospace", fontSize: "11px", fontStyle: "bold",
      color: "#facc15", backgroundColor: "rgba(5,7,10,0.85)",
      padding: { x: 8, y: 5 },
    }).setOrigin(1, 1).setDepth(70).setInteractive();
    menuBtn.on("pointerdown", () => this.toggleMenu());
  }

  update(): void {
    const state = this.registry.get("gameState") as GameState;
    if (!state) return;

    const ratio = Math.max(0, state.hero.hp / state.hero.maxHp);
    this.hpBar.setScale(ratio, 1);
    this.hpBar.setFillStyle(ratio > 0.5 ? 0x22c55e : ratio > 0.25 ? 0xfbbf24 : 0xef4444);
    this.hpText.setText(`${state.hero.hp}/${state.hero.maxHp}`);
    this.sporeText.setText(`Spores: ${state.hero.spores}  Golden: ${state.hero.goldenSpores}`);

    const realm = REALMS.find((r) => r.id === state.currentRealmId);
    this.realmText.setText(`${realm?.name ?? "Unknown"} // ${state.nickname || "Explorer"}`);

    this.drawMinimap();
  }

  private menuOpen = false;
  private menuContainer!: Phaser.GameObjects.Container;

  private createMenu(): void {
    const { width, height } = this.scale;
    const menuW = 200, menuH = 240;
    const mx = width - menuW - 8, my = height - menuH - 36;

    const bg = this.add.rectangle(menuW / 2, menuH / 2, menuW, menuH, 0x05070a).setStrokeStyle(2, 0x3d5f96);

    const state = this.registry.get("gameState") as GameState;
    const inv = state?.inventory ?? {} as Record<string, number>;
    const invText = `== INVENTORY ==
Myco Potion: ${inv.mycoPotion ?? 0}
Mana Dew: ${inv.manaDew ?? 0}
Smoke Bomb: ${inv.smokeBomb ?? 0}
Armor Shards: ${inv.armorShards ?? 0}
Guard Runes: ${inv.guardRunes ?? 0}
Spell Dust: ${inv.spellDust ?? 0}
Boss Sigils: ${inv.bossSigils ?? 0}`;

    const web3Text = `== WEB3 ==
Wallet: ${state?.web3?.wallet ? state.web3.wallet.slice(0, 6) + "..." : "none"}
$MYCO: verified
Chain Rank: ${state?.web3?.chainRank ?? "Unranked"}`;

    const boardText = `== STATS ==
Enemies: ${state?.progress?.enemyWins ?? 0}
Bosses: ${state?.progress?.bossWins ?? 0}
NPCs Met: ${state?.progress?.interactedNpcs?.size ?? 0}
Clues: ${state?.progress?.clues?.size ?? 0}
Morality: ${state?.hero?.morality ?? 0}`;

    const fullText = invText + "\n\n" + web3Text + "\n\n" + boardText;

    const text = this.add.text(8, 8, fullText, {
      fontFamily: "monospace", fontSize: "8px", color: "#dbeafe", lineSpacing: 2,
    });

    this.menuContainer = this.add.container(mx, my, [bg, text]);
    this.menuContainer.setDepth(80);
    this.menuContainer.setVisible(false);
  }

  private toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
    if (this.menuOpen) {
      const state = this.registry.get("gameState") as GameState;
      const inv = state?.inventory ?? {} as Record<string, number>;
      this.menuContainer.setVisible(true);
    } else {
      this.menuContainer.setVisible(false);
    }
  }

  private drawMinimap(): void {
    const state = this.registry.get("gameState") as GameState;
    if (!state) return;

    const { width } = this.scale;
    const mx = width - this.minimapW - 10;
    const my = 10;
    const scaleX = this.minimapW / 6200;
    const scaleY = this.minimapH / 4200;

    this.minimap.clear();
    this.minimap.fillStyle(0x040913, 0.85);
    this.minimap.fillRect(mx, my, this.minimapW, this.minimapH);
    this.minimap.lineStyle(1, 0x2f4678);
    this.minimap.strokeRect(mx, my, this.minimapW, this.minimapH);

    for (const realm of REALMS) {
      const rx = mx + realm.x * scaleX;
      const ry = my + realm.y * scaleY;
      const rw = realm.w * scaleX;
      const rh = realm.h * scaleY;
      const color = realm.id === state.currentRealmId ? 0x22c55e : 0x1e293b;
      this.minimap.fillStyle(color, 0.6);
      this.minimap.fillRect(rx, ry, rw, rh);
      this.minimap.lineStyle(1, 0x3d5f96, 0.5);
      this.minimap.strokeRect(rx, ry, rw, rh);
    }

    const hx = mx + state.hero.x * scaleX;
    const hy = my + state.hero.y * scaleY;
    this.minimap.fillStyle(0xfacc15);
    this.minimap.fillRect(hx - 2, hy - 2, 4, 4);
  }
}
