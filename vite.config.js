import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {viteSingleFile} from 'vite-plugin-singlefile';
import {fileURLToPath} from 'node:url';
export default defineConfig({base:'./',plugins:[react(),viteSingleFile()],resolve:{alias:{'three-stdlib':fileURLToPath(new URL('./src/threeExtras.js',import.meta.url))}},build:{chunkSizeWarningLimit:2500,assetsInlineLimit:10000000}});
