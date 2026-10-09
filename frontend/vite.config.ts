import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the UI proxies /api to the API: the Docker stack (https://localhost) by default,
// or a local uvicorn with API_URL=http://localhost:8000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: process.env.API_URL ?? 'https://localhost', changeOrigin: true, secure: false },
    },
  },
})
