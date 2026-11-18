import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // WebUSB 要求安全上下文：localhost 属于可信来源，因此本地开发用 HTTP 即可
    host: '127.0.0.1',
    port: 8124,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // ADB 传输层体积较大且非首屏必需，单独拆包，首屏不加载
          adb: ['@yume-chan/adb', '@yume-chan/adb-daemon-webusb', '@yume-chan/adb-credential-web'],
        },
      },
    },
  },
});
