import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { mobileBuild } from './work/scripts/mobile-build.mjs';

export default defineConfig(({mode}) => ({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  ...(mode === 'mobile' ? {plugins:[mobileBuild()], worker:{format:'es'}} : {}),
  build: {
    outDir: fileURLToPath(new URL(mode === 'mobile' ? './dist/mobile' : './dist/renderer', import.meta.url)),
    copyPublicDir: mode !== 'mobile',
    emptyOutDir: true,
  },
}));
