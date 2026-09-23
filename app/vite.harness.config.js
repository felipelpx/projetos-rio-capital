import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/* A pré-visualização troca o cliente Supabase por um de mentira, em memória.
   Assim os componentes correm o mesmo código — incluindo as escritas — sem
   precisar de base de dados. */
export default defineConfig({
  root: "harness",
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^.*\/lib\/supabase\.js$/, replacement: path.resolve("harness/supabase-falso.js") }
    ]
  },
  build: { outDir: "../dist-harness", emptyOutDir: true }
});
