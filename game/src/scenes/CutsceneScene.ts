import Phaser from "phaser";
import type { AudioManager } from "../systems/AudioManager";

export interface CutsceneData {
  id: string;
  title: string;
  pages: string[];
}

export const CUTSCENES: CutsceneData[] = [
  {
    id: "crownfall",
    title: "The Crownfall Chronicle",
    pages: [
      "On the Night of Silent Spores, Dark Mycelius shattered King Myco's crown and scattered six memory-arts across the land. Royal spores answer your crown line.",
      "The kingdom fell to corruption. Mycelial networks collapsed. The five realm guardians sealed themselves behind portal gates.",
      "You are the last Crown Bearer. Reclaim the shattered arts, defeat the realm bosses, and restore the Mycelial Network before the corruption reaches the Solana Chainlands.",
    ],
  },
  {
    id: "fen-entry",
    title: "Into the Fen",
    pages: [
      "The Rougarou Fen stretches beyond the grove border. Toxic spore mist hangs thick in the air.",
      "The Rougarou has made its den here. Local mushroom colonies report strange howling at night.",
      "Elder Myca warned you: 'Trust nothing in the fen that glows purple. The Rougarou uses illusions.'",
    ],
  },
  {
    id: "drake-summit",
    title: "The Drake Ascent",
    pages: [
      "Volcanic vents hiss as you climb. The Tri-Drake Peaks are home to ancient fire elementals.",
      "The Tri-Drake rules from the summit caldera. Its three heads see past, present, and future.",
      "Ember Smith says the only weapon that works is patience. 'Outlast the flame, and the drake yields.'",
    ],
  },
  {
    id: "chain-corruption",
    title: "Solana Corruption",
    pages: [
      "The Chainlands pulse with digital corruption. Dark Mycelius has embedded itself in the blockchain.",
      "Every transaction carries a fragment of the corruption. The Chain Oracle can decode the pattern.",
      "This is the final realm. Defeat Dark Mycelius here, and the entire Mycelial Network can be restored.",
    ],
  },
];

export class CutsceneScene extends Phaser.Scene {
  private cutscene!: CutsceneData;
  private pageIndex = 0;
  private pageText!: Phaser.GameObjects.Text;
  private revealIndex = 0;
  private revealTimer = 0;
  private revealed = false;

  constructor() {
    super({ key: "CutsceneScene" });
  }

  init(data: { cutsceneId: string }): void {
    this.cutscene = CUTSCENES.find((c) => c.id === data.cutsceneId) ?? CUTSCENES[0];
    this.pageIndex = 0;
    this.revealIndex = 0;
    this.revealed = false;
  }

  create(): void {
    const { width, height } = this.scale;

    this.add.rectangle(width / 2, height / 2, width, height, 0x050512);

    this.add.text(width / 2, 40, this.cutscene.title, {
      fontFamily: "monospace", fontSize: "18px", color: "#facc15",
    }).setOrigin(0.5);

    const pageLabel = this.add.text(width / 2, 64, `Scene ${this.pageIndex + 1} / ${this.cutscene.pages.length}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#64748b",
    }).setOrigin(0.5);

    this.pageText = this.add.text(40, 100, "", {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "15px",
      color: "#e2e8f0",
      wordWrap: { width: width - 80 },
      lineSpacing: 6,
    });

    const nextBtn = this.add.text(width / 2 - 60, height - 50, "Next", {
      fontFamily: "monospace", fontSize: "14px", fontStyle: "bold",
      color: "#facc15", backgroundColor: "rgba(5,7,10,0.9)",
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive();

    const skipBtn = this.add.text(width / 2 + 60, height - 50, "Skip", {
      fontFamily: "monospace", fontSize: "14px", fontStyle: "bold",
      color: "#94a3b8", backgroundColor: "rgba(5,7,10,0.9)",
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive();

    nextBtn.on("pointerdown", () => {
      if (!this.revealed) {
        this.revealIndex = this.cutscene.pages[this.pageIndex].length;
        this.pageText.setText(this.cutscene.pages[this.pageIndex]);
        this.revealed = true;
        return;
      }
      this.pageIndex++;
      if (this.pageIndex >= this.cutscene.pages.length) {
        this.exitCutscene();
        return;
      }
      pageLabel.setText(`Scene ${this.pageIndex + 1} / ${this.cutscene.pages.length}`);
      this.revealIndex = 0;
      this.revealTimer = 0;
      this.revealed = false;
      this.pageText.setText("");
    });

    skipBtn.on("pointerdown", () => this.exitCutscene());

    this.revealTimer = 0;
  }

  update(_time: number, delta: number): void {
    if (this.revealed) return;
    const page = this.cutscene.pages[this.pageIndex];
    if (!page) return;

    this.revealTimer += delta;
    const target = Math.floor(this.revealTimer / 20);
    if (target > this.revealIndex) {
      this.revealIndex = Math.min(target, page.length);
      this.pageText.setText(page.slice(0, this.revealIndex));

      if (this.revealIndex % 2 === 0) {
        const audio = this.registry.get("audio") as AudioManager | undefined;
        if (audio) audio.playTextBlip(this.revealIndex);
      }

      if (this.revealIndex >= page.length) this.revealed = true;
    }
  }

  private exitCutscene(): void {
    this.scene.stop();
    this.scene.resume("WorldScene");
  }
}
