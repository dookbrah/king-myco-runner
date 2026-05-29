import Phaser from "phaser";
import type { GameState } from "../systems/GameState";
import type { AudioManager } from "../systems/AudioManager";
import type { StructureDef } from "../data/structures";

interface InteriorNode {
  x: number;
  y: number;
  kind: string;
  label: string;
  solved: boolean;
}

export class InteriorScene extends Phaser.Scene {
  private structure!: StructureDef;
  private heroSprite!: Phaser.GameObjects.Container;
  private nodes: { obj: Phaser.GameObjects.Container; data: InteriorNode }[] = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private heroX = 160;
  private heroY = 300;

  constructor() {
    super({ key: "InteriorScene" });
  }

  init(data: { structure: StructureDef }): void {
    this.structure = data.structure;
  }

  create(): void {
    const { width, height } = this.scale;
    const state = this.registry.get("gameState") as GameState;
    const audio = this.registry.get("audio") as AudioManager | undefined;
    audio?.setMode("interior");

    const tileSize = 16;
    const gfx = this.add.graphics();
    const floorColors: Record<string, [number, number]> = {
      house: [0x1a1a2e, 0x16213e],
      castle: [0x0f172a, 0x1e293b],
      cave: [0x1f2937, 0x374151],
      dungeon: [0x111827, 0x1f2937],
      tower: [0x1e293b, 0x334155],
      "mushroom-shop": [0x451a03, 0x713f12],
    };
    const [floorA, floorB] = floorColors[this.structure.type] ?? [0x1a1a2e, 0x16213e];
    for (let y = 0; y < height; y += tileSize) {
      for (let x = 0; x < width; x += tileSize) {
        gfx.fillStyle(((Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2) === 0 ? floorA : floorB);
        gfx.fillRect(x, y, tileSize, tileSize);
      }
    }
    gfx.lineStyle(2, 0x3d5f96);
    gfx.strokeRect(4, 4, width - 8, height - 8);

    this.add.text(width / 2, 20, this.structure.name, {
      fontFamily: "monospace", fontSize: "14px", color: "#dbeafe",
    }).setOrigin(0.5);

    this.add.text(width / 2, 38, `${this.structure.type} interior`, {
      fontFamily: "monospace", fontSize: "10px", color: "#64748b",
    }).setOrigin(0.5);

    this.spawnInteriorNodes(width, height, state);
    this.spawnInteriorEnemies(width, height);

    const shadow = this.add.rectangle(0, 12, 18, 4, 0x020617, 0.3);
    const body = this.add.rectangle(0, 0, 14, 18, 0x166534);
    const crown = this.add.rectangle(0, -12, 10, 3, 0xfacc15);
    const eyeL = this.add.rectangle(-3, -4, 2, 2, 0x86efac);
    const eyeR = this.add.rectangle(3, -4, 2, 2, 0x86efac);
    this.heroX = width / 2;
    this.heroY = height - 60;
    this.heroSprite = this.add.container(this.heroX, this.heroY, [shadow, body, crown, eyeL, eyeR]).setDepth(10);

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
    }

    const exitBtn = this.add.text(width / 2, height - 20, "[ EXIT ]", {
      fontFamily: "monospace", fontSize: "12px", color: "#ef4444",
      backgroundColor: "rgba(5,7,10,0.8)", padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setInteractive();
    exitBtn.on("pointerdown", () => this.exitInterior(state));

    if (this.input.keyboard) {
      this.input.keyboard.on("keydown-ESCAPE", () => this.exitInterior(state));
    }
  }

  update(_time: number, delta: number): void {
    if (!this.cursors) return;
    const speed = 120;
    const dt = delta / 1000;
    let dx = 0, dy = 0;
    if (this.cursors.up.isDown) dy -= 1;
    if (this.cursors.down.isDown) dy += 1;
    if (this.cursors.left.isDown) dx -= 1;
    if (this.cursors.right.isDown) dx += 1;
    if (dx === 0 && dy === 0) return;
    const mag = Math.hypot(dx, dy);
    this.heroX = Phaser.Math.Clamp(this.heroX + (dx / mag) * speed * dt, 20, this.scale.width - 20);
    this.heroY = Phaser.Math.Clamp(this.heroY + (dy / mag) * speed * dt, 50, this.scale.height - 40);
    this.heroSprite.setPosition(this.heroX, this.heroY);

    for (const ie of this.interiorEnemies) {
      if (!ie.alive) continue;
      ie.x += ie.vx * dt;
      ie.y += ie.vy * dt;
      if (ie.x < 20 || ie.x > this.scale.width - 20) ie.vx *= -1;
      if (ie.y < 60 || ie.y > this.scale.height - 60) ie.vy *= -1;
      ie.x = Phaser.Math.Clamp(ie.x, 20, this.scale.width - 20);
      ie.y = Phaser.Math.Clamp(ie.y, 60, this.scale.height - 60);
      ie.sprite.setPosition(ie.x, ie.y);

      if (Phaser.Math.Distance.Between(this.heroX, this.heroY, ie.x, ie.y) < 18) {
        ie.hp -= 15;
        const audio = this.registry.get("audio") as AudioManager | undefined;
        audio?.playSfx("hit");
        if (ie.hp <= 0) {
          ie.alive = false;
          const state = this.registry.get("gameState") as GameState;
          state.hero.spores += 25;
          audio?.playSfx("coin");
          this.tweens.add({
            targets: ie.sprite, alpha: 0, scaleX: 2, scaleY: 2,
            duration: 300, onComplete: () => ie.sprite.destroy(),
          });
          const deathText = this.add.text(ie.x, ie.y - 10, "+25", {
            fontFamily: "monospace", fontSize: "12px", fontStyle: "bold", color: "#22c55e",
          }).setOrigin(0.5).setDepth(20);
          this.tweens.add({ targets: deathText, y: ie.y - 30, alpha: 0, duration: 600, onComplete: () => deathText.destroy() });
        } else {
          this.tweens.add({ targets: ie.sprite, x: ie.x + (Math.random() - 0.5) * 8, duration: 80, yoyo: true });
        }
      }
    }

    for (const node of this.nodes) {
      if (node.data.solved) continue;
      if (Phaser.Math.Distance.Between(this.heroX, this.heroY, node.data.x, node.data.y) < 24) {
        node.data.solved = true;
        const audio = this.registry.get("audio") as AudioManager | undefined;
        audio?.playSfx("pickup");
        const state = this.registry.get("gameState") as GameState;
        state.hero.spores += 15;

        const label = this.add.text(node.data.x, node.data.y - 16, "+15 spores", {
          fontFamily: "monospace", fontSize: "10px", color: "#22c55e",
        }).setOrigin(0.5);
        this.tweens.add({ targets: label, y: node.data.y - 40, alpha: 0, duration: 800, onComplete: () => label.destroy() });
      }
    }
  }

  private interiorEnemies: { sprite: Phaser.GameObjects.Rectangle; hp: number; maxHp: number; x: number; y: number; vx: number; vy: number; alive: boolean }[] = [];

  private spawnInteriorEnemies(width: number, height: number): void {
    const enemyTypes = ["dungeon", "cave", "tower", "castle"];
    if (!enemyTypes.includes(this.structure.type)) return;

    const count = this.structure.type === "dungeon" ? 4 : this.structure.type === "cave" ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const ex = 60 + Math.random() * (width - 120);
      const ey = 70 + Math.random() * (height - 160);
      const sprite = this.add.rectangle(ex, ey, 14, 14, 0xef4444).setDepth(6);
      this.add.rectangle(ex, ey, 14, 14).setStrokeStyle(1, 0xfca5a5).setDepth(6);
      this.interiorEnemies.push({
        sprite, hp: 30, maxHp: 30, x: ex, y: ey,
        vx: (Math.random() - 0.5) * 40,
        vy: (Math.random() - 0.5) * 40,
        alive: true,
      });
    }
  }

  private spawnInteriorNodes(width: number, height: number, state: GameState): void {
    const nodeTypes = [
      { kind: "chest", label: "Chest", color: 0xfbbf24 },
      { kind: "crystal", label: "Crystal", color: 0xa855f7 },
      { kind: "scroll", label: "Scroll", color: 0x60a5fa },
    ];
    const count = this.structure.type === "dungeon" ? 5 : this.structure.type === "cave" ? 4 : 3;

    for (let i = 0; i < count; i++) {
      const def = nodeTypes[i % nodeTypes.length];
      const nx = 60 + Math.random() * (width - 120);
      const ny = 80 + Math.random() * (height - 180);
      const nodeData: InteriorNode = { x: nx, y: ny, kind: def.kind, label: def.label, solved: false };

      const dot = this.add.rectangle(0, 0, 14, 14, def.color);
      const label = this.add.text(0, -12, def.label, {
        fontFamily: "monospace", fontSize: "8px", color: "#dbeafe",
      }).setOrigin(0.5);
      const container = this.add.container(nx, ny, [dot, label]).setDepth(5);

      this.nodes.push({ obj: container, data: nodeData });
    }
  }

  private exitInterior(state: GameState): void {
    state.mode = "explore";
    const audio = this.registry.get("audio") as AudioManager | undefined;
    audio?.setMode("overworld");
    this.scene.stop();
    this.scene.resume("WorldScene");
  }
}
