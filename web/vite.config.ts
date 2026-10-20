import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages 會放在 /<repo>/ 底下；本機開發用 /
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    // 手機的 DeviceMotion 需要 HTTPS（secure context），開發時用自簽憑證
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '順順行 sunsunbus',
        short_name: '順順行',
        description: '用手機量測公車加速度與急煞，開順不開慢。',
        lang: 'zh-TW',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
      },
    }),
  ],
  server: {
    // 允許讀取 repo 根目錄的 shared/params.default.json
    fs: { allow: ['..'] },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
