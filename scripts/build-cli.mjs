/**
 * 命令行程序打包。
 *
 * 与网页构建完全分开：
 * - 网页产物在 dist/，目标是浏览器
 * - 命令行产物在 bin/，目标是 Node，打进一个文件便于分发
 *
 * 为什么要打包而不是直接跑 tsc 产物：
 * 代码里用了 `@/` 路径别名，Node 原生不认；打成单文件后既解决了别名，
 * 也免去用户要装一堆 node_modules 才能用命令行。
 *
 * 顺带重新生成 Skill 的参数文档：那份文档必须与代码同步，
 * 放在这里生成最不容易被忘掉 —— 改完工具跑一次 build:cli 就对齐了。
 */

import { build } from 'esbuild';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'bin');

/** 两个入口：CLI 与 MCP Server */
const ENTRIES = [
  { in: 'src/node/cli.ts', out: 'webroit' },
  { in: 'src/node/mcp.ts', out: 'webroit-mcp' },
];

async function buildOne(entry) {
  const outfile = join(OUT, entry.out);
  await build({
    entryPoints: [join(ROOT, entry.in)],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    // Node 内置模块不打包；其余全部内联，产物可独立分发
    packages: 'external',
    alias: { '@': join(ROOT, 'src') },
    banner: {
      /*
       * 顺序很重要：shebang 必须是文件第一行，否则内核不认，会当成 sh 脚本执行
       * —— 现象就是 `syntax error near unexpected token`。
       * 第二行是给依赖里残留的 require 兜底：ESM 没有 require，
       * 个别包在运行时仍会调用它，用 createRequire 补上。
       */
      js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    logLevel: 'warning',
  });
  await chmod(outfile, 0o755);
  return outfile;
}

/**
 * 重新生成 Skill 的参数参考文档。
 *
 * 生成脚本本身用了 `@/` 别名，所以也要先打一次 bundle 才能跑 ——
 * 打完立刻删掉，不在仓库里留临时文件。
 */
async function generateSkillDocs() {
  const temp = join(ROOT, '.gen-skill-docs.tmp.mjs');
  try {
    await build({
      entryPoints: [join(ROOT, 'scripts/gen-skill-docs.mjs')],
      outfile: temp,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      packages: 'external',
      alias: { '@': join(ROOT, 'src') },
      logLevel: 'error',
    });
    process.env.WEBROIT_ROOT = ROOT;
    await import(`file://${temp}?t=${Date.now()}`);
  } finally {
    await rm(temp, { force: true });
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const entry of ENTRIES) {
    const outfile = await buildOne(entry);
    console.log(`已生成 ${outfile.replace(ROOT + '/', '')}`);
  }
  await generateSkillDocs();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
