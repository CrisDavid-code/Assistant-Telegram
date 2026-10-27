import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import legacy from '@vitejs/plugin-legacy';
import { fileURLToPath } from 'node:url';

/** precache.json: archivos del build para que el service worker abra la app sin red. */
const precacheList = (): Plugin => ({
  name: 'precache-list',
  apply: 'build',
  generateBundle(_, bundle) {
    this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(Object.keys(bundle).filter((f) => !f.endsWith('.map'))) });
  },
});

// Firestore usa BigInt: navegadores más viejos ven la página "actualiza tu navegador" (index.html).
const TARGETS = ['chrome >= 67', 'edge >= 79', 'firefox >= 68', 'safari >= 14', 'ios_saf >= 14', 'samsung >= 9'];

export default defineConfig({
  plugins: [react(), tailwindcss(), legacy({ modernTargets: TARGETS, modernPolyfills: true, renderLegacyChunks: false }), precacheList()],
  resolve: { alias: { '@lifeos/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)) } },
  build: { chunkSizeWarningLimit: 900 },
});
