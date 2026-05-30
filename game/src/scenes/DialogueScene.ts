import Phaser from "phaser";
import type { AudioManager } from "../systems/AudioManager";
import type { GameState } from "../systems/GameState";
import { NPC_DIALOGUES, GENERIC_NPC_DIALOGUE, type DialogueTree, type DialogueLine, type DialogueChoice } from "../data/dialogue";

export interface DialoguePayload {
  title: string;
  portrait: string;
  body: string;
  npcId?: string;
  choices?: { id: string; label: string; color?: string }[];
  onChoice?: (choiceId: string) => void;
  onClose?: () => void;
}

export class DialogueScene extends Phaser.Scene {
  private payload!: DialoguePayload;
  private tree!: DialogueTree;
  private bodyText!: Phaser.GameObjects.Text;
  private speakerText!: Phaser.GameObjects.Text;
  private mycoPortrait!: Phaser.GameObjects.Text;
  private npcPortrait!: Phaser.GameObjects.Text;
  private mycoFrame!: Phaser.GameObjects.Rectangle;
  private npcFrame!: Phaser.GameObjects.Rectangle;
  private choiceButtons: Phaser.GameObjects.Text[] = [];
  private lines: DialogueLine[] = [];
  private lineIndex = 0;
  private revealIndex = 0;
  private revealTimer = 0;
  private revealed = false;
  private phase: "greeting" | "lore" | "puzzle" | "choices" | "response" | "done" = "greeting";
  private boxY = 0;
  private boxH = 0;

  constructor() {
    super({ key: "DialogueScene" });
  }

  init(data: DialoguePayload): void {
    this.payload = data;
    this.tree = (data.npcId ? NPC_DIALOGUES[data.npcId] : null) ?? GENERIC_NPC_DIALOGUE;
    this.lineIndex = 0;
    this.revealIndex = 0;
    this.revealed = false;
    this.phase = "greeting";
    this.choiceButtons = [];
  }

  create(): void {
    const { width, height } = this.scale;
    this.boxH = Math.min(200, Math.round(height * 0.35));
    this.boxY = Math.round((height - this.boxH) / 2);

    this.add.rectangle(width / 2, height / 2, width, height, 0x020617, 0.6).setDepth(90);
    this.add.rectangle(width / 2, this.boxY + this.boxH / 2, width - 12, this.boxH, 0x05070a)
      .setStrokeStyle(3, 0xf8fafc).setDepth(91);

    const leaveBtn = this.add.text(width - 60, this.boxY + 8, "✕ LEAVE", {
      fontFamily: "monospace", fontSize: "10px", fontStyle: "bold",
      color: "#ef4444", backgroundColor: "rgba(5,7,10,0.9)",
      padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 0).setDepth(99).setInteractive();
    leaveBtn.on("pointerdown", () => this.close());

    this.mycoFrame = this.add.rectangle(28, this.boxY + 26, 40, 40, 0x020617)
      .setStrokeStyle(2, 0x86efac).setDepth(92);
    this.mycoPortrait = this.add.text(28, this.boxY + 26, "👑", { fontSize: "20px" })
      .setOrigin(0.5).setDepth(93);
    this.add.text(28, this.boxY + 50, "MYCO", {
      fontFamily: "monospace", fontSize: "7px", color: "#86efac",
    }).setOrigin(0.5).setDepth(92);

    this.npcFrame = this.add.rectangle(width - 28, this.boxY + 26, 40, 40, 0x020617)
      .setStrokeStyle(2, 0xf8fafc).setDepth(92);
    this.npcPortrait = this.add.text(width - 28, this.boxY + 26, this.payload.portrait || "🧙", { fontSize: "20px" })
      .setOrigin(0.5).setDepth(93);
    this.add.text(width - 28, this.boxY + 50, this.payload.title.slice(0, 8), {
      fontFamily: "monospace", fontSize: "7px", color: "#94a3b8",
    }).setOrigin(0.5).setDepth(92);

    this.speakerText = this.add.text(60, this.boxY + 10, "", {
      fontFamily: "monospace", fontSize: "11px", color: "#facc15",
    }).setDepth(92);

    this.bodyText = this.add.text(16, this.boxY + 28, "", {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "13px", color: "#f8fafc",
      wordWrap: { width: width - 90 }, lineSpacing: 3,
    }).setDepth(92);

    const state = this.registry.get("gameState") as GameState;
    this.lines = this.getAdaptiveGreeting(state);
    this.showCurrentLine();

    this.input.on("pointerdown", () => this.advance());
    if (this.input.keyboard) {
      this.input.keyboard.on("keydown-SPACE", () => this.advance());
      this.input.keyboard.on("keydown-ENTER", () => this.advance());
      this.input.keyboard.on("keydown-ESC", () => this.close());
    }
  }

  update(_time: number, delta: number): void {
    if (this.revealed || this.phase === "choices" || this.phase === "puzzle" || this.phase === "done") return;

    const fullText = this.lines[this.lineIndex]?.text ?? "";
    this.revealTimer += delta;
    const target = Math.floor(this.revealTimer / 20);
    if (target > this.revealIndex) {
      this.revealIndex = Math.min(target, fullText.length);
      this.bodyText.setText(fullText.slice(0, this.revealIndex));

      if (this.revealIndex % 2 === 0) {
        const audio = this.registry.get("audio") as AudioManager | undefined;
        const isMyco = this.lines[this.lineIndex]?.speaker === "myco";
        if (audio) {
          const freq = isMyco ? 440 + (this.revealIndex % 4) * 30 : 340 + (this.revealIndex % 5) * 35;
          audio.playTextBlip(Math.floor(freq / 40));
        }
      }

      if (this.revealIndex >= fullText.length) this.revealed = true;
    }
  }

  private advance(): void {
    if (!this.revealed) {
      const fullText = this.lines[this.lineIndex]?.text ?? "";
      this.revealIndex = fullText.length;
      this.bodyText.setText(fullText);
      this.revealed = true;
      return;
    }

    this.lineIndex++;
    if (this.lineIndex < this.lines.length) {
      this.showCurrentLine();
      return;
    }

    if (this.phase === "greeting") {
      this.phase = "lore";
      this.lines = this.tree.lore;
      this.lineIndex = 0;
      this.showCurrentLine();
    } else if (this.phase === "lore" && this.tree.puzzle) {
      this.phase = "puzzle";
      this.showPuzzle();
    } else if (this.phase === "lore" || this.phase === "puzzle" || this.phase === "response") {
      this.phase = "choices";
      this.showChoices();
    } else {
      this.close();
    }
  }

  private showCurrentLine(): void {
    const line = this.lines[this.lineIndex];
    if (!line) return;

    this.revealIndex = 0;
    this.revealTimer = 0;
    this.revealed = false;
    this.bodyText.setText("");

    const isMyco = line.speaker === "myco";
    this.speakerText.setText(isMyco ? "King Myco" : this.payload.title);
    this.speakerText.setColor(isMyco ? "#86efac" : "#facc15");

    this.mycoFrame.setStrokeStyle(2, isMyco ? 0xfacc15 : 0x86efac);
    this.npcFrame.setStrokeStyle(2, isMyco ? 0xf8fafc : 0xfacc15);

    this.clearChoiceButtons();
  }

  private showPuzzle(): void {
    const puzzle = this.tree.puzzle;
    if (!puzzle) { this.phase = "choices"; this.showChoices(); return; }

    this.clearChoiceButtons();
    this.speakerText.setText(this.payload.title);
    this.speakerText.setColor("#a855f7");
    this.bodyText.setText(puzzle.question);
    this.revealed = true;

    const { width } = this.scale;
    const startY = this.boxY + this.boxH - 60;

    puzzle.answers.forEach((answer, i) => {
      const btn = this.add.text(width / 2, startY + i * 20, `> ${answer.text}`, {
        fontFamily: "monospace", fontSize: "11px",
        color: "#dbeafe", backgroundColor: "rgba(5,7,10,0.8)",
        padding: { x: 8, y: 3 },
      }).setOrigin(0.5).setDepth(95).setInteractive();

      btn.on("pointerdown", () => {
        this.clearChoiceButtons();
        this.phase = "response";
        this.lines = [{ speaker: "npc", text: answer.response }];
        this.lineIndex = 0;
        if (answer.correct) {
          const state = this.registry.get("gameState") as GameState;
          state.hero.spores += 25;
          const audio = this.registry.get("audio") as AudioManager | undefined;
          audio?.playSfx("coin");
        }
        this.showCurrentLine();
      });

      this.choiceButtons.push(btn);
    });
  }

  private showChoices(): void {
    this.clearChoiceButtons();
    const state = this.registry.get("gameState") as GameState;

    const adaptiveText = this.getAdaptiveResponse(state);
    this.speakerText.setText(this.payload.title);
    this.speakerText.setColor("#94a3b8");
    this.bodyText.setText(adaptiveText);
    this.revealed = true;

    const { width } = this.scale;
    const choices = this.tree.choices;
    const startY = this.boxY + this.boxH - 36;
    const btnW = Math.min(140, (width - 30) / choices.length - 6);

    choices.forEach((choice, i) => {
      const bx = 12 + i * (btnW + 6) + btnW / 2;
      const color = Phaser.Display.Color.HexStringToColor(choice.color).color;
      const btn = this.add.text(bx, startY, choice.label, {
        fontFamily: "monospace", fontSize: "10px", fontStyle: "bold",
        color: "#" + color.toString(16).padStart(6, "0"),
        backgroundColor: "rgba(5,7,10,0.9)",
        padding: { x: 6, y: 5 },
      }).setOrigin(0.5).setDepth(95).setInteractive();

      btn.on("pointerdown", () => this.handleChoice(choice, state));
      this.choiceButtons.push(btn);
    });
  }

  private handleChoice(choice: DialogueChoice, state: GameState): void {
    state.hero.morality += choice.moralityShift;
    if (choice.clueGiven) state.progress.clues.add(choice.clueGiven);
    if (this.payload.onChoice) this.payload.onChoice(choice.id);

    this.clearChoiceButtons();
    this.phase = "done";
    this.lines = [{ speaker: "npc", text: choice.response }];
    this.lineIndex = 0;
    this.showCurrentLine();

    const audio = this.registry.get("audio") as AudioManager | undefined;
    if (choice.moralityShift > 0) audio?.playSfx("coin");
    else if (choice.moralityShift < 0) audio?.playSfx("hit");
    else audio?.playSfx("talk");
  }

  private getAdaptiveGreeting(state: GameState): DialogueLine[] {
    const lines = [...this.tree.greeting];
    const adaptive = this.tree.adaptiveResponses;

    if (state.progress.interactedNpcs.has(this.payload.npcId ?? "")) {
      lines[0] = { speaker: "npc", text: adaptive.returningPlayer };
    }
    if (state.progress.defeatedBosses.size > 0 && adaptive.bossDefeated) {
      lines.push({ speaker: "npc", text: adaptive.bossDefeated });
    }

    return lines;
  }

  private getAdaptiveResponse(state: GameState): string {
    const adaptive = this.tree.adaptiveResponses;
    if (state.hero.morality >= 10) return adaptive.highMorality;
    if (state.hero.morality <= -10) return adaptive.lowMorality;
    return "* What would you like to do?";
  }

  private clearChoiceButtons(): void {
    for (const btn of this.choiceButtons) btn.destroy();
    this.choiceButtons = [];
  }

  private close(): void {
    if (this.payload.onClose) this.payload.onClose();
    this.scene.stop();
    this.scene.resume("WorldScene");
  }
}
