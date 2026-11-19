/**
 * 错误文案翻译层的单测。
 *
 * 重点不在「每条规则都能命中」，而在两件容易出错的事：
 * 1. 规则顺序 —— 具体规则不能被通用规则先吃掉；
 * 2. 兜底 —— 认不出的错误也必须给出可执行动作，不能退回「未知错误」。
 */

import { describe, expect, it } from 'vitest';

import { VAGUE_PHRASES, explainError, messageOf } from '@/core/error-copy';

describe('messageOf', () => {
  it('取 Error 的 message', () => {
    expect(messageOf(new Error('设备已断开'))).toBe('设备已断开');
  });

  it('message 为空时退回 name', () => {
    const error = new Error('');
    error.name = 'AbortError';
    expect(messageOf(error)).toBe('AbortError');
  });

  it('字符串原样返回', () => {
    expect(messageOf('error: closed')).toBe('error: closed');
  });

  it('null / undefined 返回空串', () => {
    expect(messageOf(null)).toBe('');
    expect(messageOf(undefined)).toBe('');
  });

  it('对象序列化，循环引用时退回 String', () => {
    expect(messageOf({ code: 1 })).toBe('{"code":1}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(messageOf(cyclic)).toBe('[object Object]');
  });
});

describe('explainError 规则命中', () => {
  it('用户取消归为「已取消」而非故障，且可重试', () => {
    const result = explainError(new Error('用户已取消'));
    expect(result.reason).toContain('取消');
    expect(result.retry).toBe(true);
  });

  it('接口被占用优先于通用 error 规则', () => {
    const result = explainError(new Error('Failed to claim interface: already in use'));
    expect(result.reason).toContain('占用');
    expect(result.next).toContain('kill-server');
  });

  it('设备离线给出换线动作', () => {
    const result = explainError(new Error('error: device offline'));
    expect(result.reason).toContain('离线');
    expect(result.next).toContain('数据线');
  });

  it('未授权指向手机弹窗', () => {
    const result = explainError(new Error('error: device unauthorized'));
    expect(result.next).toContain('一律允许');
  });

  it('存储不足指向清理空间', () => {
    const result = explainError(
      new Error('Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]'),
    );
    expect(result.next).toContain('清理设备存储');
  });

  it('签名冲突不可重试，指向卸载旧版', () => {
    const result = explainError(new Error('INSTALL_FAILED_UPDATE_INCOMPATIBLE'));
    expect(result.retry).toBe(false);
    expect(result.next).toContain('卸载');
  });

  it('未知的 INSTALL_FAILED_ 子类也保留原文', () => {
    const result = explainError(new Error('Failure [INSTALL_FAILED_TEST_ONLY]'));
    expect(result.reason).toContain('INSTALL_FAILED_TEST_ONLY');
    expect(result.retry).toBe(false);
  });

  it('权限不足与命令不存在是两条不同的出口', () => {
    const denied = explainError(new Error('Permission denied'));
    const missing = explainError(new Error('sh: dumpsys: inaccessible or not found'));
    expect(denied.next).not.toBe(missing.next);
    expect(denied.next).toContain('USB 调试（安全设置）');
    expect(missing.next).toContain('替代命令');
  });

  it('超时可重试', () => {
    const result = explainError(new Error('ETIMEDOUT'));
    expect(result.retry).toBe(true);
    expect(result.next).toContain('重试');
  });

  it('连接中断提醒复查半成品结果', () => {
    const result = explainError(new Error('error: closed'));
    expect(result.reason).toContain('中断');
    expect(result.next).toContain('复查');
  });

  /*
   * 拔线中止用的是我们自己抛的原文「设备连接已结束」。
   * 它必须落在「连接中断」这一档，不能被「已取消」规则抢走 ——
   * 用户没有点中止，是线掉了：出口该是查数据线，不是「重新执行一次即可」。
   */
  it('拔线中止报「连接中断」，不混成「用户取消」', () => {
    const lost = explainError(new Error('设备连接已结束'));
    const cancelled = explainError(new Error('用户已取消'));
    expect(lost.kind).toBe('disconnected');
    expect(cancelled.kind).toBe('cancelled');
    expect(lost.next).toContain('数据线');
    expect(lost.next).not.toBe(cancelled.next);
  });

  it('未选择设备指向重新选择', () => {
    const result = explainError(new DOMException('未选择设备', 'AbortError'));
    expect(result.reason).toContain('没有选择设备');
  });

  it('不支持 WebUSB 给出浏览器要求', () => {
    const result = explainError(new Error('当前浏览器不支持 WebUSB'));
    expect(result.next).toContain('Chrome');
    expect(result.retry).toBe(false);
  });
});

describe('explainError 兜底', () => {
  it('认不出的原文照样进 reason，并给出通用排查顺序', () => {
    const result = explainError(new Error('weird vendor failure #42'));
    expect(result.reason).toBe('weird vendor failure #42');
    expect(result.next).toContain('重试一次');
    expect(result.raw).toBe('weird vendor failure #42');
  });

  it('没有任何文本时用传入的兜底句，仍带出口', () => {
    const result = explainError(null, '设备没有返回具体原因。');
    expect(result.reason).toBe('设备没有返回具体原因。');
    expect(result.next.length).toBeGreaterThan(10);
  });

  it('兜底结果里不出现零信息短语', () => {
    const result = explainError(new Error('???'));
    for (const vague of VAGUE_PHRASES) {
      expect(result.reason).not.toContain(vague);
      expect(result.next).not.toContain(vague);
    }
  });

  it('每条解释都同时有原因与出口，且出口是动作而非名词', () => {
    const samples = [
      'device offline',
      'unauthorized',
      'Permission denied',
      'ETIMEDOUT',
      'error: closed',
      'INSTALL_FAILED_INSUFFICIENT_STORAGE',
      'adb already in use',
      '完全不认识的报错',
    ];
    for (const sample of samples) {
      const result = explainError(new Error(sample));
      expect(result.reason.length).toBeGreaterThan(3);
      expect(result.next.length).toBeGreaterThan(10);
    }
  });
});
