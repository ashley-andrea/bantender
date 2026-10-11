import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the UI proxies /api to the API: the Docker stack (https://localhost) by default,
// or a local uvicorn with API_URL=http://localhost:8000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // pdf.js's modern build calls APIs Safari doesn't ship yet (Map.prototype.getOrInsertComputed, Math.sumPrecise);
  // the legacy build polyfills them. react-pdf imports the bare package, so redirect it there.
  resolve: {
    alias: [
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
      { find: /^pdfjs-dist\/web\/pdf_viewer\.mjs$/, replacement: 'pdfjs-dist/legacy/web/pdf_viewer.mjs' },
    ],
  },
  server: {
    proxy: {
      '/api': { target: process.env.API_URL ?? 'https://localhost', changeOrigin: true, secure: false },
    },
  },
})
