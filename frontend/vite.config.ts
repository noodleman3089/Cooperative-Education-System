import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  // สองค่านี้ตั้งโดย playwright.config.ts เท่านั้น (E2E หลาย worker: vite หนึ่งตัวต่อ backend หนึ่งตัว)
  // ไม่ตั้ง = ค่าปกติของ dev
  cacheDir: process.env.E2E_VITE_CACHE_DIR || 'node_modules/.vite',
  server: {
    host: true,
    proxy: {
      '/api': {
        target: process.env.E2E_API_TARGET || 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
