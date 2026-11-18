/**
 * `errors.ts` 单元测试。
 *
 * 这一层的价值全在「能被分辨」：agent 靠 `instanceof UsageError` 决定
 * 是改参数重试还是放弃。改名、丢原型链都会让这个判断失效，
 * 且失效后不会报错，只会让 agent 做出错误决策，所以必须有断言守着。
 */

import { describe, expect, it } from 'vitest';
import { UsageError } from './errors';

describe('UsageError', () => {
  it('是 Error 的子类，可被 instanceof 捕获', () => {
    const error = new UsageError('参数缺失');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(UsageError);
  });

  it('name 固定为 UsageError，写日志时能与其他错误区分', () => {
    expect(new UsageError('x').name).toBe('UsageError');
  });

  it('保留原始 message', () => {
    expect(new UsageError('未知工具：foo').message).toBe('未知工具：foo');
  });

  it('有可用的 stack（便于定位调用点）', () => {
    expect(new UsageError('x').stack).toBeTruthy();
  });

  it('与其他 Error 不混淆', () => {
    expect(new Error('x')).not.toBeInstanceOf(UsageError);
  });
});
