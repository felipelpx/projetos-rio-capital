import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "harness",
  plugins: [react()],
  build: { outDir: "../dist-harness", emptyOutDir: true }
});
