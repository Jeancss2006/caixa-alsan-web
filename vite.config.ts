import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento, as rotas /api/* (Cloudflare Pages Functions) são servidas
// pelo `npm run dev:api` (wrangler) na porta 8788.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8788' },
  },
});
