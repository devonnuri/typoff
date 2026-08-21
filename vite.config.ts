import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  worker: {
    format: 'es',
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-icon.svg'],
      manifest: {
        name: 'Typoff',
        short_name: 'Typoff',
        description: 'Offline Typst editor with live preview.',
        theme_color: '#0f766e',
        background_color: '#f8f4ec',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-icon.svg',
            sizes: '256x256',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,svg,woff2,ttf,otf}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
})
