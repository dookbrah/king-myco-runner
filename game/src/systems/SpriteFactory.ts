import Phaser from "phaser";
import { ENEMY_PALETTES } from "../data/enemies";

export function generateHeroTexture(scene: Phaser.Scene, clanColors: { cap: string; robe: string; primary: string }): void {
  const size = 32;
  const gfx = scene.make.graphics({ x: 0, y: 0 });
  const c = (hex: string) => Phaser.Display.Color.HexStringToColor(hex).color;

  for (let frame = 0; frame < 4; frame++) {
    const ox = frame * size;
    gfx.fillStyle(c(clanColors.cap));
    gfx.fillRect(ox + 9, 2, 14, 8);
    gfx.fillRect(ox + 7, 0, 18, 2);
    gfx.fillStyle(0xfacc15);
    gfx.fillRect(ox + 11, 0, 10, 3);
    gfx.fillRect(ox + 15, 0, 2, -2 + 2);
    gfx.fillStyle(0x020617);
    gfx.fillRect(ox + 8, 10, 16, 10);
    gfx.fillRect(ox + 10, 8, 12, 2);
    gfx.fillStyle(0x86efac);
    gfx.fillRect(ox + 11, 13, 3, 3);
    gfx.fillRect(ox + 18, 13, 3, 3);
    gfx.fillStyle(0x4ade80);
    gfx.fillRect(ox + 12, 14, 1, 1);
    gfx.fillRect(ox + 19, 14, 1, 1);
    gfx.fillStyle(c(clanColors.robe));
    gfx.fillRect(ox + 6, 20, 20, 10);
    gfx.fillStyle(c(clanColors.primary));
    gfx.fillRect(ox + 8, 24, 16, 6);
    gfx.fillStyle(0x713f12);
    gfx.fillRect(ox + 27, 8, 3, 20);
    gfx.fillStyle(0x22c55e);
    gfx.fillRect(ox + 25, 4, 8, 5);
    gfx.fillStyle(c(clanColors.primary));
    const footOffset = frame === 1 ? -2 : frame === 3 ? 2 : 0;
    gfx.fillRect(ox + 8 + footOffset, 30, 5, 2);
    gfx.fillRect(ox + 19 - footOffset, 30, 5, 2);
  }

  gfx.generateTexture("hero-sheet", size * 4, size);
  gfx.destroy();
}

export function generateEnemyTexture(scene: Phaser.Scene, kind: string): string {
  const key = `enemy-${kind}`;
  if (scene.textures.exists(key)) return key;

  const [baseHex, accentHex] = ENEMY_PALETTES[kind] ?? ["#f97316", "#7c2d12"];
  const base = Phaser.Display.Color.HexStringToColor(baseHex).color;
  const accent = Phaser.Display.Color.HexStringToColor(accentHex).color;
  const size = 28;
  const gfx = scene.make.graphics({ x: 0, y: 0 });

  for (let frame = 0; frame < 4; frame++) {
    const ox = frame * size;
    gfx.fillStyle(base);
    gfx.fillRect(ox + 2, 4, 24, 20);
    gfx.fillRect(ox + 4, 2, 20, 2);
    gfx.fillStyle(accent);
    gfx.fillRect(ox + 4, 6, 20, 10);
    gfx.fillStyle(0x020617);
    gfx.fillRect(ox + 8, 12, 4, 4);
    gfx.fillRect(ox + 16, 12, 4, 4);
    gfx.fillStyle(0x86efac);
    gfx.fillRect(ox + 9, 13, 2, 2);
    gfx.fillRect(ox + 17, 13, 2, 2);
    gfx.fillStyle(base);
    const footOff = frame === 1 ? -2 : frame === 3 ? 2 : 0;
    gfx.fillRect(ox + 4 + footOff, 24, 8, 4);
    gfx.fillRect(ox + 16 - footOff, 24, 8, 4);
  }

  gfx.generateTexture(key, size * 4, size);
  gfx.destroy();
  return key;
}

export function generateNpcTexture(scene: Phaser.Scene, paletteIndex: number): string {
  const key = `npc-${paletteIndex}`;
  if (scene.textures.exists(key)) return key;

  const palettes: [number, number, number][] = [
    [0x0f172a, 0x059669, 0xecfeff],
    [0x111827, 0x2563eb, 0xdbeafe],
    [0x1f2937, 0xc026d3, 0xf5d0fe],
  ];
  const [cloak, accent, eye] = palettes[paletteIndex % palettes.length];
  const size = 24;
  const gfx = scene.make.graphics({ x: 0, y: 0 });

  for (let frame = 0; frame < 4; frame++) {
    const ox = frame * size;
    gfx.fillStyle(cloak);
    gfx.fillRect(ox + 2, 2, 20, 20);
    gfx.fillRect(ox + 4, 0, 16, 2);
    gfx.fillStyle(accent);
    gfx.fillRect(ox + 5, 5, 14, 8);
    gfx.fillStyle(eye);
    gfx.fillRect(ox + 8, 10, 2, 2);
    gfx.fillRect(ox + 14, 10, 2, 2);
    gfx.fillStyle(0x94a3b8);
    gfx.fillRect(ox + 11, 14, 2, 6);
    gfx.fillStyle(cloak);
    const footOff = frame === 1 ? -1 : frame === 3 ? 1 : 0;
    gfx.fillRect(ox + 4 + footOff, 22, 6, 2);
    gfx.fillRect(ox + 14 - footOff, 22, 6, 2);
  }

  gfx.generateTexture(key, size * 4, size);
  gfx.destroy();
  return key;
}

export function generatePickupTexture(scene: Phaser.Scene, golden: boolean): string {
  const key = golden ? "pickup-golden" : "pickup-blue";
  if (scene.textures.exists(key)) return key;

  const gfx = scene.make.graphics({ x: 0, y: 0 });
  const color = golden ? 0xfbbf24 : 0x22d3ee;
  const inner = golden ? 0xfef08a : 0xa5f3fc;

  gfx.fillStyle(color);
  gfx.fillRect(4, 0, 8, 16);
  gfx.fillRect(0, 4, 16, 8);
  gfx.fillStyle(inner);
  gfx.fillRect(5, 4, 6, 8);
  gfx.fillStyle(0xf8fafc);
  gfx.fillRect(7, 6, 2, 4);
  gfx.fillRect(6, 7, 4, 2);

  gfx.generateTexture(key, 16, 16);
  gfx.destroy();
  return key;
}

export function generateProjectileTexture(scene: Phaser.Scene, color: number): string {
  const key = `proj-${color.toString(16)}`;
  if (scene.textures.exists(key)) return key;

  const gfx = scene.make.graphics({ x: 0, y: 0 });
  gfx.fillStyle(color);
  gfx.fillRect(2, 0, 4, 8);
  gfx.fillRect(0, 2, 8, 4);
  gfx.fillStyle(0xf8fafc);
  gfx.fillRect(3, 3, 2, 2);
  gfx.generateTexture(key, 8, 8);
  gfx.destroy();
  return key;
}
