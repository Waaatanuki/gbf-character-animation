import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'

export default defineConfig({
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
})
