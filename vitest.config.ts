/**
 * 单元测试配置。
 *
 * 单独一份而不写进 vite.config.ts 的原因：
 * 构建配置里塞 `test` 字段就得从 `vitest/config` 引入 defineConfig，
 * 把测试框架变成构建期依赖 —— 生产构建不该为测试配置负责。
 *
 * 环境选 node：当前测的都是纯函数层（解析器、校验器、注册表、快照仓库），
 * 它们被刻意设计成不碰 DOM，正是为了让这一层能在无浏览器环境下验证。
 * 哪天要测 Preact 组件，再为那些用例单独开 jsdom 环境即可。
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    // 与 vite.config.ts 保持同一套路径别名，否则测试里 import '@/core/utils' 会解析失败
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
