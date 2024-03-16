import { defineConfig } from 'vite'

export default defineConfig({
  base: '',
  build: {
    sourcemap: true,
    modulePreload: {
      polyfill: false
    },
  },
  define: {
    '__DEV__': 'true',
    '__COMMIT__': '"HEAD"',
    '__VERSION__': '"dev"',
  },
})
