import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: 'src/main/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: [
                'electron',
                'electron-updater',
                '@whiskeysockets/baileys',
                'pino',
                'qrcode',
                'xlsx',
                'sharp',
                'axios'
              ]
            }
          }
        }
      },
      preload: {
        input: 'src/main/preload.ts',
      },
    }),
  ],
})