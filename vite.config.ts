import { defineConfig } from "vite";
import { resolve } from "path";

const publicDir = process.env.MAHOYO_E2E_ASSETS ? resolve(process.env.MAHOYO_E2E_ASSETS) : "public";

export default defineConfig({
  publicDir,
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
