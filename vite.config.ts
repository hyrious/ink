import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    '__DEV__': 'true',
    '__COMMIT__': '"HEAD"',
    '__VERSION__': '"dev"',
  }
})
