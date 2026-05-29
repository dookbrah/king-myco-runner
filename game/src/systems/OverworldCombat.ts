import Phaser from "phaser";
import type { GameState } from "./GameState";
import { generateProjectileTexture } from "./SpriteFactory";

interface Projectile {
  sprite: Phaser.GameObjects.Sprite;
  vx: number;
  vy: number;
  damage: number;
  isHero: boolean;
  lifetime: number;
}

const REGION_PROJECTILE_COLORS: Record<string, number> = {
  "myco-kingdom": 0x84cc16,
  "rougarou-fen": 0xa855f7,
  "tri-drake-peaks": 0xf97316,
  "crimson-tide": 0x06b6d4,
  "solana-chainlands": 0x6366f1,
  "verdant-commons": 0x22c55e,
  "obsidian-wilds": 0x78716c,
};

export class OverworldCombat {
  private scene: Phaser.Scene;
  private projectiles: Projectile[] = [];
  private lastHeroShotAt = 0;
  private heroCooldownMs = 320;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  heroShoot(state: GameState): void {
    const now = this.scene.time.now;
    if (now - this.lastHeroShotAt < this.heroCooldownMs) return;
    this.lastHeroShotAt = now;

    const aimX = state.hero.facingX || 0;
    const aimY = state.hero.facingY || -1;
    const mag = Math.hypot(aimX, aimY) || 1;
    const speed = 280;

    const color = 0x22c55e;
    const texKey = generateProjectileTexture(this.scene, color);
    const sprite = this.scene.add.sprite(state.hero.x, state.hero.y, texKey).setDepth(15);

    this.projectiles.push({
      sprite,
      vx: (aimX / mag) * speed,
      vy: (aimY / mag) * speed,
      damage: 8 + state.hero.attack * 3,
      isHero: true,
      lifetime: 1.2,
    });
  }

  spawnEnemyProjectile(ex: number, ey: number, tx: number, ty: number, regionId: string): void {
    const dx = tx - ex;
    const dy = ty - ey;
    const mag = Math.hypot(dx, dy) || 1;
    const speed = 160;
    const color = REGION_PROJECTILE_COLORS[regionId] ?? 0xf97316;
    const texKey = generateProjectileTexture(this.scene, color);
    const sprite = this.scene.add.sprite(ex, ey, texKey).setDepth(15);

    this.projectiles.push({
      sprite,
      vx: (dx / mag) * speed,
      vy: (dy / mag) * speed,
      damage: 10,
      isHero: false,
      lifetime: 2.0,
    });
  }

  update(dt: number, state: GameState, enemies: { x: number; y: number; hp: number; active: boolean }[]): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.lifetime -= dt;

      if (p.lifetime <= 0) {
        p.sprite.destroy();
        this.projectiles.splice(i, 1);
        continue;
      }

      if (p.isHero) {
        for (const enemy of enemies) {
          if (!enemy.active || enemy.hp <= 0) continue;
          if (Phaser.Math.Distance.Between(p.sprite.x, p.sprite.y, enemy.x, enemy.y) < 22) {
            enemy.hp -= p.damage;
            this.spawnImpact(p.sprite.x, p.sprite.y, 0x22c55e);
            p.sprite.destroy();
            this.projectiles.splice(i, 1);
            break;
          }
        }
      } else {
        if (Phaser.Math.Distance.Between(p.sprite.x, p.sprite.y, state.hero.x, state.hero.y) < 14) {
          state.hero.hp = Math.max(0, state.hero.hp - p.damage);
          this.spawnImpact(p.sprite.x, p.sprite.y, 0xef4444);
          p.sprite.destroy();
          this.projectiles.splice(i, 1);
        }
      }
    }
  }

  private spawnImpact(x: number, y: number, color: number): void {
    const gfx = this.scene.add.graphics().setDepth(16);
    gfx.fillStyle(color, 0.6);
    gfx.fillRect(x - 6, y - 6, 12, 12);
    this.scene.tweens.add({
      targets: gfx,
      alpha: 0,
      scaleX: 2,
      scaleY: 2,
      duration: 300,
      onComplete: () => gfx.destroy(),
    });
  }

  destroy(): void {
    for (const p of this.projectiles) p.sprite.destroy();
    this.projectiles = [];
  }
}
