import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vercel builds the SPA alone (dist/) and the API separately (scripts/build-vercel.mjs);
// everywhere else the Cloudflare plugin builds and serves the SPA and the Worker together.
const vercel = process.env.ACS_TARGET === 'vercel';

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(vercel ? [] : [cloudflare()])],
  server: { port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 1500 },
});
