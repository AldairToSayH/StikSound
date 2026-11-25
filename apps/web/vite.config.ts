import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Relative base so the build works at any path (GitHub Pages project site, Netlify, a sub-folder).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true
  },
  resolve: {
    alias: {
      "@stiksound/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      "@stiksound/providers": path.resolve(__dirname, "../../packages/providers/src/index.ts"),
      "@stiksound/media-web": path.resolve(__dirname, "../../packages/media-web/src/index.ts"),
      "@stiksound/ui": path.resolve(__dirname, "../../packages/ui/src/index.ts")
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
