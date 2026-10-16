import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig} from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(() => {
  return {
    base: './',
    build: {
      emptyOutDir: false,
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(projectRoot),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/src-tauri/**', '**/target/**'],
      },
    },
  };
});
