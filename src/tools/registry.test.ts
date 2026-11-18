/**
 * `registry.ts` 单元测试。
 *
 * 注册表是「功能是否出现在界面上」的唯一判定处，两类判断错都会直接影响可用性：
 * - 品牌判定错 → 小米设备上冒出三星的清理项，或该出现的项不出现
 * - 分区可见性错 → 终端/操作记录入口被误藏（历史上真出过这个 bug）
 *
 * 注册表是模块级单例，用例里注册的工具一律带 `test.` 前缀的 ID，
 * 避免与内置工具撞名，也让出错时一眼看出是谁污染的。
 */

import { describe, expect, it } from 'vitest';
import type { DeviceCapabilities } from '@/core/session/device-session';
import {
  MODULES,
  VENDORS,
  allTools,
  detectVendor,
  findTool,
  registerTool,
  registryStats,
  toolsOfModule,
  vendorMeta,
  visibleModules,
  visibleTools,
  type Tool,
  type VendorId,
} from './registry';

/** 造一份设备能力快照，只覆盖用例关心的字段 */
function capabilities(overrides: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    sdk: 34,
    release: '14',
    brand: 'generic',
    model: 'Test Device',
    props: {},
    canWriteSecureSettings: true,
    canUseDumpsys: true,
    canUseWmSize: true,
    canUseWmDensity: true,
    canUseSettings: true,
    canUsePm: true,
    canUseCmdPackage: true,
    canUseScreenshot: true,
    canUseInput: true,
    canUseMonkey: true,
    canUseSync: true,
    vendorNote: null,
    ...overrides,
  };
}

/** 造一个最小可注册工具 */
function makeTool(id: string, module: Tool['module'], vendor?: VendorId): Tool {
  return {
    id,
    module,
    title: id,
    description: id,
    risk: 0,
    params: [],
    available: () => true,
    ...(vendor ? { vendor } : {}),
    run: async () => ({ summary: 'ok' }),
  };
}

describe('detectVendor', () => {
  it('按 ro.product.brand 判定', () => {
    expect(detectVendor(capabilities({ props: { 'ro.product.brand': 'Redmi' } }))).toBe('xiaomi');
    expect(detectVendor(capabilities({ props: { 'ro.product.brand': 'OPPO' } }))).toBe('oppo');
    expect(detectVendor(capabilities({ props: { 'ro.product.brand': 'samsung' } }))).toBe('samsung');
    expect(detectVendor(capabilities({ props: { 'ro.product.brand': 'vivo' } }))).toBe('vivo');
    expect(detectVendor(capabilities({ props: { 'ro.product.brand': 'HONOR' } }))).toBe('huawei');
  });

  it('brand 缺失时退回 manufacturer', () => {
    expect(
      detectVendor(capabilities({ props: { 'ro.product.manufacturer': 'OnePlus' } })),
    ).toBe('oppo');
  });

  it('brand 字段本身也参与判定', () => {
    expect(detectVendor(capabilities({ brand: 'iqoo' }))).toBe('vivo');
  });

  it('都匹配不上时归为 generic，不抛错', () => {
    expect(
      detectVendor(capabilities({ brand: 'acme', props: { 'ro.product.model': 'X1' } })),
    ).toBe('generic');
  });

  it('大小写不敏感', () => {
    expect(detectVendor(capabilities({ props: { 'ro.product.brand': 'POCO' } }))).toBe('xiaomi');
  });
});

describe('vendorMeta', () => {
  it('已知品牌返回元信息', () => {
    expect(vendorMeta('xiaomi')?.rom).toBe('MIUI · HyperOS');
  });

  it('generic 不在 VENDORS 列表里，返回 null', () => {
    // generic 是兜底值，没有展示信息，调用方必须自己处理 null
    expect(vendorMeta('generic')).toBeNull();
  });

  it('VENDORS 覆盖 5 个已知品牌', () => {
    expect(VENDORS).toHaveLength(5);
  });
});

describe('registerTool', () => {
  it('注册后能按 ID 取回', () => {
    const tool = makeTool('test.registry.basic', 'system');
    registerTool(tool);
    expect(findTool('test.registry.basic')).toBe(tool);
  });

  it('ID 重复时抛错，不允许静默覆盖', () => {
    registerTool(makeTool('test.registry.dup', 'system'));
    expect(() => registerTool(makeTool('test.registry.dup', 'system'))).toThrow(/工具 ID 重复/);
  });

  it('取不存在的 ID 返回 undefined', () => {
    expect(findTool('test.registry.missing')).toBeUndefined();
  });
});

describe('toolsOfModule / registryStats', () => {
  it('按分区过滤', () => {
    registerTool(makeTool('test.registry.m1', 'battery'));
    registerTool(makeTool('test.registry.m2', 'battery'));
    registerTool(makeTool('test.registry.m3', 'files'));
    expect(toolsOfModule('battery').map((tool) => tool.id)).toEqual([
      'test.registry.m1',
      'test.registry.m2',
    ]);
  });

  it('统计各分区数量，且总和等于工具总数', () => {
    const before = allTools().length;
    registerTool(makeTool('test.registry.s1', 'audit'));
    registerTool(makeTool('test.registry.s2', 'audit'));

    const stats = registryStats();
    expect(stats.audit).toBe(2);
    const sum = Object.values(stats).reduce((a, b) => a + b, 0);
    expect(sum).toBe(before + 2);
  });
});

describe('visibleTools', () => {
  it('非品牌分区不按品牌过滤', () => {
    registerTool(makeTool('test.registry.v1', 'display'));
    expect(visibleTools('display', capabilities())).toHaveLength(1);
  });

  it('品牌分区只留当前品牌的工具', () => {
    registerTool(makeTool('test.registry.vendor.xiaomi', 'vendor', 'xiaomi'));
    registerTool(makeTool('test.registry.vendor.samsung', 'vendor', 'samsung'));

    const onXiaomi = visibleTools('vendor', capabilities({ props: { 'ro.product.brand': 'Xiaomi' } }));
    expect(onXiaomi.map((tool) => tool.id)).toContain('test.registry.vendor.xiaomi');
    expect(onXiaomi.map((tool) => tool.id)).not.toContain('test.registry.vendor.samsung');
  });
});

describe('visibleModules', () => {
  it('viewOnly 分区无论有无工具都显示 —— 这是曾经丢过入口的地方', () => {
    const ids = visibleModules(capabilities()).map((module) => module.id);
    expect(ids).toContain('terminal');
    expect(ids).toContain('audit');
  });

  it('普通分区始终显示', () => {
    const ids = visibleModules(capabilities()).map((module) => module.id);
    for (const id of ['device', 'apps', 'display', 'files', 'system', 'battery']) {
      expect(ids).toContain(id);
    }
  });

  it('品牌分区无匹配工具时隐藏', () => {
    // 前面用例已注册了小米与三星工具，这里用 generic 设备验证「都不匹配 → 藏掉」
    const ids = visibleModules(capabilities({ brand: 'generic' })).map((module) => module.id);
    expect(ids).not.toContain('vendor');
  });

  it('预览模式（未连设备）时品牌分区也显示，避免访客以为没这功能', () => {
    const ids = visibleModules(capabilities(), true).map((module) => module.id);
    expect(ids).toContain('vendor');
  });

  it('返回顺序与 MODULES 定义顺序一致，侧边栏不会跳序', () => {
    const ids = visibleModules(capabilities(), true).map((module) => module.id);
    const expected = MODULES.map((module) => module.id).filter((id) => ids.includes(id));
    expect(ids).toEqual(expected);
  });

  it('每个分区都有 id / title / description / icon 四项', () => {
    for (const module of MODULES) {
      expect(module.id).toBeTruthy();
      expect(module.title).toBeTruthy();
      expect(module.description).toBeTruthy();
      expect(module.icon).toBeTruthy();
    }
  });
});
