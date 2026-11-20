**简体中文** | [English](./README_EN.md)

# Webroit

**插上数据线，打开网页，就能玩机。**

**Webroit** 是一个在浏览器里直接对 Android 设备执行 ADB 操作的玩机工具箱。它把「装驱动、配环境、敲命令」这一整层从用户侧删掉，只留下一个标签页：应用管理、文件传输、终端、显示调节、系统调校、电池诊断 —— 当前 26 项功能，全部在你的浏览器和那根数据线之间完成，不经过任何服务器。

![Status](https://img.shields.io/badge/status-v0.1%20prototype-8957e5?style=flat-square)
[![Version](https://img.shields.io/badge/version-0.1.0--dev-fb8500.svg?style=flat-square)](https://github.com/ntars/Webroit/releases)
[![GitHub license](https://img.shields.io/github/license/ntars/Webroit?style=flat-square)](./LICENSE)
[![GitHub Star](https://img.shields.io/github/stars/ntars/Webroit?style=flat-square)](https://github.com/ntars/Webroit/stargazers)
[![GitHub Fork](https://img.shields.io/github/forks/ntars/Webroit?style=flat-square)](https://github.com/ntars/Webroit/network/members)
![GitHub Repo size](https://img.shields.io/github/repo-size/ntars/Webroit?style=flat-square&color=3cb371)
[![GitHub Repo Languages](https://img.shields.io/github/languages/top/ntars/Webroit?style=flat-square)](https://github.com/ntars/Webroit/search?l=typescript)

[![WebUSB](https://img.shields.io/badge/WebUSB-required-4285F4.svg?style=flat-square)](https://developer.chrome.com/docs/capabilities/usb)
[![Chrome](https://img.shields.io/badge/Chrome-supported-4285F4.svg?style=flat-square&logo=googlechrome&logoColor=white)](https://www.google.com/chrome/)
[![Edge](https://img.shields.io/badge/Edge-supported-0078D7.svg?style=flat-square&logo=microsoftedge&logoColor=white)](https://www.microsoft.com/edge)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Preact](https://img.shields.io/badge/Preact-10.29-673AB8.svg?style=flat-square&logo=preact&logoColor=white)](https://preactjs.com/)
[![Backend](https://img.shields.io/badge/backend-none-2ea44f.svg?style=flat-square)](#)
[![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8.svg?style=flat-square)](#)
[![Telemetry](https://img.shields.io/badge/telemetry-none-2ea44f.svg?style=flat-square)](#)

| 项目 | 内容 |
|---|---|
| 产品 | Webroit |
| 版本 | 0.1.0-dev |
| 状态 | 可运行原型：26 项功能已实现并通过构建与类型检查，9 个功能分区含品牌差异分流（原生 Android 设备显示 24 项，品牌专区不出现） |
| 在线试用 | <https://ntars.github.io/Webroit/> |
| 仓库 | <https://github.com/ntars/Webroit> |
| 授权 | Apache-2.0 / MIT（分层） |
| 形态 | 浏览器单页应用（PWA，可安装、可离线打开） |
| 许可 | Apache-2.0 / MIT（「Webroit」名称与界面归星玖工作室 Ntarstudio） |
| 后端 | 无。静态托管，零服务端 |
| 代码规模 | 98 个源文件、20,806 行（含 CSS 与测试） |
| 产物规模 | 499 KB / 12 个文件，首屏 gzip 约 67 KB |
| 依赖 | 25 个组件，全部 MIT / ISC / BSD / Apache-2.0 |

---

## 一、项目名称与定位

> **仓库描述 / Description**：`Webroit —— 浏览器里的安卓玩机工具箱：WebUSB 直连 ADB 与 Fastboot，26 项功能已实现、152 项规划，数据不出本机 | An in-browser Android toolbox: ADB and Fastboot over WebUSB, 26 features shipped and 152 planned, all data stays local.`
>
> **话题标签 / Topics**（20 个，仅英文）：`adb`, `android`, `android-tools`, `browser`, `fastboot`, `ntarstudio`, `pwa`, `scrcpy`, `typescript`, `webusb`, `ya-webadb`, `webroit`, `preact`, `vite`, `static-site`, `client-side`, `privacy-first`, `no-backend`, `file-manager`, `screen-mirroring`


**名称**：Webroit。由 `Web` 与 `roit` 拼合的自造词，不承载缩写含义。选用自造词的唯一理由是检索唯一性——`WebADB` 一类通称已被多个同类站点使用，无法作为独立识别符。

**一句话定位**：把 Android 玩机所需的一切操作搬进浏览器，零安装、零驱动、零后端，数据不出本机。

**定位的三条边界**：

1. **它是工具箱，不是协议库**。底层用 Tango 实现 ADB，本项目交付的是玩机者能直接用的界面与流程，不是给开发者调用的 API。
2. **它是本地直连，不是远程控制**。设备必须用数据线接在你自己的电脑上，你自己在手机屏幕上点「允许」。不提供任何远程操控他人设备的路径。
3. **它是可审计的开源软件，不是黑箱服务**。全部代码在仓库里，全部依赖在 NOTICE 里，不上传任何数据。

> **关于命名**：立项初期曾用 `WebADB`，后主动弃用。原因是 `WebADB` 已是社区对「浏览器里的 ADB」这一品类的通称，`webadb.com`、`webadb.online`、`mirko-it/webadb` 等站点与项目都在使用，既无法作为独立识别符，也容易让人误以为本项目是同类站点的分支。现名 `Webroit` 是本项目专用标识，**与上述任何站点无关联**。

---

## 二、项目简介

### 2.1 背景

安卓玩机的门槛从来不在「会不会用命令」，而在**为了敲那几行命令所必须先完成的事**。

想给手机装个应用、看条日志、改个 DPI，你得先：找对版本的 Platform-Tools、配 PATH、在 Windows 上装 USB 驱动、在 Linux 上写 udev 规则、祈祷驱动别跟设备管理器打架。换了台电脑，全部重来。用别人的电脑，不敢装。

而真正让人放弃的，是那些「装完了还是连不上」的时刻——你分不清是线的问题、口的问题、驱动的问题，还是 `adb.exe` 还挂在后台占着接口。

### 2.2 要解决的问题

| 问题 | 具体表现 |
|---|---|
| 环境成本高 | 装工具、配路径、装驱动，一套流程占掉大半时间 |
| 环境不可移植 | 换电脑重来，公共电脑不敢动 |
| 命令记不住 | 知道要改 DPI，不记得 `wm density` 后面跟什么 |
| 工具碎片化 | 装包一个软件、投屏一个软件、日志又一个软件 |
| 风险不可见 | 抄来的命令不知道会改什么、能不能改回来 |
| 结果不可审计 | 闭源工具做了什么，用户无从得知 |

### 2.3 核心思路

**把「环境准备」整层删掉，把「玩机功能」做全。**

```
传统路径：  下载工具 → 配环境 → 装驱动 → 连设备 → 敲命令 → 查文档 → 再敲
Webroit：    打开网页 → 点连接 → 点功能
```

技术上，浏览器提供的 **WebUSB API** 让网页可以直接与 USB 设备通信，`@yume-chan/adb`（Tango）把 ADB 协议完整实现在 TypeScript 里，两者相加，浏览器就成了一台不需要安装任何东西的 ADB 客户端。

工程上，所有功能被抽象为**工具注册表**中的一个条目，每个条目自带参数描述。同一份描述同时驱动三件事：界面表单、脚本编排的原子步骤、插件扩展点。这是 152 个功能点能在单项目内做完的关键。

### 2.4 适用场景

| 场景 | 具体用法 |
|---|---|
| 个人玩机 | 停用预装、改 DPI、换动画倍率、抓日志、提包备份 |
| 开发调试 | 真机装包、实时日志、投屏操作、跨端复制粘贴 |
| 测试验收 | 多设备并行跑同一脚本、批量安装、批量截图比对 |
| 售后支持 | 远程指导用户打开网页接上手机，这边直接看设备报告 |
| 教学演示 | 学生不装 SDK，打开网页就能看到设备内部结构 |
| 临时借用 | 公共电脑上零安装完成一次操作，关掉不留痕 |

### 2.5 非目标

1. 不做云端 ADB 中继，不做远程控制平台。
2. 不做应用商店、不内置 APK 下载源。
3. 不做账号体系、不做云同步。
4. 不做 iOS / 鸿蒙刷机。
5. 不做「一键 root」。
6. 不做解锁 BL、绕过激活锁、绕过屏幕锁。
7. 不承诺 EDL / Odin / Amlogic 私有协议的成功率。

---

## 三、核心功能

### 3.1 当前已实现（v0.1）

9 个功能分区，其中 7 个承载 26 项工具卡片，2 个是不承载卡片的整块交互界面。`npm run build` 与 `tsc --noEmit` 全部通过。

| # | 分区 | 条目 | 内容 |
|---|---|---|---|
| V1 | 设备总览 | 1 | 自动采集硬件画像与实时状态；6 种模式重启 |
| V2 | 应用管理 | 6 | 列表、详情、启停、清数据、卸载与恢复、卸载保护、批量 |
| V3 | 显示与输入 | 4 | 分辨率/DPI 读写与还原、截屏、按键/点击/滑动/文字注入 |
| V4 | 文件传输 | 4 | APK 安装（含分卷）、双向传输、提包、目录浏览 |
| V5 | 系统调校 | 7 | 字体与动画倍率、锁屏时间、状态栏图标、沉浸模式、WiFi 验证修复、一键还原、应急重置 |
| V6 | 电池管理 | 2 | 状态读取与功耗采样、参数与充电来源模拟、精确还原 |
| V7 | 品牌专区 | 2 | 按品牌分流的可停用组件清单、批量启停 |
| — | ADB 终端 | 0 | 交互式 shell 会话，带工作目录、命令历史、3 条常驻快捷命令 |
| — | 操作记录 | 0 | 变更型操作的本地留底，可按状态筛选、导出 JSON |

终端与操作记录标 0 是因为它们不是「一组可执行操作」，而是「一整块交互界面」，没有 Tool 可注册（`ModuleMeta.viewOnly`）。设备总览标 1 是因为硬件画像与实际状态由视图进入即采集，不再单独放读取卡片。

**26 这个数字怎么来的**：`src/tools/builtin.ts` 最终导出 34 个 `Tool` 对象 —— 24 个直接声明，加品牌专区的 10 个。后者由 `vendorTools()` 按模板生成（`vendor.{id}.scan` 与 `vendor.{id}.disable`），5 个品牌各 2 个。`visibleTools()` 按当前设备品牌过滤，所以：

| 设备 | 可见工具数 | 说明 |
|---|---|---|
| 小米 / OPPO / vivo / 华为 / 三星 | 26 | 24 个通用 + 本品牌 2 个 |
| 原生 Android 或其他品牌 | 24 | 品牌专区不显示，少 2 个 |

因此「26」指**品牌设备上的可见数**，是文档通篇采用的口径。用 `grep -c "id: '" src/tools/builtin.ts` 得到 24，是因为 vendor 的两个 `id` 用模板字符串拼接，不匹配字面量。

**分区边界原则**：一个功能只出现在一个分区，不重复登记。
已经按「同一入口、同一前置条件、结果互补」合并过的典型例子：

| 合并前 | 合并后 | 合并理由 |
|---|---|---|
| 冻结 / 解冻 / 强制停止 | 应用启停（单卡片 + action） | 同一对象、同一前置条件，只是方向不同 |
| 修改分辨率 / 修改 DPI / 还原显示 | 修改显示参数（单卡片） | 都是 `wm` 命令，还原是它的反向操作 |
| 字体缩放 / 动画倍率 / 锁屏时间 | 修改系统参数（单卡片） | 都是 `settings put`，参数名不同而已 |
| 电量 / 温度 / 电压 / 充电来源模拟 | 模拟电池（单卡片） | 都是 `dumpsys battery set` 系列 |
| 设备信息卡片 + 设备状态按钮 | 只保留自动采集的视图 | 视图进页即读，不需要再点一次 |

后续新增功能前先查两件事：这个分区里有没有语义重叠的既有工具？如果有，优先加 `action` 参数而不是加新卡片。

### 3.2 改坏了怎么退回去

`settings put` 与 `wm` 类命令是**静默生效**的 —— 没有系统弹窗，改完界面立刻变化。把 DPI 调到 1000、字体调到 2 倍，界面会大到点不动按钮。这时候靠记忆回忆原值不现实，靠网上搜到的「默认值」更不现实（每个厂商都不一样）。

三道防线，从轻到重：

1. **自动快照**。所有 `settings put` / `wm` 写入在改之前先记原值，`一键还原设置` 按**逆序**回放。逆序是必须的：连着改三次 DPI（420 → 300 → 480），只有倒着退才能回到最初的 420。快照存 IndexedDB，刷新页面不丢；但只保留**本次会话**，跨会话回放陈旧值会算错。
2. **独立应急入口** `#/reset-display`。整页只有一个 462×64 的按钮，不套侧边栏、不用 em 单位。实测把根字号放大到 2.5 倍，按钮尺寸与位置完全不变 —— 因为这一页所有尺寸都用 px，不随系统缩放走。
3. **终端常驻快捷命令**。顶栏常驻 `wm size reset; wm density reset`，任何会话一点即执行，不依赖上面两条。

第 2、3 条的差别：快照还原的是「你上次设的值」，应急重置拉回的是「设备物理值」。改坏了用前者，改到没法操作了用后者。

### 3.3 品牌差异如何分流

同一件事在不同品牌上做法完全不同。以「关闭系统广告」为例：小米是停用 `com.miui.systemAdSolution`，OPPO 是 `com.coloros.oppoguardelf`，华为走 `hw_app_ad` 开关。若混在通用应用管理里，用户面对几千个包名根本不知道该动哪个。

所以品牌独有能力统一收进 **品牌专区**，由 `detectVendor()` 按 `ro.product.brand` / `ro.product.manufacturer` 判定，工具注册表的 `visibleTools()` 再按当前品牌过滤。结果是：小米设备上永远不会看到三星的组件清单，原生 Android 设备则不显示该分区。

目前覆盖小米、OPPO/一加/真我、vivo/iQOO、华为/荣耀、三星五个品牌。每项组件都标注客观功能名与实际影响，例如：

```
系统广告服务        com.miui.systemAdSolution     影响：系统应用内的推广位会消失，不影响应用功能
使用数据统计        com.miui.analytics            影响：不再上报使用行为，系统更新不受影响
快应用框架          com.miui.hybrid               影响：快应用无法启动，普通应用不受影响
```

刻意不提供「一键全关」——清单里有「系统更新」这类停掉会影响安全的项，一个按钮全关掉出问题后无从追溯。给的是「仅停用推荐项」，推荐项均为纯推广与统计类。

### 3.4 规划中的完整蓝图

14 个模块、152 个功能条目（含每项的风险等级、所需权限、依赖命令、降级策略）为设计蓝图。以下为设计目标，尚未实现：

| # | 模块 | 条目 | 概要 |
|---|---|---|---|
| M1 | 连接管理 | 7 | USB 直连、无线配对、多设备、健康探测、故障诊断 |
| M2 | 设备信息 | 12 | 硬件画像、电池、存储、网络、传感器、Root/BL 状态、报告导出 |
| M3 | 应用管理 | 18 | 列表、详情、图标、启停、卸载、多 APK 安装、提包、权限、批量 |
| M4 | 文件管理 | 14 | 浏览、上传下载、编辑、回收站、权限、检索、大文件排行、双栏对比 |
| M5 | 终端 | 9 | 多标签 PTY、分屏、历史、快捷命令、root 会话、导出、报错解释 |
| M6 | 屏幕与输入 | 11 | 投屏、反向控制、音频、录屏、截图、按键/文本注入、手势回放、剪贴板 |
| M7 | 系统设置与调校 | 16 | 分辨率、DPI、字体、动画、状态栏、沉浸、深色、语言、时区、DNS、快照还原 |
| M8 | 性能与监控 | 10 | CPU 各核、频率、内存、进程、温度、GPU、帧率、网络、电池功率 |
| M9 | 日志与诊断 | 9 | 实时 logcat、高亮告警、暂停回看、崩溃记录、dumpsys、bugreport、诊断向导 |
| M10 | 备份与恢复 | 7 | 应用数据、APK 全量、目录备份、索引、校验、加密 |
| M11 | 脚本与自动化 | 8 | 可视化编排、原子步骤库、录制、条件循环、定时、多设备下发、报告 |
| M12 | Fastboot 与刷机 | 12 | 变量读取、分区刷写、大镜像分片、临时启动、擦除、A/B 切换、update.zip |
| M13 | 高级与实验 | 9 | 属性编辑、分区镜像、电池模拟、弱网模拟、唤醒锁、私有协议入口 |
| M14 | 平台能力 | 10 | PWA、离线、插件系统、工具注册表、i18n、主题、可达性、审计 |

### 3.5 亮点功能选介

以下几项明确分为两组：已在 v0.1 落地的，与仍是设计目标的。这样分开写，是为了不让规划听起来像现状。

**已经能用的：**

**设置快照与逆序回滚**。所有 `settings put` / `wm` 类改动，执行前自动记录原值到 IndexedDB。点「一键还原设置」按逆序回放，设备回到本次会话开始前的状态。配 `#/reset-display` 应急入口与终端常驻快捷命令，三层兜底。

**能力分级与二次确认**。每个功能标注「只读 / 可逆 / 需确认 / 高危」四档，界面据此改变形态：只读直接执行，可逆提供还原路径，需确认弹确认框，高危要求手打「确认」二字才放行。风险 3 级的门槛不受偏好开关影响 —— 卸载、清数据、进 EDL 没有撤销路径，这个门不能由用户设置关掉。变更型操作同步写入本地审计记录，可按状态筛选、导出 JSON。

**PWA 离线能力**。Service Worker 预缓存 11 个文件（构建产物的全部，Service Worker 自身除外），断网后重新打开页面仍能完整渲染，包括按需加载的 ADB 传输层；可安装为桌面应用，从桌面图标直接进入。更新不自动接管，发现新版本时顶部提示，由用户决定何时刷新。这一项已在 v0.1 落地，细节见 4.7 与 5.14。

**还在规划里的：**

**多设备并行面板**。三台手机同时接着，各自一个会话、各自一份工具状态、各自一条进度条，批量脚本一次下发，逐台汇报成败。当前实现是单设备会话，架构上 `DeviceSession` 已按「可多实例」设计，但 UI 尚未支持切换。

**工具注册表扩展到脚本编排**。每个功能是一个 `Tool` 对象：`{ id, risk, params, available(), run() }`，表单由 `params` 自动生成 —— 这部分已实现。规划中的是把它同时用作脚本编排的原子步骤与插件接口，让「加功能不改框架」这句话覆盖到脚本层。

**Fastboot 也在这个页面**。ADB 只负责「设备开着的时候」，刷机得靠 Fastboot。计划接入 `android-fastboot`，从「看信息」到「刷分区」走同一条链路。当前未实现。

---

## 四、核心特性

### 4.1 零安装、零驱动、零后端

**价值**：解决「装了半小时还没连上」这个最大的放弃点。

**实现方式**：浏览器 WebUSB 直连设备 USB 接口，`@yume-chan/adb` 在 TypeScript 里实现完整的 ADB 协议（握手、RSA 认证、流复用、sync 文件协议）。整个应用是静态文件，无服务端进程。

**差异化**：桌面 GUI 工具箱要装、要管理员权限、只跑 Windows；命令行要配环境；本项目打开 URL 即可，Windows / macOS / Linux / ChromeOS / Android 手机同一套代码。

**证据**：产物为静态 `dist/`，部署到任意 HTTPS 静态托管即可运行；`grep -r "http" dist/` 中不含任何本项目自有的后端地址；无数据库、无容器、无部署密钥。

### 4.2 数据不出本机

**价值**：设备操作涉及个人信息、账号、文件内容，任何上传都不可接受。

**实现方式**：无后端即无上传路径。设备通信走 USB，本地状态走 IndexedDB / localStorage，无任何网络上报调用，不加载第三方 CDN 资源。

**差异化**：多数在线 ADB 站点虽自称「前端处理」，但依赖 CDN 与统计脚本，实际外联行为难以审计。本项目**完全不采集**，且产物可 `grep` 验证。

**证据**：`grep -rE "gtag|sentry|umami|plausible|google-analytics" dist/` 结果为空。产物中全部绝对 URL 共 5 条，均为 SVG 命名空间标识或写入设备设置的字符串，不产生任何浏览器请求（逐条列表见 13.2）。

**关于离线缓存的额外说明**：Service Worker 只缓存同源资源，跨域请求一律不接管。因此不存在「离线缓存把数据回传到第三方」的路径，这一点可以从 `sw.js` 的 `isCacheable()` 直接读出：非 GET、非 http(s)、非同源，三者任一即 return。

**关于 AI 调用场景的说明**（4.8 引入的能力，此处的承诺范围需要说清）：上面两条证据针对的是**网页版**，它至今仍然零外联。新增的命令行与 MCP Server 同样不联网 —— 它们只调用本机 `adb`。所谓「AI 调用」是 agent 在自己的进程里调用模型，模型请求由 agent 发起，不由本项目发起，本项目也不会把设备数据写进任何请求。换言之：**本项目任何一部分都不联网，联网的是使用方**。

### 4.3 风险分级，而不是「功能堆满」

**价值**：玩机工具真正的危险不是功能少，而是功能危险却不告知。

**实现方式**：`Tool.risk` 四档（只读 / 可逆 / 需确认 / 高危）决定 UI 形态 —— 需确认的弹确认框，高危的额外要求手打「确认」二字，且这一档不受偏好开关影响。`available()` 返回 `false` 或一句中文原因，不可用的工具直接在卡片描述里说明为什么不可用，而不是等用户点了才报错。风险 2 级以上操作同步写入本地审计记录（含实际执行的命令）。

**差异化**：同类工具普遍是「点一下就执行」，出错后用户不知道发生了什么。本项目把「这一步会改什么、能不能改回来」写在按钮旁边，并且真的留了还原路径 —— 改了能退，退不了能查。

**当前边界**：没有任何「权限声明」字段 —— `available()` 依据的是连接时探测到的真实设备能力（`wm` / `pm` / `settings` / `dumpsys` 是否可用），比静态声明的权限更准。也没有内置的关键包保护名单：`apps.uninstall` 对系统应用会走 `pm uninstall` 并由系统自身拒绝，不额外加白名单，因为白名单容易过期且会挡住合理的高级用法。这两项都在规划中。

**证据**：`Tool.risk` 与 `available()` 见 `src/tools/registry.ts`；审计写入见 `src/core/audit.ts` 与 `src/ui/components/ToolCard.tsx`。

### 4.4 一份参数描述，四处复用

**价值**：功能点如果每个都写界面 + 写脚本步骤 + 写插件接口，工作量翻三倍且易不一致。

**实现方式**：`Tool.params` 用 schema 描述参数（`text` / `number` / `select` / `boolean` / `file` / `textarea`），界面表单由 schema 渲染 —— 加一个工具只需往注册表塞一个对象，`ModuleView` 与 `ToolCard` 一行都不用改。

同一份 schema 现在供**四处**使用，全部从 `BUILTIN_TOOLS` 现算，没有一处是手写的第二份：

| 使用方 | 消费方式 | 代码位置 |
|---|---|---|
| 网页表单 | 按 `type` 渲染 `ParamField` | `src/ui/components/ToolCard.tsx` |
| 命令行 | `run <tool-id> --key=value`，按 schema 转换类型与校验范围 | `src/node/runtime.ts` 的 `coerceParams()` |
| MCP Server | 转成 JSON Schema 供 agent 读取 | `src/node/mcp/schema.ts` 的 `toInputSchema()` |
| Skill 文档 | 生成 `references/tools.md` 的参数表 | `scripts/gen-skill-docs.mjs` |

**差异化**：同类项目的脚本功能往往是「另写一套命令解释器」（如 BAT 语法子集），两套逻辑必然漂移。本项目只有一个真源 —— 所以「网页里能做的，命令行与 agent 也能做，参数含义完全一致」这句话是可以验证的，不是承诺。

**当前边界**：脚本编排与插件系统尚未实现。规划中的做法是让编排器把 `Tool` 当原子步骤调用，而不是另立一套 DSL。

**证据**：`src/tools/registry.ts` 是唯一注册点；`src/tools/catalog.ts` 是唯一目录派生点；`src/ui/components/ToolCard.tsx` 的 `ParamField` 是唯一的表单渲染实现。

### 4.5 文件传输走流式，不落盘中转

**价值**：500 MB 的 APK、1 GB 的文件，任何 base64 中转或临时落盘都会成为瓶颈与失败点。

**实现方式**：文件推送走 `sync` 协议，直接把 `File.stream()` 通过 `TransformStream` 边计数边喂给 `sync.write()`，全程不整体读进内存；拉取时读 `ReadableStream` 并按块累计进度。传输均支持 `AbortSignal` 中断，且 abort 时会主动 `dispose()` sync 会话 —— 不 dispose 会让后续所有文件操作卡死。逐块进度不写进终端，而是经 `src/ui/state/progress.ts` 降频后交给终端面板底部的进度条：不足 120 ms 且未跨 1 个百分点的中间态直接丢弃，100 MB 的包 1600 次回调最终只渲染一百多次。

**差异化**：常见实现为了省事用 base64 字符串传递，体积膨胀 33%，大文件容易截断，内存峰值高。

**一处需要说明的取舍**：截图走的是 `screencap -p` 写入设备临时文件 + `sync` 读回，读回后立即删除临时文件，而不是 `exec-out screencap -p` 直接收字节流。原因是 `exec-out` 在部分老设备与部分 ROM 上不可用，而 `screencap` + `sync` 的兼容面更广。代价是设备上会短暂存在一个临时文件。

**证据**：`src/core/transport/driver.ts` 的 `write` / `read` 全程流式；`src/services/display.service.ts` 的 `screenshot()` 在读回后校验 PNG 魔数，并保证 `removeTemp` 一定会执行。

### 4.6 说清楚「为什么不能用」

**价值**：玩机工具最常见的挫败是「按钮能点，点了没反应」。

**实现方式**：连接后并行跑 9 条**只读**探针（`wm size`、`wm density`、`settings get`、`pm list packages -s`、`cmd package help`、`dumpsys battery`、`which screencap`、`input --help`、`which monkey`），单条失败不影响其他条，结果存成 `DeviceCapabilities`。工具的 `available()` 据此返回 `true` 或一句**中文原因**，不可用的卡片直接置灰并在描述位显示原因，用户不必点进去才发现不行。

有一条能力探测是刻意没做的：`WRITE_SECURE_SETTINGS` 没法用只读命令验证 —— 只能按 Android 版本加已知厂商策略推断，实际失败时由工具层兜底提示。这是「探测不到就不假装知道」的取舍。

**差异化**：多数工具把命令丢过去，失败就显示原始终端报错，用户看不懂。

**证据**：`DeviceCapabilities` 与 9 条探针见 `src/core/session/device-session.ts`；厂商补充提示（小米需开「USB 调试（安全设置）」等）见同文件 `vendorHint()`。

### 4.7 离线可用，且更新不打断操作

**价值**：设备操作常在无网络的场合进行（机房、产线、飞机上）。同时，工具类应用最忌讳「用到一半页面自己刷新」。

**实现方式**：Service Worker 分三档策略 —— 导航请求走网络优先（要最新版本），带内容哈希的构建产物走缓存优先（文件名变了才叫变），其余静态资源走增量更新。版本号取**产物指纹**（所有文件名与大小的 SHA-256 前 12 位），内容没变版本号就不变。

发现新版本时**不自动接管**：预缓存完成后停在 waiting，顶部显示一条窄横条，由用户点击才激活并刷新。理由见 5.14。

**差异化**：常见做法是用 `skipWaiting()` + `clientsClaim()` 自动切版，用户会在下一次操作时突然发现界面换了、状态丢了。本项目的取舍是「宁可晚一点更新，也不在操作中途换掉资源」。

**证据**：`npm run verify:offline` 会做真断网验证 —— 装好 Service Worker、优雅关掉浏览器、关掉本地服务器、再用同一个 profile 重启浏览器打开同一地址。断言三件事：预缓存覆盖 `dist/` 全部产物、两个缓存桶按路径分对、断网重开后导航项数量与在线一致且按需加载的 ADB 分包仍能取到。预缓存清单为 11 个文件：入口 JS、CSS、HTML、manifest、5 个图标、ADB 传输层分包。**ADB 分包也预缓存**——它的使用场景本来就是「设备在手边但没有网络」，省下 73 KB 却让离线时点「连接设备」直接失败，是拿最需要的能力换最不需要的流量。

### 4.8 同一套能力，三种调用方式

**价值**：网页只能人用。但「批量冻结这批预装」「把这台机器的 DPI 调回去」这类事，脚本和 AI agent 做起来比人快得多。功能如果只能通过点击触发，就等于把它的用途限制在「有人盯着屏幕」的场景里。

**实现方式**：把传输层抽成一份接口 `DeviceDriver`，网页侧用 WebUSB 实现，命令行侧用 `child_process` 调本机 adb 实现。`ShellContext` → services → 34 个工具全部只依赖接口，因此**业务逻辑一行都没重写**，两种传输上是同一份代码。

由此得到三种入口：

| 入口 | 面向 | 启动方式 |
|---|---|---|
| 网页 | 人 | 打开 https://ntars.github.io/Webroit/ ，WebUSB 直连，不需要本机 adb |
| 命令行 | 脚本 / 终端里的开发者 | `webroit run display.read --json` |
| MCP Server | AI agent | stdio 传输，35 个工具（34 功能 + 设备列举）自动注入 |

**为什么不是「在网页里加个聊天框」**：那只是把模型塞进页面，用户还得自己打开页面、自己插线。真正的需求是让**外部** agent 能直接读设备状态、执行操作，所以做成 MCP Server 与 CLI，让 agent 在自己的环境里调用。

**风险门控如何跨入口保持一致**：网页靠弹确认框（高危还要求手打「确认」），命令行与 MCP 没有 UI，改成显式传参 —— 风险 2 级以上的工具必须带 `allowDangerous: true` / `--allow-dangerous`，否则直接拒绝。这一层在 `gateTool()` 里只有一份实现，三个入口共用。

**证据**：接口见 `src/core/transport/types.ts`；两种实现分别是 `src/core/transport/driver.ts`（WebUSB）与 `src/node/adb-driver.ts`（本机 adb）；`tsconfig.node.json` 把 `services` / `tools` / `core` 一并纳入检查，只要共享层误用 `document`、`localStorage` 之类的浏览器 API，Node 侧编译立刻报错 —— 这是「共享层真的可共享」的机械保证，不靠自觉。

**必须说清的边界**：WebUSB 只能在浏览器里运行，任何外部进程都走不了那条通道。所以命令行与 MCP 的前提是本机已装 platform-tools，且 `adb devices` 能看到设备。这与网页版「零安装」的卖点相反，是两条各自成立的路径，不是替代关系。另外，网页版仍然零外联；新增的外联只发生在 agent 调用模型时，与本项目无关（见 4.2 的补充说明）。

---

## 五、设计细节与工程取舍

本章只写**代码里确实存在**的做法，并标出哪些是设计意图但尚未落地。

### 5.1 并发读流，避免死锁

**问题**：`adb shell` 的 stdout 与 stderr 是两个独立管道。只读 stdout 而不管 stderr，当 stderr 缓冲填满时，设备端进程会阻塞在写操作上，整个命令挂死。这是 ADB over USB 类项目最隐蔽的 bug。

**做法**：`ShellContext.shell()` 同时订阅 stdout 与 stderr 回调，两者并行接收，最后统一判断退出码。

这一条有实测支撑：早期版本串行读流时，「安装 APK」在包名报错的情况下会卡死而非返回错误，改成并发后消失。

### 5.2 同毫秒的多条记录必须能正确逆序

**问题**：设置快照要按**逆序**回放才能还原到最初值。如果按 `Date.now()` 排序，同一毫秒内写入的多条记录彼此无法区分先后，`Array.sort` 会保持原序 —— 也就是**没有逆序**。DPI 连改三次（420 → 300 → 480），还原时会退到 300 而不是 420。

**做法**：快照带上单调递增的 `seq`，排序键用 `seq` 而非 `at`。IndexedDB 读回时也按 `seq` 复排，并防御旧记录缺 `seq` 的情况（`undefined` 参与减法得 `NaN`，而 `Array.sort` 遇 `NaN` 行为未定义）。

**验证**：压测用例写入 50 条同毫秒记录，还原顺序严格逆序，全部通过。

### 5.3 审计的命令窗口不能靠时间戳划分

**问题**：操作记录要写「这次操作执行了哪些命令」。若用 `commandsSince(Date.now())` 划窗口，下一次操作落在同一毫秒时，就会把上一次的最后一条命令算进来。这不是理论问题 —— 测试中实际出现了「停用应用」的记录里带着上一条 `wm density` 命令。

**做法**：`ShellContext` 维护命令环形缓冲（上限 200 条）与自增序号 `commandSeq`。操作开始前取 `commandMark()`，结束后用 `commandsSince(mark)` 取出水位之后的命令。序号是整数比较，不存在精度问题。

环形缓冲的记录**不受「显示命令回显」偏好影响**：用户关掉回显只是不想看屏幕上的命令，不等于不想留审计。

### 5.4 `settings get` 返回 null 时的逆操作

**问题**：读取一个未设置过的 `settings` 键会返回字符串 `null`。若要还原，直接把它写回去会得到一个值为 `"null"` 的设置项，比不设置更糟。

**做法**：`settingsInverse()` 判断原值为空或 `null` 时，把逆操作翻译成 `settings delete`，而不是 `settings put ... null`。

```ts
export function settingsInverse(scope: string, key: string, original: string): string {
  const value = String(original ?? '').trim();
  if (!value || value === 'null') return `settings delete ${scope} ${key}`;
  return `settings put ${scope} ${key} ${quote(value)}`;
}
```

### 5.5 DPI 改坏了怎么办

改 DPI 最怕界面巨大到点不到「重置」按钮。三道防线，从轻到重：

1. **改前自动快照**。所有 `settings put` / `wm` 写入在改之前先读原值存入 IndexedDB（`src/core/snapshot.ts`），点「一键还原设置」按 `seq` 逆序回放。快照只保留**本次会话** —— 跨会话回放陈旧值会算错。
2. **URL 直达应急入口**，两种写法都认：`#/reset-display` 与 `?reset-display`。整页只有一个按钮，不套侧边栏。这一页所有尺寸**全部用 px**，不用 em/rem。实测把根字号放大到 2.5 倍（24px → 40px），按钮仍为 462×64，位置不变，无横向滚动。「返回主界面」会**同时清掉两处标记**（`hash` 与查询串）再撤回视图 —— 只清一处的话，从查询串进来的人点完地址变了、页面不动，等于被锁在逃生页里；这一点由 `verify:docs` 的五项断言守着。
3. **终端顶栏常驻快捷命令** `wm size reset; wm density reset`，任何会话一点即执行，不依赖上面两条。

这一页的「当前连接状态」是三态（已连接 / 连接中… / 未连接），且与主界面共用同一条连接链路（`src/ui/state/connect.ts`）——包括断线监听，所以拔线后它不会继续显示「已连接」。

第 1 条与第 2、3 条的区别：快照还原的是「你上次设的值」，应急重置拉回的是**设备物理值**。改坏了用前者，改到没法操作了用后者 —— 快照本身也可能记录的是错值。

关于输入范围：服务层对 DPI 的硬限制是 72–1600，对分辨率是 100–16384。没有做「超出常用区间需勾选风险」这类交互，因为合法 DPI 因设备而异（低分屏 160 正常，高分屏 560 也正常），固定区间拦截反而会挡住合理用法。替代做法是把「改错可还原」做成常驻能力。

### 5.6 分区可见性不能用「工具数 > 0」判定

**问题**：终端与操作记录是「一整块交互界面」，没有 Tool 可注册，工具数恒为 0。早期 `visibleModules()` 只判断品牌分区，结果这两个入口被当成空分区隐藏了。

**做法**：`ModuleMeta` 增加 `viewOnly` 标记。带此标记的分区无条件显示，不参与工具数判定。

这是一个真实的 bug，由逐个分区的 DOM 断言发现（9 个分区中 2 个 `nav: false`），不是推断出来的。

### 5.7 输入校验与转义

| 输入 | 处理 |
|---|---|
| 空字符串 | 表单层拦截，不发送命令 |
| 负数或超范围数值 | 参数 `min` / `max` 校验拦截 |
| 含空格 / 中文 / 引号的值 | 统一走 `quote()` 转义，不拼接裸字符串 |
| 包名 | `assertPackageName()` 白名单校验，防止把命令拼进包名位 |
| 偏好设置里的脏数据 | `sanitize()` 逐字段校验，非法值退回默认，不让 UI 崩 |

`sanitize()` 是防御式设计的核心：localStorage 里的内容可以被用户手动改写，也可以被旧版本写入。每个字段都做类型与范围检查，而不是直接信任 `JSON.parse` 的结果。

### 5.8 页面关闭就是断开，不假装能做到

浏览器标签即会话。关闭标签、刷新页面，USB 会话必然断开。这是 WebUSB 的硬限制。

处理：不承诺「后台继续执行」；文档中明确写出这一限制，而不是让用户自己发现。**未实现**：长任务期间的「请勿关闭页面」提示、文件传输断点续传 —— 这两项在路线图中。

### 5.9 本地 `adb.exe` 抢占接口

WebUSB 与桌面 `adb` 服务抢同一个 USB 接口。连接失败且错误指向接口占用时，连接面板直接给出具体命令：

| 平台 | 操作 |
|---|---|
| Windows | 任务管理器结束 `adb.exe` |
| macOS / Linux | `adb kill-server` |

**不尝试在页面内杀进程** —— 浏览器没有这个权限，做不到就不要在 UI 上摆一个假按钮。

### 5.10 终端输出合并，避免刷屏

连续同频道的文本会被合并成一行再渲染。`ls` 一个几百项的目录时，逐行渲染会让界面明显卡顿；合并后行数减少一个数量级。终端总行数上限 2000，超出裁掉最旧。

### 5.11 主题跟随系统

默认跟随 `prefers-color-scheme`，用户可手动锁定明/暗。不引入主题框架，只用 CSS 自定义属性：`--bg-base`、`--text-primary`、`--accent` 等 82 个变量，切换即换根节点的 `data-theme`。

`auto` 模式下监听 `matchMedia` 的 `change` 事件，用户在系统里改暗色后本页即时跟随，不需要刷新。

### 5.11a 配色只取黑白灰

背景、文字、边框、强调色全部取自中性灰阶，一个色相都不引入。信息层级只靠明度差与字重表达，不靠颜色。

| 层次 | 深色 | 浅色 |
|---|---|---|
| 画布 | `#141414` | `#ededed` |
| 侧边栏（下沉） | `#101010` | `#e6e6e6` |
| 卡片（纸面） | `#1e1e1e` | `#fcfcfc` |
| 抬升层 | `#252525` | `#ffffff` |
| 主文字 | `#ececec` | `#191919` |
| 次文字 | `#b3b3b3` | `#4a4a4a` |
| 三级文字 | `#949494` | `#656565` |
| 描边 | `#3a3a3a` | `#d8d8d8` |
| 控件描边 | `#7c7c7c` | `#838383` |
| 强调（实底） | `#ececec` 配 `#191919` 字 | `#191919` 配 `#ffffff` 字 |

两点取舍：

1. **强调色本身是灰的**。深色主题下强调色是浅灰、文字取深；浅色主题下反过来。按钮、选中态、进度条都靠这组反色形成焦点，不靠蓝。
2. **语义色保留极低饱和度**。成功 / 警告 / 危险仍用绿 / 琥珀 / 红，因为这三个是状态判断，不是品牌表达 —— 全灰会让「命令失败」和「操作成功」在视觉上无法区分。它们的饱和度压到刚好能辨色相的程度。

**控件描边为什么单独一档**：`--border-default` 是半透明白，压在输入框的 `#101010` 填色上只有 1.84:1，控件边界等于看不见；`--border-strong` 在深色下比它更暗，hover 反而像被禁用。WCAG 1.4.11 要求可交互控件与相邻颜色至少 3:1，所以单独设 `--border-control`，只为表单承担这件事，不为了一个输入框把全局描边一起加重。

### 5.11b 对比度实测（WCAG AA）

80 对色全部达标，数字由 `npm run verify:theme -- --markdown` 现场算出，非手写。取最紧的一对（弹层 `--bg-overlay` 是所有背景里最亮的一层）：

| 前景 | 深色最低 | 浅色最低 | 门槛 |
|---|---|---|---|
| `--text-primary` | 11.82:1 | 14.09:1 | 4.5:1 |
| `--text-secondary` | 6.66:1 | 7.10:1 | 4.5:1 |
| `--text-tertiary` | 4.60:1 | 4.67:1 | 4.5:1 |
| `--success` | 6.70:1 | 4.94:1 | 4.5:1 |
| `--warning` | 6.61:1 | 4.74:1 | 4.5:1 |
| `--danger` | 4.82:1 | 4.96:1 | 4.5:1 |
| `--terminal-info` | 5.51:1 | 5.68:1 | 4.5:1 |
| `--accent-contrast` on `--accent` | 14.88:1 | 17.58:1 | 4.5:1 |
| `#ffffff` on `--danger-solid` | 5.44:1 | 6.19:1 | 4.5:1 |
| `--border-control` on `--bg-sunken` | 4.56:1 | 3.04:1 | 3:1 |
| `--switch-knob` on `--switch-track-off` | 4.25:1 | 3.36:1 | 3:1 |

这套约束由 `npm run verify:theme` 机器校验：检查所有非语义 token 的色度是否接近 0、强调色方向是否与主题相反、以及上面这张矩阵里的每一对色是否达标。早期它只测 4 对色，`--text-tertiary`、语义色、终端配色、控件描边全在盲区里，盲区里恰好藏着两个真缺陷（浅色三级文字只有 3.90:1、浅色开关关态的滑块与轨道只有 1.74:1）。现已改成矩阵：前景与背景各自枚举，任意一对不达标就失败，新增 token 只要进清单就自动被覆盖。

### 5.12 危险按钮不做成主色

L2/L3 操作的确认按钮不使用主色调，改用中性色 + 明确的动词（「确认卸载 com.example.app」而不是「确定」）。降低误点概率的有效手段不是弹窗，是让危险动作看起来就不像「下一步」。

风险 2 级与 3 级的差别在交互上明确分开：2 级弹确认框，3 级还要手打确认词，**且 3 级不受「关闭二次确认」偏好影响** —— 关掉偏好只降低 2 级的摩擦，不降低 3 级。

### 5.13 中文优先的文案

所有错误提示先写「发生了什么」，再写「你可以做什么」。例：

> 无法连接设备：USB 接口已被其他程序占用。
> Windows 请在任务管理器结束 `adb.exe`；macOS 与 Linux 请执行 `adb kill-server`，然后重新连接。

工具不可用时不是把报错抛给用户，而是在卡片上直接写明原因（由 `available()` 返回的中文字符串）。

### 5.14 Service Worker 不自动接管

发现新版本时**不调用 `skipWaiting()` 自动切版**。理由：用户可能正在执行一条设备操作，中途把资源换掉会造成界面与设备状态不一致。

做法：预缓存完成后停留在 waiting 状态，顶部显示一条窄横条「新版本已就绪，刷新后生效」，由用户点击才 `postMessage('skip-waiting')` 并刷新页面。

`install` 阶段也不做原子失败：单个文件预缓存失败只 warn，不让整个 Service Worker 安装失败 —— 否则用户会永久停留在旧版本上。

### 5.15 开发环境不注册 Service Worker

`registerServiceWorker()` 首行判断 `import.meta.env.PROD`。开发时若注册了 Service Worker，它会缓存 Vite 的模块请求，改代码不生效，排查起来极其费时。

注册失败（无痕模式、旧版浏览器、非安全上下文）一律静默 warn，不影响主功能 —— 连接设备本来就不依赖 Service Worker。

---

---

## 六、技术栈与依赖清单

版本号一律取自 `package-lock.json` 的实际解析结果（lockfileVersion 3，2026-11-15 生成）。运行 `npm install` 后若版本变动，本节与 [NOTICE](NOTICE) 需同步更新。

### 6.1 核心技术栈

| 层 | 选型 | 版本 | 选择理由 |
|---|---|---|---|
| 构建 | Vite | 7.3.8 | 原生 ESM 开发服务器，冷启动快；产物为干净的多 chunk |
| 语言 | TypeScript | 5.9.3 | strict 全开，`exactOptionalPropertyTypes` 关闭以便配置对象可省略字段 |
| UI 运行时 | Preact | 10.29.8 | 3.6 KB gzip，与 React 同构 API，无虚拟 DOM 开销顾虑 |
| 状态管理 | 自研 signal | 46 行 | 全局状态只有十来项，引入 MobX / Zustand 不划算 |
| 样式 | 原生 CSS + 自定义属性 | 5 份表、206 行令牌 | 无构建期扫描，产物可读，主题切换只改 `data-theme` |
| 路由 | hash 路由 | 约 20 行 | 静态托管无需服务端 rewrite，应急页靠 `#/reset-display` 直达 |
| ADB 协议 | `@yume-chan/adb` | 2.6.4 | TypeScript 实现的完整 ADB，含 sync 协议与 RSA 认证 |
| 离线 | 手写 Service Worker | — | 不用 Workbox：缓存策略只有三档，手写 200 行比引入依赖更可控 |

### 6.2 运行时直接依赖（6 个）

全部随产物分发给最终用户，均为未修改的发布版本。

| 包 | 版本 | 版权方 | 许可证 | 官方地址 | 用途 |
|---|---|---|---|---|---|
| `@yume-chan/adb` | 2.6.4 | Simon Chan | MIT | <https://github.com/yume-chan/ya-webadb> | ADB 协议：握手、RSA 认证、流复用、sync 传输 |
| `@yume-chan/adb-daemon-webusb` | 2.3.2 | Simon Chan | MIT | <https://github.com/yume-chan/ya-webadb> | WebUSB 传输后端 |
| `@yume-chan/adb-credential-web` | 2.1.0 | Simon Chan | MIT | <https://github.com/yume-chan/ya-webadb> | RSA 密钥持久化到 IndexedDB |
| `@yume-chan/stream-extra` | 2.6.1 | Simon Chan | MIT | <https://github.com/yume-chan/ya-webadb> | 流工具（BufferedReadableStream 等） |
| `@yume-chan/struct` | 2.3.2 | Simon Chan | MIT | <https://github.com/yume-chan/ya-webadb> | 二进制结构体序列化 |
| `preact` | 10.29.8 | Preact contributors | MIT | <https://github.com/preactjs/preact> | UI 运行时 |

### 6.3 运行时传递依赖（4 个）

不直接 import，由上述 6 个包引入。

| 包 | 版本 | 版权方 | 许可证 | 引入者 | 用途 |
|---|---|---|---|---|---|
| `@yume-chan/async` | 4.2.2 | Simon Chan | MIT | `@yume-chan/adb` | 异步工具（AutoDisposable 等） |
| `@yume-chan/event` | 2.0.0 | Simon Chan | MIT | `@yume-chan/adb` | 事件派发 |
| `@yume-chan/no-data-view` | 2.0.0 | Simon Chan | MIT | `@yume-chan/adb` | 零拷贝视图操作 |
| `@types/w3c-web-usb` | 1.0.14 | DefinitelyTyped contributors | MIT | `@yume-chan/adb-daemon-webusb` | WebUSB 的 TypeScript 类型声明 |

`@types/w3c-web-usb` 虽名为 `@types`，但它是 `dependencies` 而非 `devDependencies`，因为 `@yume-chan/adb-daemon-webusb` 在运行时依赖其类型形状。

### 6.4 构建期依赖（15 个）

不进入 `dist/` 产物，不随应用分发。

| 包 | 版本 | 版权方 | 许可证 | 用途 |
|---|---|---|---|---|
| `vite` | 7.3.8 | Evan You 与 Vite contributors | MIT | 开发服务器与构建 |
| `typescript` | 5.9.3 | Microsoft Corporation | Apache-2.0 | 类型检查（`tsc --noEmit`） |
| `@types/node` | 24.19.2 | DefinitelyTyped contributors | MIT | Node API 类型（构建脚本使用） |
| `esbuild` | 0.28.2 | Evan Wallace | MIT | Vite 内置的转换器 |
| `rollup` | 4.68.3 | Rich Harris | MIT | Vite 内置的打包器 |
| `postcss` | 8.5.33 | Andrey Sitnik | MIT | CSS 处理管线 |
| `nanoid` | 3.3.20 | Andrey Sitnik | MIT | 内部 ID 生成 |
| `picocolors` | 1.1.1 | Alexey Raspopov | **ISC** | 终端着色 |
| `picomatch` | 4.0.7 | Jon Schlinkert | MIT | glob 匹配 |
| `fdir` | 6.5.0 | thecodrr | MIT | 文件遍历 |
| `tinyglobby` | 0.2.17 | Superchupu | MIT | 轻量 glob |
| `source-map-js` | 1.2.2 | Valentin Semirulnik | **BSD-3-Clause** | Source Map 解析 |
| `fsevents` | 2.3.3 | fsevents contributors | MIT | macOS 文件监听（可选，仅 Darwin） |
| `@types/estree` | 1.0.10 | DefinitelyTyped contributors | MIT | ESTree AST 类型 |
| `undici-types` | 7.24.6 | Node.js contributors | MIT | fetch 相关类型 |

### 6.5 平台相关可选二进制（52 个条目，2 个家族）

`esbuild` 与 `rollup` 各带 26 个平台专用的原生二进制包（`@esbuild/*` 与 `@rollup/rollup-*`），覆盖 aix / android / darwin / freebsd / linux / netbsd / openbsd / openharmony / sunos / win32 等平台与架构。npm 按当前平台只安装其中一个，其余在锁文件中标记为 `optional`。

这两族全部为 MIT 许可证，版权方分别为 Evan Wallace（esbuild）与 Rich Harris（rollup）。不逐个列举，完整清单见 `package-lock.json`。

### 6.6 许可证汇总

| 许可证 | 数量 | 组件 |
|---|---|---|
| MIT | 22 | 除下表三项外的全部 |
| ISC | 1 | `picocolors` |
| BSD-3-Clause | 1 | `source-map-js` |
| Apache-2.0 | 1 | `typescript` |

合计 25 个非平台相关组件。四种许可证均为宽松许可（MIT / ISC / BSD / Apache-2.0），与本项目自身的 Apache-2.0 / MIT 完全兼容，不存在冲突。

**没有随包分发的二进制组件**。早期规划中的 `scrcpy-server`（Apache-2.0，Romain Vimont）因投屏功能尚未实现，当前不包含在仓库与产物中。

### 6.7 明确不引入

| 不引入 | 理由 |
|---|---|
| React / Vue | 体积与本项目预算冲突；Preact 提供同构 API 且 3.6 KB gzip |
| UI 组件库（Ant / MUI 等） | 体积大、风格不可控，与 Apple HIG 取向冲突 |
| CSS 框架（Tailwind 等） | 构建期扫描与「产物可读」目标有张力 |
| 图标库 | 全部图标手写 SVG path：9 个分区图标 + 若干界面图标 + 1 个 favicon，合计不到 3 KB |
| 字体文件 | 用系统字体栈，不下载任何 webfont |
| axios / lodash | 原生 `fetch` 与 ES2022 足够 |
| Workbox | 缓存策略只有三档，手写比配置更短 |
| 任何统计 / 监控 SDK | 与「零遥测」承诺冲突 |

完整依赖树（含传递依赖与平台二进制）见 [NOTICE](NOTICE)。

---

## 七、安装与部署

### 7.1 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 20 | CI 使用 20 LTS，本地开发实测于 22.22.2 |
| 包管理器 | npm ≥ 10 | 项目提供 `package-lock.json`，建议用 `npm ci` |
| 浏览器（开发/使用） | Chrome / Edge / 其他 Chromium 内核 | 非 Chromium 内核无 WebUSB 实现 |
| 协议 | HTTPS 或 `localhost` | WebUSB 要求安全上下文 |

### 7.2 本地开发

```bash
git clone https://github.com/ntars/Webroit.git
cd Webroit
npm ci
npm run dev
```

打开终端输出的地址（默认 `http://127.0.0.1:8124`）。`localhost` 与回环地址属于浏览器认可的信任来源，无需 HTTPS。

无可用设备时，可打开 `dev-preview.html` 使用 mock 服务浏览界面。

### 7.3 生产构建

```bash
npm run typecheck  # 浏览器侧与 Node 侧各跑一次 tsc
npm run lint       # ESLint 9 扁平配置，含 no-explicit-any
npm test           # vitest 单元测试，纯函数层，无需浏览器与真机
npm run build      # tsc --noEmit → vite build → 注入 Service Worker
npm run preview    # 本地预览构建产物
```

`build` 是三步串联，第三步不可省略：`dist/sw.js` 在注入前带有 `__SW_VERSION__` 占位符，未经注入的版本无法注册。单独执行 `vite build` 会得到不可用的 Service Worker。

`npm test` 跑的是 `src/**/*.test.ts`，共 15 个文件、254 个用例，全部落在不碰 DOM 的纯函数层（另有确认门槛的 7 个用例在 `/ui/state/confirm`、批量播报的 23 个用例在 `/ui/state/batch-report`）（`/core/utils`、`/core/shell`、`/core/snapshot`、`/core/transport/stream`、`/core/error-copy`、`/tools/registry`、`/tools/builtin`、`/node/errors`、`/ui/state/progress`、`/ui/routing/route`、`/ui/components/error-boundary-copy`、`/ui/state/confirm`、`/ui/state/batch-report`、`/ui/hooks/use-focus-trap`）。测试与被测文件同目录，改代码时测试就在旁边。

其中 `src/tools/builtin.test.ts` 是注册表快照测试：工具定义按分区拆到 `src/tools/defs/` 下七个文件后，拼装顺序只由 `builtin.ts` 一处决定，漏掉一行展开符号（比如忘了 `...vendorToolsAll`）typecheck 照样通过，但品牌专区分区会整块消失。该测试锁住 34 / 26 / 24 三个数字、分区分布、id 唯一性与品牌配对。

### 7.3a 一致性校验

十份脚本把「文档说的」「配色该是怎样」「四档屏宽下能不能用」「提示语说不说得清」「确认弹层拦不拦得住」「断线会不会停手」「键盘焦点会不会跑出弹层」「操作记录清空是不是也走了同一套门槛」和「代码实际的」对齐，避免读者拿到过期数字、改一次样式就把手机端弄坏，或者把一句没用的报错丢给用户。

```bash
npm run verify:docs     # README 的记录 vs 仓库现状（需先 build）
npm run verify:theme    # 配色是否仍为纯黑白灰、对比度是否达标（需先 build）
npm run verify:layout   # 375 / 768 / 1024 / 1440 四档宽度的溢出与触控（需先 build）
npm run verify:copy     # 四类情形的提示是否都给出「原因 + 下一步」，批量失败明细有没有出口
npm run verify:confirm  # 确认弹层：请求 → 弹层 → 点击 → Promise 兑现，含六档视口高度（需 Chrome）
npm run verify:batch    # 批量播报：摘要真的进了提示条、明细真的成了独立行（需 Chrome）
npm run verify:cancel   # 两种停法：拔线立刻停手且剩余项标「未执行」，点「中止」也能停到底层（需 Chrome）
npm run verify:focus    # 三处浮层的 Tab 焦点是否真的被锁在里面、关闭后是否还给触发按钮（需 Chrome）
npm run verify:audit    # 操作记录：新记录立刻上屏、清空走站内弹层而非原生对话框、清空后留一条自述（需 Chrome）
```

`verify:docs` 逐项核对可以从仓库现状重算的事实：源文件数与行数、产物文件数与体积、各 chunk 的 gzip 大小、工具数量（26 / 24 / 34 三个口径）、品牌数、`any` 的分布、单元测试文件数与用例数、SW 预缓存清单、对比度色对、偏好面板的「字段 → 挂载 → 主题落 DOM → 文档口径」四环、中英文档的章节数是否一致。它已在 CI 中作为构建后的一步运行，不一致就让部署失败。

`verify:theme` 启动无头 Chrome 读取真实计算样式，检查所有非语义 token 的色度（确认没有混入彩色）、强调色方向（深色主题必须浅、浅色主题必须深）、以及全部前景 × 全部背景的对比度矩阵（80 对色，含终端配色、强调实底反色、控件描边与开关的 3:1 门槛）。加 `-- --markdown` 会额外打印两份可直接粘进文档的实测表格，数字全来自同一次测量，改完配色重跑一次即可，不必手抄。它不进 CI —— 需要 Chrome 环境，作为本地改色后的自检项更合适。

`verify:layout` 同样起无头 Chrome，但量的是几何：四档宽度 × 全部分区 × 折叠 / 展开 / 连接步骤弹层 / 偏好设置弹层 / 抽屉六种状态，逐一检查横向溢出、元素越界、被 `overflow-x:hidden` 裁掉、以及中心点被别的图层挡住。窄屏下另查两件事：可点区域是否 ≥ 44px，抽屉展开后点遮罩和按 Esc 能否关掉。越界判定基准取「最近裁剪祖先的右边缘」而不是视口 —— 侧边栏占掉左侧 236px 之后，按视口比会漏掉已经被裁掉的那截。它已进 CI，和 `verify:docs` 一样是构建后的一步。

`verify:confirm` 量的是确认弹层的纵向几何。前八组走行为链路（请求 → 弹层 → 打确认词 → 点击 → Promise 兑现 → Esc → 并发挤占），第九组换成**视口高度扫描**：812×375 手机横屏、667×320 横屏叠工具栏、568×320 小屏横屏、375×300 分屏小窗、768×1024 平板竖屏、1440×900 桌面六档，每档断言卡片不越出视口上下边界、标题可见且未被遮挡、两个按钮用 `elementFromPoint` 都能命中；宽屏三档另断言卡片宽度不超过 420px。为什么高度要单测：`.confirm-sheet` 的 420px 管横向，而这一层会失控的是纵向 —— 卡片高由文案、输入框、目标清单堆出来，实测手机横屏下 341px、分屏小窗下 360px，都比视口高，症状是标题跑到屏幕外、连「取消」都够不着，只能刷新页面逃出去。两处修法各管一半：`.confirm-overlay` 补 `overflow-y:auto` 且卡片改用 `margin:auto` 居中（`align-items:center` 在溢出时会把多出的高度往两头等分，向上溢出的那截永远滚不到），`detail` 的限高由固定 96px 改为 `min(240px, 22vh)`。四项反向探针逐条打红：退回 `align-items` 居中、删卡片 `max-height`、删正文 `overflow-y`、删 420px 上限。

`verify:copy` 守的是「每句失败提示都得有用」，外加「这些提示真的出得来」。它分十段：一段把 `src/core/error-copy.ts` 真跑一遍，对「未连接设备 / 无工具结果 / 命令失败 / 设备断开」四类共 17 条真实原文逐条断言——原因非空、下一步是可执行动作、不出现「操作失败」「未知错误」这类零信息短语、原始报错必须保留；另一半静态扫源码，抓两种绕过翻译层的写法：把异常直接塞进 `<p>{error}</p>`，以及各处自己写 `instanceof Error ? x.message : String(x)`。后者本身无害，但散落十几处就意味着没人负责「翻译成下一步」这一步。第三段守的是反馈通路：数出全部 `toast(` 调用点，再确认存在订阅 `toasts` 信号的组件、该组件确实被 `App.tsx` 渲染，且应急重置页那条提前 `return` 的分支也挂上了它 —— 文案写得再清楚，没有渲染层就等于没写。第四段守的是传输进度通路，结构与第三段同构：数出 `reportProgress(` 与 `progressSink` 的真实调用点，确认存在用 `useSignal(progress)` 订阅的组件、该组件被 `App.tsx` 渲染，并额外断言「逐块进度不得再写进终端文本」—— 传输时每 64 KB 回调一次，100 MB 的包约 1600 次，`pushOutput` 的 80 ms 合并窗口会把它们拼进同一个 DOM 节点，宽度撑到几万像素。第五段守的是更前面一步 —— **渲染本身就炸了的时候用户看到什么**：Preact 在渲染期抛错会一路向上抛，找不到边界就把整棵子树从 DOM 卸掉，实测某个分区算错一个字段，切进去后主区域只剩一张连接提示条、切到别的分区也不恢复。所以这一段断言四环：错误边界组件实现双钩子（`getDerivedStateFromError` + `componentDidCatch`）且带重试与复位键、分区渲染确实包在里面、外壳渲染 `<App />` 时也有边界、`unhandledrejection` 与 `error` 两个全局事件都听得见；外加一条反向禁令：兜底块不得使用「出错了」这类零信息短语 —— 界面已经坏掉时，用户唯一能看到的就是这几行字。不需要浏览器，已进 CI。第六段守的是「同一件事从哪个入口进来，门槛都一样」：`gateFor()` 是唯一的门槛判定、`runMutation()` 内部必须真的 `await askConfirm()` 并用 `audited()` 包住执行、动作规格表里凡是名字带 uninstall / clearData 的动作必须记为 risk 3，同时用一张**只读方法白名单**反向扫描视图层 —— 名单外的一切服务调用都算绕过治理层。用白名单而不是禁用词表，是因为新增一个变更方法时「默认不许在视图里直接调」，漏一次就等于放行一条无确认无审计的路径。第七段守的是「问完之后结果说不说得清」：批量操作的部分失败曾经只报「成功 3 个、失败 2 个」并附一句「逐条原因见下方记录」，而下方没有任何记录 —— 失败原因躺在 `BatchResult.message` 里，视图层数完成功个数就把它扔了。所以这一段断言播报由 `buildBatchReport()` 从结果数组算出（摘要进提示条、明细逐条进终端），并反向检查每个 `reportBatch()` 调用点都没有拿 `.length` 当播报依据；另加一条形状禁令：出现「见下方」时必须紧跟一个「」包起来的真实区域名，否则就是在把用户指去一个不存在的地方。同一段还守着「说得清之后要看得见」：`indexOutcomes()` 把结果数组折成「行 → 标记」，两个批量视图（应用列表、品牌专区）都要消费它并在行上落 `data-outcome` —— 只播报不落行，用户读完终端还得拿包名回 300 行列表里逐个捞回来。不需要浏览器，已进 CI。第八段守的是「说清结果之前，那批操作得先停下来」：拔线时 `batch()` 的 for 循环曾经没有任何中断判据 —— 正在跑的那条会失败，catch 记成一条失败，然后循环毫不犹豫开始下一条，后面 7 条命令一条条发往已经死掉的 USB 链路，每条都等到超时。这一段断言五环：连接收尾时真的调了 `abort()`（且必须在清空 `services` **之前**，否则那个 ShellContext 再没人能触发）、批量循环里有 `aborted` 判据、正在执行的那条调用被 `raceAbort()` 包过（数据线都拔了，谁来兑现底层 spawn 的 Promise）、**`shell()` 自身也把信号 race 上**（这一处收口覆盖 services 层全部 76 处命令调用，单条冻结、改分辨率、传文件都靠它，光守住两条批量路径不够）、剩余项标 `skipped` 且播报层真的按它筛而不是往「失败」里塞。第四环还会反向禁止「raceAbort 调了但信号传空」这种形状对、行为不对的写法。第九段接着守另一条取消源 —— **用户自己点「中止」**：拔线是连接级（一次 `abort()` 整条会话作废，不可逆），点中止只是不想跑这一条，用它会把之后每一个操作都弄成立刻失败。所以卡片走 `ShellContext.runScoped()` 登记操作级作用域，作用域内发出的命令自动组合这个信号，结束即注销。这一段断言四条：`runScoped` 存在、信号真的合进 `#composeSignal`（登记了但没接线是典型假通过）、卡片确实用它包住执行、卡片不得调用 `shell.abort()`。为什么不能改成「让 26 个工具各传一次 signal」—— 实测只有 2 个工具真的往下传，其余 24 个写 `run({ input })` 直接调服务层，逐个补参数的方法新增一个工具就会漏一个。不需要浏览器，已进 CI。第十段守的是「弹层到底有没有盖住」：三处浮层都写着 `aria-modal="true"`，但实测行为上不是模态 —— 偏好面板打开后第一次 Tab 落在背景的顶栏按钮上，走完面板内 10 个控件后又一路沿侧边栏导航跑；确认弹层第二次 Tab 就跑到背景；关掉面板后焦点落在侧边栏的「连接设备」上，想接着调偏好得从页面开头 Tab 一遍。所以这一段断言四环：焦点陷阱会接管 `Tab` 的默认行为（只加监听不 `preventDefault`，看着拦住了、浏览器照样往下跳）、关闭时把焦点还回打开前的元素、三处浮层都真的接了这个 hook 且容器上挂着 `ref`、以及 hook 的依赖数组必须含 `active`（确认弹层常驻挂载、没有请求时 `return null`，只依赖 `ref` 时 effect 会在容器尚不存在时提前返回且不再重跑 —— 本轮正是被这一条卡住过一次：`verify:focus` 全绿而面板那半没生效，全靠探针把两处分开测才现形）。不需要浏览器，已进 CI；真实按键行为另行交给 `verify:focus`。第十一段守的是一处**校验盲区**：`verify:copy` 前九段查的都是「提示说了什么」与「提示出不出得来」，而「操作记录」的清空按钮用的是 `window.confirm` —— 它既不是服务调用也不改设备状态，F 段那张只读方法白名单扫不到，于是历轮全绿。它的坏处很具体：样式不受控（深色主题下弹出一张系统白框）、没有手打确认词的余地（一次误点抹掉全部追溯线索），且**会阻塞页面执行上下文** —— 本轮探针第一次跑就因此挂死三分钟，自动化与读屏工具同样拿它没办法。所以这一段反向禁止全仓 UI 层出现 `window.alert/confirm/prompt`，同时要求清空真的经过 `askConfirm()` 与 `gateFor(risk 3)`，且 `auditLog.clear()` 必须带自述参数 —— 被无声抹掉的日志与「从来没操作过」长得一模一样，而这一页存在的唯一理由就是「改过什么能追溯」。两条反向探针逐条打红：改回 `window.confirm` 时脚本点名到行号，删掉确认门但保留站内弹层时第二条红。

### 7.3b 命令行与 MCP Server

网页之外的两个入口，与网页共用同一份业务代码（原理见 4.8）。

```bash
npm run build:cli      # 打包 bin/webroit 与 bin/webroit-mcp，并重新生成 Skill 参数文档
```

产物在 `bin/`，不纳入版本控制（每次改代码都产生二进制 diff 没有意义）。

**命令行用法**

```bash
webroit devices                                  # 列出本机 adb 可见设备
webroit tools --verbose                          # 34 个功能与各自参数
webroit run display.read --json                  # 执行，--json 供脚本解析
webroit run apps.control --package=com.x --action=freeze --allow-dangerous
webroit shell "dumpsys battery"                  # 逃生口：跑任意 adb shell 命令
```

全局选项：`--serial=<序列号>`（多台设备时必须指定）、`--out=<目录>`（截屏/拉取/导出 APK 的保存位置）、`--json`、`--verbose`、`--allow-dangerous`。

退出码固定三档，供脚本与 agent 分支：

| 码 | 含义 | 典型场景 |
|---|---|---|
| 0 | 成功 | — |
| 1 | 执行失败 | 设备断开、命令报错 |
| 2 | 用法错误 | 缺参数、参数越界、工具不存在、未授权的高危调用 |

**MCP Server 用法**

stdio 传输，注册到任意 MCP 客户端即可：

```json
{
  "mcpServers": {
    "webroit": {
      "command": "node",
      "args": ["/path/to/Webroit/bin/webroit-mcp"]
    }
  }
}
```

工具命名规则为 `webroit_<分区>_<动作>`（点号在部分客户端会被截断，故统一换成下划线），原始 ID 写在描述里。另有 `webroit_devices` 用于列出设备。环境变量 `WEBROIT_SERIAL` 指定目标设备，`WEBROIT_OUT_DIR` 指定产物目录。

**风险门控在无 UI 场景下的处理**：风险 2 级以上的工具，其 inputSchema 里会多出 `allowDangerous` 字段，默认 `false`。不传就拒绝执行。这一层与网页的确认弹窗是同一个判定函数。

**不能做的事**：命令行与 MCP 都依赖本机 adb，无法复用浏览器那套 WebUSB 通道（WebUSB 只存在于浏览器）。因此使用前提是已安装 platform-tools 且 `adb devices` 能看到设备。

### 7.4 部署到静态托管

`dist/` 是纯静态目录，`base` 已设为相对路径（`./`），可直接放在域名根目录或任意子目录下。

**已配置 GitHub Pages 自动部署**，线上地址：<https://ntars.github.io/Webroit/>

工作流文件为 `.github/workflows/deploy.yml`，行为如下：

| 环节 | 内容 |
|---|---|
| 触发 | 推送 `main` 分支，或在 Actions 页面手动触发 |
| 权限 | `contents: read` / `pages: write` / `id-token: write`，不使用长期密钥 |
| 并发 | 同一时间只跑一个部署，`cancel-in-progress: false` 避免留下半成品站点 |
| 步骤 | 检出 → Node 20 → `npm ci` → 类型检查 → 构建 → **文档校验** → 上传 → 发布 |

首次启用需在仓库 Settings → Pages 把 Source 设为 **GitHub Actions**。改用其他平台（Netlify、Vercel、Cloudflare Pages）时，构建命令 `npm run build`、输出目录 `dist` 两项照填即可。

**必须 HTTPS**。HTTP 站点（非 localhost）下 `navigator.usb` 不可用，页面会显示明确提示而不是静默失败。

### 7.5 单文件离线版的现状

早期规划里列过 `npm run build:aio`（产出单个内嵌全部依赖的 HTML 用于 U 盘携带）。该脚本**尚未实现**，`package.json` 中不存在此命令。

需要离线使用时，当前可行的做法是部署后由 PWA 安装为桌面应用：Service Worker 会缓存界面骨架，断网仍能打开页面。受 `file://` 协议限制，直接双击本地 HTML 文件无法使用 WebUSB，这一点无法绕过。

---

### 7.6 无线连接（可选）

WebUSB 需要物理连接。若需无线调试，需自行部署 WebSocket 中继（本项目不托管）：

```bash
# 在已连设备的电脑上
adb tcpip 5555
# 用 WebSockify 或其他 ADB-over-WebSocket 中继将 5555 端口暴露为 ws://
```

中继暴露在公网等同于把设备控制权交出去，**仅限可信内网使用**。

---

## 八、快速开始

### 8.1 设备侧准备

1. 设置 → 关于手机 → 连续点击「版本号」7 次，开启开发者选项；
2. 设置 → 系统 → 开发者选项 → 打开「USB 调试」；
3. 部分厂商（小米、OPPO、vivo）还需额外打开「USB 调试（安全设置）」；
4. 用**支持数据传输**的数据线连接电脑（很多线只能充电）。

### 8.2 电脑侧

1. 用 Chrome 或 Edge 打开部署地址；
2. 点击「连接设备」；
3. 浏览器弹出设备选择框，选中你的手机；
4. 手机屏幕弹出「允许 USB 调试吗？」，勾选「一律允许」并确定；
5. 连接成功后自动采集设备画像，进入主界面。

### 8.3 如果连不上

按顺序排查：

| 现象 | 原因 | 处理 |
|---|---|---|
| 连接按钮灰色 | 浏览器不支持 WebUSB | 换 Chrome / Edge，确认是 HTTPS 或 localhost |
| 设备列表为空 | 系统未识别设备 | 换数据线、换 USB 口、Windows 检查驱动 |
| 提示接口被占用 | 本地 `adb.exe` 在跑 | Windows 结束 `adb.exe`；macOS/Linux `adb kill-server` |
| 手机无授权弹窗 | 锁屏 / 已拒绝 / 已有旧授权 | 解锁屏幕；开发者选项里「撤销 USB 调试授权」后重试 |
| 连上后命令无响应 | 线材质量问题 | 换线；本工具默认 8 秒超时，超时会报错而非卡死 |

---

## 九、配置说明

本应用无配置文件，全部设置存于浏览器本地。

### 9.1 存储位置

全部数据留在本机浏览器内，无任何服务端。

| 数据 | 存储位置 | 具体的键或库名 | 生命周期 |
|---|---|---|---|
| ADB RSA 私钥 | IndexedDB | 由 `@yume-chan/adb-credential-web` 管理的 `Tango` 库 | 持久，需手动清除 |
| 界面偏好 | localStorage | `webroit:preferences` | 持久 |
| 操作记录（审计） | IndexedDB | `webroit` | 持久，上限 500 条，可导出；清空需手打「确认」，清完留一条自述记录 |
| 设置快照 | IndexedDB | `webroit-snapshots` | 仅当前会话，刷新页面后清空前一会话的残留 |
| 命令历史 | 内存 | — | 关掉标签页即丢，不做持久化 |
| Service Worker 缓存 | Cache Storage | `webroit-shell-*` / `webroit-assets-*` | 版本更新时旧缓存整体丢弃 |

审计与快照分为两个数据库，而不是放在同一个库的两个表：两者版本演进节奏不同，合并会造成「升级审计结构时误删快照」这类问题。

### 9.2 可调参数

顶栏右上角的**齿轮按钮**打开「偏好设置」面板，六项偏好改完立即生效并落盘，没有「保存」按钮 —— 每一项都能在界面上直接看到结果（字号、主题、侧边栏宽度），多一步确认只会让人怀疑存没存住。其余为代码内的常量。

| 项 | 默认值 | 可选范围 | 说明 |
|---|---|---|---|
| 主题 | 跟随系统 | 深色 / 浅色 / 跟随系统 | `auto` 时监听 `prefers-color-scheme` 实时切换 |
| 终端字号 | 13 px | 10–24 px | 越界值一律回落 13，不写入脏数据 |
| 显示命令回显 | 开 | 开 / 关 | 关闭后只显示结果，`info` 频道仍保留 |
| 高危操作二次确认 | 开 | 开 / 关 | 关闭后风险 2 级不再弹确认；风险 3 级不受此开关影响 |
| 低电量告警阈值 | 20% | 1–100% | 低于阈值且未充电时在概览页提示 |
| 上次使用的分区 | 设备总览 | 任一分区 | 刷新后回到同一位置 |
| 侧边栏收起 | 否 | 是 / 否 | — |

以下为代码常量，不提供界面开关：命令环形缓冲 200 条（供审计按序号切窗口）、终端显示上限 2000 行（`pushOutput` 超出即裁掉最旧）、审计记录上限 500 条、命令超时需在调用处显式传入（当前所有调用点均未设置，依赖 ADB 层自身的连接超时）。

### 9.3 重置

偏好面板底部的「恢复默认」只清六项偏好并把主题切回「跟随系统」，**不动**设备设置快照、审计记录与 ADB 密钥 —— 那些是「发生过的事实」，不该因为一次界面调回原样而消失。

界面上没有「清除全部数据」按钮。需要彻底重置时，在浏览器开发者工具的 Application 面板删除 IndexedDB 中的 `webroit`、`webroit-snapshots`、`Tango` 三个库，以及 localStorage 的 `webroit:preferences`。清除后需重新授权设备并重设偏好。

---

## 十、API 与模块说明

本项目面向终端用户，不对外提供 HTTP API。内部模块契约如下。

### 10.1 Tool —— 工具注册表条目

```ts
interface Tool {
  id: string;                       // 全局唯一，如 "system.fontScale"
  module: ModuleId;                 // device | apps | display | files | system | battery | vendor
  title: string;
  description: string;
  risk: RiskLevel;                  // 0 只读 / 1 可逆 / 2 需确认 / 3 高危
  params: ParamSchema[];            // 驱动 UI 表单，UI 不认识具体工具
  vendor?: VendorId;                // 仅品牌专区的工具需要声明
  available(capabilities: DeviceCapabilities): boolean | string;
  run(context: ToolContext): Promise<ToolResult>;
}
```

`available()` 返回 `true` 表示可用，返回**字符串**表示不可用并把该字符串作为原因直接展示给用户。这是「说明为什么不能用」的实现基础。

### 10.2 ToolContext —— 执行上下文

```ts
interface ToolContext {
  shell: ShellContext;                 // 命令执行门面
  capabilities: DeviceCapabilities;    // 连接时探测到的能力画像
  input: Record<string, unknown>;      // 用户在表单里填的值
  signal?: AbortSignal;
}
```

工具**不持有**会话、不直接调用 `@yume-chan/adb`，只通过 `shell` 发命令。这一层约束让工具实现可以在 mock 环境下完整测试。

### 10.3 ShellContext —— 命令执行门面

```ts
class ShellContext {
  shell(command: string, options?: ShellOptions): Promise<ShellResult>;
  text(command: string, options?: ShellOptions): Promise<string>;   // 取 stdout 并 trim
  mutation(command: string, options?: ShellOptions): Promise<ShellResult>;
  commandMark(): number;                    // 当前命令序号水位
  commandsSince(mark: number): string[];    // 取水位之后的命令，供审计记录
  cancelAll(): void;
}
```

`shell()` 内部并行读 stdout 与 stderr。串行读会在 stderr 缓冲满时死锁 —— 这是 ADB over USB 上一个真实的坑，命令看起来「卡住」而 CPU 空闲。

### 10.4 DeviceSession 与能力画像

```ts
interface DeviceCapabilities {
  sdk: number;                  // API 等级
  release: string;              // Android 版本，如 "14"
  brand: string;                // 厂商，小写
  model: string;
  props: Record<string, string>;  // 完整 getprop

  // 以下为 9 条只读探针的判定结果
  canWriteSecureSettings: boolean;
  canUseDumpsys: boolean;
  canUseWmSize: boolean;
  canUseWmDensity: boolean;
  canUseSettings: boolean;
  canUsePm: boolean;
  canUseCmdPackage: boolean;
  canUseScreenshot: boolean;
  canUseInput: boolean;
  canUseMonkey: boolean;
  canUseSync: boolean;

  vendorNote: string | null;     // 已知 ROM 的额外开关提示
}
```

`canWriteSecureSettings` 无法用只读命令验证，取值来自 Android 版本与已知厂商策略的推断。真正写入失败时由工具层兜底提示，不假装探测准确。

### 10.5 分层职责边界

| 层 | 目录 | 可以 | 不可以 |
|---|---|---|---|
| UI | `src/ui/` | 渲染、交互、表单校验、调用工具 | 直接 import `@yume-chan/adb` |
| 工具 | `src/tools/` | 声明参数、组合服务调用、判定可用性 | 持有会话、读 DOM |
| 服务 | `src/services/` | 组合命令、解析输出、业务规则 | 触碰 DOM |
| 会话 | `src/core/session/` | 连接生命周期、能力探测、品牌判定 | 业务逻辑 |
| 传输 | `src/core/transport/` | 握手、设备枚举、命令收发 | 命令语义 |

分层的实际作用是让「设备操作」可测：`services` 与 `tools` 只依赖 `ShellContext` 接口，因此可以在没有真机的情况下跑完整逻辑断言。

### 10.6 新增一个工具的最小改动面

1. 在 `src/services/` 里加一个方法（若已有服务能覆盖则跳过）。
2. 在 `src/tools/defs/` 里对应分区文件的数组里加一个 `Tool` 对象（新分区则新建文件，并在 `builtin.ts` 的 `BUILTIN_TOOLS` 里展开）。
3. 若属于新分区，在 `registry.ts` 的 `MODULES` 里加一条并补 `ModuleId`。

`ModuleView`、`ToolCard`、侧边栏、终端输出、审计记录**均不需要改动**。v0.1 的 26 个工具全部由这同一套机制驱动。

### 10.7 插件系统的现状

插件接口（`PluginHost`、第三方 ES 模块加载、权限声明）**尚未实现**，`src/plugins/` 目录不存在。当前扩展功能只能通过修改 `builtin.ts` 并重新构建。

未实现的理由不是技术难度，而是安全边界没想清楚：插件能执行任意 ADB 命令，而 ADB 命令能刷分区。在「插件如何声明权限、用户如何确认、出问题如何追溯」这三个问题有确定答案之前，不开放这条路径。

---

## 十一、目录结构

以下为 v0.1 的实际结构，与仓库内容一致。标注「规划」的条目尚未创建。

```
Webroit/
├── index.html                      # 应用入口 HTML，含 PWA 元信息与 noscript 提示
├── package.json                    # 依赖与脚本；build 串起 tsc → vite → SW 注入
├── package-lock.json               # 锁定依赖版本，CI 与本地构建一致
├── tsconfig.json                   # strict 模式，@/* 路径别名
├── vite.config.ts                  # base 为相对路径，适配子目录部署
├── dev-preview.html                # 无设备时的界面预览入口
├── .github/workflows/deploy.yml    # 推送 main 自动构建并发布 Pages
├── public/                         # 直接复制进 dist，不经打包
│   ├── favicon.svg
│   ├── manifest.webmanifest        # PWA 清单：独立窗口、快捷方式、图标
│   ├── sw.js                       # Service Worker 源码，构建期注入版本与预缓存列表
│   └── icons/                      # 192 / 512 / maskable / apple-touch
├── scripts/
│   └── build-sw.mjs                # 按产物指纹改写 dist/sw.js
├── src/
│   ├── main.tsx                    # 入口：主题 → 注册工具 → 绑定服务 → 注册 PWA → 挂载
│   ├── dev-preview.tsx             # 预览用 mock 服务实现
│   ├── core/                       # 与 UI 无关的底层，可单独测试
│   │   ├── transport/driver.ts     # WebUSB ↔ ADB 会话，唯一接触 @yume-chan 的文件
│   │   ├── session/device-session.ts  # 能力探测、品牌判定、会话生命周期
│   │   ├── shell.ts                # 命令执行：超时、并发读流、输出频道、命令环形缓冲
│   │   ├── snapshot.ts             # 设置快照存储，单调序号保证逆序正确
│   │   ├── audit.ts                # 操作记录，IndexedDB 独立库避免版本冲突
│   │   ├── storage.ts              # 偏好持久化，非法值一律回落默认
│   │   ├── pwa.ts                  # Service Worker 注册、更新提示、安装引导
│   │   └── utils.ts                # 转义、格式化、字节单位等纯函数
│   ├── services/                   # 领域服务，一个分区一个文件
│   │   ├── index.ts                # Services 聚合对象与构造
│   │   ├── device.service.ts
│   │   ├── app.service.ts
│   │   ├── display.service.ts
│   │   ├── file.service.ts
│   │   ├── system.service.ts
│   │   ├── battery.service.ts
│   │   ├── vendor.service.ts
│   │   └── rollback.service.ts     # 按逆序回放快照
│   ├── tools/
│   │   ├── registry.ts             # Tool 类型、注册表、按能力过滤
│   │   ├── builtin.ts              # 聚合入口：七个分区按顺序拼成 BUILTIN_TOOLS
│   │   ├── host.ts                 # 宿主注入：服务解析器与产物交付口
│   │   ├── input.ts                # 入参收敛：str / num / bool / packageList
│   │   └── defs/                   # 各分区工具定义，一个分区一个文件
│   │       ├── device.ts           # 设备总览（重启）
│   │       ├── apps.ts             # 应用管理（6 项）
│   │       ├── display.ts          # 显示与输入（4 项）
│   │       ├── files.ts            # 文件传输（4 项）
│   │       ├── system.ts           # 系统调校（7 项）
│   │       ├── battery.ts          # 电池管理（2 项）
│   │       └── vendor.ts           # 品牌专区（5 品牌 × 2 项，模板生成）
│   ├── node/                       # 命令行与 MCP Server，走本机 adb 而非 WebUSB
│   │   ├── cli.ts                  # webroit 命令入口，参数解析与人类可读输出
│   │   ├── runtime.ts              # 工具执行运行时：参数收敛、风险门控、产物落盘
│   │   ├── adb-driver.ts           # 本机 adb 的 Driver 实现
│   │   ├── errors.ts               # 用法错误类型
│   │   ├── mcp.ts                  # MCP Server 启动与退出（stdio JSON-RPC）
│   │   └── mcp/                    # MCP 的四个职能层
│   │       ├── protocol.ts         # 协议常量、消息收发、结果包装
│   │       ├── schema.ts           # 工具名映射与 JSON Schema 生成
│   │       ├── session.ts          # 设备会话缓存：懒连接 + 失败重连
│   │       └── handle.ts           # 方法分发与 tools/call 实现
│   └── ui/
│       ├── App.tsx                 # 外壳：侧边栏 + 主区域 + 终端；应急路由分流
│       ├── routing/                # 页面归属判定与应急页退出（URL 语义唯一真源）
│       ├── state/                  # signal、全局动作、连接链路、传输进度降频
│       ├── components/             # ToolCard、Terminal、ErrorBoundary、PwaPrompt、ProgressStrip 等
│       ├── views/                  # 各分区页面
│       └── theme/                  # 设计令牌与四份样式表
├── NOTICE                          # 第三方组件披露
├── LICENSE                         # Apache-2.0 全文（GitHub 据此识别仓库许可）
├── LICENSE-MIT                     # MIT 全文
├── LICENSING.md                    # 分层路由表（人类可读）
├── README.md
└── README_EN.md
```

规划中但尚未创建：`src/plugins/`（插件宿主）、`src/ui/i18n/`（语言包）、`public/scrcpy-server`（投屏尚未实现）。

单元测试不另建 `tests/` 目录，而是与被测文件同目录放 `*.test.ts`（`src/core/utils.test.ts` 等）：被测代码一动，测试就在眼皮底下，比跨目录找文件更容易维护。端到端测试尚未建立。

---

## 十二、性能表现

### 12.1 实测数据

测量环境：macOS 15 / Apple Silicon，Node.js 22.22.2，Vite 7.3.8，`npm run build` 生产构建。体积取文件实际字节数，gzip 为 `gzip -c` 结果。

| 产物 | 原始体积 | gzip | 说明 |
|---|---|---|---|
| `index-*.js` | 166.1 KB | 57.1 KB | 首屏必需：Preact、工具注册表、全部服务与界面 |
| `index-*.css` | 43.9 KB | 7.8 KB | 五份样式表合并后 |
| `adb-*.js` | 71.7 KB | 21.7 KB | ADB 传输层，连接时才加载 |
| `index.html` | 2.2 KB | 1.1 KB | 含 PWA 元信息 |
| 图标合计 | 203.1 KB | — | 192 / 512 / maskable / apple-touch |
| **首屏合计** | **约 214 KB** | **约 67 KB** | JS + CSS + HTML，不含图标 |
| **全量产物** | **499 KB** | **—** | `dist/` 12 个文件 |

构建耗时 0.8 秒，模块数 180。类型检查 `tsc --noEmit` 零错误。

### 12.2 运行时开销

| 项 | 实测或设定 | 依据 |
|---|---|---|
| 命令环形缓冲 | 上限 200 条 | `shell.ts` 中 `#recentCommands` 超出即裁剪 |
| 审计记录读盘 | 仅读本会话前缀 | `SNAPSHOT` 与审计按 `sessionId` 过滤，历史记录不参与排序 |
| 快照还原排序 | 50 条同毫秒记录严格逆序 | 以单调递增 `seq` 为排序键，不依赖时间戳 |
| 终端输出合并 | 连续同频道文本合并 | 避免逐行渲染导致长命令刷屏卡顿 |
| Service Worker 预缓存 | 11 个文件 | 构建产物全量预缓存（`sw.js` 除外），含 ADB 分包 |

### 12.3 尚未测量的项

投屏延迟、大文件传输速度、logcat 十万行吞吐、内存占用四项**未测**，因为对应功能（投屏、logcat 实时流）在 v0.1 尚未实现。这三项在路线图中属 v0.2 范围，届时补入实测并注明设备型号与连接方式。

---

## 十三、安全与隐私

### 13.1 数据流向

| 数据 | 位置 | 出本机 |
|---|---|---|
| 设备信息 | 浏览器内存 | 否 |
| 文件内容 | 浏览器 ↔ USB ↔ 设备 | 否 |
| 终端输出 | 浏览器内存 | 否 |
| 界面偏好 | localStorage | 否 |
| 操作记录与设置快照 | IndexedDB | 否 |
| ADB 私钥 | IndexedDB（`Tango` 库） | 否 |
| 使用统计 | **不采集** | — |

### 13.2 无遥测

本项目**不包含任何埋点、统计、崩溃上报**。无 Google Analytics、无 Sentry、无自建上报端点，不加载任何第三方 CDN 资源。

产物可用以下命令验证。注意第一条会命中一处，那是小米组件清单里的包名 `com.miui.analytics`（一个可停用的系统统计组件），属于功能数据而非遥测代码：

```bash
grep -rE "gtag|sentry|umami|plausible|google-analytics" dist/   # 应为空
grep -rE "https://cdn\." dist/                                  # 应为空
grep -rhoE "https?://[a-zA-Z0-9._/-]+" dist/ | sort -u          # 仅剩 5 条，见下表
```

产物中全部绝对 URL 的实际用途：

| URL | 用途 | 是否产生浏览器请求 |
|---|---|---|
| `https://connect.rom.miui.com/generate_204` | 作为字符串写入设备设置，用于修复小米「WiFi 显示已连接但无网络」 | 否，字符串只发往设备 |
| `http://connect.rom.miui.com/generate_204` | 同上，还原时写回的原值 | 否 |
| `http://www.w3.org/2000/svg` | SVG 命名空间标识 | 否，不是可请求地址 |
| `http://www.w3.org/1999/xhtml` | 同上 | 否 |
| `http://www.w3.org/1998/Math/MathML` | 同上 | 否 |

### 13.3 权限模型

设备侧唯一授权凭证是手机上的「允许 USB 调试」弹窗。本项目**不提供任何绕过该确认的手段**，也不接受已授权的设备会话被导出或分享。

风险分级是界面上唯一的权限表达方式，`Tool.risk` 四档直接决定交互形态：

| 等级 | 名称 | 界面行为 | 记录 |
|---|---|---|---|
| 0 | 只读 | 点即执行 | 不写操作记录 |
| 1 | 可逆 | 点即执行，改前自动记快照 | 写操作记录 |
| 2 | 需确认 | 弹确认框（可在偏好里关闭） | 写操作记录 |
| 3 | 高危 | 弹确认框 + 要求手打确认词，不受偏好开关影响 | 写操作记录 |

**同一件事从哪个入口进来，门槛都一样**。风险分级不只在工具卡片上生效 ——「应用管理」列表里的冻结 / 启用 / 停止 / 批量冻结 / 批量卸载，以及「品牌专区」的停用选中，全部经同一条治理路径（`src/ui/state/actions.ts` 的 `runMutation()`：先按 `gateFor()` 判门槛，再串 `audited()` 留底）。

这条约束不是设计出来的，是实测发现的：早期列表里的「批量卸载」直接调服务层，勾选应用点一下就卸了，既没有确认也没有记录；而同一件事在工具卡片里是 risk 3、要求手打「确认」。所以门槛判定只有 `gateFor()` 一处，服务调用只有 `src/ui/state/mutations.ts` 一张表，`verify:copy` 会扫视图层是否出现该表之外的变更调用。

**问完之后必须说得清结果**。批量操作逐条执行，`app.service.ts` 的 `batch()` 对每条单独 try/catch，失败原因写进 `BatchResult.message`。只报「成功 N 个、失败 M 个」等于把最有用的部分扔了：用户不知道是哪几个没成、为什么。所以播报交给 `src/ui/state/batch-report.ts` 的 `buildBatchReport()`，输入是完整结果数组 —— 摘要进提示条并点名前几个失败目标，明细逐条以 `[失败] 包名：原文` 进下方「命令输出」面板；超过 20 条折叠成一行并指路「操作记录」（审计日志带全部命令与错误）。`verify:copy` 会反向检查每个 `reportBatch()` 调用点没有拿 `.length` 当依据，并禁止「见下方」后面不跟真实区域名。

播报之外还得让它在列表里看得见。批量结束之后用户要做的事不是读 toast，而是回到那 300 行里找到没成功的几行 —— 提示条 5 秒后消失，只留终端里一串包名。所以 `indexOutcomes()` 把结果数组折成行级标记（失败 / 未执行），行左侧染一道边、状态列多一个标签（`title` 带设备原文），表格上方给一个「只看未成功（N）」的开关。失败染淡红底 + 红边，未执行只留灰边：前者要查原因，后者要插回数据线，两种下一步不该长得一样。成功执行的那一行会撤掉旧标记，重新读取时只清掉已经不存在的行 —— 否则批量卸载后的 `load()` 会把刚设好的标记一起抹掉。

**拔线要让正在做的活立刻停手**。批量操作是「一轮 for 循环里逐条 await」，每条命令自己会响应取消信号，但**循环本身不会**：前一条失败被 catch 之后，它会毫不犹豫地开始下一条。实测拔线时后面的命令一条条发往已经死掉的 USB 链路，每条都要等到超时才返回，用户看到「拔线后界面还在转两分钟」。所以 `resetConnection()` 里先 `abort()` 再清 `services`（顺序不能反 —— 一旦置空，那个 `ShellContext` 就再没人能触发），`batch()` 每条之前查 `aborted`，正在执行的那条用 `raceAbort()` 包住 —— 数据线都拔了，谁来兑现底层 `spawn()` 的 Promise？靠信号抢回控制权是唯一办法。剩余项标记为 `skipped` 而不是失败：失败意味着命令到了设备、设备拒绝了，用户该去查权限或存储；未执行意味着命令压根没发出去，用户该去查数据线。混成一类就会把人往错误的方向指。

这一层收口在 `ShellContext.shell()` 一处：它把驱动调用本身和取消信号 race 起来，而不是裸 `await`。原因是 services 层有 76 处命令调用，绝大多数是单条（冻结一个应用、改一次分辨率、传一个文件），它们的取消语义全靠这一个出口 —— 只在两条批量路径外包一层，剩下的单条调用依旧会卡在一条永不兑现的 Promise 上，直到 USB 超时。

**拔线之外还有第二种停法：用户自己点「中止」**。这两件事必须走不同的机制。拔线是连接级的，`shell.abort()` 一响整条会话就废了，且不可逆 —— 这是对的，线都没了。但点「中止」只是不想跑这一条，把整条连接一起废掉会让之后每一个操作都立刻失败。

所以卡片上的「中止」走 `ShellContext.runScoped()`：它把一次操作的取消信号登记进上下文，该操作期间发出的所有命令自动组合这个信号，作用域结束（成功 / 失败 / 中止）就注销。`verify:copy` 会断言卡片确实用它包住执行，并反向禁止卡片调 `shell.abort()`。

这一层是必须的，不能靠「让每个工具自己把 signal 传下去」：26 个工具里只有 2 个（文件安装、文件传输）真的把 `ToolContext.signal` 交给服务层，其余 24 个写的是 `run({ input })`，直接 `requireServices().apps.disable(...)`。命令最终都走 `shell()`，而 `shell()` 只认自己的信号 —— 于是「冻结一个应用」时点中止，卡片上的转圈停了（界面说「已取消」），底层命令继续跑到自己回来或 USB 超时，设备照旧被改。

注销的时机比登记更容易写错。挂在 `runScoped()` 的 `finally` 上不对：race 输掉时（用户点了中止）外层立刻拿到控制权并跑 finally，而内层代码其实还在往下跑，它后面发的命令就都落在作用域之外，一条条照发不误 —— 表现恰好是「界面已经停了，日志里还在出新命令」。正确的挂法在内层任务自己的 `finally` 上，外层只负责把控制权立刻还给调用方。这条是被单测逼出来的，不是想出来的。

**没有实现权限声明字段**。`available()` 判定依据的是连接时探测到的真实能力，而非静态声明的 `none` / `shell+` / `root` / `bootloader` 标签。这样做的理由是静态标签会过期：同一命令在不同 ROM 上的权限要求不同，声明的标签反而是误导。

### 13.4 敏感信息脱敏的现状

**尚未实现**。v0.1 不提供设备报告导出功能，因此也没有脱敏逻辑。导出功能在路线图中属 v0.2，届时会一并实现：序列号保留前 4 后 4，IMEI / MEID 全打码，MAC 保留 OUI。

当前设备概览页直接显示完整序列号 —— 这是本地界面，不出本机，但用户截图分享时需自行打码。

### 13.5 本地数据清理的现状

界面上**没有**「一次清空」按钮。实际清理方式见 9.3 节。

不提供该按钮是有意取舍：一次清空会同时删掉 ADB 私钥与操作记录，前者导致需要重新授权，后者让「刚才改了什么」永久丢失。在设备被改坏的情况下，用户最需要的恰恰是操作记录。

---

## 十四、兼容性说明

### 14.1 浏览器

| 浏览器 | 支持 | 说明 |
|---|---|---|
| Chrome（桌面） | 完整 | 首选 |
| Edge（桌面） | 完整 | 首选 |
| Chromium 系（Brave / Opera / Vivaldi） | 基本完整 | 部分版本阉割 WebUSB |
| Chrome for Android | 可用 | 需 C-to-C / OTG，界面适配移动端 |
| Safari / iOS 全部浏览器 | 不支持 | 无 WebUSB，内核限制 |
| Firefox | 不支持 | 明确拒绝实现 WebUSB |
| 国产浏览器极速模式 | 视内核 | 多数阉割 WebUSB，会显示明确提示 |

### 14.2 操作系统

| 系统 | 状态 | 备注 |
|---|---|---|
| Windows 10 / 11 | 支持 | 需系统能识别 ADB 接口；首次可能需驱动 |
| macOS（Intel / Apple Silicon） | 支持 | 免驱 |
| Linux（x64 / arm64） | 支持 | 需 udev 规则，见下 |
| ChromeOS | 支持 | 免驱 |
| 虚拟机 | 不稳定 | USB 直通常见握手失败，建议物理机 |

Linux udev 规则：

```bash
# /etc/udev/rules.d/51-android.rules
SUBSYSTEM=="usb", ATTR{idVendor}=="18d1", MODE="0666", GROUP="plugdev"
# 按设备厂商追加各自的 idVendor
sudo udevadm control --reload-rules && sudo udevadm trigger
```

### 14.3 Android 版本

| 版本 | SDK | 备注 |
|---|---|---|
| Android 8–10 | 26–29 | 基础功能可用；投屏音频不可用 |
| Android 11–13 | 30–33 | 完整功能；无线配对可用 |
| Android 14–16 | 34–36 | 完整功能；剪贴板 API 有变更，需走兼容分支 |
| Android 17+ | 37+ | 待验证 |

### 14.4 厂商差异

品牌判定由 `detectVendor()` 完成，依次比对 `ro.product.brand`、`ro.product.manufacturer`、`ro.product.vendor.brand`、`ro.build.product` 与探测到的 `brand`，命中第一条即返回。优先看 `brand` 而非 `manufacturer`，因为 Redmi 的 manufacturer 是 Xiaomi 但 brand 是 Redmi。

当前覆盖六个分类：

| 分类 | 匹配规则 | 系统名 | 专区内容 |
|---|---|---|---|
| 小米 / 红米 / POCO | `xiaomi\|redmi\|poco` | MIUI · HyperOS | 可停用组件清单 |
| OPPO / 一加 / 真我 | `oppo\|oneplus\|realme` | ColorOS · realme UI | 同上 |
| vivo / iQOO | `vivo\|iqoo` | OriginOS · Funtouch | 同上 |
| 华为 / 荣耀 | `huawei\|honor` | EMUI · HarmonyOS · MagicOS | 同上 |
| 三星 | `samsung` | One UI | 同上 |
| 其他（generic） | 全部未命中 | — | 不显示品牌专区 |

厂商提示文案（如小米需开「USB 调试（安全设置）」）由会话层的 `vendorHint()` 提供，显示在连接面板与错误信息旁，不是统一报错。

### 14.5 PWA 与离线

| 项 | 状态 | 说明 |
|---|---|---|
| Service Worker | 支持 | Chromium 系与 Safari 16.4+ 均可注册 |
| 离线打开界面 | 支持 | 预缓存 11 个文件（HTML、清单、5 个图标、入口 JS 与 CSS、ADB 分包） |
| 离线操作设备 | 不需要网络 | 设备通信走 USB，本就不经网络 |
| 安装为桌面应用 | 支持 | Chrome / Edge 显示安装按钮，Safari 走「添加到主屏幕」 |
| 更新提示 | 支持 | 发现新版本时顶部显示横条，由用户决定何时刷新 |

不在安全上下文（HTTP 且非 localhost）时 Service Worker 与 WebUSB 都不可用，页面会显示明确说明。

---

## 十五、已知问题与限制

### 15.1 架构性限制（无法通过开发消除）

| # | 限制 | 原因 | 应对 |
|---|---|---|---|
| 1 | 刷新或关闭页面即断开设备 | WebUSB 会话依附标签页生命周期 | 界面明示；文件传输中断后可重传 |
| 2 | 无法后台执行长任务 | 浏览器会节流后台标签页 | 不承诺后台定时精度 |
| 3 | 不支持远程控制他人设备 | 架构上无中继，也无此设计意图 | 明确声明，不实现 |
| 4 | 不支持 Safari / Firefox / iOS | 前者无 WebUSB，后者明确拒绝实现 | 打开时显示浏览器不支持说明 |
| 5 | 必须 HTTPS 或 localhost | WebUSB 要求安全上下文 | HTTP 站点显示明确提示而非静默失败 |
| 6 | 无线连接需自建中继 | 零后端架构 | 不提供托管，仅在文档说明做法 |
| 7 | `file://` 下不可用 | 非安全上下文 | PWA 安装后离线可用，绕过该限制 |

### 15.2 功能尚未实现

| # | 项 | 现状 |
|---|---|---|
| 1 | 投屏（scrcpy） | 未实现，`public/scrcpy-server` 不存在 |
| 2 | 实时 logcat | 未实现，仅终端可手动执行 |
| 3 | Fastboot / 刷机 | 未实现 |
| 4 | 脚本编排与定时 | 未实现 |
| 5 | 插件系统 | 未实现，见 10.7 |
| 6 | 多设备并行 | 未实现，一次一个会话 |
| 7 | 设备报告导出与脱敏 | 未实现，见 13.4 |
| 8 | 单文件离线版 | 未实现，见 7.5 |

### 15.3 已知缺陷

| # | 问题 | 影响 | 状态 |
|---|---|---|---|
| 1 | `canWriteSecureSettings` 靠版本与厂商策略推断 | 极少数 ROM 上判定与实际不符，操作时才失败 | 已知，由工具层兜底提示 |
| 2 | 部分厂商 ROM 限制 `pm` / `settings` | 命令返回权限错误 | 显示原始错误 + 厂商说明 |
| 3 | GPU 负载读数不可靠 | 各厂商 sysfs 节点不同 | 不可读时标注而非显示 0 |
| 4 | Service Worker 更新需手动刷新 | 用户可能长时间停留在旧版本 | 顶部横条提示，不自动刷新以免打断操作 |
| 5 | 端到端测试缺席 | 真实 USB 握手与多机型行为无法在 CI 里回归 | 纯函数层单元测试已接入 CI，端到端待补，见路线图 |

---

## 十六、更新日志

### v0.1.0-dev — 2026-11-15

首个可运行版本。

**功能**

- 9 个功能分区、26 项工具卡片，覆盖设备总览、应用管理、显示与输入、文件传输、系统调校、电池管理、品牌专区。
- 2 个不承载卡片的交互界面：ADB 终端（含 3 条常驻快捷命令）、操作记录（可按状态筛选并导出 JSON）。
- 品牌专区按 5 类厂商分流，`visibleTools()` 依据 `ro.product.brand` 过滤。
- 连接时并行执行 9 条只读探针，生成 `DeviceCapabilities`，工具据此返回可用或不可用原因。

**可靠性**

- 设置快照：所有 `settings put` / `wm` 写入前记录原值，一键还原按逆序回放。以单调递增序号为排序键，同毫秒多条记录也能严格逆序。
- 应急重置页 `#/reset-display`：整页单按钮，全部尺寸用 px，根字号放大 2.5 倍后按钮尺寸与位置不变。
- 命令环形缓冲与序号水位：审计记录按 `commandMark()` 切窗口，不依赖时间戳，避免同毫秒操作串味。
- `settings get` 返回 `null` 时，逆操作翻译为 `settings delete` 而非写入字符串 "null"。

**PWA 与部署**

- 新增 Web App Manifest、Service Worker、4 种尺寸图标。
- 三档缓存策略：导航网络优先、哈希产物缓存优先、静态资源增量更新。
- 构建期按产物指纹注入版本号，内容不变则版本号不变，用户不会收到无意义更新提示。
- GitHub Actions 自动部署到 Pages，线上地址 <https://ntars.github.io/Webroit/>。

**已知不足**

- 投屏、logcat、Fastboot、脚本编排、插件系统、多设备均未实现。
- 端到端测试缺席。纯函数层已有单元测试并接入 CI，真实 WebUSB 握手仍需人工验证。
- 无设备报告导出与脱敏。

### 更早

项目此前为设计与规划阶段，无对外发布版本。规划期的功能清单、技术方案、决策记录等文档为内部资料，不随仓库分发。

---

## 十七、后续路线图

| 版本 | 代号 | 目标 | 出口条件 | 状态 |
|---|---|---|---|---|
| v0.1 | 起子 | 连接与最小闭环（26 项） | 插线能连、能装包、能传文件、能截图、能敲命令 | 已完成 |
| v0.2 | 手柄 | 实时监控与投屏（累计 60 项） | 屏幕镜像可用；logcat 实时流十万行不崩；CPU / 内存 / 温度曲线 | 未开始 |
| v0.3 | 扳手 | 备份、脚本、多设备（累计 90 项） | 一条脚本在三台设备跑完并出报告 | 未开始 |
| v0.4 | 手术刀 | Fastboot 与高危操作（累计 120 项） | 3 品牌 5 台实机完成刷写与回滚 | 未开始 |
| v1.0 | 工坊 | 插件生态与发布（累计 152 项） | 第三方可写插件；i18n 齐备；测试覆盖核心路径 | 未开始 |

v0.2 之前的**技术债清单**（优先于新功能）：

1. 补端到端测试 —— 纯函数层已有 244 个用例在 CI 里跑，但真实的 WebUSB 握手仍需人工验证。
2. 设备报告导出与敏感信息脱敏（见 13.4）。
3. 单文件离线版（见 7.5），或明确废弃该计划。

**不做排期的事**：云端账号、iOS / 鸿蒙、一键 root、APK 商店、远程协助。

---

## 十八、参与贡献

### 18.1 适合贡献的方向

| 方向 | 说明 | 难度 |
|---|---|---|
| 机型适配 | 在 Issue 中贴出设备型号、Android 版本、ROM，以及哪些工具在你的机器上不可用 | 低 |
| 错误码映射 | 补充常见 ADB 报错的中文解释，往 `src/core/error-copy.ts` 的规则表加一条即可，`npm run verify:copy` 会校验新规则是否同时给出原因与出口 | 低 |
| 文档校对 | 核对 `README.md` 与 `README_EN.md` 的事实一致性，指出与代码不符之处 | 低 |
| 新工具 | 按 `Tool` 接口实现一个功能条目，附实机截图与失败表现 | 中 |
| 测试 | 为 `src/services/` 剩余模块补单元测试，接口化后的依赖使其易测 | 中 |
| 缺陷报告 | 附设备型号、Android 版本、ROM、复现步骤、控制台日志 | 低 |

插件示例暂不接受 —— 插件系统尚未实现，见 10.7。

### 18.2 提交前须知

1. **不要提交来源不明的代码**。任何从其他项目复制的片段，必须在 PR 中注明来源与许可证，且不得是 GPL-2.0-only 或不兼容许可。
2. **不要提交来自 CzJam/gjgjxweb 的任何内容**。该项目为 GPL-3.0-only，与本项目的 Apache-2.0 / MIT 不兼容（copyleft 不能反向吸收进宽松许可），且本项目从零实现。
3. **涉及设备行为的功能，必须说明实测机型与结果**。未实测的请在 PR 里写明，不要按「应该可以」提交。
4. **新增依赖前先讨论**。本项目刻意保持依赖极简，多一个包要说明为什么不能用现有能力实现。
5. **截图与日志请脱敏**。序列号、IMEI、账号信息请先打码。

### 18.3 代码风格

- TypeScript strict 模式，`noUnusedLocals` / `noUnusedParameters` / `noImplicitOverride` 全部开启。
- 注释用中文，写「为什么」不写「是什么」。
- 提交信息用中文，格式：`类型: 动作`，例如 `应用管理: 修复停用系统包后无法恢复`。
- 单文件不超过约 500 行；超了就拆，服务按分区拆，组件按职责拆。

### 18.4 `any` 已归零（曾经的取舍与现在的做法）

早期版本里 `src/core/transport/driver.ts` 有 18 处 `any`，理由是「`@yume-chan/*` 自带的 `ReadableStream` 与 DOM 的 `ReadableStream` 不兼容，标注了必然在十几个调用点报错」。这个理由只对了一半：报错是真的，但那两个 `ReadableStream` **在运行时是同一个类** —— `@yume-chan/stream-extra` 的 `esm/stream.js` 直接 `export { ReadableStream }`，取的就是 `globalThis.ReadableStream`。冲突只存在于 `.d.ts` 声明形状（一个有零参 `getReader()` 重载，一个没有），不是真实的对象差异。

弄清这点之后，18 处全部收掉了，没有一处用 `as unknown as` 硬转：

| 原来的 `any` | 处数 | 现在的写法 |
|---|---|---|
| `Libs` 接口的五个字段（`adb` / `stream` / `usb` / `CredentialStore` / `manager`） | 5 | 改用 `typeof import('@yume-chan/adb')` 这类表达式类型 —— 由动态 import 的返回值直接推导，包升级也不会失真 |
| 访问 `libs.*` 成员时的 `as any`（`Consumable`、`MaybeConsumable`、`default`、`AdbDaemonWebUsbDeviceManager.BROWSER`） | 4 | 全部去掉断言。命名空间的类型本来就带这些导出，`as any` 只是当年为了绕开「没写形参类型」而顺手加的 |
| `Driver` 的字段与形参（`#adb`、`#sessions`、构造函数 `adb`、`get raw()`、`#withSync` 的 `sync`） | 5 | `Adb` / `Set<AdbSync>` / `(sync: AdbSync) => Promise<T>`；`get raw()` 返回 `Adb` |
| `authenticate()` 的 `connection` 与 `transport` 回调形参 | 2 | `AdbDaemonConnection` / `AdbDaemonTransport`（由 `authenticate()` 的返回类型推导） |
| `connectUsb()` 的 `selected` 与 `(error as any)?.name` | 2 | `AdbDaemonWebUsbDevice`（`ConnectOptions.device` 一并标注）；错误判定改 `instanceof libs.usb.AdbDaemonWebUsbDevice.DeviceBusyError`，比读 `name` 字符串可靠，压缩器改不掉 |
| **合计** | **18** | 零 `any`，且无一处 `as unknown as` |

真正需要绕开的只有一处形状差异：读流时不能把 DOM 的 `ReadableStream` 直接传给按包内类型声明的形参。解法不是断言，而是新增一个窄结构接口：

```ts
// 只要求「能拿 reader、能读、能放锁」。DOM 流与包内的流都天然满足。
interface ByteSource {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    releaseLock(): void;
  };
}
```

`collect()` 用它收参，`exec()` / `read()` 里的两边流都能直接传进来。反方向（把 `File.stream()` 交给 `sync.write()`）则用包自己的 `ReadableStream` 构造器重新包一层，接上 DOM reader 的 `pull`：运行时两者是同一个构造器，这一步是零拷贝，只是让类型对得上。

现在 `npm run lint` 的 `no-explicit-any` 是**全仓生效**，`eslint.config.js` 里原先给 `driver.ts` 的例外已经删掉；`verify:docs` 也会重新数一遍 `any`，只要再出现一处就失败。全仓 94 个 `.ts` / `.tsx` 文件、0 处 `any`（含 15 个测试文件）。

唯一遗留的是「UI 层不得 import `@yume-chan/adb`」这条分层约束，仍靠代码评审维持，尚未落成自定义 ESLint 规则。

---

## 十九、版权与许可

本项目按目录分层授权，**只使用 Apache License 2.0 与 MIT 两种宽松许可证**，全文见 [LICENSE](LICENSE)（Apache-2.0）与 [LICENSE-MIT](LICENSE-MIT)（MIT），分层说明见 [LICENSING.md](LICENSING.md)。

| 路径 | 许可 |
|---|---|
| `src/services/` `src/tools/` `src/core/transport/` | Apache-2.0 |
| `src/core/`（其余）、`src/ui/`、`src/node/`、`scripts/`、`skill/`、`public/` | MIT |
| `index.html` `dev-preview.html` `vite.config.ts` `tsconfig*.json` `package.json` `.github/` | MIT |
| 品牌名称、Logo 与界面设计 | 保留所有权利 |

**默认归属**：上表未列出的本项目自研文件，一律适用根 `LICENSE`（Apache-2.0）。本仓库没有 `bin/` 目录（命令行入口是 `src/node/cli.ts`，产物不入库）；逐路径路由与再分发须保留的文件清单见 [LICENSING.md](LICENSING.md)。

```
Copyright (c) 2026 星玖工作室 Ntarstudio

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

两种许可都可商用、可修改、可闭源、可再许可，**没有传染性**：你的衍生作品无需开源。再分发时保留版权声明、许可全文与 [NOTICE](NOTICE) 即可。Apache-2.0 另外提供明示专利授权（第 3 条）。

本项目是零服务端静态 PWA：没有后端、没有数据库，产物直接跑在用户浏览器里。因此不存在「用 AGPL 约束网络服务」的场景——真要研究实现，打开 DevTools 就能读到。

「Webroit」名称、Logo 与界面设计归星玖工作室（Ntarstudio）所有，不在代码许可授权范围内。

第三方组件保留各自的版权与许可证，详见 [NOTICE](NOTICE)。

---

## 二十、NOTICE 开源合规声明

完整的第三方组件披露（名称、版本、版权方、许可证、官方地址、用途、是否修改、许可证原文）见 [NOTICE](NOTICE)。该文件独立编写，不能由本节代替。

### 20.1 披露口径

| 类别 | 数量 | 是否随产物分发 |
|---|---|---|
| 运行时直接依赖 | 6 | 是 |
| 运行时传递依赖 | 4 | 是 |
| 构建期依赖 | 15 | 否，不进入 `dist/` |
| 平台相关可选二进制条目 | 52 | 否，按平台只装一个 |
| 随包分发的二进制组件 | 0 | — |

合计 25 个组件。早期规划中的 `scrcpy-server`（Apache-2.0）因投屏未实现，当前**不在**仓库与产物中。

### 20.2 许可证分布

| 许可证 | 数量 | 组件 |
|---|---|---|
| MIT | 22 | 除下列三项外的全部 |
| ISC | 1 | `picocolors` |
| BSD-3-Clause | 1 | `source-map-js` |
| Apache-2.0 | 1 | `typescript` |

四种均为宽松许可，与项目自身的 Apache-2.0 / MIT 兼容。**没有任何 GPL / LGPL / AGPL / MPL 等 copyleft 组件**，因此不存在上游许可冲突的问题。

### 20.3 特别说明

1. **ADB 协议**由 Google 以 Apache-2.0 发布。本项目使用的 `@yume-chan/adb` 是该协议的独立 TypeScript 重新实现（MIT），不是 Google 代码的衍生作品。
2. **本项目的全部图标为手写 SVG path**，不使用任何厂商 Logo，不引入外部图标库或图标字体。
3. **字体使用系统字体栈**（`-apple-system`、`PingFang SC`、`Microsoft YaHei` 等），不下载、不分发任何 webfont 文件。
4. **界面中出现的品牌名称**（小米、OPPO、vivo、华为、三星等）仅作为设备识别与功能分流的依据，属于描述性使用，不涉及商标授权。
5. **本项目不使用任何来源不明或许可证未标注的代码、文案、图片**。全部代码从零实现。

### 20.4 依赖变更时的维护义务

`package.json` 或 `package-lock.json` 变动后，必须同步更新 [NOTICE](NOTICE) 与本节的数量统计。核对方式：

```bash
npm ci
node -e "const d=require('./package-lock.json');const p=d.packages;const s=new Set();for(const k in p){if(!k)continue;const n=k.split('node_modules/').pop();if(n.startsWith('@esbuild/')||n.startsWith('@rollup/'))continue;s.add(n)}console.log(s.size,'组件')"
```

输出应为 25。数字不符说明有新增或移除，需更新披露。

---

## 免责声明

```
使用本工具即表示你已理解并接受以下内容：

1. 本工具通过 ADB / Fastboot 协议直接操作 Android 设备，属于底层操作。
   任何操作都存在导致数据丢失、系统异常或设备无法开机的可能。

2. 本工具仅在你主动授权的前提下工作。设备端的「允许 USB 调试」确认
   是唯一授权凭证，本工具不提供、也不接受任何绕过该确认的方式。

3. 刷写分区、擦除分区、修改系统属性等操作的风险由使用者自行承担。
   请务必在操作前备份重要数据，并确认所用镜像与设备型号严格匹配。

4. 本工具不提供解锁 Bootloader、绕过激活锁、绕过屏幕锁、破解他人设备
   的功能，也不为上述用途提供任何协助。

5. 本软件按 Apache-2.0 与 MIT 许可「按现状」提供，不附带任何明示或暗示的担保。
   作者与贡献者不对因使用本软件产生的任何直接或间接损失承担责任。

6. 本工具不采集、不上传任何用户数据。所有设备操作均在你的浏览器与本机
   USB 连接之间完成。
```

---

## 相关文件

仓库内与本 README 配套的文件：

| 文件 | 内容 |
|---|---|
| [`README_EN.md`](README_EN.md) | 英文版，与本文件章节一一对应 |
| [`NOTICE`](NOTICE) | 第三方组件逐项披露与许可证原文 |
| [`LICENSE`](LICENSE) | Apache-2.0 全文（GitHub 据此识别） |
| [`LICENSE-MIT`](LICENSE-MIT) | MIT 全文 |
| [`LICENSING.md`](LICENSING.md) | 分层路由表 |
| [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) | Pages 自动部署流程 |
| [`package.json`](package.json) | 依赖与构建脚本 |
| [`public/sw.js`](public/sw.js) | Service Worker 源码 |

项目在规划阶段另有一批内部设计文档（功能清单、技术方案、决策记录、风险合规、实机验证清单等），不随仓库分发。这些文档的内容已按实际实现情况提炼进本 README 的对应章节。
