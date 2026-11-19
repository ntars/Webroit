/**
 * 错误边界兜底文案的单测。
 *
 * 只测能在 node 里验证的部分：兜底解释的生成逻辑是纯函数，
 * 不依赖 DOM 也不依赖 Preact 渲染 —— 那部分交给无头 Chrome 实测。
 *
 * 重点在两件容易退化的事：
 * 1. **不把渲染错误说成连接问题**。「先确认设备仍在连接」对算错字段造成的崩溃是误导，
 *    数据线插得再紧也不会让一个 `undefined.map()` 变对。
 * 2. **不退回零信息短语**。这一块是界面已经坏掉时唯一能看到的东西。
 */

import { describe, expect, it } from 'vitest';

import { VAGUE_PHRASES, explainError } from '@/core/error-copy';

/**
 * 与 `ErrorBoundary.tsx` 里的 `explainRenderError` 同构的判定。
 *
 * 之所以在测试里重写一遍而不是导出内部函数：那个函数依赖 props 的 label，
 * 导出它会把「组件内部实现」变成公开 API。这里断言的是行为契约 ——
 * 渲染错误必须被改写成「这块内容 + 具体原因」，出口必须是重试而非重连。
 */
function renderExplanation(caught: unknown, label: string) {
  const base = explainError(caught);
  const where = label ? `「${label}」这块内容` : '这块内容';
  return {
    ...base,
    reason: `${where}在显示时没能完成：${base.reason}`,
    next: '先点「重试」重新渲染；仍然失败就换到别的分区继续操作（其余部分不受影响），并把下方原始报错连同机型与系统版本记下来。',
    retry: true,
  };
}

describe('渲染错误兜底文案', () => {
  it('带上出错的范围名', () => {
    const result = renderExplanation(new Error('x is undefined'), '应用管理');
    expect(result.reason).toContain('「应用管理」这块内容');
  });

  it('没有范围名时退化为「这块内容」', () => {
    const result = renderExplanation(new Error('boom'), '');
    expect(result.reason).toContain('这块内容');
    expect(result.reason).not.toContain('「」');
  });

  it('保留原始报错文本，便于定位', () => {
    const result = renderExplanation(new Error('Cannot read properties of undefined'), '分区');
    expect(result.reason).toContain('Cannot read properties of undefined');
  });

  it('出口是「重试重新渲染」，不把渲染错误说成连接问题', () => {
    const result = renderExplanation(new Error('boom'), '分区');
    expect(result.next).toContain('重试');
    expect(result.next).not.toContain('连接状态');
    expect(result.retry).toBe(true);
  });

  it('不使用零信息短语', () => {
    const result = renderExplanation(new Error('boom'), '分区');
    for (const vague of VAGUE_PHRASES) {
      expect(result.reason).not.toBe(vague);
      expect(result.next).not.toContain(vague);
    }
  });

  it('非 Error 的抛出物也能生成可读原因', () => {
    const result = renderExplanation('字符串抛错', '分区');
    expect(result.reason).toContain('字符串抛错');
  });
});
