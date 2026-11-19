/**
 * 构建后处理：把预缓存清单与版本号写入 Service Worker。
 *
 * 为什么要在构建后写，而不是让 Service Worker 自己扫描：
 * Service Worker 只有在运行时才知道有哪些文件，而运行时扫描需要先
 * 请求一次目录 —— 静态托管没有目录列表接口。构建期是唯一能拿到
 * 完整产物清单的时机。
 *
 * 版本号取本次构建产物的内容指纹（所有文件名 + 大小的哈希），
 * 而不是时间戳：内容没变时版本号不变，用户不会收到无意义的更新提示。
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

/** 递归收集 dist 下的所有文件，返回相对路径（统一用 /） */
async function walk(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, acc);
    } else if (entry.isFile()) {
      acc.push(relative(DIST, full).split(sep).join('/'));
    }
  }
  return acc;
}

/**
 * 需要预缓存的文件：dist 里的全部文件，除 sw.js 自身。
 *
 * 为什么全量预缓存，而不是只缓存「首屏骨架」：
 *
 * 1. **体积不构成理由**。全部产物约 480 KB，其中图标占 200 KB，
 *    脚本与样式约 260 KB。只缓存骨架也只省下 73 KB 的 ADB 分包，
 *    换来的却是「离线时点连接设备直接失败」。
 * 2. **使用场景决定策略**。这个工具最需要离线能力的场合恰恰是
 *    机房、产线、飞机上 —— 那种地方没有网络，而设备就在手上。
 *    把「按需加载」当成省流量的手段，等于在最需要它的时候让它缺席。
 * 3. **更新成本不变**。版本号取产物指纹，任何一个文件变了版本号就变，
 *    旧缓存整体丢弃，不会出现新旧文件混用。
 *
 * sw.js 自身不预缓存：它是缓存策略的执行者，不是被缓存的对象，
 * 且它的 URL 必须能被浏览器直接更新到最新版本。
 */
function pickPrecache(files) {
  return files.filter((file) => file !== 'sw.js').sort();
}

/** 用产物清单算出版本指纹 */
async function fingerprint(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    const info = await stat(join(DIST, file));
    hash.update(`${file}:${info.size}\n`);
  }
  return hash.digest('hex').slice(0, 12);
}

async function main() {
  const files = await walk(DIST);
  const version = await fingerprint(files);
  const precache = pickPrecache(files);

  const swPath = join(DIST, 'sw.js');
  let source;
  try {
    source = await readFile(swPath, 'utf8');
  } catch {
    console.error('[build-sw] 找不到 dist/sw.js，请确认 public/sw.js 存在');
    process.exit(1);
  }

  if (!source.includes('__SW_VERSION__') || !source.includes('/* __PRECACHE__ */')) {
    console.error('[build-sw] dist/sw.js 缺少占位符，可能是被其他工具改写过');
    process.exit(1);
  }

  const next = source
    .replace('__SW_VERSION__', version)
    .replace('/* __PRECACHE__ */', precache.map((file) => `'./${file}'`).join(', '));

  await writeFile(swPath, next, 'utf8');

  console.log(`[build-sw] 版本 ${version}，预缓存 ${precache.length} 个文件：`);
  for (const file of precache) console.log(`  · ${file}`);
}

await main();
