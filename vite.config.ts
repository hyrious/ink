import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '',
  build: {
    sourcemap: true,
    modulePreload: {
      polyfill: false
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        raw: resolve(__dirname, 'raw.html'),
      }
    }
  },
  define: {
    '__DEV__': 'true',
    '__COMMIT__': '"HEAD"',
    '__VERSION__': '"dev"',
  },
})
