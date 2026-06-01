import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'inline',
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff,woff2}'],
          navigateFallback: 'index.html',
        },
        manifest: {
          name: 'Factorycloud',
          short_name: 'Factorycloud',
          description: 'Factory Floor SCADA Operator & Pilot App',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          scope: '/',
          start_url: '/',
          icons: [
            {
              src: 'https://cdn.jsdelivr.net/gh/lucide-react/lucide@latest/icons/factory.svg',
              sizes: '192x192',
              type: 'image/svg+xml'
            },
            {
              src: 'https://cdn.jsdelivr.net/gh/lucide-react/lucide@latest/icons/factory.svg',
              sizes: '512x512',
              type: 'image/svg+xml'
            }
          ]
        }
      })
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/data.db', '**/data.db-journal', '**/data.db-shm', '**/data.db-wal'],
      },
    },
  };
});
