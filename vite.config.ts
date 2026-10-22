import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: {
      deny: [
        "**/.env",
        "**/.env.*",
        "**/*.{crt,pem}",
        "**/.git/**",
        "**/data/**",
      ],
    },
    watch: { ignored: ["**/data/**"] },
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  build: {
    rollupOptions: { output: { manualChunks: { charts: ["recharts"] } } },
  },
});
