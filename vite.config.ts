import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const workerProxyTarget = env.VITE_GBF_PROXY_BASE || 'http://127.0.0.1:8787'

  return {
    plugins: [
      vue(),
      AutoImport({
        imports: ['vue'],
        dts: 'types/auto-imports.d.ts',
        vueTemplate: true,
      }),
      Components({
        dts: 'types/components.d.ts',
      }),
      UnoCSS({ inspector: false }),
    ],
    server: {
      proxy: {
        '/health': {
          target: workerProxyTarget,
          changeOrigin: true,
        },
        '/version': {
          target: workerProxyTarget,
          changeOrigin: true,
        },
        '/js/cjs': {
          target: workerProxyTarget,
          changeOrigin: true,
        },
        '/img/cjs': {
          target: workerProxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
