import { defineConfig } from "vite";

export default defineConfig({
  base: "/api/game-phaser/",
  build: {
    outDir: "../public/game-phaser",
    emptyOutDir: true,
  },
  server: {
    port: 3001,
  },
});
