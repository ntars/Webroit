---
name: webroit
description: 通过本机 adb 操作安卓设备。用于查看设备与硬件状态、启停冻结应用、调整分辨率与 DPI、截屏、安装与提取 APK、推送拉取文件、调校系统参数（字体、动画、状态栏、锁屏时间）、模拟电池状态、清理厂商预装组件。当用户提到安卓手机、ADB、玩机、改 DPI、冻结应用、清除预装、截屏、导出 APK 等需求时使用。也适用于排查「手机界面被调乱」「WiFi 显示无法访问网络」「误删系统应用」这类需要恢复现场的问题。
---

# Webroit · 安卓设备操作

Webroit 提供 34 项安卓设备操作能力。同一套能力有三种调用方式，**优先用 MCP，其次用命令行**。

## 三种接入方式

| 方式 | 适用场景 | 接入成本 |
|---|---|---|
| **MCP Server**（推荐） | 你支持 MCP 协议 | 配一条命令即可，工具列表自动注入 |
| **命令行 `webroit`** | 你只能执行 shell | 需要用户已有该命令（`npm i -g` 或本地 `bin/webroit`） |
| **网页版** | 用户自己在浏览器里操作 | 无需接入，让用户自己去 https://ntars.github.io/Webroit/ |

### MCP 接入

```bash
node /path/to/Webroit/bin/webroit-mcp
```

stdio 传输，无需额外参数。注册后你会看到 35 个工具：1 个设备列举 + 34 个功能工具，命名规则为 `webroit_<分区>_<动作>`，例如 `webroit_apps_control`。

### 命令行接入

```bash
webroit devices                    # 先确认有设备
webroit tools --verbose            # 看全部功能与参数
webroit run display.read --json    # 执行，加 --json 拿结构化结果
```

## 使用前必须确认的环境

Webroit 走**本机 adb**，不是 WebUSB。WebUSB 只能在浏览器里运行，任何外部进程都用不了那条通道。所以：

1. 本机已安装 Android platform-tools（`adb version` 能跑通）
2. `adb devices` 能看到设备，且状态是 `device` 而不是 `unauthorized` / `offline`

不满足就先解决环境，不要盲目调用工具——那只会得到一串「未探测到设备」。

## 风险门控（这是硬规则）

每个工具有风险等级，标在工具描述里：

| 等级 | 含义 | 调用要求 |
|---|---|---|
| 只读 | 不改设备 | 随时可调 |
| 可逆 | 有明确逆操作 | 随时可调 |
| 需确认 | 改动设备状态 | **必须传 `allowDangerous: true`**（CLI 是 `--allow-dangerous`） |
| 高危 | 可能不可逆 | **必须传 `allowDangerous: true`** |

不传会被服务器直接拒绝。这不是障碍，是让你在调用记录里留下「我确实要这么做」的痕迹。

**自己决定要不要传，但满足以下任一条件时必须先问用户**：
- 高危工具（清数据、卸载、恢复出厂类、重启到 EDL）
- 批量操作超过 5 个包名
- 目标设备不明确（多台在线且用户没说哪台）

## 标准工作流

### 1. 先看现状，再动手

任何「改」的操作前，先调对应的「读」：

```
webroit_devices                          → 确认设备在线
webroit_display_read                     → 记下当前分辨率与 DPI
webroit_system_read                      → 记下字体缩放、动画倍率
webroit_apps_inspect {package}           → 确认包名存在、看当前状态
```

DPI 从 420 改到 1000 会让界面大到点不动，而用户往往说不清原值是多少。**读一次的成本远低于猜错。**

### 2. 品牌工具必须先扫后停

`vendor.*` 类工具分两步，顺序不能反：

```
webroit_vendor_xiaomi_scan               → 拿到组件清单与各自作用
  ↓ 挑出用户确实要停的
webroit_vendor_xiaomi_disable {packages: "com.x,com.y", action: "disable"}
```

品牌判定是自动的：小米设备只有 `xiaomi` 那组工具可用。调错品牌会返回「当前不可用」。

### 3. 改完留退路

- `webroit_system_rollback` 能把本次会话改过的分辨率、DPI、系统参数按逆序还原
- `webroit_system_emergency` 是「界面大到点不动」时的急救：强制拉回物理值，不依赖任何先决条件
- `webroit_apps_installState {action: "restore"}` 能把卸载掉的系统应用装回来

## 常用场景速查

**DPI 调乱了，界面点不动**
→ `webroit_system_emergency`（无参数，直接执行）

**WiFi 已连接但显示「无法访问网络」**
→ `webroit_system_wifi`（无参数）

**某个应用卸载不掉 / 被误删**
→ 防误删：`webroit_apps_lock {package, lock: true}`
→ 恢复系统应用：`webroit_apps_installState {package, action: "restore"}`

**清理预装与广告（小米为例）**
→ `webroit_vendor_xiaomi_scan` → 挑选 → `webroit_vendor_xiaomi_disable`

**导出某个应用的安装包**
→ `webroit_files_extract {package: "com.tencent.mm"}`
→ 分卷应用会自动打包成 zip

**截屏**
→ `webroit_display_screenshot`（无参数）。产物落在 `WEBROIT_OUT_DIR` 或当前目录

**手机没反应，想强制重启**
→ `webroit_device_reboot {mode: "system"}`。`edl` 是深度刷机模式，非必要不要用

## 参数怎么填

详细参数见 `references/tools.md`，几个易错点先说明：

- **布尔参数**：CLI 里写 `--lock=true`，不是 `--lock`
- **多个包名**：逗号分隔，`--packages="com.a,com.b"`
- **文件参数**：传本地路径，不是文件内容。`files.install` 与 `files.transfer` 的 `file` 都是路径
- **`files.transfer` 的方向**：`push` 推送到手机（要给 `file`），`pull` 从手机拉取（只给 `remote`）

## 出错了怎么读

CLI 退出码固定，可据此分支：

| 退出码 | 含义 | 该怎么办 |
|---|---|---|
| 0 | 成功 | — |
| 1 | 执行失败（设备出错、命令失败） | 看错误信息；设备类问题重试无用，先检查连接 |
| 2 | 用法错误（参数缺失、工具不存在、越权） | 改参数重试；不要重复同样的调用 |

MCP 侧对应 `isError: true`，文本里会写清是缺参数还是设备不支持。

## 不要做的事

- **不要在没读现状的情况下改显示参数**。用户记不住原值，你也猜不到
- **不要为了「看起来干了活」而跳过 `scan` 直接 `disable`**。停错组件会让系统功能残缺，且不容易查出来
- **不要在多台设备在线时随便挑一台**。改错手机的分辨率不可逆。服务器会主动报错要求指定序列号
- **不要用 `system.write` 写不在枚举里的 key**。工具只开放了 5 个安全 key，其余一律拒绝
