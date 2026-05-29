import Phaser from "phaser";
import { CLAN_PROFILES } from "../data/clans";
import type { GameState } from "../systems/GameState";
import { connectWallet, checkMycoBalance, MYCO_REQUIRED_AMOUNT } from "../systems/SolanaGate";

export class TitleScene extends Phaser.Scene {
  private starGfx!: Phaser.GameObjects.Graphics;
  private stars: { x: number; y: number; brightness: number; speed: number }[] = [];

  constructor() {
    super({ key: "TitleScene" });
  }

  create(): void {
    const { width, height } = this.scale;
    const tile = Math.max(8, Math.round(Math.min(width, height) / 80));

    const bgGfx = this.add.graphics().setDepth(-2);
    const horizonY = Math.round(height * 0.5);
    for (let y = 0; y < height; y += tile) {
      for (let x = 0; x < width; x += tile) {
        const checker = ((Math.floor(x / tile) + Math.floor(y / tile)) % 2) === 0;
        bgGfx.fillStyle(y < horizonY ? (checker ? 0x0a1328 : 0x060b17) : (checker ? 0x1a3a2a : 0x143024));
        bgGfx.fillRect(x, y, tile, tile);
      }
    }

    this.stars = [];
    for (let i = 0; i < 50; i++) {
      this.stars.push({
        x: Math.random() * width,
        y: Math.random() * horizonY,
        brightness: 0.3 + Math.random() * 0.7,
        speed: 0.2 + Math.random() * 0.8,
      });
    }
    this.starGfx = this.add.graphics().setDepth(-1);

    const overlay = this.add.dom(width / 2, height / 2).createFromHTML(`
      <div style="text-align:center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #f8fafc; width: ${Math.min(440, width - 32)}px">
        <h1 style="font-size: 28px; color: #facc15; margin: 0 0 4px; text-shadow: 0 0 20px rgba(250,204,21,0.5)">MYCO QUEST</h1>
        <p style="font-size: 11px; color: #94a3b8; margin: 0 0 14px">KINGDOM CHRONICLE // PHASER 3 EDITION</p>
        <div style="text-align:left; display:grid; gap:8px">
          <button id="ph-connect-wallet" style="padding:12px; font-size:14px; font-weight:700; border:2px solid #a855f7; border-radius:8px; background:rgba(168,85,247,0.15); color:#c084fc; cursor:pointer; font-family:monospace; display:flex; align-items:center; justify-content:center; gap:8px">
            <span style="font-size:18px">👻</span> Connect Phantom Wallet
          </button>
          <div id="ph-wallet-status" style="padding:8px 12px; border:1px solid #334155; border-radius:6px; background:#0a1326; font-size:11px; color:#64748b; text-align:center">
            Wallet not connected. Hold ${MYCO_REQUIRED_AMOUNT.toLocaleString()} $MYCO to play.
          </div>
          <div id="ph-token-status" style="padding:10px 12px; border:2px solid #334155; border-radius:6px; background:#0a0e1a; font-size:12px; color:#94a3b8; text-align:center; display:none">
            Checking $MYCO balance...
          </div>
          <input id="ph-nickname" type="text" placeholder="Choose your nickname" maxlength="24"
            style="padding:10px; font-size:14px; border:2px solid #facc15; border-radius:6px; background:#0a1326; color:#f8fafc; font-family:monospace; width:100%; box-sizing:border-box" />
          <select id="ph-clan" style="padding:10px; font-size:13px; border:2px solid #3d5f96; border-radius:6px; background:#0a1326; color:#f8fafc; font-family:monospace; width:100%; box-sizing:border-box">
            ${Object.values(CLAN_PROFILES).map((c) => `<option value="${c.id}">${c.name} — ${c.slogan}</option>`).join("")}
          </select>
          <button id="ph-start" disabled style="padding:12px; font-size:15px; font-weight:700; border:3px solid #334155; border-radius:6px; background:rgba(51,65,85,0.3); color:#64748b; cursor:not-allowed; font-family:monospace; letter-spacing:0.05em">
            CONNECT WALLET TO PLAY
          </button>
          <p id="ph-status" style="font-size:10px; color:#64748b; margin:2px 0 0; text-align:center">
            Token: $MYCO • Min ${MYCO_REQUIRED_AMOUNT.toLocaleString()} required • Solana mainnet
          </p>
        </div>
      </div>
    `).setOrigin(0.5, 0.5);

    const connectBtn = overlay.getChildByID("ph-connect-wallet") as HTMLButtonElement | null;
    const walletStatus = overlay.getChildByID("ph-wallet-status") as HTMLDivElement | null;
    const tokenStatus = overlay.getChildByID("ph-token-status") as HTMLDivElement | null;
    const startBtn = overlay.getChildByID("ph-start") as HTMLButtonElement | null;
    const nicknameInput = overlay.getChildByID("ph-nickname") as HTMLInputElement | null;
    const clanSelect = overlay.getChildByID("ph-clan") as HTMLSelectElement | null;
    const statusText = overlay.getChildByID("ph-status") as HTMLParagraphElement | null;

    const enableStart = () => {
      if (!startBtn) return;
      startBtn.disabled = false;
      startBtn.style.border = "3px solid #facc15";
      startBtn.style.background = "rgba(250,204,21,0.15)";
      startBtn.style.color = "#facc15";
      startBtn.style.cursor = "pointer";
      startBtn.textContent = "START ADVENTURE";
    };

    const disableStart = (msg: string) => {
      if (!startBtn) return;
      startBtn.disabled = true;
      startBtn.style.border = "3px solid #334155";
      startBtn.style.background = "rgba(51,65,85,0.3)";
      startBtn.style.color = "#64748b";
      startBtn.style.cursor = "not-allowed";
      startBtn.textContent = msg;
    };

    if (connectBtn) {
      connectBtn.addEventListener("click", async () => {
        connectBtn.textContent = "Connecting...";
        connectBtn.disabled = true;

        const wallet = await connectWallet();
        if (!wallet) {
          connectBtn.textContent = "👻 Connect Phantom Wallet";
          connectBtn.disabled = false;
          if (walletStatus) walletStatus.textContent = "Connection failed. Install Phantom or try again.";
          return;
        }

        const shortWallet = wallet.slice(0, 4) + "..." + wallet.slice(-4);
        connectBtn.textContent = `✅ ${shortWallet}`;
        connectBtn.style.borderColor = "#22c55e";
        connectBtn.style.color = "#86efac";

        const state = this.registry.get("gameState") as GameState;
        state.web3.wallet = wallet;

        if (walletStatus) walletStatus.textContent = `Wallet: ${shortWallet}`;
        if (tokenStatus) {
          tokenStatus.style.display = "block";
          tokenStatus.textContent = "Checking $MYCO balance...";
          tokenStatus.style.borderColor = "#334155";
          tokenStatus.style.color = "#94a3b8";
        }

        const result = await checkMycoBalance(wallet);

        if (tokenStatus) {
          if (result.hasEnough) {
            tokenStatus.textContent = `✅ ${result.balance.toLocaleString()} $MYCO — Access granted!`;
            tokenStatus.style.borderColor = "#22c55e";
            tokenStatus.style.color = "#86efac";
            enableStart();
          } else {
            tokenStatus.textContent = `❌ ${result.balance.toLocaleString()} $MYCO — Need ${MYCO_REQUIRED_AMOUNT.toLocaleString()} to play`;
            tokenStatus.style.borderColor = "#ef4444";
            tokenStatus.style.color = "#fca5a5";
            disableStart("INSUFFICIENT $MYCO");
          }
        }
      });
    }

    if (startBtn) {
      startBtn.addEventListener("click", () => {
        if (startBtn.disabled) return;
        const nick = nicknameInput?.value.trim() ?? "";
        if (!nick) {
          if (statusText) statusText.textContent = "Enter a nickname to begin!";
          return;
        }
        const state = this.registry.get("gameState") as GameState;
        state.nickname = nick;
        state.playerClan = clanSelect?.value ?? "myco";
        state.mode = "explore";
        this.scene.start("WorldScene");
      });
    }
  }

  update(): void {
    const now = this.time.now;
    this.starGfx.clear();
    for (const star of this.stars) {
      const alpha = star.brightness * (0.5 + 0.5 * Math.sin(now * 0.002 * star.speed));
      this.starGfx.fillStyle(0xf8fafc, alpha);
      this.starGfx.fillRect(Math.round(star.x), Math.round(star.y), 2, 2);
    }
  }
}
