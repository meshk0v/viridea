import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' — работает и на GitHub Pages (/repo/), и локально
export default defineConfig({ plugins: [react()], base: './', build: { chunkSizeWarningLimit: 1200 } });
