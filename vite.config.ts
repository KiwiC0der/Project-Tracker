import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Served from the root of https://pt.anteneh.tech
  base: '/',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // three.js is ~460KB and is only needed once a shader scene mounts.
        // Splitting it lets the loader and shell paint far sooner.
        manualChunks: {
          three: ['three'],
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
})
