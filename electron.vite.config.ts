import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@': resolve('src')
      }
    },
    build: {
      outDir: resolve('dist/main'),
      lib: {
        entry: resolve('electron/main.ts')
      },
      rollupOptions: {
        external: ['keytar']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@': resolve('src')
      }
    },
    build: {
      outDir: resolve('dist/preload'),
      lib: {
        entry: {
          index: resolve('electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@': resolve('src/renderer')
      }
    },
    build: {
      outDir: resolve('dist/renderer')
    },
    plugins: [vue()]
  }
})
