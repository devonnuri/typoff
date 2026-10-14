import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        // Keep editor parsing and UI vendors out of the application chunk;
        // compiler/renderer already execute in a separate lazy-created worker.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/codemirror-lang-typst/')) return 'typst-language'
          if (/\/(?:@codemirror|@lezer|codemirror)\//.test(id)) return 'editor-vendor'
          if (/\/(?:react|react-dom|scheduler)\//.test(id)) return 'react-vendor'
          if (/\/(?:@radix-ui|radix-ui|lucide-react)\//.test(id)) return 'ui-vendor'
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-icon.svg'],
      manifest: {
        name: 'Typoff',
        short_name: 'Typoff',
        description: 'Offline Typst editor with live preview.',
        theme_color: '#171717',
        background_color: '#171717',
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
