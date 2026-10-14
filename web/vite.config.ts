import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run up` builds this into web/dist, which the simple-silver server serves on :4747.
// `npm run dev` (in web/) gives hot reload on :5173 and forwards /api to the running server,
// so start one first with `npm run up:mock` at the repo root.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4747" },
  },
  // One bundle is fine for a local app served from localhost; highlight.js's common languages make it ~600 kB.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
});
