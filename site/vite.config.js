import { defineConfig } from "vite";

// /firms/* -> NASA FIRMS near-real-time CSVs (no CORS on their side, so we proxy;
// nginx does the same in production).
export default defineConfig({
  server: {
    proxy: {
      "/firms": {
        target: "https://firms.modaps.eosdis.nasa.gov",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/firms/, "/data/active_fire"),
      },
    },
  },
  build: { chunkSizeWarningLimit: 900 },
});
