import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { TitleScene } from "./scenes/TitleScene";
import { WorldScene } from "./scenes/WorldScene";
import { BattleScene } from "./scenes/BattleScene";
import { DialogueScene } from "./scenes/DialogueScene";
import { InteriorScene } from "./scenes/InteriorScene";
import { CutsceneScene } from "./scenes/CutsceneScene";
import { BurnPitScene } from "./scenes/BurnPitScene";
import { HudScene } from "./scenes/HudScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-container",
  width: window.innerWidth,
  height: window.innerHeight,
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  backgroundColor: "#040913",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  dom: {
    createContainer: true,
  },
  input: {
    touch: true,
    keyboard: true,
  },
  scene: [
    BootScene,
    TitleScene,
    WorldScene,
    BattleScene,
    DialogueScene,
    InteriorScene,
    CutsceneScene,
    BurnPitScene,
    HudScene,
  ],
};

new Phaser.Game(config);
