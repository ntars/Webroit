/**
 * 生成 Skill 的参数参考文档。
 *
 * 为什么用脚本而不是手写：
 * 34 个工具、上百个参数，手写的文档一定会在某次改动后失效。
 * 更糟的是它失效时没人知道 —— agent 照文档传参，报错，然后怀疑工具。
 * 所以这份文档从 catalog 现算，改代码后重跑脚本即可。
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { catalogStats, toCatalog } from '@/tools/catalog';

/*
 * 根目录由调用方传入，不从 import.meta.url 推。
 * 原因：这个脚本会被 esbuild 打成临时 bundle 才能解析 @/ 别名，
 * 打包后 import.meta.url 指向 bundle 的位置，推算出来的根目录会错一层。
 * 显式传入比依赖相对位置可靠。
 */
const ROOT = process.env.WEBROIT_ROOT ?? process.cwd();

/** 风险等级对应的调用要求 */
const RISK_NOTE = {
  0: '直接调用',
  1: '直接调用',
  2: '需 `allowDangerous`',
  3: '需 `allowDangerous`',
};

/** 把参数渲染成一行说明（不含参数名，参数名由表格第一列承担） */
function renderParam(param) {
  const parts = [];
  parts.push(param.required ? '必填' : '可选');
  parts.push(`类型 ${param.type}`);
  if (param.default !== undefined) parts.push(`默认 \`${JSON.stringify(param.default)}\``);
  if (param.min !== undefined || param.max !== undefined) {
    parts.push(`范围 ${param.min ?? '—'} ~ ${param.max ?? '—'}`);
  }
  if (param.choices?.length) {
    parts.push(`取值 ${param.choices.map((choice) => `\`${choice.value}\``).join(' / ')}`);
  }
  return parts.join(' · ');
}

async function main() {
  const entries = toCatalog();
  const stats = catalogStats(entries);

  const lines = [
    '# Webroit 工具参数参考',
    '',
    '> 本文件由 `scripts/gen-skill-docs.mjs` 从代码自动生成，请勿手改。',
    '',
    `共 ${stats.total} 个工具：通用 ${stats.generic} 个，每台设备可用 ${stats.perDevice} 个，覆盖 ${stats.vendors} 个品牌。`,
    '',
    '风险分布：' +
      `只读 ${stats.risks[0]} · 可逆 ${stats.risks[1]} · ` +
      `需确认 ${stats.risks[2]} · 高危 ${stats.risks[3]}`,
    '',
    '## 索引',
    '',
  ];

  // 按分区做索引
  const byModule = new Map();
  for (const entry of entries) {
    const list = byModule.get(entry.moduleTitle) ?? [];
    list.push(entry);
    byModule.set(entry.moduleTitle, list);
  }
  for (const [moduleTitle, list] of byModule) {
    lines.push(`- **${moduleTitle}**：${list.map((entry) => `\`${entry.id}\``).join('、')}`);
  }
  lines.push('');

  // 逐个工具展开
  for (const [moduleTitle, list] of byModule) {
    lines.push(`## ${moduleTitle}`, '');
    for (const entry of list) {
      lines.push(`### \`${entry.id}\` · ${entry.title}`, '');
      lines.push(entry.description, '');
      lines.push(
        `- 风险：**${entry.riskLabel}**（${RISK_NOTE[entry.risk]}）`,
      );
      if (entry.vendorName) {
        lines.push(`- 仅限品牌：${entry.vendorName}`);
      }
      if (entry.params.length === 0) {
        lines.push('- 参数：无', '');
      } else {
        lines.push('', '| 参数 | 说明 |', '| --- | --- |');
        for (const param of entry.params) {
          const meta = renderParam(param);
          const desc = param.description ? `${meta}<br>${param.description}` : meta;
          lines.push(`| \`${param.key}\` | ${desc} |`);
        }
        lines.push('');
      }
    }
  }

  lines.push(
    '## 通用约定',
    '',
    '- 布尔参数写 `true` / `false`，不是 `1` / `0`（CLI 里要带等号：`--lock=true`）',
    '- 多个包名用逗号分隔：`--packages="com.a,com.b"`',
    '- 文件类参数传本地绝对路径',
    '- 风险 2 与 3 的工具必须显式放行：MCP 传 `allowDangerous: true`，CLI 加 `--allow-dangerous`',
    '',
  );

  const target = join(ROOT, 'skill/webroit/references/tools.md');
  await writeFile(target, lines.join('\n'), 'utf8');
  console.log(`已生成 ${target.replace(ROOT + '/', '')}（${entries.length} 个工具）`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
