import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: { manualChunks: { maplibre: ['maplibre-gl'], vendor: ['react', 'react-dom', 'framer-motion', 'zustand'] } },
    },
  },
});
