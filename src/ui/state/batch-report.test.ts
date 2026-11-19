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
  countFailed,
  countOk,
  pickFailures,
  pickSkipped,
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

/*
 * 连接中途断掉是第三种结局，不是「失败」的变体。
 *
 * 这个区分来自实测：拔线时 `batch()` 的循环不响应中断，前一条抛错被 catch
 * 之后它会接着跑完剩下的，每条都等到 USB 超时。修了循环只是第一步 ——
 * 如果播报仍把「没发出去」算作「失败」，用户会去查那 26 个包的权限，
 * 而真正该做的是把线插回去。所以这一组用单测把两种含义焊死。
 */
describe('buildBatchReport：连接中断的剩余项', () => {
  /** 造一批：okCount 个成功，failCount 个真失败，其余未执行 */
  function mixed(total: number, okCount: number, failCount: number): BatchOutcome[] {
    return Array.from({ length: total }, (_, index) => {
      if (index < okCount) return { target: `com.ok.${index}`, ok: true, message: 'Success' };
      if (index < okCount + failCount) {
        return { target: `com.bad.${index}`, ok: false, message: 'Failure [DENIED]' };
      }
      return { target: `com.skip.${index}`, ok: false, skipped: true, message: '连接已中断' };
    });
  }

  it('pickSkipped 只取未执行项，不把真失败算进去', () => {
    const outcomes = mixed(5, 1, 1);
    expect(pickSkipped(outcomes).map((item) => item.target)).toEqual([
      'com.skip.2',
      'com.skip.3',
      'com.skip.4',
    ]);
    expect(countFailed(outcomes)).toBe(1);
  });

  it('摘要说「中途连接中断」并给出剩余数量，而不是把它们算作失败', () => {
    const report = buildBatchReport(mixed(6, 2, 0), '冻结');
    expect(report.tone).toBe('error');
    // 关键：不得出现「失败 4 个」这种把人往设备问题上引的说法
    expect(report.summary).not.toContain('失败 4 个');
    expect(report.summary).toContain('中途连接中断');
    expect(report.summary).toContain('剩余 4 个没有执行');
  });

  it('摘要给的是「插回线再来一次」，不是「去查这几个包」', () => {
    const report = buildBatchReport(mixed(4, 0, 0), '卸载');
    expect(report.summary).toContain('数据线');
    // 已完成的部分不能重复生效 —— 用户最怕的是一批操作跑两遍
    expect(report.summary).toContain('已完成的部分不会重复生效');
  });

  it('终端明细用「未执行」标记，与「失败」分开成行', () => {
    const report = buildBatchReport(mixed(4, 1, 1), '停用');
    const skippedLine = report.lines.find((line) => line.startsWith('[未执行]'));
    const failedLine = report.lines.find((line) => line.startsWith('[失败]'));
    expect(skippedLine).toBeDefined();
    expect(skippedLine).toContain('com.skip.2');
    // 真失败那条仍然逐条点名原因
    expect(failedLine).toContain('com.bad.1');
    expect(failedLine).toContain('DENIED');
  });

  it('未执行项超上限时折叠，但摘要里的总数仍是真实总数', () => {
    const report = buildBatchReport(mixed(MAX_LISTED_FAILURES + 6, 0, 0), '冻结');
    const skippedLine = report.lines.find((line) => line.startsWith('[未执行]'));
    expect(skippedLine).toContain(`共 ${MAX_LISTED_FAILURES + 6} 个`);
    expect(report.summary).toContain(`剩余 ${MAX_LISTED_FAILURES + 6} 个没有执行`);
  });

  it('全部未执行（第一条就断线）不会被当成全成功', () => {
    const report = buildBatchReport(mixed(3, 0, 0), '卸载');
    expect(report.tone).toBe('error');
    expect(report.summary).toContain('成功 0 个');
  });
});
