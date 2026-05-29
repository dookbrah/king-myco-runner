import Phaser from "phaser";
import { CLAN_PROFILES } from "../data/clans";
import type { GameState } from "../systems/GameState";

export class TitleScene extends Phaser.Scene {
  private stars: { x: number; y: number; brightness: number; speed: number }[] = [];
  private tileSize = 10;

  constructor() {
    super({ key: "TitleScene" });
  }

  create(): void {
    const { width, height } = this.scale;
    this.tileSize = Math.max(8, Math.round(Math.min(width, height) / 80));

    for (let i = 0; i < 60; i++) {
      this.stars.push({
        x: Math.random() * width,
        y: Math.random() * height * 0.45,
        brightness: 0.3 + Math.random() * 0.7,
        speed: 0.2 + Math.random() * 0.8,
      });
    }

    const overlay = this.add.dom(width / 2, height / 2).createFromHTML(`
      <div style="text-align:center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #f8fafc; width: ${Math.min(420, width - 40)}px">
        <h1 style="font-size: 28px; color: #facc15; margin: 0 0 6px; text-shadow: 0 0 20px rgba(250,204,21,0.5)">MYCO QUEST</h1>
        <p style="font-size: 11px; color: #94a3b8; margin: 0 0 16px">KINGDOM CHRONICLE // PHASER 3 EDITION</p>
        <div style="text-align:left; display:grid; gap:8px">
          <input id="ph-nickname" type="text" placeholder="Choose your nickname" maxlength="24"
            style="padding:10px; font-size:14px; border:2px solid #facc15; border-radius:6px; background:#0a1326; color:#f8fafc; font-family:monospace; width:100%; box-sizing:border-box" />
          <select id="ph-clan" style="padding:10px; font-size:13px; border:2px solid #3d5f96; border-radius:6px; background:#0a1326; color:#f8fafc; font-family:monospace; width:100%; box-sizing:border-box">
            ${Object.values(CLAN_PROFILES).map((c) => `<option value="${c.id}">${c.name} — ${c.slogan}</option>`).join("")}
          </select>
          <input id="ph-wallet" type="text" placeholder="Solana wallet (optional)"
            style="padding:8px; font-size:12px; border:1px solid #3d5f96; border-radius:6px; background:#0a1326; color:#94a3b8; font-family:monospace; width:100%; box-sizing:border-box" />
          <button id="ph-start" style="padding:12px; font-size:15px; font-weight:700; border:3px solid #facc15; border-radius:6px; background:rgba(250,204,21,0.15); color:#facc15; cursor:pointer; font-family:monospace; letter-spacing:0.05em">
            START ADVENTURE
          </button>
          <p id="ph-status" style="font-size:11px; color:#94a3b8; margin:4px 0 0; text-align:center">Enter a nickname to begin.</p>
        </div>
      </div>
    `);
    overlay.setOrigin(0.5, 0.5);

    const startBtn = overlay.getChildByID("ph-start") as HTMLButtonElement | null;
    const nicknameInput = overlay.getChildByID("ph-nickname") as HTMLInputElement | null;
    const clanSelect = overlay.getChildByID("ph-clan") as HTMLSelectElement | null;
    const walletInput = overlay.getChildByID("ph-wallet") as HTMLInputElement | null;
    const statusText = overlay.getChildByID("ph-status") as HTMLParagraphElement | null;

    if (startBtn) {
      startBtn.addEventListener("click", () => {
        const nick = nicknameInput?.value.trim() ?? "";
        if (!nick) {
          if (statusText) statusText.textContent = "Nickname is required!";
          return;
        }
        const state = this.registry.get("gameState") as GameState;
        state.nickname = nick;
        state.playerClan = clanSelect?.value ?? "myco";
        state.web3.wallet = walletInput?.value.trim() ?? "";
        state.mode = "explore";
        this.scene.start("WorldScene");
      });
    }
  }

  update(): void {
    const { width, height } = this.scale;
    const gfx = this.add.graphics();
    gfx.clear();

    const tile = this.tileSize;
    const horizonY = Math.round(height * 0.5);

    for (let y = 0; y < height; y += tile) {
      for (let x = 0; x < width; x += tile) {
        const checker = ((x / tile + y / tile) % 2) === 0;
        if (y < horizonY) {
          gfx.fillStyle(checker ? 0x0a1328 : 0x060b17);
        } else {
          gfx.fillStyle(checker ? 0x1a3a2a : 0x143024);
        }
        gfx.fillRect(x, y, tile, tile);
      }
    }

    const now = this.time.now;
    for (const star of this.stars) {
      const alpha = star.brightness * (0.5 + 0.5 * Math.sin(now * 0.002 * star.speed));
      gfx.fillStyle(0xf8fafc, alpha);
      gfx.fillRect(Math.round(star.x), Math.round(star.y), 2, 2);
    }

    gfx.setDepth(-1);
  }
}
