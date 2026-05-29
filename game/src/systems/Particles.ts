import Phaser from "phaser";

export function createSporeParticles(scene: Phaser.Scene, x: number, y: number, golden: boolean): void {
  const colors = golden ? [0xfbbf24, 0xfef08a, 0xf59e0b] : [0x22d3ee, 0xa5f3fc, 0x06b6d4];
  for (let i = 0; i < 8; i++) {
    const color = colors[i % colors.length];
    const gfx = scene.add.graphics().setDepth(20);
    gfx.fillStyle(color, 0.8);
    gfx.fillRect(x - 2, y - 2, 4, 4);
    const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 20 + Math.random() * 20;
    scene.tweens.add({
      targets: gfx,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist - 10,
      alpha: 0,
      duration: 400 + Math.random() * 200,
      onComplete: () => gfx.destroy(),
    });
  }
}

export function createDamageNumber(scene: Phaser.Scene, x: number, y: number, amount: number, color: string): void {
  const text = scene.add.text(x, y, `-${amount}`, {
    fontFamily: "monospace",
    fontSize: "14px",
    fontStyle: "bold",
    color,
  }).setOrigin(0.5).setDepth(25);

  scene.tweens.add({
    targets: text,
    y: y - 30,
    alpha: 0,
    duration: 600,
    onComplete: () => text.destroy(),
  });
}

export function createPickupMagnet(scene: Phaser.Scene, pickupSprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle, targetX: number, targetY: number, onComplete: () => void): void {
  scene.tweens.add({
    targets: pickupSprite,
    x: targetX,
    y: targetY,
    scaleX: 0.3,
    scaleY: 0.3,
    alpha: 0,
    duration: 250,
    ease: "Power2",
    onComplete: () => {
      pickupSprite.destroy();
      onComplete();
    },
  });
}

export function createPortalFlash(scene: Phaser.Scene): void {
  const { width, height } = scene.scale;
  const flash = scene.add.rectangle(width / 2, height / 2, width, height, 0x22d3ee, 0.4)
    .setScrollFactor(0).setDepth(50);
  scene.tweens.add({
    targets: flash,
    alpha: 0,
    duration: 400,
    onComplete: () => flash.destroy(),
  });
}

export function createBattleTransition(scene: Phaser.Scene, onComplete: () => void): void {
  const { width, height } = scene.scale;
  const bars: Phaser.GameObjects.Rectangle[] = [];
  const count = 8;
  for (let i = 0; i < count; i++) {
    const bar = scene.add.rectangle(0, i * (height / count), 0, height / count, 0x020617)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(50);
    bars.push(bar);
  }
  scene.tweens.add({
    targets: bars,
    width: width,
    duration: 300,
    delay: (_target: unknown, _key: string, _value: unknown, index: number) => index * 40,
    onComplete: () => {
      onComplete();
      scene.tweens.add({
        targets: bars,
        alpha: 0,
        duration: 200,
        delay: 100,
        onComplete: () => bars.forEach((b) => b.destroy()),
      });
    },
  });
}
