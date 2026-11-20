# 分层许可说明

> 本文件是人类可读的分层路由表。`LICENSE` 是 Apache-2.0 全文，`LICENSE-MIT` 是 MIT 全文。
> GitHub 只按 `LICENSE` 识别仓库主许可，因此显示为 Apache-2.0；MIT 覆盖的部分见下表。

本仓库按目录分层授权，只使用两种宽松许可证：**Apache License 2.0** 与 **MIT**。
许可全文见 [`LICENSE`](./LICENSE)（Apache-2.0）与 [`LICENSE-MIT`](./LICENSE-MIT)（MIT）。

Copyright (c) 2026 星玖工作室 Ntarstudio

---

## 零、默认归属（先看这条）

**下表未列出的、由本项目编写的文件，一律适用根 [`LICENSE`](./LICENSE)，即 Apache-2.0。**

这条兜底规则是必须的。只列目录而不写默认值，克隆者面对 `index.html`、
`vite.config.ts`、`package.json` 这类根级文件就无从判断归属，法律上等于没有授权。
需要相反结果的路径，必须显式写进下表——**不存在「靠猜」的路径**。

第三方组件不适用本兜底条款，按第五节处理。

---

## 一、分层映射

| 路径 | 许可 | 说明 |
|---|---|---|
| `src/services/` | **Apache-2.0** | ADB 设备服务层：应用、文件、显示、系统、电池、回滚 |
| `src/tools/` | **Apache-2.0** | 能力注册表与工具目录 |
| `src/core/transport/` | **Apache-2.0** | WebUSB 传输层 |
| `src/core/`（其余） | **MIT** | 会话、快照、存储、PWA、外壳 |
| `src/ui/` | **MIT** | 界面层 |
| `src/node/` | **MIT** | 命令行侧实现（含 MCP 服务端） |
| `src/main.tsx` `src/dev-preview.tsx` | **MIT** | 应用入口与开发预览入口 |
| `scripts/` | **MIT** | 构建、生成与校验脚本 |
| `skill/` | **MIT** | Agent Skill 定义 |
| `public/` | **MIT** | 站点静态资源（favicon、图标、manifest、Service Worker 模板） |
| `index.html` `dev-preview.html` | **MIT** | 页面入口 |
| `vite.config.ts` `tsconfig.json` `tsconfig.node.json` `package.json` `package-lock.json` `.gitignore` | **MIT** | 根级工程配置 |
| `.github/` | **MIT** | CI 与仓库配置 |
| 品牌名称、Logo、界面设计 | **保留所有权利** | 不随代码许可授予 |

> 本仓库**没有** `bin/` 目录：命令行入口是 `src/node/cli.ts`，由 `scripts/build-cli.mjs`
> 产出，产物不入库。旧版本文档曾把它写成 `bin/`，已一并更正。

## 二、Apache-2.0 的两条额外义务

设备操作层与能力注册表选 Apache-2.0 而非纯 MIT，是因为它多给两样东西：

1. **明示专利授权**（第 3 条）：贡献者授予你使用其专利的许可。
2. **NOTICE 保留义务**（第 4 条 d 项）：再分发时须保留 [`NOTICE`](./NOTICE) 中的归属声明。

除此之外与 MIT 一样宽松：可商用、可闭源、可修改、可再许可，**没有传染性**。

## 三、关于「为什么不用 AGPL」

本项目零服务端：没有后端、没有数据库，`dist/` 产物直接跑在用户浏览器里，本身就是可读的 JavaScript。
AGPL 第 13 条约束的是「通过网络提供服务」，这里没有服务可约束——想看实现，打开 DevTools 就有。
AGPL 在此只会劝退企业用户与 fork，收益为零。

## 四、商标

「Webroit」「星玖工作室」「Ntarstudio」等名称、Logo 与界面设计归星玖工作室所有。
Apache-2.0 与 MIT 只授予**代码**权利，不授予商标权。
修改版请更换品牌标识，或明确标注为非官方版本。

## 五、第三方组件

本项目依赖 25 个 npm 组件与 52 个平台相关二进制条目，全部为 MIT / ISC / BSD / Apache-2.0。
逐项披露见 [`NOTICE`](./NOTICE)。**没有任何 GPL / LGPL / AGPL / MPL 等 copyleft 组件。**

`node_modules/` 与 `dist/` 不入库，其中的第三方代码归各上游作者，不适用本仓库的分层授权。

## 六、再分发时须一并保留的文件

| 文件 | 依据 |
|---|---|
| `LICENSE`（Apache-2.0 全文） | Apache-2.0 第 4 条 a 项 |
| `LICENSE-MIT`（MIT 全文） | MIT 正文「须包含上述版权声明与许可声明」 |
| `NOTICE` | Apache-2.0 第 4 条 d 项 |
| 各源文件中已有的版权与许可声明 | Apache-2.0 第 4 条 b 项 |

本仓库**没有** `LICENSES/` 目录，许可全文只有根目录这两个文件。
