import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * electron-vite 配置：
 * - main：Electron 主进程
 * - preload：预加载脚本（contextBridge）
 * - renderer：渲染进程（React + Vite）
 */
export default defineConfig({
  main: {
    // exclude 本地 workspace 包（@ai-md-editor/shared 等）使其内联打包，
    // 这样 main 产物完全自包含，打包时无需复制 node_modules，
    // 也避免 electron-builder 重装依赖时误删 7zip-bin 二进制。
    plugins: [externalizeDepsPlugin({ exclude: ['@ai-md-editor/shared'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@ai-md-editor/shared'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@ai-md-editor/shared': resolve(__dirname, '../../packages/shared/src'),
        '@ai-md-editor/theme': resolve(__dirname, '../../packages/theme/src'),
        '@ai-md-editor/markdown-core': resolve(__dirname, '../../packages/markdown-core/src'),
        '@ai-md-editor/editor': resolve(__dirname, '../../packages/editor/src')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
});
