import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { mobileBuild } from './work/scripts/mobile-build.mjs';
import { mobileTypeScript } from './work/scripts/mobile-typescript.mjs';

export default defineConfig(({mode}) => ({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  ...(mode === 'mobile' ? {plugins:[mobileBuild()], worker:{format:'es', plugins:() => [mobileTypeScript()]}} : {}),
  build: {
    outDir: fileURLToPath(new URL(mode === 'mobile' ? './dist/mobile' : './dist/renderer', import.meta.url)),
    copyPublicDir: mode !== 'mobile',
    emptyOutDir: true,
  },
}));
