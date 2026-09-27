import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxies /api, /uploads and /satellite-cache to the FastAPI backend on :8000
// so the frontend can be built with relative paths and just work in both
// dev and any later same-origin deployment.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/uploads": "http://127.0.0.1:8000",
      "/satellite-cache": "http://127.0.0.1:8000",
    },
  },
});
