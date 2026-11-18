// ESLint 9 扁平配置（flat config）。
// 只做「类型层之外」的检查：类型错误交给 tsc，这里管风格、可疑写法与显式 any。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // 这些目录不是源码，不参与检查
    ignores: ['dist/**', 'node_modules/**', 'bin/**', 'scripts/**', 'docs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // 显式 any 一律报错。唯一例外见下方 driver.ts 的 override。
      '@typescript-eslint/no-explicit-any': 'error',
      // 允许以 _ 开头的参数/变量表示「有意不用」
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // 本项目大量使用 Preact 的 signal 与短小箭头函数，空接口等写法没有收益
      '@typescript-eslint/no-empty-object-type': 'warn',
      // console 输出是 CLI 与调试的正当出口
      'no-console': 'off',
      // 与 tsc 的 noUnusedLocals 保持一致，避免两套规则打架
      'no-undef': 'off',
    },
  },
  {
    // WebUSB 的类型定义（@types/w3c-web-usb 未安装，@yume-chan 的类型也不完整）
    // 迫使此文件必须用 any 承接原生 USB 对象。已在 STATE.md 的 T-006 登记，
    // 待引入完整 USB 类型定义后一并收敛，这里先放行。
    files: ['src/core/transport/driver.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
