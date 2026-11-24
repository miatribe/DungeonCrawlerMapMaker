import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works from any static host sub-path (e.g. GitHub Pages).
  base: "./",
  server: { port: 5173 },
  // The editor (React + Zod) and the lazily loaded 3D chunk (three.js) are each ~500–600 kB.
  build: { chunkSizeWarningLimit: 800 },
});
