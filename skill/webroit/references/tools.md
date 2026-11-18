# Webroit 工具参数参考

> 本文件由 `scripts/gen-skill-docs.mjs` 从代码自动生成，请勿手改。

共 34 个工具：通用 24 个，每台设备可用 26 个，覆盖 5 个品牌。

风险分布：只读 11 · 可逆 7 · 需确认 11 · 高危 5

## 索引

- **设备总览**：`device.reboot`
- **应用管理**：`apps.batch`、`apps.control`、`apps.data`、`apps.inspect`、`apps.installState`、`apps.lock`
- **显示与输入**：`display.input`、`display.read`、`display.screenshot`、`display.write`
- **文件传输**：`files.extract`、`files.install`、`files.list`、`files.transfer`
- **系统调校**：`system.emergency`、`system.immersive`、`system.read`、`system.rollback`、`system.statusIcons`、`system.wifi`、`system.write`
- **电池管理**：`battery.restore`、`battery.simulate`
- **品牌专区**：`vendor.huawei.disable`、`vendor.huawei.scan`、`vendor.oppo.disable`、`vendor.oppo.scan`、`vendor.samsung.disable`、`vendor.samsung.scan`、`vendor.vivo.disable`、`vendor.vivo.scan`、`vendor.xiaomi.disable`、`vendor.xiaomi.scan`

## 设备总览

### `device.reboot` · 重启设备

重启系统、进入 Recovery / Bootloader / EDL，或直接关机

- 风险：**高危**（需 `allowDangerous`）

| 参数 | 说明 |
| --- | --- |
| `mode` | 必填 · 类型 select · 默认 `"system"` · 取值 `system` / `recovery` / `bootloader` / `fastboot` / `edl` / `poweroff`<br>进入 Recovery / Bootloader / EDL 后 ADB 连接会断开，属正常现象 |

## 应用管理

### `apps.batch` · 批量处理

对多个包名执行同一动作，逐条执行并汇总每条结果

- 风险：**高危**（需 `allowDangerous`）

| 参数 | 说明 |
| --- | --- |
| `packages` | 必填 · 类型 textarea<br>每行一个，或用逗号、空格分隔，例如 com.a.b
com.c.d |
| `action` | 必填 · 类型 select · 默认 `"disable"` · 取值 `disable` / `enable` / `forceStop` / `clearData` / `uninstall`<br>动作 |

### `apps.control` · 启停应用

冻结（停用）或解冻应用，也可以强制结束它的进程

- 风险：**需确认**（需 `allowDangerous`）

| 参数 | 说明 |
| --- | --- |
| `package` | 必填 · 类型 text<br>包名，例如 com.tencent.mm |
| `action` | 必填 · 类型 select · 默认 `"freeze"` · 取值 `freeze` / `unfreeze` / `stop`<br>冻结后应用图标仍在，但无法启动；解冻可完全恢复原状 |

### `apps.data` · 清除应用数据

清空应用的账号、设置与缓存，等同于系统里的「清除全部数据」

- 风险：**高危**（需 `allowDangerous`）

| 参数 | 说明 |
| --- | --- |
| `package` | 必填 · 类型 text<br>包名，例如 com.tencent.mm |

### `apps.inspect` · 查看应用详情

版本号、安装路径、申请权限、安装与更新时间

- 风险：**只读**（直接调用）

| 参数 | 说明 |
| --- | --- |
| `package` | 必填 · 类型 text<br>包名，例如 com.tencent.mm |

### `apps.installState` · 卸载与恢复

卸载应用，或把卸载掉的系统应用重新装回来

- 风险：**高危**（需 `allowDangerous`）

| 参数 | 说明 |
| --- | --- |
| `package` | 必填 · 类型 text<br>包名，例如 com.tencent.mm |
| `action` | 必填 · 类型 select · 默认 `"uninstall"` · 取值 `uninstall` / `uninstall-keep` / `restore`<br>动作 |

### `apps.lock` · 卸载保护

锁定后应用在桌面与商店里无法被卸载，可用于防误删

- 风险：**需确认**（需 `allowDangerous`）

| 参数 | 说明 |
| --- | --- |
| `package` | 必填 · 类型 text<br>包名，例如 com.tencent.mm |
| `lock` | 可选 · 类型 select · 默认 `"true"` · 取值 `true` / `false`<br>操作 |

## 显示与输入

### `display.input` · 模拟操作

发送按键、点击坐标、滑动或输入文字

- 风险：**需确认**（需 `allowDangerous`）

| 参数 | 说明 |
| --- | --- |
| `kind` | 必填 · 类型 select · 默认 `"key"` · 取值 `key` / `tap` / `swipe` / `text`<br>操作类型 |
| `key` | 可选 · 类型 select · 默认 `"4"` · 取值 `4` / `3` / `187` / `26` / `24` / `25` / `164` / `82` / `27` / `84` / `66` / `67` / `224` / `223` / `120`<br>仅「按键」需要选择 |
| `longPress` | 可选 · 类型 boolean · 默认 `false`<br>仅「按键」有效，如长按电源键弹出关机菜单 |
| `x1` | 可选 · 类型 number · 范围 0 ~ 16384<br>起点 X，例如 540 |
| `y1` | 可选 · 类型 number · 范围 0 ~ 16384<br>起点 Y，例如 1200 |
| `x2` | 可选 · 类型 number · 范围 0 ~ 16384<br>仅「滑动」需要填写，例如 540 |
| `y2` | 可选 · 类型 number · 范围 0 ~ 16384<br>仅「滑动」需要填写，例如 400 |
| `text` | 可选 · 类型 text<br>仅「输入文字」需要填写，只支持 ASCII，例如 hello world |

### `display.read` · 读取显示参数

当前分辨率、屏幕密度、最小宽度 dp

- 风险：**只读**（直接调用）
- 参数：无

### `display.screenshot` · 截屏

截取当前屏幕并保存到本地

- 风险：**只读**（直接调用）
- 参数：无

### `display.write` · 修改显示参数

调整分辨率或屏幕密度，也可以还原为出厂值

- 风险：**高危**（需 `allowDangerous`）

| 参数 | 说明 |
| --- | --- |
| `target` | 必填 · 类型 select · 默认 `"resolution"` · 取值 `resolution` / `density` / `reset`<br>改错可能导致界面错位，可用「还原到出厂值」恢复 |
| `width` | 可选 · 类型 number · 范围 320 ~ 7680<br>仅「分辨率」需要填写，例如 1080 |
| `height` | 可选 · 类型 number · 范围 320 ~ 7680<br>仅「分辨率」需要填写，例如 2400 |
| `density` | 可选 · 类型 number · 范围 72 ~ 1000<br>仅「屏幕密度」需要填写，单位 DPI，例如 420 |

## 文件传输

### `files.extract` · 提取安装包

把已安装应用的 APK 导出到本地，分卷应用自动打包成 zip

- 风险：**只读**（直接调用）

| 参数 | 说明 |
| --- | --- |
| `package` | 必填 · 类型 text<br>包名，例如 com.tencent.mm |

### `files.install` · 安装 APK

安装单个 APK，或一次选中多个分卷包完成整套安装

- 风险：**需确认**（需 `allowDangerous`）

| 参数 | 说明 |
| --- | --- |
| `file` | 必填 · 类型 file<br>分卷包请一次选中全部 .apk 文件 |
| `downgrade` | 可选 · 类型 boolean · 默认 `false`<br>安装版本号低于当前已装版本的包 |

### `files.list` · 浏览目录

列出手机上某个目录的文件与子目录

- 风险：**只读**（直接调用）

| 参数 | 说明 |
| --- | --- |
| `path` | 必填 · 类型 text · 默认 `"/sdcard"`<br>目录路径，例如 /sdcard |

### `files.transfer` · 传输文件

把本地文件推送到手机，或从手机拉取文件到本地

- 风险：**可逆**（直接调用）

| 参数 | 说明 |
| --- | --- |
| `direction` | 必填 · 类型 select · 默认 `"push"` · 取值 `push` / `pull`<br>方向 |
| `file` | 可选 · 类型 file<br>仅「推送到手机」需要选择 |
| `remote` | 必填 · 类型 text · 默认 `"/sdcard/Download/"`<br>推送时以 / 结尾表示目录，会自动补上文件名；拉取时填完整文件路径，例如 /sdcard/Download/a.txt |

## 系统调校

### `system.emergency` · 应急重置显示

界面大到点不动时用这个：强制把分辨率、DPI、字体拉回物理值

- 风险：**需确认**（需 `allowDangerous`）
- 参数：无

### `system.immersive` · 沉浸模式

隐藏状态栏或导航栏，获得完整屏幕显示

- 风险：**可逆**（直接调用）

| 参数 | 说明 |
| --- | --- |
| `kind` | 可选 · 类型 select · 默认 `"full"` · 取值 `full` / `status` / `navigation` / `reset`<br>模式 |

### `system.read` · 读取系统参数

当前字体缩放、三种动画倍率、自动锁屏时间

- 风险：**只读**（直接调用）
- 参数：无

### `system.rollback` · 一键还原设置

把本次会话改过的分辨率、DPI、系统参数按逆序还原到改动前的值

- 风险：**可逆**（直接调用）

| 参数 | 说明 |
| --- | --- |
| `scope` | 可选 · 类型 select · 默认 `"all"` · 取值 `all` / `display` / `system`<br>只还原本次会话内的改动，不会碰本次会话之前的状态 |

### `system.statusIcons` · 状态栏图标

隐藏状态栏上不需要的图标，保留其余设置不变

- 风险：**可逆**（直接调用）

| 参数 | 说明 |
| --- | --- |
| `hidden` | 可选 · 类型 text · 默认 `""`<br>留空表示全部恢复。可选：clock / location / headset / cast / alarm_clock / volume / mobile / airplane / bluetooth / battery / wifi / nfc，例如 nfc, alarm_clock |

### `system.wifi` · 修复 WiFi 验证

解决已连接 WiFi 却提示「无法访问网络」的感叹号问题

- 风险：**可逆**（直接调用）
- 参数：无

### `system.write` · 修改系统参数

调整字体缩放、动画倍率或自动锁屏时间

- 风险：**可逆**（直接调用）

| 参数 | 说明 |
| --- | --- |
| `key` | 必填 · 类型 select · 默认 `"window_animation_scale"` · 取值 `window_animation_scale` / `transition_animation_scale` / `animator_duration_scale` / `font_scale` / `screen_off_timeout`<br>参数 |
| `value` | 必填 · 类型 number · 默认 `0.5` · 范围 0 ~ 86400<br>动画倍率填 0~4（0 关闭、1 默认）；字体填 0.85~1.3；锁屏时间填 15~1800 秒 |

## 电池管理

### `battery.restore` · 还原电池状态

把模拟过的参数逐项写回真实值

- 风险：**可逆**（直接调用）
- 参数：无

### `battery.simulate` · 模拟电池

伪造电量、温度、电压，或模拟不同的充电来源

- 风险：**需确认**（需 `allowDangerous`）

| 参数 | 说明 |
| --- | --- |
| `kind` | 必填 · 类型 select · 默认 `"level"` · 取值 `level` / `temperature` / `voltage` / `status` / `source`<br>模拟项目 |
| `value` | 可选 · 类型 text<br>电量 0~100；温度 -50~150℃；电压 3000~5000mV；充电状态可填 unknown / charging / discharging / not-charging / full；充电来源可填 usb / ac / wireless / unplugged，例如 15 |

## 品牌专区

### `vendor.huawei.disable` · 停用 / 恢复组件

批量停用选中的系统组件，可随时恢复

- 风险：**需确认**（需 `allowDangerous`）
- 仅限品牌：华为 / 荣耀

| 参数 | 说明 |
| --- | --- |
| `packages` | 必填 · 类型 textarea<br>从扫描结果里选填；仅允许停用清单内的组件，例如 com.miui.systemAdSolution |
| `action` | 可选 · 类型 select · 默认 `"disable"` · 取值 `disable` / `enable`<br>动作 |

### `vendor.huawei.scan` · 扫描系统广告与预装组件

列出可停用的系统组件及其当前状态，每项都标注实际作用

- 风险：**只读**（直接调用）
- 仅限品牌：华为 / 荣耀
- 参数：无

### `vendor.oppo.disable` · 停用 / 恢复组件

批量停用选中的系统组件，可随时恢复

- 风险：**需确认**（需 `allowDangerous`）
- 仅限品牌：OPPO / 一加 / 真我

| 参数 | 说明 |
| --- | --- |
| `packages` | 必填 · 类型 textarea<br>从扫描结果里选填；仅允许停用清单内的组件，例如 com.miui.systemAdSolution |
| `action` | 可选 · 类型 select · 默认 `"disable"` · 取值 `disable` / `enable`<br>动作 |

### `vendor.oppo.scan` · 扫描系统广告与预装组件

列出可停用的系统组件及其当前状态，每项都标注实际作用

- 风险：**只读**（直接调用）
- 仅限品牌：OPPO / 一加 / 真我
- 参数：无

### `vendor.samsung.disable` · 停用 / 恢复组件

批量停用选中的系统组件，可随时恢复

- 风险：**需确认**（需 `allowDangerous`）
- 仅限品牌：三星

| 参数 | 说明 |
| --- | --- |
| `packages` | 必填 · 类型 textarea<br>从扫描结果里选填；仅允许停用清单内的组件，例如 com.miui.systemAdSolution |
| `action` | 可选 · 类型 select · 默认 `"disable"` · 取值 `disable` / `enable`<br>动作 |

### `vendor.samsung.scan` · 扫描系统广告与预装组件

列出可停用的系统组件及其当前状态，每项都标注实际作用

- 风险：**只读**（直接调用）
- 仅限品牌：三星
- 参数：无

### `vendor.vivo.disable` · 停用 / 恢复组件

批量停用选中的系统组件，可随时恢复

- 风险：**需确认**（需 `allowDangerous`）
- 仅限品牌：vivo / iQOO

| 参数 | 说明 |
| --- | --- |
| `packages` | 必填 · 类型 textarea<br>从扫描结果里选填；仅允许停用清单内的组件，例如 com.miui.systemAdSolution |
| `action` | 可选 · 类型 select · 默认 `"disable"` · 取值 `disable` / `enable`<br>动作 |

### `vendor.vivo.scan` · 扫描系统广告与预装组件

列出可停用的系统组件及其当前状态，每项都标注实际作用

- 风险：**只读**（直接调用）
- 仅限品牌：vivo / iQOO
- 参数：无

### `vendor.xiaomi.disable` · 停用 / 恢复组件

批量停用选中的系统组件，可随时恢复

- 风险：**需确认**（需 `allowDangerous`）
- 仅限品牌：小米 / 红米

| 参数 | 说明 |
| --- | --- |
| `packages` | 必填 · 类型 textarea<br>从扫描结果里选填；仅允许停用清单内的组件，例如 com.miui.systemAdSolution |
| `action` | 可选 · 类型 select · 默认 `"disable"` · 取值 `disable` / `enable`<br>动作 |

### `vendor.xiaomi.scan` · 扫描系统广告与预装组件

列出可停用的系统组件及其当前状态，每项都标注实际作用

- 风险：**只读**（直接调用）
- 仅限品牌：小米 / 红米
- 参数：无

## 通用约定

- 布尔参数写 `true` / `false`，不是 `1` / `0`（CLI 里要带等号：`--lock=true`）
- 多个包名用逗号分隔：`--packages="com.a,com.b"`
- 文件类参数传本地绝对路径
- 风险 2 与 3 的工具必须显式放行：MCP 传 `allowDangerous: true`，CLI 加 `--allow-dangerous`
