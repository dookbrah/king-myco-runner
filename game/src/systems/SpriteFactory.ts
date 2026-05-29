import Phaser from "phaser";

export function generateTerrainTile(scene: Phaser.Scene, colorA: number, colorB: number, realmId: string): string {
  const key = `terrain-${realmId}`;
  if (scene.textures.exists(key)) return key;

  const t = 16;
  const gfx = scene.make.graphics({ x: 0, y: 0 });
  const cA = Phaser.Display.Color.IntegerToColor(colorA);
  const cB = Phaser.Display.Color.IntegerToColor(colorB);
  const hiA = cA.clone().lighten(14).color;
  const loA = cA.clone().darken(12).color;
  const hiB = cB.clone().lighten(14).color;
  const loB = cB.clone().darken(12).color;

  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const isA = (tx + ty) % 2 === 0;
      const fill = isA ? colorA : colorB;
      const hi = isA ? hiA : hiB;
      const lo = isA ? loA : loB;
      const ox = tx * t, oy = ty * t;
      gfx.fillStyle(fill); gfx.fillRect(ox, oy, t, t);
      gfx.fillStyle(hi, 0.35); gfx.fillRect(ox, oy, t, 1); gfx.fillRect(ox, oy + 1, 1, t - 1);
      gfx.fillStyle(lo, 0.3); gfx.fillRect(ox + 1, oy + t - 1, t - 1, 1); gfx.fillRect(ox + t - 1, oy + 1, 1, t - 2);
      // Noise detail pixels
      const accent = isA ? hiA : hiB;
      for (let i = 0; i < 4; i++) {
        const px = ox + 2 + Math.floor(Math.random() * (t - 4));
        const py = oy + 2 + Math.floor(Math.random() * (t - 4));
        gfx.fillStyle(accent, 0.2 + Math.random() * 0.15); gfx.fillRect(px, py, 1, 1);
      }
    }
  }
  gfx.generateTexture(key, t * 2, t * 2);
  gfx.destroy();
  return key;
}

export function generateHeroSprites(scene: Phaser.Scene, _colors: { cap: number; robe: number; primary: number }): void {
  const dirs = ["down", "up", "left", "right"];
  const w = 32, h = 40;

  dirs.forEach((dir) => {
    for (let frame = 0; frame < 4; frame++) {
      const key = `hero-${dir}-${frame}`;
      if (scene.textures.exists(key)) continue;
      const g = scene.make.graphics({ x: 0, y: 0 });

      // Shadow
      g.fillStyle(0x000000, 0.22); g.fillRect(6, 36, 20, 4);

      // Purple robe body
      g.fillStyle(0x5b21b6); g.fillRect(8, 22, 16, 16);
      g.fillStyle(0x7c3aed); g.fillRect(9, 23, 14, 14);
      g.fillStyle(0x6d28d9); g.fillRect(10, 26, 12, 10);
      // Robe shading
      g.fillStyle(0x4c1d95, 0.4); g.fillRect(8, 22, 2, 16); g.fillRect(22, 22, 2, 16);
      g.fillStyle(0x8b5cf6, 0.25); g.fillRect(12, 24, 8, 2);
      // Belt
      g.fillStyle(0xfbbf24); g.fillRect(10, 28, 12, 2);
      g.fillStyle(0xf59e0b); g.fillRect(14, 27, 4, 1);

      // Red mushroom cap (32-bit detail)
      g.fillStyle(0xb91c1c); g.fillRect(7, 4, 18, 10);
      g.fillStyle(0xdc2626); g.fillRect(8, 3, 16, 10);
      g.fillStyle(0xef4444); g.fillRect(9, 2, 14, 4);
      g.fillStyle(0xfca5a5); g.fillRect(10, 1, 12, 2);
      // Cap highlight
      g.fillStyle(0xfee2e2, 0.4); g.fillRect(10, 2, 6, 2);
      // White spots
      g.fillStyle(0xfef2f2); g.fillRect(10, 4, 3, 3); g.fillRect(17, 5, 3, 2); g.fillRect(12, 2, 2, 2); g.fillRect(20, 3, 2, 2);
      // Cap rim
      g.fillStyle(0x991b1b); g.fillRect(7, 13, 18, 2); g.fillRect(6, 12, 1, 2); g.fillRect(25, 12, 1, 2);

      // Black face
      g.fillStyle(0x020617); g.fillRect(9, 14, 14, 8);
      g.fillStyle(0x0f172a); g.fillRect(10, 15, 12, 6);

      // Green glowing eyes
      if (dir === "down") {
        g.fillStyle(0x86efac); g.fillRect(11, 16, 4, 4); g.fillRect(18, 16, 4, 4);
        g.fillStyle(0x4ade80); g.fillRect(12, 17, 2, 2); g.fillRect(19, 17, 2, 2);
        g.fillStyle(0xf0fdf4); g.fillRect(12, 16, 1, 1); g.fillRect(19, 16, 1, 1);
        g.fillStyle(0x22c55e, 0.2); g.fillRect(9, 14, 6, 6); g.fillRect(16, 14, 6, 6);
      } else if (dir === "up") {
        g.fillStyle(0x86efac); g.fillRect(11, 15, 4, 3); g.fillRect(18, 15, 4, 3);
        g.fillStyle(0x4ade80); g.fillRect(12, 15, 2, 2); g.fillRect(19, 15, 2, 2);
      } else if (dir === "left") {
        g.fillStyle(0x86efac); g.fillRect(9, 16, 4, 4);
        g.fillStyle(0x4ade80); g.fillRect(9, 17, 2, 2);
        g.fillStyle(0xf0fdf4); g.fillRect(9, 16, 1, 1);
        g.fillStyle(0x22c55e, 0.2); g.fillRect(7, 14, 7, 6);
      } else {
        g.fillStyle(0x86efac); g.fillRect(19, 16, 4, 4);
        g.fillStyle(0x4ade80); g.fillRect(20, 17, 2, 2);
        g.fillStyle(0xf0fdf4); g.fillRect(22, 16, 1, 1);
        g.fillStyle(0x22c55e, 0.2); g.fillRect(18, 14, 7, 6);
      }

      // Magic staff
      const sx = dir === "left" ? 2 : 26;
      g.fillStyle(0x78350f); g.fillRect(sx, 10, 3, 28);
      g.fillStyle(0x92400e); g.fillRect(sx + 1, 10, 1, 28);
      // Green flame on staff
      g.fillStyle(0x22c55e); g.fillRect(sx - 1, 5, 5, 6);
      g.fillStyle(0x86efac); g.fillRect(sx, 4, 3, 4);
      g.fillStyle(0x4ade80); g.fillRect(sx, 2, 3, 3);
      g.fillStyle(0xbbf7d0, 0.5); g.fillRect(sx + 1, 1, 1, 2);
      // Flame flicker per frame
      if (frame % 2 === 0) { g.fillStyle(0x86efac, 0.4); g.fillRect(sx - 2, 3, 2, 3); }
      else { g.fillStyle(0x86efac, 0.4); g.fillRect(sx + 3, 3, 2, 3); }

      // Feet/boots with walk cycle
      g.fillStyle(0x3b0764);
      const step = frame % 4;
      if (dir === "left" || dir === "right") {
        const off = step === 1 ? -3 : step === 3 ? 3 : 0;
        g.fillRect(9 + off, 36, 5, 3);
        g.fillRect(18 - off, 36, 5, 3);
      } else {
        const off = step === 1 ? -2 : step === 3 ? 2 : 0;
        g.fillRect(9 + off, 36, 5, 3);
        g.fillRect(18 - off, 36, 5, 3);
      }
      // Boot highlight
      g.fillStyle(0x4c1d95, 0.5);
      g.fillRect(10 + (step === 1 ? -2 : step === 3 ? 2 : 0), 36, 3, 1);

      // Outline
      g.fillStyle(0x1e1b4b, 0.3);
      g.fillRect(7, 22, 1, 16); g.fillRect(24, 22, 1, 16);

      g.generateTexture(key, w, h);
      g.destroy();
    }
  });
}

export function generateEnemySprite(scene: Phaser.Scene, kind: string, base: number, accent: number): string {
  const key = `enemy-${kind}`;
  if (scene.textures.exists(key)) return key;

  const g = scene.make.graphics({ x: 0, y: 0 });
  const w = 28, h = 28;
  const bC = Phaser.Display.Color.IntegerToColor(base);
  const hi = bC.clone().lighten(18).color;
  const lo = bC.clone().darken(16).color;

  g.fillStyle(0x000000, 0.2); g.fillRect(4, 24, 20, 4);
  g.fillStyle(base); g.fillRect(4, 4, 20, 20);
  g.fillStyle(lo); g.fillRect(4, 4, 20, 2); g.fillRect(4, 22, 20, 2);
  g.fillStyle(accent); g.fillRect(6, 7, 16, 10);
  g.fillStyle(hi, 0.3); g.fillRect(5, 5, 18, 1); g.fillRect(5, 5, 1, 18);
  g.fillStyle(lo, 0.3); g.fillRect(5, 22, 18, 1); g.fillRect(22, 5, 1, 18);

  // Eyes
  g.fillStyle(0x020617); g.fillRect(8, 11, 4, 4); g.fillRect(16, 11, 4, 4);
  g.fillStyle(0x86efac); g.fillRect(9, 12, 2, 2); g.fillRect(17, 12, 2, 2);
  g.fillStyle(0xf0fdf4); g.fillRect(9, 11, 1, 1); g.fillRect(17, 11, 1, 1);

  // Mouth/teeth
  g.fillStyle(0x020617); g.fillRect(10, 17, 8, 3);
  g.fillStyle(0xf8fafc); g.fillRect(11, 17, 2, 2); g.fillRect(15, 17, 2, 2);

  // Feet
  g.fillStyle(base); g.fillRect(6, 24, 6, 3); g.fillRect(16, 24, 6, 3);
  g.fillStyle(lo); g.fillRect(6, 26, 6, 1); g.fillRect(16, 26, 6, 1);

  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}

export function generateNpcSprite(scene: Phaser.Scene, id: string, cloak: number, accent: number): string {
  const key = `npc-${id}`;
  if (scene.textures.exists(key)) return key;

  const g = scene.make.graphics({ x: 0, y: 0 });
  const cC = Phaser.Display.Color.IntegerToColor(cloak);
  const hi = cC.clone().lighten(20).color;

  g.fillStyle(0x000000, 0.2); g.fillRect(6, 26, 16, 3);
  g.fillStyle(cloak); g.fillRect(6, 4, 16, 22);
  g.fillStyle(hi, 0.3); g.fillRect(6, 4, 16, 1); g.fillRect(6, 4, 1, 22);
  g.fillStyle(accent); g.fillRect(8, 8, 12, 8);
  g.fillStyle(0xf8fafc); g.fillRect(10, 10, 3, 3); g.fillRect(15, 10, 3, 3);
  g.fillStyle(0x86efac); g.fillRect(11, 11, 1, 1); g.fillRect(16, 11, 1, 1);
  g.fillStyle(0xd6ca9f); g.fillRect(8, 2, 12, 3); // hood
  g.fillStyle(0x94a3b8); g.fillRect(13, 14, 2, 10); // staff

  g.generateTexture(key, 28, 30);
  g.destroy();
  return key;
}

export function generateStructureSprite(scene: Phaser.Scene, type: string, w: number, h: number): string {
  const key = `struct-${type}-${w}x${h}`;
  if (scene.textures.exists(key)) return key;

  const colors: Record<string, { wall: number; roof: number; door: number }> = {
    house: { wall: 0xb45309, roof: 0xdc2626, door: 0x451a03 },
    castle: { wall: 0x475569, roof: 0x3b82f6, door: 0x1e293b },
    "mushroom-shop": { wall: 0xa16207, roof: 0xef4444, door: 0x78350f },
    tower: { wall: 0x64748b, roof: 0x94a3b8, door: 0x334155 },
    cave: { wall: 0x4b5563, roof: 0x6b7280, door: 0x1f2937 },
    dungeon: { wall: 0x312e81, roof: 0x6366f1, door: 0x1e1b4b },
    shrine: { wall: 0x6d28d9, roof: 0xa78bfa, door: 0x4c1d95 },
    "burn-pit": { wall: 0x92400e, roof: 0xf97316, door: 0x7c2d12 },
  };
  const c = colors[type] ?? colors.house;
  const g = scene.make.graphics({ x: 0, y: 0 });
  const wC = Phaser.Display.Color.IntegerToColor(c.wall);

  // Roof with gradient
  g.fillStyle(c.roof); g.fillRect(0, 0, w, 10);
  g.fillStyle(Phaser.Display.Color.IntegerToColor(c.roof).darken(20).color); g.fillRect(0, 0, w, 3);
  g.fillStyle(Phaser.Display.Color.IntegerToColor(c.roof).lighten(10).color, 0.3); g.fillRect(2, 3, w - 4, 2);

  // Wall
  g.fillStyle(c.wall); g.fillRect(3, 10, w - 6, h - 12);
  g.fillStyle(wC.clone().lighten(12).color, 0.35); g.fillRect(3, 10, w - 6, 1); g.fillRect(3, 10, 1, h - 12);
  g.fillStyle(wC.clone().darken(15).color, 0.35); g.fillRect(3, h - 3, w - 6, 1); g.fillRect(w - 4, 10, 1, h - 12);

  // Door
  const dw = Math.max(8, Math.round(w * 0.22));
  const dh = Math.max(10, Math.round(h * 0.3));
  const dx = Math.round((w - dw) / 2);
  g.fillStyle(c.door); g.fillRect(dx, h - dh - 2, dw, dh);
  g.fillStyle(0x000000, 0.3); g.fillRect(dx + 1, h - dh, dw - 2, dh - 2);
  g.fillStyle(0xfbbf24); g.fillRect(dx + dw - 3, h - dh / 2 - 1, 2, 2); // doorknob

  // Windows
  if (w > 32) {
    g.fillStyle(0x7dd3fc, 0.6); g.fillRect(7, 14, 6, 6); g.fillRect(w - 13, 14, 6, 6);
    g.fillStyle(0x0ea5e9, 0.3); g.fillRect(7, 14, 6, 1); g.fillRect(7, 14, 1, 6);
    g.fillStyle(0x0284c7, 0.3); g.fillRect(10, 17, 3, 3);
  }

  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}

export function generatePickupTexture(scene: Phaser.Scene, golden: boolean): string {
  const key = golden ? "pickup-golden" : "pickup-blue";
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 });
  const c1 = golden ? 0xf59e0b : 0x0891b2;
  const c2 = golden ? 0xfbbf24 : 0x22d3ee;
  const c3 = golden ? 0xfef08a : 0xa5f3fc;
  // Diamond shape
  g.fillStyle(c1); g.fillRect(5, 0, 4, 14); g.fillRect(3, 2, 8, 10); g.fillRect(1, 4, 12, 6);
  g.fillStyle(c2); g.fillRect(4, 2, 6, 10); g.fillRect(2, 4, 10, 6);
  g.fillStyle(c3); g.fillRect(4, 4, 6, 6);
  g.fillStyle(0xf8fafc); g.fillRect(5, 5, 2, 3); g.fillRect(4, 6, 4, 1);
  g.generateTexture(key, 14, 14);
  g.destroy();
  return key;
}

export function generatePortalTexture(scene: Phaser.Scene): string {
  const key = "portal";
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 });
  const s = 24;
  // Swirl pattern
  g.fillStyle(0x06b6d4, 0.3);
  for (let y = 0; y < s; y += 4) {
    for (let x = 0; x < s; x += 4) {
      if ((x / 4 + y / 4) % 2 === 0) g.fillRect(x, y, 4, 4);
    }
  }
  g.fillStyle(0x22d3ee, 0.6); g.fillRect(4, 4, s - 8, s - 8);
  g.fillStyle(0x67e8f9, 0.4); g.fillRect(8, 8, s - 16, s - 16);
  g.fillStyle(0xf8fafc); g.fillRect(s / 2 - 1, 2, 2, s - 4); g.fillRect(2, s / 2 - 1, s - 4, 2);
  g.fillStyle(0xa5f3fc); g.fillRect(s / 2 - 2, s / 2 - 2, 4, 4);
  g.generateTexture(key, s, s);
  g.destroy();
  return key;
}

export function generateProjectileTexture(scene: Phaser.Scene, _color: number): string {
  const key = "hero-flame";
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 });
  g.fillStyle(0x16a34a); g.fillRect(1, 0, 6, 8); g.fillRect(0, 1, 8, 6);
  g.fillStyle(0x22c55e); g.fillRect(2, 1, 4, 6); g.fillRect(1, 2, 6, 4);
  g.fillStyle(0x86efac); g.fillRect(3, 2, 2, 4);
  g.fillStyle(0xf0fdf4); g.fillRect(3, 3, 2, 2);
  g.generateTexture(key, 8, 8);
  g.destroy();
  return key;
}
