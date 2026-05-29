import Phaser from "phaser";
import type { AudioManager } from "../systems/AudioManager";

export interface DialoguePayload {
  title: string;
  portrait: string;
  body: string;
  choices?: { id: string; label: string; color?: string }[];
  onChoice?: (choiceId: string) => void;
  onClose?: () => void;
}

export class DialogueScene extends Phaser.Scene {
  private payload!: DialoguePayload;
  private bodyText!: Phaser.GameObjects.Text;
  private revealIndex = 0;
  private fullText = "";
  private revealTimer = 0;
  private revealed = false;

  constructor() {
    super({ key: "DialogueScene" });
  }

  init(data: DialoguePayload): void {
    this.payload = data;
    this.revealIndex = 0;
    this.fullText = data.body;
    this.revealed = false;
  }

  create(): void {
    const { width, height } = this.scale;
    const boxH = Math.min(180, height * 0.3);
    const boxY = height - boxH - 8;

    this.add.rectangle(width / 2, boxY + boxH / 2, width - 16, boxH, 0x05070a)
      .setStrokeStyle(3, 0xf8fafc);

    const portraitSize = 40;
    this.add.rectangle(24 + portraitSize / 2, boxY + 24, portraitSize, portraitSize, 0x020617)
      .setStrokeStyle(2, 0x86efac);
    this.add.text(24 + portraitSize / 2, boxY + 24, "👑", {
      fontSize: "22px",
    }).setOrigin(0.5);

    this.add.rectangle(width - 24 - portraitSize / 2, boxY + 24, portraitSize, portraitSize, 0x020617)
      .setStrokeStyle(2, 0xf8fafc);
    this.add.text(width - 24 - portraitSize / 2, boxY + 24, this.payload.portrait || "?", {
      fontSize: "22px",
    }).setOrigin(0.5);

    this.add.text(74, boxY + 10, this.payload.title, {
      fontFamily: "monospace", fontSize: "12px", color: "#94a3b8",
    });

    this.bodyText = this.add.text(24, boxY + 50, "", {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "14px",
      color: "#f8fafc",
      wordWrap: { width: width - 56 },
      lineSpacing: 4,
    });

    const choices = this.payload.choices ?? [{ id: "close", label: "Close", color: "#94a3b8" }];
    const btnW = Math.min(160, (width - 40) / choices.length - 8);
    const btnY = boxY + boxH - 30;

    choices.forEach((choice, i) => {
      const bx = 20 + i * (btnW + 8) + btnW / 2;
      const color = Phaser.Display.Color.HexStringToColor(choice.color ?? "#facc15").color;
      const btn = this.add.text(bx, btnY, choice.label, {
        fontFamily: "monospace",
        fontSize: "12px",
        fontStyle: "bold",
        color: "#" + color.toString(16).padStart(6, "0"),
        backgroundColor: "rgba(5,7,10,0.9)",
        padding: { x: 10, y: 6 },
      }).setOrigin(0.5).setInteractive();

      btn.on("pointerdown", () => {
        if (this.payload.onChoice) this.payload.onChoice(choice.id);
        if (choice.id === "close" && this.payload.onClose) this.payload.onClose();
        this.scene.stop();
        this.scene.resume("WorldScene");
      });
    });

    this.revealTimer = 0;
  }

  update(_time: number, delta: number): void {
    if (this.revealed) return;

    this.revealTimer += delta;
    const charsToShow = Math.floor(this.revealTimer / 18);

    if (charsToShow > this.revealIndex) {
      this.revealIndex = Math.min(charsToShow, this.fullText.length);
      this.bodyText.setText(this.fullText.slice(0, this.revealIndex));

      if (this.revealIndex % 2 === 0) {
        const audio = this.registry.get("audio") as AudioManager | undefined;
        if (audio) audio.playTextBlip(this.revealIndex);
      }

      if (this.revealIndex >= this.fullText.length) {
        this.revealed = true;
      }
    }
  }
}
