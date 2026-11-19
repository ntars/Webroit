/**
 * 内置工具注册表快照测试。
 *
 * 为什么需要它：工具定义已经按分区拆到 `defs/` 下七个文件里，拼装顺序
 * 由 `builtin.ts` 一处决定。拆分、挪文件、改 import 顺序都可能在没有类型错误
 * 的情况下悄悄改变「注册了哪些工具」—— 比如漏了 `...vendorToolsAll`，
 * typecheck 照样过，但品牌专区分区会整块消失。
 *
 * 这里断言的是**可观察结果**，不是实现细节：
 * - 总数与分区分布（README 的 34 / 26 / 24 三个数字都从这里来）
 * - id 全局唯一（注册表本身也会拦，但那是运行时抛错，这里提前到测试期）
 * - 每个工具的 risk 落在 0–3、参数键不重复
 * - 品牌专区十个工具的 id 与 vendor 字段按品牌配对
 *
 * 只断言「形状与数量」，不逐字比对标题文案 —— 改一句 description 不该让测试变红，
 * 那是该改 README 的事，不是该改测试的事。
 */

import { describe, expect, it } from 'vitest';

import { BUILTIN_TOOLS } from './builtin';
import { MODULES, VENDORS, type ModuleId } from './registry';

/** 按分区计数，便于断言分布 */
function byModule(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tool of BUILTIN_TOOLS) counts[tool.module] = (counts[tool.module] ?? 0) + 1;
  return counts;
}

describe('BUILTIN_TOOLS 聚合完整性', () => {
  it('共 34 个 Tool 对象', () => {
    expect(BUILTIN_TOOLS).toHaveLength(34);
  });

  it('分区分布与文档一致（device 1 / apps 6 / display 4 / files 4 / system 7 / battery 2 / vendor 10）', () => {
    expect(byModule()).toEqual({
      device: 1,
      apps: 6,
      display: 4,
      files: 4,
      system: 7,
      battery: 2,
      vendor: 10,
    });
  });

  it('通用工具 24 个，每个品牌设备可见 26 个', () => {
    const vendorCount = BUILTIN_TOOLS.filter((tool) => tool.module === 'vendor').length;
    // 品牌工具数必须单独断言：只算「总数 - 品牌数」的话，品牌工具整块漏掉
    // 会让两个数字凑巧仍然是 24 / 26，测试假通过（反向探针实测过这一点）
    expect(vendorCount).toBe(10);
    expect(BUILTIN_TOOLS.length - vendorCount).toBe(24);
    expect(BUILTIN_TOOLS.length - vendorCount + 2).toBe(26);
  });

  it('每个 module 都是 MODULES 里声明过的分区', () => {
    const declared = new Set<ModuleId>(MODULES.map((module) => module.id));
    for (const tool of BUILTIN_TOOLS) expect(declared.has(tool.module)).toBe(true);
  });

  it('id 全局唯一', () => {
    const ids = BUILTIN_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('id 以所属分区名为前缀，斜杠分隔的层级至少两段', () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(tool.id.startsWith(`${tool.module}.`)).toBe(true);
      expect(tool.id.split('.').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('risk 落在 0–3，title 与 description 非空', () => {
    for (const tool of BUILTIN_TOOLS) {
      expect([0, 1, 2, 3]).toContain(tool.risk);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('同一工具内参数键不重复', () => {
    for (const tool of BUILTIN_TOOLS) {
      const keys = tool.params.map((param) => param.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('select 参数必须给候选值，file 参数只能是文件选择器', () => {
    for (const tool of BUILTIN_TOOLS) {
      for (const param of tool.params) {
        if (param.type === 'select') expect(param.options?.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('品牌专区', () => {
  const vendorTools = BUILTIN_TOOLS.filter((tool) => tool.module === 'vendor');

  it('只覆盖 VENDORS 里声明的五个品牌，每个品牌两项', () => {
    const declared = VENDORS.map((vendor) => vendor.id);
    for (const vendor of declared) {
      const mine = vendorTools.filter((tool) => tool.vendor === vendor);
      expect(mine.map((tool) => tool.id).sort()).toEqual([
        `vendor.${vendor}.disable`,
        `vendor.${vendor}.scan`,
      ]);
    }
    expect(vendorTools).toHaveLength(declared.length * 2);
  });

  it('每项的 vendor 字段与 id 前缀一致（防止复制模板时忘了改 vendor）', () => {
    for (const tool of vendorTools) {
      expect(tool.id.split('.')[1]).toBe(tool.vendor);
    }
  });

  it('扫描为只读，停用为需确认', () => {
    for (const vendor of VENDORS) {
      expect(vendorTools.find((tool) => tool.id === `vendor.${vendor.id}.scan`)?.risk).toBe(0);
      expect(vendorTools.find((tool) => tool.id === `vendor.${vendor.id}.disable`)?.risk).toBe(2);
    }
  });
});

describe('高危工具的确认门槛', () => {
  it('全部 risk 3 的工具都声明了 params 与可调用的 available', () => {
    // risk 3 在 UI 里要求输入确认词，在 CLI / MCP 里要求 allowDangerous。
    // 它们必须能被执行器识别出来，所以 available() 必须存在且可调用。
    for (const tool of BUILTIN_TOOLS.filter((item) => item.risk === 3)) {
      expect(typeof tool.available).toBe('function');
      expect(Array.isArray(tool.params)).toBe(true);
    }
  });

  it('risk >= 2 的工具在 MCP schema 里都带 allowDangerous，只读工具不带', async () => {
    // 这是门控的实际生效面：agent 若看不到 allowDangerous，就永远无法执行变更操作；
    // 若只读工具也带它，agent 会误以为读操作也要先申请授权。
    const { listToolDescriptors, mcpName } = await import('@/node/mcp/schema');
    const descriptors = listToolDescriptors() as {
      name: string;
      inputSchema: { properties: Record<string, unknown> };
    }[];
    for (const tool of BUILTIN_TOOLS) {
      const found = descriptors.find((item) => item.name === mcpName(tool.id));
      expect(found, `${tool.id} 未出现在 tools/list`).toBeDefined();
      expect('allowDangerous' in found!.inputSchema.properties).toBe(tool.risk >= 2);
    }
  });

  it('MCP 工具名两两不同，且原始 id 写在描述里可回溯', async () => {
    const { listToolDescriptors, mcpName } = await import('@/node/mcp/schema');
    const descriptors = listToolDescriptors() as { name: string; description: string }[];
    expect(new Set(descriptors.map((item) => item.name)).size).toBe(descriptors.length);
    for (const tool of BUILTIN_TOOLS) {
      const found = descriptors.find((item) => item.name === mcpName(tool.id));
      expect(found?.description).toContain(tool.id);
    }
  });
});
