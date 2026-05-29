import Phaser from "phaser";
import { createInitialState, loadGameState, type GameState } from "../systems/GameState";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  create(): void {
    const saved = loadGameState();
    const state: GameState = saved ?? createInitialState();
    state.mode = "intro";
    this.registry.set("gameState", state);
    this.scene.start("TitleScene");
  }
}
