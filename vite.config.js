import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/google-api/', // Убедитесь, что 'google-api' - это точное имя вашего репозитория на GitHub
});