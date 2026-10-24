// The editor's build. In development the studio runs separately ("npm run studio") and
// this server forwards the studio's addresses to it, so the page and the studio share
// one origin as they do when the studio serves the built editor.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const studio = process.env.FULLSCALE_STUDIO ?? 'http://127.0.0.1:4747';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/live': { target: studio, ws: true, changeOrigin: true },
      '/api': { target: studio, changeOrigin: true },
      '/files': { target: studio, changeOrigin: true },
      '/health': { target: studio, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
