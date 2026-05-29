import Phaser from "phaser";

export function generateTerrainTile(scene: Phaser.Scene, colorA: number, colorB: number, realmId: string): string {
  const key = `terrain-${realmId}`;
  if (scene.textures.exists(key)) return key;

  const t = 16;
  const gfx = scene.make.graphics({ x: 0, y: 0 });

  // 2x2 checker base
  gfx.fillStyle(colorA); gfx.fillRect(0, 0, t, t); gfx.fillRect(t, t, t, t);
  gfx.fillStyle(colorB); gfx.fillRect(t, 0, t, t); gfx.fillRect(0, t, t, t);

  // ALTTP-style bevel: light edge top-left, dark edge bottom-right per tile
  const hilight = Phaser.Display.Color.IntegerToColor(colorA).lighten(12).color;
  const shadow = Phaser.Display.Color.IntegerToColor(colorA).darken(18).color;
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const ox = tx * t, oy = ty * t;
      gfx.fillStyle(hilight, 0.3); gfx.fillRect(ox, oy, t, 1); gfx.fillRect(ox, oy, 1, t);
      gfx.fillStyle(shadow, 0.25); gfx.fillRect(ox, oy + t - 1, t, 1); gfx.fillRect(ox + t - 1, oy, 1, t);
    }
  }

  // Grass tufts (random pixel noise for ALTTP look)
  const accent = Phaser.Display.Color.IntegerToColor(colorA).lighten(20).color;
  for (let i = 0; i < 6; i++) {
    const px = Math.floor(Math.random() * 30) + 1;
    const py = Math.floor(Math.random() * 30) + 1;
    gfx.fillStyle(accent, 0.4); gfx.fillRect(px, py, 1, 1);
  }

  gfx.generateTexture(key, t * 2, t * 2);
  gfx.destroy();
  return key;
}

export function generateHeroSprites(scene: Phaser.Scene, colors: { cap: number; robe: number; primary: number }): void {
  const dirs = ["down", "up", "left", "right"];
  const w = 16, h = 22;

  dirs.forEach((dir, di) => {
    for (let frame = 0; frame < 4; frame++) {
      const key = `hero-${dir}-${frame}`;
      if (scene.textures.exists(key)) continue;
      const gfx = scene.make.graphics({ x: 0, y: 0 });

      // Shadow
      gfx.fillStyle(0x000000, 0.2); gfx.fillRect(2, 19, 12, 3);

      // Body/robe
      gfx.fillStyle(colors.robe); gfx.fillRect(2, 10, 12, 10);
      gfx.fillStyle(colors.primary); gfx.fillRect(3, 12, 10, 7);

      // Head
      gfx.fillStyle(colors.cap); gfx.fillRect(2, 2, 12, 8);
      gfx.fillStyle(0xfacc15); gfx.fillRect(4, 0, 8, 3); // crown

      // Eyes (direction-based)
      gfx.fillStyle(0x020617);
      if (dir === "down") {
        gfx.fillRect(4, 6, 3, 3); gfx.fillRect(9, 6, 3, 3);
        gfx.fillStyle(0x86efac); gfx.fillRect(5, 7, 1, 1); gfx.fillRect(10, 7, 1, 1);
      } else if (dir === "up") {
        gfx.fillRect(4, 4, 3, 2); gfx.fillRect(9, 4, 3, 2);
      } else if (dir === "left") {
        gfx.fillRect(3, 6, 3, 3);
        gfx.fillStyle(0x86efac); gfx.fillRect(3, 7, 1, 1);
      } else {
        gfx.fillRect(10, 6, 3, 3);
        gfx.fillStyle(0x86efac); gfx.fillRect(12, 7, 1, 1);
      }

      // Staff (right side)
      if (dir !== "left") {
        gfx.fillStyle(0x713f12); gfx.fillRect(14, 4, 2, 14);
        gfx.fillStyle(0x22c55e); gfx.fillRect(13, 2, 3, 3);
      }

      // Feet with walk frame
      gfx.fillStyle(colors.primary);
      const step = frame % 4;
      if (dir === "left" || dir === "right") {
        const off = step === 1 ? -2 : step === 3 ? 2 : 0;
        gfx.fillRect(3, 19 + Math.abs(off), 4, 2);
        gfx.fillRect(9, 19 - Math.abs(off), 4, 2);
      } else {
        const off = step === 1 ? -1 : step === 3 ? 1 : 0;
        gfx.fillRect(3 + off, 19, 4, 2);
        gfx.fillRect(9 - off, 19, 4, 2);
      }

      gfx.generateTexture(key, w, h);
      gfx.destroy();
    }
  });
}

export function generateEnemySprite(scene: Phaser.Scene, kind: string, base: number, accent: number): string {
  const key = `enemy-${kind}`;
  if (scene.textures.exists(key)) return key;

  const gfx = scene.make.graphics({ x: 0, y: 0 });
  const w = 16, h = 16;

  gfx.fillStyle(0x000000, 0.2); gfx.fillRect(2, 13, 12, 3);
  gfx.fillStyle(base); gfx.fillRect(1, 2, 14, 12);
  gfx.fillStyle(accent); gfx.fillRect(2, 4, 12, 6);

  // Eyes
  gfx.fillStyle(0x020617); gfx.fillRect(4, 6, 2, 2); gfx.fillRect(10, 6, 2, 2);
  gfx.fillStyle(0x86efac); gfx.fillRect(4, 7, 1, 1); gfx.fillRect(10, 7, 1, 1);

  // Feet
  gfx.fillStyle(base); gfx.fillRect(2, 14, 4, 2); gfx.fillRect(10, 14, 4, 2);

  // Highlight edge (ALTTP style)
  const hi = Phaser.Display.Color.IntegerToColor(base).lighten(20).color;
  gfx.fillStyle(hi, 0.3); gfx.fillRect(1, 2, 14, 1); gfx.fillRect(1, 2, 1, 12);

  gfx.generateTexture(key, w, h);
  gfx.destroy();
  return key;
}

export function generateNpcSprite(scene: Phaser.Scene, id: string, cloak: number, accent: number): string {
  const key = `npc-${id}`;
  if (scene.textures.exists(key)) return key;

  const gfx = scene.make.graphics({ x: 0, y: 0 });
  gfx.fillStyle(0x000000, 0.2); gfx.fillRect(2, 13, 12, 3);
  gfx.fillStyle(cloak); gfx.fillRect(2, 1, 12, 14);
  gfx.fillStyle(accent); gfx.fillRect(3, 3, 10, 6);
  gfx.fillStyle(0xf8fafc); gfx.fillRect(5, 5, 2, 2); gfx.fillRect(9, 5, 2, 2);
  gfx.fillStyle(0xd6ca9f); gfx.fillRect(4, 0, 8, 2); // hat
  gfx.fillStyle(0x94a3b8); gfx.fillRect(7, 9, 2, 4); // staff

  gfx.generateTexture(key, 16, 16);
  gfx.destroy();
  return key;
}

export function generateStructureSprite(scene: Phaser.Scene, type: string, w: number, h: number): string {
  const key = `struct-${type}-${w}x${h}`;
  if (scene.textures.exists(key)) return key;

  const colors: Record<string, { wall: number; roof: number; door: number }> = {
    house: { wall: 0x92400e, roof: 0xb45309, door: 0x451a03 },
    castle: { wall: 0x1e3a5f, roof: 0x3b82f6, door: 0x1e293b },
    "mushroom-shop": { wall: 0x7c2d12, roof: 0xef4444, door: 0x450a0a },
    tower: { wall: 0x374151, roof: 0x6b7280, door: 0x1f2937 },
    cave: { wall: 0x374151, roof: 0x4b5563, door: 0x111827 },
    dungeon: { wall: 0x1e1b4b, roof: 0x4338ca, door: 0x0f0e26 },
    shrine: { wall: 0x4c1d95, roof: 0x7c3aed, door: 0x2e1065 },
    "burn-pit": { wall: 0x451a03, roof: 0xf97316, door: 0x7c2d12 },
  };
  const c = colors[type] ?? colors.house;
  const gfx = scene.make.graphics({ x: 0, y: 0 });

  // Roof
  gfx.fillStyle(c.roof); gfx.fillRect(0, 0, w, 8);
  gfx.fillStyle(Phaser.Display.Color.IntegerToColor(c.roof).darken(15).color);
  gfx.fillRect(0, 0, w, 2);

  // Wall
  gfx.fillStyle(c.wall); gfx.fillRect(2, 8, w - 4, h - 10);

  // ALTTP wall highlights
  const wallHi = Phaser.Display.Color.IntegerToColor(c.wall).lighten(15).color;
  gfx.fillStyle(wallHi, 0.4); gfx.fillRect(2, 8, w - 4, 1); gfx.fillRect(2, 8, 1, h - 10);

  // Door
  gfx.fillStyle(c.door);
  const dw = Math.max(6, Math.round(w * 0.25));
  gfx.fillRect(Math.round((w - dw) / 2), h - 10, dw, 8);

  // Windows
  gfx.fillStyle(0x93c5fd, 0.5);
  if (w > 30) {
    gfx.fillRect(6, 12, 4, 4); gfx.fillRect(w - 10, 12, 4, 4);
  }

  gfx.generateTexture(key, w, h);
  gfx.destroy();
  return key;
}

export function generatePickupTexture(scene: Phaser.Scene, golden: boolean): string {
  const key = golden ? "pickup-golden" : "pickup-blue";
  if (scene.textures.exists(key)) return key;
  const gfx = scene.make.graphics({ x: 0, y: 0 });
  const c = golden ? 0xfbbf24 : 0x22d3ee;
  const inner = golden ? 0xfef08a : 0xa5f3fc;
  gfx.fillStyle(c); gfx.fillRect(3, 0, 6, 12); gfx.fillRect(0, 3, 12, 6);
  gfx.fillStyle(inner); gfx.fillRect(4, 3, 4, 6);
  gfx.fillStyle(0xf8fafc); gfx.fillRect(5, 5, 2, 2);
  gfx.generateTexture(key, 12, 12);
  gfx.destroy();
  return key;
}

export function generatePortalTexture(scene: Phaser.Scene): string {
  const key = "portal";
  if (scene.textures.exists(key)) return key;
  const gfx = scene.make.graphics({ x: 0, y: 0 });
  const s = 20;
  gfx.fillStyle(0x22d3ee, 0.4);
  for (let y = 0; y < s; y += 4) {
    for (let x = 0; x < s; x += 4) {
      if ((x / 4 + y / 4) % 2 === 0) gfx.fillRect(x, y, 4, 4);
    }
  }
  gfx.fillStyle(0xf8fafc); gfx.fillRect(9, 2, 2, 16); gfx.fillRect(2, 9, 16, 2);
  gfx.fillStyle(0x22d3ee, 0.7); gfx.fillRect(7, 7, 6, 6);
  gfx.generateTexture(key, s, s);
  gfx.destroy();
  return key;
}

export function generateProjectileTexture(scene: Phaser.Scene, _color: number): string {
  const key = "hero-flame";
  if (scene.textures.exists(key)) return key;
  const gfx = scene.make.graphics({ x: 0, y: 0 });
  gfx.fillStyle(0x22c55e); gfx.fillRect(1, 0, 4, 6); gfx.fillRect(0, 1, 6, 4);
  gfx.fillStyle(0x86efac); gfx.fillRect(2, 2, 2, 2);
  gfx.generateTexture(key, 6, 6);
  gfx.destroy();
  return key;
}
