import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { sourcemap: process.env.NODE_ENV === 'development' ? 'inline' : undefined, cssMinify: true, minify: true, rollupOptions: { input: process.env.INPUT ?? 'mcp-app.html' }, outDir: 'dist', emptyOutDir: true }
});
