import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/google-api/', // <-- Вот эта строка всё исправит!
  plugins: [react()],
})