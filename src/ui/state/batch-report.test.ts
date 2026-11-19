/**
 * 批量播报的单测。
 *
 * 重点不在「字符串拼得对不对」，而在三条曾经说不清的行为：
 * 全成功不该产明细、部分失败必须逐条点名、超量必须折叠并指路。
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_LISTED_FAILURES,
  MAX_TOAST_FAILURES,
  buildBatchReport,
  countOk,
  pickFailures,
  type BatchOutcome,
} from '@/ui/state/batch-report';

/** 造一批结果：前 okCount 个成功，其余失败 */
function makeOutcomes(total: number, okCount: number): BatchOutcome[] {
  return Array.from({ length: total }, (_, index) =>
    index < okCount
      ? { target: `com.ok.${index}`, ok: true, message: 'Success' }
      : { target: `com.bad.${index}`, ok: false, message: `Failure [ERR_${index}]` },
  );
}

describe('pickFailures', () => {
  it('只留失败项且保持原顺序', () => {
    const outcomes: BatchOutcome[] = [
      { target: 'a', ok: false, message: 'x' },
      { target: 'b', ok: true, message: '' },
      { target: 'c', ok: false, message: 'y' },
    ];
    expect(pickFailures(outcomes).map((item) => item.target)).toEqual(['a', 'c']);
  });

  it('全成功时返回空数组', () => {
    expect(pickFailures(makeOutcomes(3, 3))).toEqual([]);
  });
});

describe('countOk', () => {
  it('数出成功条数', () => {
    expect(countOk(makeOutcomes(5, 2))).toBe(2);
  });

  it('空结果记 0', () => {
    expect(countOk([])).toBe(0);
  });
});

describe('buildBatchReport', () => {
  it('全成功：success 语调且不产明细', () => {
    const report = buildBatchReport(makeOutcomes(4, 4), '冻结');
    expect(report.tone).toBe('success');
    expect(report.summary).toBe('4 个冻结完成');
    // 全成功还在终端刷 4 行「成功」是噪音 —— 用户刚看见进度条跑完
    expect(report.lines).toEqual([]);
  });

  it('部分失败：摘要点名失败目标、语调转 error', () => {
    const report = buildBatchReport(makeOutcomes(4, 2), '冻结');
    expect(report.tone).toBe('error');
    expect(report.summary).toContain('4 个冻结：成功 2 个，失败 2 个');
    // 失败项必须具名，只说「失败 2 个」等于没说
    expect(report.summary).toContain('com.bad.2');
    expect(report.summary).toContain('com.bad.3');
  });

  it('摘要指向界面真实存在的区域，不写「下方记录」这类无着落指代', () => {
    const report = buildBatchReport(makeOutcomes(2, 1), '卸载');
    expect(report.summary).toContain('命令输出');
    expect(report.summary).not.toContain('下方记录');
  });

  it('逐条明细带包名与原文', () => {
    const report = buildBatchReport(makeOutcomes(3, 1), '冻结');
    expect(report.lines).toHaveLength(2);
    expect(report.lines[0]).toContain('com.bad.1');
    expect(report.lines[0]).toContain('ERR_1');
  });

  it('失败原文的多行空白压成单行，避免撑乱终端排版', () => {
    const report = buildBatchReport(
      [{ target: 'com.x', ok: false, message: '  Failure [A]\n   reason: quota  ' }],
      '安装',
    );
    expect(report.lines[0]).toBe('[失败] com.x：Failure [A] reason: quota');
  });

  it('空原因不留白 —— 否则又变成「失败了但不知道为什么」', () => {
    const report = buildBatchReport([{ target: 'com.x', ok: false, message: '   ' }], '冻结');
    expect(report.lines[0]).toContain('设备没有返回原因');
  });

  it('失败数超上限时折叠并指路操作记录', () => {
    const total = MAX_LISTED_FAILURES + 5;
    const report = buildBatchReport(makeOutcomes(total, 0), '卸载');
    // 明细 = 上限条 + 1 条折叠说明
    expect(report.lines).toHaveLength(MAX_LISTED_FAILURES + 1);
    expect(report.lines.at(-1)).toContain('另有 5 条');
    expect(report.lines.at(-1)).toContain('操作记录');
  });

  it('摘要里的失败名单最多列 MAX_TOAST_FAILURES 个，超出用「等」收口', () => {
    const report = buildBatchReport(makeOutcomes(5, 0), '冻结');
    // 列出前几个后必须收口，否则提示条会被包名撑满
    expect(report.summary).toContain('等');
    const listed = report.summary.slice(0, report.summary.indexOf(' 等'));
    const count = listed.split('、').length;
    expect(count).toBe(MAX_TOAST_FAILURES);
  });
});
