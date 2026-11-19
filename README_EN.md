[简体中文](./README.md) | **English**

# Webroit

**Plug in a cable, open a page, start tinkering.**

**Webroit** is an Android tinkering toolbox that performs ADB operations on devices directly from the browser. It removes the entire layer of "install drivers, configure the environment, type commands" and leaves a single tab: app management, file transfer, terminal, display tuning, system tuning, battery diagnostics — 26 features today, all taking place between your browser and that one USB cable, with no server in between.

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

| Item | Content |
|---|---|
| Product | Webroit |
| Version | 0.1.0-dev |
| Status | Working prototype: 26 features implemented and passing build plus type checking; 9 functional sections including per-vendor branching (stock Android devices show 24, as the vendor zone is absent) |
| Live demo | <https://ntars.github.io/Webroit/> |
| Repository | <https://github.com/ntars/Webroit> |
| License | Apache-2.0 / MIT (layered) |
| Form factor | Browser single-page application (PWA, installable, opens offline) |
| Trademark | The "Webroit" name and interface belong to Ntarstudio |
| Backend | None. Static hosting, zero server |
| Code size | 62 source files, 16,113 lines (CSS and tests included) |
| Artifact size | 462 KB across 12 files; first paint roughly 56 KB gzipped |
| Dependencies | 25 components, all MIT / ISC / BSD / Apache-2.0 |

---

## 1. Name and Positioning

> **仓库描述 / Description**：`Webroit —— 浏览器里的安卓玩机工具箱：WebUSB 直连 ADB 与 Fastboot，26 项功能已实现、152 项规划，数据不出本机 | An in-browser Android toolbox: ADB and Fastboot over WebUSB, 26 features shipped and 152 planned, all data stays local.`
>
> **话题标签 / Topics**（20 个，仅英文）：`adb`, `android`, `android-tools`, `browser`, `fastboot`, `ntarstudio`, `pwa`, `scrcpy`, `typescript`, `webusb`, `ya-webadb`, `webroit`, `preact`, `vite`, `static-site`, `client-side`, `privacy-first`, `no-backend`, `file-manager`, `screen-mirroring`


**Name**: Webroit. A coined word joining `Web` and `roit`, carrying no acronym meaning. The sole reason for choosing a coined term is search uniqueness — generic labels such as `WebADB` are already used by several comparable sites and cannot serve as a distinct identifier.

**One-line positioning**: move everything Android tinkering requires into the browser — zero installation, zero drivers, zero backend, with data never leaving the local machine.

**Three boundaries of this positioning**:

1. **It is a toolbox, not a protocol library.** ADB is implemented underneath by Tango; what this project delivers is an interface and workflow a tinkerer can use directly, not an API for developers to call.
2. **It is a local direct connection, not remote control.** The device must be plugged into your own computer with a cable, and you tap "Allow" on your own phone screen. No path exists for operating someone else's device remotely.
3. **It is auditable open-source software, not a black box service.** All code is in the repository, all dependencies are in NOTICE, and no data is uploaded.

> **A note on the name**: during early planning the project used `WebADB` and later abandoned it deliberately. `WebADB` had become the community's generic term for the "ADB in a browser" category — `webadb.com`, `webadb.online`, `mirko-it/webadb` and others all use it — so it could neither identify this project nor avoid the impression that this project is a fork of one of those sites. The current name `Webroit` is specific to this project and **is not affiliated with any of the sites above**.

---

## 2. Overview

### 2.1 Background

The barrier to Android tinkering was never "can you use the commands" — it is **everything you must complete before those few lines of commands can be typed**.

To install an app, read a log, or change the DPI, you first have to: find the right Platform-Tools version, configure PATH, install a USB driver on Windows, write udev rules on Linux, and pray that the driver does not fight with Device Manager. Switch computers and all of it repeats. Borrow someone else's computer and you do not dare install anything.

What actually makes people give up, though, are the moments where "it is installed and it still will not connect" — you cannot tell whether the problem is the cable, the port, the driver, or an `adb.exe` still holding the interface in the background.

### 2.2 Problems Addressed

| Problem | Concrete manifestation |
|---|---|
| High environment cost | Installing tools, configuring paths, installing drivers consumes most of the time |
| Environment is not portable | Every new computer repeats the setup; public computers cannot be touched |
| Commands are not memorable | You know the DPI needs changing, not what follows `wm density` |
| Fragmented tooling | One program for installing packages, one for screen mirroring, another for logs |
| Risk is invisible | A copied command gives no hint what it changes or whether it can be undone |
| Results are not auditable | What a closed-source tool did is unknowable to the user |

### 2.3 Core Approach

**Delete the entire "environment preparation" layer; implement the tinkering features thoroughly.**

```
Conventional path:  download tools → configure environment → install drivers → connect device → type commands → check docs → type again
Webroit:            open the page → click connect → click the feature
```

Technically, the **WebUSB API** exposes USB devices to web pages directly, and `@yume-chan/adb` (Tango) implements the full ADB protocol in TypeScript. Combined, the browser becomes an ADB client that needs nothing installed.

In engineering terms, every feature is abstracted as an entry in a **tool registry**, and each entry carries its own parameter description. That single description drives three things at once: the UI form, the atomic step used by script orchestration, and the plugin extension point. This is what makes 152 planned feature points feasible within one project.

### 2.4 Intended Use

| Scenario | Concrete usage |
|---|---|
| Personal tinkering | Disable preinstalled apps, change DPI, adjust animation scale, capture logs, extract APK backups |
| Development debugging | Install builds on real hardware, live logs, mirrored operation, cross-device copy and paste |
| Test acceptance | Run one script across several devices in parallel, batch installation, batch screenshot comparison |
| After-sales support | Guide a user to open the page and plug in the phone while you read the device report directly |
| Teaching and demos | Students see the internals of a device without installing the SDK |
| Borrowed computers | Complete one operation on a public machine with zero installation, leaving no trace afterwards |

### 2.5 Non-Goals

1. No cloud ADB relay, no remote control platform.
2. No app store, no bundled APK download source.
3. No accounts, no cloud sync.
4. No iOS or HarmonyOS flashing.
5. No "one-click root".
6. No bootloader unlocking, activation-lock bypass, or screen-lock bypass.
7. No promise of success for EDL, Odin, or Amlogic proprietary protocols.

---

## 3. Core Features

### 3.1 Currently Implemented (v0.1)

Nine functional sections, seven of which carry 26 tool cards while two are whole interaction surfaces that carry no cards. `npm run build` and `tsc --noEmit` both pass.

| # | Section | Entries | Content |
|---|---|---|---|
| V1 | Device overview | 1 | Automatic hardware profile and live status collection; restart in 6 modes |
| V2 | App management | 6 | List, detail, start/stop, clear data, uninstall and restore, uninstall protection, batch |
| V3 | Display and input | 4 | Resolution and DPI read/write plus restore, screenshot, key/tap/swipe/text injection |
| V4 | File transfer | 4 | APK installation (including split APKs), two-way transfer, APK extraction, directory browsing |
| V5 | System tuning | 7 | Font and animation scale, lock screen timeout, status bar icons, immersive mode, WiFi validation fix, one-click restore, emergency reset |
| V6 | Battery management | 2 | Status reading and power sampling, parameter and charging-source simulation, exact restore |
| V7 | Vendor zone | 2 | Per-vendor lists of disable-able components, batch enable and disable |
| — | ADB terminal | 0 | Interactive shell session with working directory, command history, 3 persistent shortcuts |
| — | Operation log | 0 | Local record of mutating operations, filterable by status, exportable as JSON |

The terminal and operation log are marked 0 because they are not "a set of executable operations" but "a whole interaction surface" with no Tool to register (`ModuleMeta.viewOnly`). Device overview is marked 1 because the hardware profile and live status are collected as soon as the view opens, so no separate read card is needed.

**Where the number 26 comes from**: `src/tools/builtin.ts` ultimately exports 34 `Tool` objects — 24 declared directly, plus 10 in the vendor zone. The latter are generated from a template by `vendorTools()` (`vendor.{id}.scan` and `vendor.{id}.disable`), two per vendor across five vendors. `visibleTools()` filters by the current device's vendor, so:

| Device | Visible tools | Notes |
|---|---|---|
| Xiaomi / OPPO / vivo / Huawei / Samsung | 26 | 24 generic plus 2 for that vendor |
| Stock Android or any other brand | 24 | The vendor zone is not shown, hence two fewer |

"26" therefore denotes **the count visible on a supported vendor's device**, and that is the convention used throughout this document. Running `grep -c "id: '" src/tools/builtin.ts` yields 24 because the two vendor `id` values are built with template literals and do not match the literal pattern.

**Section boundary rule**: a feature appears in exactly one section and is never registered twice.
Typical merges already performed under the principle of "same entry point, same preconditions, complementary results":

| Before merge | After merge | Rationale |
|---|---|---|
| Freeze / unfreeze / force stop | App start-stop (one card plus an `action` parameter) | Same object, same precondition, only the direction differs |
| Change resolution / change DPI / restore display | Modify display parameters (one card) | All are `wm` commands; restore is their inverse |
| Font scale / animation scale / lock screen timeout | Modify system parameters (one card) | All are `settings put`; only the key differs |
| Battery level / temperature / voltage / charging source simulation | Simulate battery (one card) | All belong to the `dumpsys battery set` family |
| Device info card plus device status buttons | Keep only the auto-collected view | The view reads on entry; a second click is redundant |

Before adding a feature, check two things: is there an existing tool in this section with overlapping semantics? If so, add an `action` parameter rather than a new card.

### 3.2 How to Recover from a Bad Change

`settings put` and `wm` commands take effect **silently** — no system dialog, the interface changes immediately. Push the DPI to 1000 or the font scale to 2, and the UI becomes too large to reach any button. Recalling the original value from memory is unrealistic, and looking up "defaults" online is worse (every vendor differs).

Three lines of defence, from lightest to heaviest:

1. **Automatic snapshots.** Every `settings put` / `wm` write records the previous value first, and "one-click restore settings" replays them **in reverse order**. Reverse order is mandatory: change the DPI three times in a row (420 → 300 → 480) and only a backwards walk returns you to the original 420. Snapshots live in IndexedDB and survive a page reload, but are kept only for **the current session** — replaying stale values across sessions computes the wrong result.
2. **A standalone emergency entry** at `#/reset-display`. The whole page is one 462×64 button, with no sidebar and no `em` units. Measured with the root font size scaled to 2.5×, the button's size and position do not change at all, because every dimension on that page is in px and does not follow system scaling.
3. **Persistent terminal shortcuts.** The top bar keeps `wm size reset; wm density reset` permanently available; one tap executes it in any session, independent of the two mechanisms above.

The difference between 2 and 3: a snapshot restore returns to "the value you last set", while the emergency reset pulls back "the device's physical value". Use the former after a bad change, the latter when the interface is no longer operable.

### 3.3 How Vendor Differences Are Branched

The same task is done differently across vendors. Take "turn off system ads": Xiaomi disables `com.miui.systemAdSolution`, OPPO uses `com.coloros.oppoguardelf`, and Huawei goes through the `hw_app_ad` switch. Mixed into generic app management, a user facing thousands of package names has no idea which one to touch.

Vendor-specific capabilities are therefore collected into the **vendor zone**, determined by `detectVendor()` from `ro.product.brand` / `ro.product.manufacturer`, with `visibleTools()` in the tool registry filtering by the current vendor. The result: a Xiaomi device never shows Samsung's component list, and a stock Android device does not show the section at all.

Five vendors are covered today: Xiaomi, OPPO/OnePlus/realme, vivo/iQOO, Huawei/Honor, and Samsung. Every component is labelled with an objective function name and its actual impact, for example:

```
System ad service        com.miui.systemAdSolution     Impact: promotional slots inside system apps disappear; app functionality unaffected
Usage statistics         com.miui.analytics            Impact: usage behaviour is no longer reported; system updates unaffected
Quick App framework      com.miui.hybrid               Impact: Quick Apps cannot launch; ordinary apps unaffected
```

A "disable everything" button is deliberately absent — the list includes items such as system updates whose removal affects security, and a single button that disables all of them leaves no trail when something breaks. What is offered is "disable recommended items only", and the recommended set is purely promotional and statistical.

### 3.4 The Full Planned Blueprint

14 modules and 152 feature entries (each with risk level, required permissions, dependent commands, and degradation strategy) form the design blueprint. The following are design targets and are **not yet implemented**:

| # | Module | Entries | Summary |
|---|---|---|---|
| M1 | Connection management | 7 | USB direct, wireless pairing, multiple devices, health probing, fault diagnosis |
| M2 | Device information | 12 | Hardware profile, battery, storage, network, sensors, root/BL status, report export |
| M3 | App management | 18 | List, detail, icons, start-stop, uninstall, multi-APK install, extraction, permissions, batch |
| M4 | File management | 14 | Browse, upload and download, edit, recycle bin, permissions, search, large-file ranking, dual-pane compare |
| M5 | Terminal | 9 | Multi-tab PTY, split view, history, shortcuts, root session, export, error explanation |
| M6 | Screen and input | 11 | Mirroring, reverse control, audio, screen recording, screenshots, key and text injection, gesture replay, clipboard |
| M7 | System settings and tuning | 16 | Resolution, DPI, font, animation, status bar, immersive, dark mode, language, time zone, DNS, snapshot restore |
| M8 | Performance and monitoring | 10 | Per-core CPU, frequency, memory, processes, temperature, GPU, frame rate, network, battery power |
| M9 | Logs and diagnostics | 9 | Live logcat, warning highlighting, pause and review, crash records, dumpsys, bugreport, diagnostic wizard |
| M10 | Backup and restore | 7 | App data, full APK, directory backup, index, verification, encryption |
| M11 | Scripting and automation | 8 | Visual orchestration, atomic step library, recording, conditional loops, scheduling, multi-device dispatch, reports |
| M12 | Fastboot and flashing | 12 | Variable reading, partition flashing, large image chunking, temporary boot, erase, A/B switching, update.zip |
| M13 | Advanced and experimental | 9 | Property editing, partition images, battery simulation, weak network simulation, wake locks, proprietary protocol entry points |
| M14 | Platform capabilities | 10 | PWA, offline, plugin system, tool registry, i18n, theming, accessibility, auditing |

### 3.5 Selected Highlights

The following are explicitly split into two groups: those shipped in v0.1 and those that remain design targets. They are separated so that planning does not read as current state.

**Already working:**

**Settings snapshots with reverse-order rollback.** Every `settings put` / `wm` change records its previous value into IndexedDB before execution. "One-click restore settings" replays them in reverse order, returning the device to the state at the start of the current session. This is backed by the `#/reset-display` emergency entry and persistent terminal shortcuts — three layers of fallback.

**Risk grading with confirmation.** Every feature is labelled as one of four levels: read-only / reversible / needs confirmation / high risk. The interface changes shape accordingly: read-only executes immediately, reversible offers a restore path, needs-confirmation raises a dialog, and high risk requires typing the word "confirm" before proceeding. The level-3 gate is unaffected by preference toggles — uninstall, clear data, and entering EDL have no undo path, and that gate must not be switchable by the user. Mutating operations are also written to the local audit record, filterable by status and exportable as JSON.

**PWA offline capability.** The Service Worker precaches 11 files (every build artifact except the Service Worker itself), so reopening the page after losing network still renders completely, including the lazily loaded ADB transport layer; the app installs as a desktop application and launches from a desktop icon. Updates do not take over automatically — when a new version appears, a bar at the top lets the user decide when to refresh. This shipped in v0.1; see 4.7 and 5.14 for details.

**Still planned:**

**Multi-device parallel panel.** Three phones connected at once, each with its own session, its own tool state, and its own progress bar; a batch script is dispatched once and reports success per device. The current implementation is single-device; `DeviceSession` is architected to support multiple instances, but the UI has no switching yet.

**Tool registry extended to script orchestration.** Every feature is a `Tool` object: `{ id, risk, params, available(), run() }`, with the form generated from `params` — that part is implemented. What is planned is using the same object as the atomic step for script orchestration and as the plugin interface, so that "adding a feature does not change the framework" also covers the scripting layer.

**Fastboot on the same page.** ADB only covers "while the device is booted"; flashing needs Fastboot. The plan is to integrate `android-fastboot` so that "read information" through "flash a partition" follow one path. Not implemented today.

---

## 4. Core Characteristics

### 4.1 Zero Installation, Zero Drivers, Zero Backend

**Value**: removes the single biggest reason people give up — "half an hour of installation and it still will not connect".

**Implementation**: the browser connects directly to the device's USB interface via WebUSB, and `@yume-chan/adb` implements the complete ADB protocol in TypeScript (handshake, RSA authentication, stream multiplexing, the sync file protocol). The entire application is static files with no server process.

**Differentiation**: desktop GUI toolboxes require installation, administrator rights, and Windows only; the command line requires environment setup; this project needs only a URL, with one codebase running on Windows, macOS, Linux, ChromeOS, and Android phones.

**Evidence**: the output is a static `dist/`, deployable to any HTTPS static host; `grep -r "http" dist/` contains no backend address belonging to this project; there is no database, no container, and no deployment secret.

### 4.2 Data Never Leaves the Machine

**Value**: device operations touch personal information, accounts, and file contents; any upload is unacceptable.

**Implementation**: no backend means no upload path. Device communication runs over USB, local state lives in IndexedDB / localStorage, there are no network reporting calls, and no third-party CDN resources are loaded.

**Differentiation**: most online ADB sites claim "front-end only processing" yet depend on CDNs and analytics scripts, making actual outbound behaviour hard to audit. This project **collects nothing**, and the artifact can be verified with `grep`.

**Evidence**: `grep -rE "gtag|sentry|umami|plausible|google-analytics" dist/` returns nothing. The artifact contains 5 absolute URLs in total, all of which are SVG namespace identifiers or strings written into device settings, producing no browser request whatsoever (itemised in 13.2).

**A further note on offline caching**: the Service Worker caches same-origin resources only and never intercepts cross-origin requests. There is therefore no path by which "the offline cache sends data back to a third party", and this can be read directly from `isCacheable()` in `sw.js`: not GET, not http(s), or not same-origin — any one of the three returns immediately.

### 4.3 Risk Grading Instead of "Feature Pile-Up"

**Value**: the real danger in a tinkering tool is not a shortage of features but dangerous features that do not say so.

**Implementation**: `Tool.risk` has four levels (read-only / reversible / needs confirmation / high risk) that determine the UI shape — the needs-confirmation level raises a dialog, the high-risk level additionally requires typing the word "confirm", and that level is unaffected by preference toggles. When `available()` returns `false` or a reason string, the unusable tool states why in its card description instead of failing after the user clicks. Operations at risk level 2 and above are written to the local audit record, including the actual commands executed.

**Differentiation**: comparable tools generally execute on a single click and leave the user with no idea what happened when something goes wrong. This project writes "what this step changes and whether it can be undone" next to the button, and genuinely provides a restore path — changes can be reverted, and reversions can be inspected.

**Current boundaries**: there is no "permission declaration" field — `available()` is based on the real device capabilities probed at connection time (whether `wm` / `pm` / `settings` / `dumpsys` work), which is more accurate than a static declaration. There is also no built-in critical-package protection list: `apps.uninstall` sends system apps through `pm uninstall` and lets the system itself refuse, because a whitelist goes stale and blocks legitimate advanced use. Both are planned.

**Evidence**: `Tool.risk` and `available()` live in `src/tools/registry.ts`; audit writes live in `src/core/audit.ts` and `src/ui/components/ToolCard.tsx`.

### 4.4 One Parameter Description, Reused in Four Places

**Value**: if every feature required writing a UI, a script step, and a plugin interface separately, the work would triple and drift.

**Implementation**: `Tool.params` describes parameters as a schema (`text` / `number` / `select` / `boolean` / `file` / `textarea`), and the UI form is rendered from that schema — adding a tool means adding one object to the registry, with zero changes to `ModuleView` or `ToolCard`.

That single schema now serves **four** consumers, all derived from `BUILTIN_TOOLS` at runtime. Not one of them is a hand-written second copy:

| Consumer | How it reads the schema | Code |
|---|---|---|
| Web form | renders `ParamField` by `type` | `src/ui/components/ToolCard.tsx` |
| CLI | `run <tool-id> --key=value`, with type coercion and range checks | `coerceParams()` in `src/node/runtime.ts` |
| MCP Server | converts to JSON Schema for agents | `toInputSchema()` in `src/node/mcp.ts` |
| Skill docs | generates the parameter tables in `references/tools.md` | `scripts/gen-skill-docs.mjs` |

**Differentiation**: comparable projects implement scripting as "a second command interpreter" (a subset of BAT syntax, for instance), and two implementations inevitably diverge. This project has one source of truth — so "what works in the browser also works from the CLI and from an agent, with identical parameter meaning" is verifiable, not just claimed.

**Current boundaries**: script orchestration and the plugin system are not implemented. The plan is for the orchestrator to call `Tool` as an atomic step rather than inventing a separate DSL.

**Evidence**: `src/tools/registry.ts` is the only registration point; `src/tools/catalog.ts` is the only derivation point; `ParamField` in `src/ui/components/ToolCard.tsx` is the only form rendering implementation.

### 4.5 File Transfer Is Streamed, Never Staged to Disk

**Value**: a 500 MB APK or a 1 GB file turns any base64 staging or temporary disk write into a bottleneck and a failure point.

**Implementation**: pushes use the `sync` protocol, feeding `File.stream()` through a `TransformStream` that counts bytes on the way into `sync.write()` without ever reading the whole file into memory; pulls read a `ReadableStream` and accumulate progress per chunk. Both directions accept an `AbortSignal`, and aborting actively calls `dispose()` on the sync session — failing to dispose blocks every subsequent file operation.

**Differentiation**: common implementations pass base64 strings for convenience, inflating size by 33%, truncating large files, and spiking memory.

**One trade-off worth stating**: screenshots use `screencap -p` into a temporary file on the device followed by a `sync` read-back, deleting the temporary file immediately afterwards, rather than `exec-out screencap -p` receiving bytes directly. The reason is that `exec-out` is unavailable on some older devices and some ROMs, while `screencap` plus `sync` has broader compatibility. The cost is a brief temporary file on the device.

**Evidence**: `write` / `read` in `src/core/transport/driver.ts` are streamed end to end; `screenshot()` in `src/services/display.service.ts` verifies the PNG magic number after read-back and guarantees that `removeTemp` always runs.

### 4.6 Stating Clearly "Why It Cannot Be Used"

**Value**: the most common frustration with tinkering tools is "the button is clickable and nothing happens".

**Implementation**: after connecting, 9 **read-only** probes run in parallel (`wm size`, `wm density`, `settings get`, `pm list packages -s`, `cmd package help`, `dumpsys battery`, `which screencap`, `input --help`, `which monkey`); a single failure does not affect the others, and the results form a `DeviceCapabilities` object. A tool's `available()` returns `true` or a **reason string** based on that object; unusable cards are greyed out with the reason shown in the description slot, so the user need not click in to discover the problem.

One capability probe was deliberately omitted: `WRITE_SECURE_SETTINGS` cannot be verified with a read-only command — it can only be inferred from the Android version and known vendor policies, with the tool layer providing a fallback message when a write actually fails. This is the trade-off of "if it cannot be probed, do not pretend to know".

**Differentiation**: most tools send the command, and on failure display the raw terminal error, which the user cannot interpret.

**Evidence**: `DeviceCapabilities` and the 9 probes live in `src/core/session/device-session.ts`; vendor-specific hints (Xiaomi requires "USB debugging (Security settings)", for instance) come from `vendorHint()` in the same file.

### 4.7 Works Offline, and Updates Never Interrupt an Operation

**Value**: device operations often happen without network access (server rooms, production lines, aeroplanes). At the same time, the worst sin for a tool is "the page reloads itself mid-task".

**Implementation**: the Service Worker uses three strategies — navigation requests go network-first (the newest version matters), content-hashed build artifacts go cache-first (the name changes only when the content does), and everything else uses incremental update. The version number is derived from an **artifact fingerprint** (the first 12 hex characters of a SHA-256 over all filenames and sizes), so the version stays the same as long as the content does.

When a new version is found it **does not take over automatically**: after precaching completes it waits, the top of the page shows a narrow bar, and only a user click activates it and reloads. The rationale is in 5.14.

**Differentiation**: the common approach uses `skipWaiting()` plus `clientsClaim()` to swap versions automatically, and the user discovers mid-operation that the interface changed and state was lost. The trade-off here is "update a little later rather than swap resources in the middle of an operation".

**Evidence**: `npm run verify:offline` performs a genuine offline check — install the Service Worker, close the browser gracefully, stop the local server, then restart the browser with the same profile and open the same address. It asserts three things: the precache covers every artifact in `dist/`, both cache buckets are split by path correctly, and after going offline the navigation item count matches the online run while the lazily loaded ADB chunk is still available. The precache list holds 11 files: entry JS, CSS, HTML, manifest, 5 icons, and the ADB transport chunk. **The ADB chunk is precached too** — its entire use case is "the device is in your hand but there is no network", and saving 73 KB by making "Connect device" fail offline trades the capability you need most for bandwidth you do not.

### 4.8 Same Capabilities, Three Ways In

**Value**: a web page can only be used by a human. But "freeze this batch of preinstalled apps" or "put this machine's DPI back" is work that scripts and AI agents do far faster than people. If the only way to trigger a feature is clicking, its usefulness is capped at "someone is watching the screen".

**Implementation**: the transport layer is extracted into a single interface, `DeviceDriver`. The web side implements it over WebUSB; the CLI implements it over `child_process` calling the local adb binary. `ShellContext` → services → the 34 tools depend only on the interface, so **not a line of business logic was rewritten** — both transports run the same code.

That yields three entry points:

| Entry point | For | How to start |
|---|---|---|
| Web | people | open https://ntars.github.io/Webroit/ , WebUSB direct, no local adb needed |
| CLI | scripts / developers in a terminal | `webroit run display.read --json` |
| MCP Server | AI agents | stdio transport, 35 tools (34 features + device listing) injected automatically |

**Why not "add a chat box to the page"**: that only stuffs a model into the page, and the user still has to open the page and plug in the cable themselves. The actual need is for an **external** agent to read device state and act on it, so this ships as an MCP Server plus a CLI, letting the agent call from its own environment.

**How risk gating stays consistent across entry points**: the web relies on a confirmation dialog (high-risk also requires typing "确认"). The CLI and MCP have no UI, so it becomes an explicit argument — any tool at risk level 2 or above requires `allowDangerous: true` / `--allow-dangerous` and is refused otherwise. That logic lives in one place, `gateTool()`, shared by all three.

**Evidence**: the interface is `src/core/transport/types.ts`; the two implementations are `src/core/transport/driver.ts` (WebUSB) and `src/node/adb-driver.ts` (local adb). `tsconfig.node.json` compiles `services` / `tools` / `core` alongside the Node code, so if the shared layer ever touches `document`, `localStorage` or similar browser APIs, the Node build fails immediately — a mechanical guarantee rather than a matter of discipline.

**Boundaries that must be stated**: WebUSB only runs in a browser; no external process can use that channel. So the CLI and MCP require platform-tools installed locally and a device visible to `adb devices`. That is the opposite of the web version's "zero install" selling point — two independently valid paths, not replacements. The web version also remains fully offline; any outbound traffic happens when an agent calls its model, which is outside this project (see the note in 4.2).

---

## 5. Design Details and Engineering Trade-offs

This chapter covers only what **actually exists in the code**, and marks what is design intent but not yet shipped.

### 5.1 Concurrent Stream Reading to Avoid Deadlock

**Problem**: `adb shell` has two independent pipes for stdout and stderr. Reading stdout while ignoring stderr means that once the stderr buffer fills, the device-side process blocks on write and the whole command hangs. This is the most insidious bug in ADB-over-USB projects.

**Approach**: `ShellContext.shell()` subscribes to both stdout and stderr callbacks concurrently, receives both in parallel, and evaluates the exit code at the end.

This is backed by measurement: in an early version with serial stream reading, "install APK" hung instead of returning an error when the package name was invalid; concurrency removed the hang.

### 5.2 Multiple Records in the Same Millisecond Must Reverse Correctly

**Problem**: settings snapshots must replay **in reverse** to restore the original value. Sorting by `Date.now()` makes records written within the same millisecond indistinguishable, and `Array.sort` is stable — which means **no reversal**. Change the DPI three times (420 → 300 → 480) and the restore lands on 300 instead of 420.

**Approach**: snapshots carry a monotonically increasing `seq`, and the sort key is `seq` rather than `at`. IndexedDB reads re-sort by `seq` and defensively handle legacy records missing `seq` (`undefined` in a subtraction yields `NaN`, and `Array.sort` has undefined behaviour with `NaN`).

**Verification**: a stress case writes 50 records in the same millisecond; the restore order is strictly reversed and all pass.

### 5.3 Audit Command Windows Cannot Be Divided by Timestamp

**Problem**: the operation log must record "which commands this operation executed". Dividing the window with `commandsSince(Date.now())` pulls in the previous operation's last command when the next operation falls in the same millisecond. This is not theoretical — testing actually produced a "disable app" record carrying the previous `wm density` command.

**Approach**: `ShellContext` keeps a command ring buffer (200 entries) and a monotonic `commandSeq`. An operation takes `commandMark()` before it starts and reads `commandsSince(mark)` after it ends, capturing the commands beyond that watermark. Integer comparison has no precision issue.

Ring buffer records are **not affected by the "show command echo" preference**: turning echo off means the user does not want commands on screen, not that they want no audit trail.

### 5.4 Inverse Operations When `settings get` Returns null

**Problem**: reading a `settings` key that was never set returns the string `null`. To restore it, writing that value back produces a setting whose value is `"null"`, which is worse than leaving it unset.

**Approach**: `settingsInverse()` translates the inverse operation into `settings delete` when the original value is empty or `null`, instead of `settings put ... null`.

```ts
export function settingsInverse(scope: string, key: string, original: string): string {
  const value = String(original ?? '').trim();
  if (!value || value === 'null') return `settings delete ${scope} ${key}`;
  return `settings put ${scope} ${key} ${quote(value)}`;
}
```

### 5.5 What to Do When the DPI Is Broken

The fear with DPI changes is an interface so large that the reset button cannot be reached. Three lines of defence, from lightest to heaviest:

1. **Automatic snapshot before the change.** Every `settings put` / `wm` write reads the previous value into IndexedDB (`src/core/snapshot.ts`) first; "one-click restore settings" replays by `seq` in reverse. Snapshots are kept only for **the current session** — replaying stale values across sessions computes the wrong result.
2. **A URL-reachable emergency entry** at `#/reset-display`, a page with a single button and no sidebar. Every dimension on this page is **in px**, never em or rem. Measured with the root font size scaled to 2.5× (24px → 40px), the button remains 462×64 in the same position with no horizontal scrolling.
3. **Persistent terminal shortcuts** `wm size reset; wm density reset` in the top bar; one tap executes them in any session, independent of the two mechanisms above.

The difference between 1 and 2/3: a snapshot restores "the value you last set", while the emergency reset pulls back the **device's physical value**. Use the former after a bad change, the latter when the interface is no longer usable — since a snapshot may itself hold a wrong value.

On input ranges: the service layer hard-limits DPI to 72–1600 and resolution to 100–16384. There is no "tick to accept risk outside the common range" interaction, because legitimate DPI varies by device (160 is normal on a low-density panel, 560 on a high-density one), and fixed-band rejection would block legitimate use. The alternative is to make "a bad change can be reverted" a permanent capability.

### 5.6 Section Visibility Cannot Be Decided by "Tool Count > 0"

**Problem**: the terminal and the operation log are "whole interaction surfaces" with no Tool to register, so their tool count is always 0. An early `visibleModules()` checked only the vendor section, and these two entries were hidden as empty sections.

**Approach**: `ModuleMeta` gained a `viewOnly` flag. Sections carrying it are always shown and do not participate in tool-count evaluation.

This was a real bug, found by asserting the DOM of each section in turn (2 of 9 sections reported `nav: false`), not inferred.

### 5.7 Input Validation and Escaping

| Input | Handling |
|---|---|
| Empty string | Blocked at the form layer; no command is sent |
| Negative or out-of-range numbers | Blocked by the parameter's `min` / `max` validation |
| Values containing spaces, Chinese characters, or quotes | Escaped through `quote()`; raw concatenation is never used |
| Package names | Validated against a whitelist by `assertPackageName()` to prevent command injection into the package-name slot |
| Dirty data in preferences | `sanitize()` validates field by field, falling back to defaults so the UI never crashes |

`sanitize()` is the heart of the defensive design: localStorage content can be edited by the user by hand and can also have been written by an older version. Every field receives a type and range check rather than trusting the result of `JSON.parse`.

### 5.8 Closing the Page Is Disconnecting; No Pretence Otherwise

The browser tab is the session. Closing the tab or reloading the page inevitably drops the USB session. This is a hard WebUSB limitation.

Handling: no promise of "continues executing in the background"; the limitation is stated in the documentation rather than left for the user to discover. **Not implemented**: a "do not close this page" prompt during long tasks, and resumable file transfers — both are on the roadmap.

### 5.9 A Local `adb.exe` Holding the Interface

WebUSB and the desktop `adb` service compete for the same USB interface. When a connection fails with an error pointing at interface contention, the connect panel gives the exact command:

| Platform | Action |
|---|---|
| Windows | End `adb.exe` in Task Manager |
| macOS / Linux | `adb kill-server` |

**No attempt is made to kill the process from within the page** — the browser has no such permission, and if it cannot be done, no fake button should be placed in the UI.

### 5.10 Merging Terminal Output to Avoid Flooding

Consecutive text on the same channel is merged into one line before rendering. Listing a directory with several hundred entries would visibly stutter if rendered line by line; merging reduces the line count by an order of magnitude. The terminal caps at 2000 lines, dropping the oldest beyond that.

### 5.11 Theme Follows the System

Defaults to `prefers-color-scheme`, with a manual lock to light or dark. No theming framework is used, only CSS custom properties: `--bg-base`, `--text-primary`, `--accent` and 79 others, 82 variables in total, switched by changing the root node's `data-theme`.

In `auto` mode the app listens for `matchMedia` `change` events, so a system-wide dark mode switch is reflected immediately without a reload.

### 5.11a Palette Is Black, White and Grey Only

Backgrounds, text, borders and the accent colour all come from a neutral grey scale. No hue is introduced anywhere. Hierarchy is carried by lightness difference and font weight alone, never by colour.

| Layer | Dark | Light |
|---|---|---|
| Canvas | `#141414` | `#ededed` |
| Sidebar (recessed) | `#101010` | `#e6e6e6` |
| Card (paper) | `#1e1e1e` | `#fcfcfc` |
| Raised | `#252525` | `#ffffff` |
| Primary text | `#ececec` | `#191919` |
| Secondary text | `#b3b3b3` | `#4a4a4a` |
| Tertiary text | `#949494` | `#656565` |
| Border | `#3a3a3a` | `#d8d8d8` |
| Control border | `#7c7c7c` | `#838383` |
| Accent (solid) | `#ececec` with `#191919` text | `#191919` with `#ffffff` text |

Two trade-offs:

1. **The accent colour is itself grey.** In dark mode the accent is light grey with dark text; in light mode it inverts. Buttons, selection states and progress bars get their focus from this inversion, not from blue.
2. **Semantic colours keep very low saturation.** Success / warning / danger still use green / amber / red, because those three encode state rather than brand — going fully grey would make "command failed" and "operation succeeded" visually indistinguishable. Their saturation is pushed down to just enough to read as a hue.

**Why the control border is its own step**: `--border-default` is translucent white, which over the input's `#101010` fill measures only 1.84:1 — the control edge is effectively invisible; and `--border-strong` is *darker* than it in dark mode, so hover reads as disabled. WCAG 1.4.11 requires interactive controls to reach 3:1 against adjacent colours, so `--border-control` exists solely for form controls rather than darkening the global border for the sake of one input.

### 5.11b Measured Contrast (WCAG AA)

All 80 colour pairs pass. The numbers are produced live by `npm run verify:theme -- --markdown`, not written by hand. Below is the tightest pair per token (the overlay `--bg-overlay` is the lightest background in dark mode):

| Foreground | Dark min | Light min | Threshold |
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

The constraint is machine-checked by `npm run verify:theme`: it verifies that every non-semantic token is close to zero chroma, that the accent direction is inverted relative to the theme, and that every pair in the matrix above passes. Early on it only measured 4 pairs, leaving `--text-tertiary`, the semantic colours, the terminal palette and the control border unchecked — and that blind spot hid two real defects (light-mode tertiary text at 3.90:1, light-mode switch knob against its off-track at 1.74:1). It is now a matrix: foregrounds and backgrounds are enumerated independently, any failing pair fails the run, and a new token is covered as soon as it is added to the list.

### 5.12 Dangerous Buttons Are Not Primary

Confirmation buttons for L2/L3 operations do not use the accent colour; they use a neutral colour with an explicit verb ("Confirm uninstall com.example.app" rather than "OK"). The effective way to reduce mis-clicks is not a dialog but making a dangerous action look unlike "the next step".

Level 2 and level 3 are clearly separated in interaction: level 2 raises a dialog, level 3 additionally requires typing the confirmation word, **and level 3 is unaffected by the "disable second confirmation" preference** — turning the preference off reduces friction at level 2 only, never at level 3.

### 5.13 Chinese-First Copy

Every error message states "what happened" first and "what you can do" second. Example:

> Unable to connect the device: the USB interface is held by another program.
> On Windows, end `adb.exe` in Task Manager; on macOS and Linux, run `adb kill-server`, then reconnect.

When a tool is unavailable, the error is not thrown at the user but written directly on the card (as the reason string returned by `available()`).

### 5.14 The Service Worker Does Not Take Over Automatically

When a new version is found, `skipWaiting()` is **not** called to swap versions automatically. The reason: the user may be in the middle of a device operation, and swapping resources mid-flight leaves the interface and the device state inconsistent.

Approach: after precaching completes the worker stays in the waiting state, and a narrow bar at the top reads "A new version is ready and will apply after refresh". Only a user click sends `postMessage('skip-waiting')` and reloads the page.

The `install` phase also avoids atomic failure: a single file failing to precache only warns, rather than failing the entire Service Worker installation — otherwise the user would be stuck on the old version forever.

### 5.15 No Service Worker in Development

The first line of `registerServiceWorker()` checks `import.meta.env.PROD`. Registering a Service Worker in development makes it cache Vite's module requests, so code changes stop taking effect and debugging becomes extremely time-consuming.

Registration failures (incognito mode, older browsers, insecure contexts) only warn silently and do not affect the main functionality — connecting a device never depended on the Service Worker.

---

## 6. Technology Stack and Dependencies

All version numbers are taken from the actual resolution in `package-lock.json` (lockfileVersion 3, generated 2026-11-15). If versions change after `npm install`, this section and [NOTICE](NOTICE) must be updated together.

### 6.1 Core Technology Stack

| Layer | Choice | Version | Rationale |
|---|---|---|---|
| Build | Vite | 7.3.8 | Native ESM dev server with fast cold start; clean multi-chunk output |
| Language | TypeScript | 5.9.3 | `strict` fully on; `exactOptionalPropertyTypes` off so config objects may omit fields |
| UI runtime | Preact | 10.29.8 | 3.6 KB gzipped, React-compatible API, no virtual-DOM overhead concerns |
| State | Hand-written signal | 46 lines | Global state is about a dozen items; MobX or Zustand would not pay off |
| Styling | Native CSS with custom properties | 5 sheets, 159 token lines | No build-time scanning, readable output, theme switch changes only `data-theme` |
| Routing | Hash routing | About 20 lines | Static hosting needs no server rewrite; the emergency page is reachable at `#/reset-display` |
| ADB protocol | `@yume-chan/adb` | 2.6.4 | Complete ADB in TypeScript, including the sync protocol and RSA authentication |
| Offline | Hand-written Service Worker | — | No Workbox: there are only three cache strategies, and 200 hand-written lines are more controllable than a dependency |

### 6.2 Runtime Direct Dependencies (6)

All are distributed to end users within the artifact, all unmodified release versions.

| Package | Version | Copyright holder | License | Official URL | Purpose |
|---|---|---|---|---|---|
| `@yume-chan/adb` | 2.6.4 | Simon Chan | MIT | <https://github.com/yume-chan/ya-webadb> | ADB protocol: handshake, RSA authentication, stream multiplexing, sync transfer |
| `@yume-chan/adb-daemon-webusb` | 2.3.2 | Simon Chan | MIT | <https://github.com/yume-chan/ya-webadb> | WebUSB transport backend |
| `@yume-chan/adb-credential-web` | 2.1.0 | Simon Chan | MIT | <https://github.com/yume-chan/ya-webadb> | RSA key persistence in IndexedDB |
| `@yume-chan/stream-extra` | 2.6.1 | Simon Chan | MIT | <https://github.com/yume-chan/ya-webadb> | Stream utilities (BufferedReadableStream and others) |
| `@yume-chan/struct` | 2.3.2 | Simon Chan | MIT | <https://github.com/yume-chan/ya-webadb> | Binary struct serialisation |
| `preact` | 10.29.8 | Preact contributors | MIT | <https://github.com/preactjs/preact> | UI runtime |

### 6.3 Runtime Transitive Dependencies (4)

Not imported directly; pulled in by the six packages above.

| Package | Version | Copyright holder | License | Introduced by | Purpose |
|---|---|---|---|---|---|
| `@yume-chan/async` | 4.2.2 | Simon Chan | MIT | `@yume-chan/adb` | Async utilities (AutoDisposable and others) |
| `@yume-chan/event` | 2.0.0 | Simon Chan | MIT | `@yume-chan/adb` | Event dispatch |
| `@yume-chan/no-data-view` | 2.0.0 | Simon Chan | MIT | `@yume-chan/adb` | Zero-copy view operations |
| `@types/w3c-web-usb` | 1.0.14 | DefinitelyTyped contributors | MIT | `@yume-chan/adb-daemon-webusb` | TypeScript declarations for WebUSB |

`@types/w3c-web-usb` carries a `@types` name but sits in `dependencies` rather than `devDependencies`, because `@yume-chan/adb-daemon-webusb` depends on its type shapes at runtime.

### 6.4 Build-Time Dependencies (15)

These do not enter `dist/` and are not distributed with the application.

| Package | Version | Copyright holder | License | Purpose |
|---|---|---|---|---|
| `vite` | 7.3.8 | Evan You and Vite contributors | MIT | Dev server and build |
| `typescript` | 5.9.3 | Microsoft Corporation | Apache-2.0 | Type checking (`tsc --noEmit`) |
| `@types/node` | 24.19.2 | DefinitelyTyped contributors | MIT | Node API types (used by build scripts) |
| `esbuild` | 0.28.2 | Evan Wallace | MIT | Transformer bundled with Vite |
| `rollup` | 4.68.3 | Rich Harris | MIT | Bundler bundled with Vite |
| `postcss` | 8.5.33 | Andrey Sitnik | MIT | CSS processing pipeline |
| `nanoid` | 3.3.20 | Andrey Sitnik | MIT | Internal ID generation |
| `picocolors` | 1.1.1 | Alexey Raspopov | **ISC** | Terminal colouring |
| `picomatch` | 4.0.7 | Jon Schlinkert | MIT | Glob matching |
| `fdir` | 6.5.0 | thecodrr | MIT | File traversal |
| `tinyglobby` | 0.2.17 | Superchupu | MIT | Lightweight globbing |
| `source-map-js` | 1.2.2 | Valentin Semirulnik | **BSD-3-Clause** | Source map parsing |
| `fsevents` | 2.3.3 | fsevents contributors | MIT | macOS file watching (optional, Darwin only) |
| `@types/estree` | 1.0.10 | DefinitelyTyped contributors | MIT | ESTree AST types |
| `undici-types` | 7.24.6 | Node.js contributors | MIT | fetch-related types |

### 6.5 Platform-Specific Optional Binaries (52 entries, 2 families)

`esbuild` and `rollup` each ship 26 platform-specific native binary packages (`@esbuild/*` and `@rollup/rollup-*`), covering aix / android / darwin / freebsd / linux / netbsd / openbsd / openharmony / sunos / win32 across architectures. npm installs only the one matching the current platform; the rest are marked `optional` in the lockfile.

Both families are MIT-licensed, held by Evan Wallace (esbuild) and Rich Harris (rollup). They are not listed individually; the complete inventory is in `package-lock.json`.

### 6.6 License Summary

| License | Count | Components |
|---|---|---|
| MIT | 22 | Everything except the three below |
| ISC | 1 | `picocolors` |
| BSD-3-Clause | 1 | `source-map-js` |
| Apache-2.0 | 1 | `typescript` |

25 non-platform components in total. All four licenses are permissive (MIT / ISC / BSD / Apache-2.0) and fully compatible with this project's own Apache-2.0 / MIT, so no conflict exists.

**No binary components are distributed with the package.** The previously planned `scrcpy-server` (Apache-2.0, Romain Vimont) is not included in the repository or the artifact, because screen mirroring is not implemented.

### 6.7 Deliberately Excluded

| Excluded | Rationale |
|---|---|
| React / Vue | Size conflicts with this project's budget; Preact offers a compatible API at 3.6 KB gzipped |
| UI component libraries (Ant, MUI, and similar) | Large, style-uncontrollable, and at odds with the Apple HIG direction |
| CSS frameworks (Tailwind and similar) | Build-time scanning is in tension with the "readable output" goal |
| Icon libraries | All icons are hand-written SVG paths: 9 section icons, a few interface icons, and 1 favicon, under 3 KB in total |
| Font files | The system font stack is used; no webfont is downloaded |
| axios / lodash | Native `fetch` and ES2022 suffice |
| Workbox | Three cache strategies only; hand-written is shorter than configuration |
| Any analytics or monitoring SDK | Conflicts with the zero-telemetry commitment |

The complete dependency tree, including transitive dependencies and platform binaries, is in [NOTICE](NOTICE).

---

## 7. Installation and Deployment

### 7.1 Requirements

| Item | Requirement | Notes |
|---|---|---|
| Node.js | ≥ 20 | CI uses 20 LTS; local development measured on 22.22.2 |
| Package manager | npm ≥ 10 | `package-lock.json` is provided; `npm ci` is recommended |
| Browser (development and use) | Chrome / Edge / other Chromium-based | Non-Chromium engines have no WebUSB implementation |
| Protocol | HTTPS or `localhost` | WebUSB requires a secure context |

### 7.2 Local Development

```bash
git clone https://github.com/ntars/Webroit.git
cd Webroit
npm ci
npm run dev
```

Open the address printed by the dev server (default `http://127.0.0.1:8124`). `localhost` and loopback addresses are trusted origins in browsers, so HTTPS is not required.

With no device available, open `dev-preview.html` to browse the interface against mock services.

### 7.3 Production Build

```bash
npm run typecheck  # tsc once for the browser side, once for the Node side
npm run lint       # ESLint 9 flat config, with no-explicit-any enabled
npm test           # vitest unit tests over the pure-function layer; no browser or device needed
npm run build      # tsc --noEmit → vite build → inject Service Worker
npm run preview    # preview the build output locally
```

`build` is three chained steps and the third cannot be skipped: `dist/sw.js` carries a `__SW_VERSION__` placeholder before injection, and an uninjected version cannot register. Running `vite build` alone produces an unusable Service Worker.

`npm test` runs `src/**/*.test.ts`: 6 files, 140 cases, all confined to the pure-function layer that never touches the DOM (`/core/utils`, `/core/snapshot`, `/core/transport/stream`, `/core/error-copy`, `/tools/registry`, `/node/errors`). Tests sit next to the files they cover, so they are right there when the code changes.

### 7.3a Consistency Checks

Four scripts keep "what the docs say", "what the palette should be", "does it work at four widths", "does the message say anything useful" and "what the code does" aligned, so readers never get stale numbers, a styling change never silently breaks the phone layout, and no useless error text is handed to the user.

```bash
npm run verify:docs     # README's claims vs the repo (run after build)
npm run verify:theme    # is the palette still pure grey, is contrast sufficient (run after build)
npm run verify:layout   # overflow and touch targets at 375 / 768 / 1024 / 1440 (run after build)
npm run verify:copy     # do all four failure modes give a cause and a next step
```

`verify:docs` checks every fact that can be recomputed from the repository: source file and line counts, artifact file count and size, per-chunk gzip sizes, tool counts (the 26 / 24 / 34 trio), brand count, the distribution of `any`, unit-test file and case counts, and whether the Chinese and English docs have matching section counts. It runs in CI as a post-build step and fails the deploy on any mismatch.

`verify:theme` launches headless Chrome and reads real computed styles to check the chroma of every non-semantic token (confirming no hue crept in), the accent direction (must be light in dark mode, dark in light mode), and a full foreground × background contrast matrix (80 pairs, including the terminal palette, accent-on-fill inversion, control border and switch at the 3:1 threshold). Passing `-- --markdown` also prints two ready-to-paste measurement tables generated from the same run, so recolouring means re-running the script rather than transcribing by hand. It is not wired into CI — it needs a Chrome environment, so it is better suited as a local self-check after touching colours.

`verify:layout` also launches headless Chrome, but measures geometry: four widths × every module × five states (collapsed, expanded, modal, drawer), checking horizontal overflow, elements past the viewport, content clipped by `overflow-x:hidden`, and elements whose centre point is covered by another layer. On narrow widths it checks two more things: whether tap targets reach 44px, and whether the drawer can be dismissed by tapping the scrim and by pressing Esc. The overflow baseline is the nearest clipping ancestor's right edge rather than the viewport — once the sidebar takes 236px on the left, comparing against the viewport misses the slice that has already been clipped. It runs in CI, as a post-build step like `verify:docs`.

`verify:copy` guards one rule: every failure message must be useful. Half of it executes `src/core/error-copy.ts` for real and asserts, over 17 authentic strings across four modes (not connected / empty result / command failed / device disconnected), that a cause is present, the next step is an action, no filler phrase like "operation failed" or "unknown error" appears, and the raw device text is retained. The other half scans the source for two ways of bypassing the translation layer: dumping an exception straight into `<p>{error}</p>`, and hand-writing `instanceof Error ? x.message : String(x)` in a dozen places. The latter is harmless on its own, but scattered everywhere it means nobody owns the "turn this into a next step" part. No browser needed; it runs in CI.

### 7.3b CLI and MCP Server

Two entry points beyond the web page, sharing the same business code (rationale in 4.8).

```bash
npm run build:cli      # bundles bin/webroit and bin/webroit-mcp, regenerates the Skill parameter docs
```

Artifacts land in `bin/`, which is not version-controlled (a binary diff on every code change is noise).

**CLI**

```bash
webroit devices                                  # list devices visible to the local adb
webroit tools --verbose                          # the 34 features and their parameters
webroit run display.read --json                  # execute, with --json for scripts
webroit run apps.control --package=com.x --action=freeze --allow-dangerous
webroit shell "dumpsys battery"                  # escape hatch: run any adb shell command
```

Global options: `--serial=<serial>` (required when several devices are online), `--out=<dir>` (where screenshots, pulled files and exported APKs go), `--json`, `--verbose`, `--allow-dangerous`.

Exit codes are fixed, so scripts and agents can branch on them:

| Code | Meaning | Typical cause |
|---|---|---|
| 0 | success | — |
| 1 | execution failed | device disconnected, command errored |
| 2 | usage error | missing argument, out-of-range value, unknown tool, unauthorised high-risk call |

**MCP Server**

stdio transport; register it with any MCP client:

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

Tool names follow `webroit_<module>_<action>` (dots get truncated by some clients, hence underscores); the original ID is kept in the description. `webroit_devices` lists devices. The `WEBROIT_SERIAL` environment variable picks a target device, `WEBROIT_OUT_DIR` sets the artifact directory.

**Risk gating without a UI**: tools at risk level 2 or above get an extra `allowDangerous` field in their inputSchema, defaulting to `false`; without it the call is refused. This is the same predicate that backs the web confirmation dialog.

**What it cannot do**: both the CLI and the MCP server depend on the local adb and cannot reuse the browser's WebUSB channel (WebUSB exists only in browsers). The prerequisite is therefore platform-tools installed and a device visible to `adb devices`.

### 7.4 Deploying to Static Hosting

`dist/` is a purely static directory, `base` is set to a relative path (`./`), so it can be served from a domain root or any subdirectory.

**GitHub Pages automatic deployment is configured**, live at <https://ntars.github.io/Webroit/>

The workflow file is `.github/workflows/deploy.yml`, behaving as follows:

| Aspect | Content |
|---|---|
| Trigger | Push to the `main` branch, or manual dispatch from the Actions page |
| Permissions | `contents: read` / `pages: write` / `id-token: write`; no long-lived secrets |
| Concurrency | One deployment at a time, `cancel-in-progress: false` to avoid leaving a half-finished site |
| Steps | Checkout → Node 20 → `npm ci` → type check → build → **doc verification** → upload → deploy |

On first use, set Source to **GitHub Actions** under repository Settings → Pages. On other platforms (Netlify, Vercel, Cloudflare Pages), fill in the build command `npm run build` and the output directory `dist`.

**HTTPS is mandatory**. On an HTTP site (other than localhost) `navigator.usb` is unavailable, and the page shows an explicit message rather than failing silently.

### 7.5 Status of the Single-File Offline Build

Early planning listed `npm run build:aio` (producing a single HTML file with all dependencies inlined, for carrying on a USB stick). That script is **not implemented**; the command does not exist in `package.json`.

For offline use today, the practical route is to install the deployed app as a desktop application through the PWA: the Service Worker caches the interface shell, so the page still opens without network. Because of the `file://` protocol restriction, double-clicking a local HTML file cannot use WebUSB — a limitation that cannot be worked around.

---

### 7.6 Wireless Connection (Optional)

WebUSB requires a physical connection. For wireless debugging you must deploy your own WebSocket relay (this project hosts none):

```bash
# On a computer already connected to the device
adb tcpip 5555
# Expose port 5555 as ws:// with WebSockify or another ADB-over-WebSocket relay
```

A relay exposed to the public internet hands over control of the device. **Use on trusted local networks only.**

---

## 8. Quick Start

### 8.1 On the Device

1. Settings → About phone → tap "Build number" 7 times to enable Developer options;
2. Settings → System → Developer options → enable "USB debugging";
3. Some vendors (Xiaomi, OPPO, vivo) additionally require "USB debugging (Security settings)";
4. Connect to the computer with a cable that **supports data transfer** (many cables are charge-only).

### 8.2 On the Computer

1. Open the deployed address in Chrome or Edge;
2. Click "Connect device";
3. The browser shows a device picker; select your phone;
4. The phone displays "Allow USB debugging?"; tick "Always allow" and confirm;
5. Once connected, the device profile is collected automatically and the main interface appears.

### 8.3 If It Will Not Connect

Check in this order:

| Symptom | Cause | Handling |
|---|---|---|
| Connect button is grey | The browser does not support WebUSB | Switch to Chrome or Edge; confirm HTTPS or localhost |
| Device list is empty | The system does not recognise the device | Try another cable or port; on Windows check the driver |
| Interface is held by another program | A local `adb.exe` is running | End `adb.exe` on Windows; `adb kill-server` on macOS/Linux |
| No authorisation prompt on the phone | Screen locked, previously denied, or a stale authorisation | Unlock the screen; use "Revoke USB debugging authorizations" in Developer options and retry |
| Commands do not respond after connecting | Cable quality | Replace the cable; the default timeout is 8 seconds and raises an error instead of hanging |

---

## 9. Configuration

The application has no configuration file; all settings live in browser storage.

### 9.1 Storage Locations

All data stays in the local browser; there is no server.

| Data | Storage | Exact key or database | Lifetime |
|---|---|---|---|
| ADB RSA private key | IndexedDB | The `Tango` database managed by `@yume-chan/adb-credential-web` | Persistent; manual removal required |
| Interface preferences | localStorage | `webroit:preferences` | Persistent |
| Operation log (audit) | IndexedDB | `webroit` | Persistent, capped at 500 entries, exportable then clearable |
| Settings snapshots | IndexedDB | `webroit-snapshots` | Current session only; the previous session's leftovers are cleared on reload |
| Command history | Memory | — | Lost when the tab closes; not persisted |
| Service Worker cache | Cache Storage | `webroit-shell-*` / `webroit-assets-*` | Old caches are discarded wholesale on version update |

Audit and snapshots use two separate databases rather than two stores in one: their schemas evolve at different rates, and merging them invites problems such as "upgrading the audit schema wipes the snapshots".

### 9.2 Adjustable Parameters

Settings live next to the theme button in the top-right corner; the rest are constants in code.

| Item | Default | Range | Notes |
|---|---|---|---|
| Theme | Follow system | Dark / light / follow system | In `auto`, `prefers-color-scheme` is observed and applied live |
| Terminal font size | 13 px | 10–24 px | Out-of-range values fall back to 13 rather than writing dirty data |
| Show command echo | On | On / off | When off, only results are shown; the `info` channel remains |
| High-risk second confirmation | On | On / off | Turning it off removes the dialog at risk level 2; level 3 is unaffected |
| Low battery warning threshold | 20% | 1–100% | Warned on the overview page when below the threshold and not charging |
| Last used section | Device overview | Any section | Returns to the same place after a reload |
| Sidebar collapsed | No | Yes / no | — |

The following are code constants with no UI toggle: command ring buffer 200 entries (used by the audit to slice windows by sequence number), terminal display cap 2000 lines (`pushOutput` drops the oldest beyond it), audit record cap 500 entries, and command timeouts which must be passed explicitly at each call site (no call site currently sets one, relying on the ADB layer's own connection timeout).

### 9.3 Reset

There is no "clear all data" button in the interface. For a complete reset, delete the `webroit`, `webroit-snapshots`, and `Tango` databases in the Application panel of the browser developer tools, along with the `webroit:preferences` key in localStorage. Afterwards you must re-authorise the device and reconfigure preferences.

---

## 10. API and Module Reference

This project targets end users and exposes no HTTP API. The internal module contracts follow.

### 10.1 Tool — a Tool Registry Entry

```ts
interface Tool {
  id: string;                       // Globally unique, e.g. "system.fontScale"
  module: ModuleId;                 // device | apps | display | files | system | battery | vendor
  title: string;
  description: string;
  risk: RiskLevel;                  // 0 read-only / 1 reversible / 2 needs confirmation / 3 high risk
  params: ParamSchema[];            // Drives the UI form; the UI knows nothing about specific tools
  vendor?: VendorId;                // Required only for vendor-zone tools
  available(capabilities: DeviceCapabilities): boolean | string;
  run(context: ToolContext): Promise<ToolResult>;
}
```

`available()` returns `true` when the tool is usable, or a **string** when it is not, with that string shown directly to the user as the reason. This is the foundation of the "state why it cannot be used" behaviour.

### 10.2 ToolContext — the Execution Context

```ts
interface ToolContext {
  shell: ShellContext;                 // Command execution facade
  capabilities: DeviceCapabilities;    // Capability profile probed at connection time
  input: Record<string, unknown>;      // Values the user entered in the form
  signal?: AbortSignal;
}
```

A tool **does not hold** a session and does not call `@yume-chan/adb` directly; it only issues commands through `shell`. This constraint lets tool implementations be tested completely in a mock environment.

### 10.3 ShellContext — the Command Execution Facade

```ts
class ShellContext {
  shell(command: string, options?: ShellOptions): Promise<ShellResult>;
  text(command: string, options?: ShellOptions): Promise<string>;   // stdout, trimmed
  mutation(command: string, options?: ShellOptions): Promise<ShellResult>;
  commandMark(): number;                    // Current command sequence watermark
  commandsSince(mark: number): string[];    // Commands beyond the watermark, for the audit
  cancelAll(): void;
}
```

`shell()` reads stdout and stderr in parallel internally. Serial reading deadlocks once the stderr buffer fills — a genuine ADB-over-USB pitfall where the command appears to hang while the CPU is idle.

### 10.4 DeviceSession and the Capability Profile

```ts
interface DeviceCapabilities {
  sdk: number;                  // API level
  release: string;              // Android version, e.g. "14"
  brand: string;                // Vendor, lowercase
  model: string;
  props: Record<string, string>;  // Full getprop

  // Results of the 9 read-only probes
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

  vendorNote: string | null;     // Extra switch hints for known ROMs
}
```

`canWriteSecureSettings` cannot be verified with read-only commands; its value is inferred from the Android version and known vendor policies. When a real write fails, the tool layer provides a fallback message rather than pretending the probe was accurate.

### 10.5 Layer Boundaries

| Layer | Directory | May | May not |
|---|---|---|---|
| UI | `src/ui/` | Render, interact, validate forms, call tools | Import `@yume-chan/adb` directly |
| Tools | `src/tools/` | Declare parameters, compose service calls, determine availability | Hold sessions, read the DOM |
| Services | `src/services/` | Compose commands, parse output, apply business rules | Touch the DOM |
| Session | `src/core/session/` | Connection lifecycle, capability probing, vendor detection | Business logic |
| Transport | `src/core/transport/` | Handshake, device enumeration, command exchange | Command semantics |

The practical purpose of layering is to make device operations testable: `services` and `tools` depend only on the `ShellContext` interface, so complete logic assertions can run without real hardware.

### 10.6 Minimal Change Surface for a New Tool

1. Add a method in `src/services/` (skip if an existing service covers it).
2. Add a `Tool` object to the `BUILTIN_TOOLS` array in `src/tools/builtin.ts`.
3. If it belongs to a new section, add an entry to `MODULES` in `registry.ts` and extend `ModuleId`.

`ModuleView`, `ToolCard`, the sidebar, terminal output, and the audit record **all require no changes**. All 26 tools in v0.1 are driven by this one mechanism.

### 10.7 Status of the Plugin System

The plugin interface (`PluginHost`, third-party ES module loading, permission declaration) is **not implemented**; the `src/plugins/` directory does not exist. Extending functionality today requires editing `builtin.ts` and rebuilding.

The reason is not technical difficulty but an unresolved security boundary: a plugin can execute arbitrary ADB commands, and ADB commands can flash partitions. Until there are definite answers to "how does a plugin declare permissions, how does the user confirm, and how is a problem traced", this path stays closed.

---

## 11. Repository Layout

The following is the actual v0.1 structure, matching the repository contents. Items marked "planned" do not exist yet.

```
Webroit/
├── index.html                      # Application entry HTML with PWA metadata and a noscript notice
├── package.json                    # Dependencies and scripts; build chains tsc → vite → SW injection
├── package-lock.json               # Pinned dependency versions for CI and local parity
├── tsconfig.json                   # strict mode, @/* path alias
├── vite.config.ts                  # base is relative, suitable for subdirectory deployment
├── dev-preview.html                # Interface preview entry for use without a device
├── .github/workflows/deploy.yml    # Build and publish to Pages on push to main
├── public/                         # Copied into dist verbatim, not bundled
│   ├── favicon.svg
│   ├── manifest.webmanifest        # PWA manifest: standalone window, shortcuts, icons
│   ├── sw.js                       # Service Worker source; version and precache list injected at build time
│   └── icons/                      # 192 / 512 / maskable / apple-touch
├── scripts/
│   └── build-sw.mjs                # Rewrites dist/sw.js from the artifact fingerprint
├── src/
│   ├── main.tsx                    # Entry: theme → register tools → bind services → register PWA → mount
│   ├── dev-preview.tsx             # Mock service implementations for the preview
│   ├── core/                       # UI-independent foundation, testable in isolation
│   │   ├── transport/driver.ts     # WebUSB ↔ ADB session; the only file touching @yume-chan
│   │   ├── session/device-session.ts  # Capability probing, vendor detection, session lifecycle
│   │   ├── shell.ts                # Command execution: timeouts, concurrent streams, channels, ring buffer
│   │   ├── snapshot.ts             # Snapshot storage; monotonic sequence guarantees correct reversal
│   │   ├── audit.ts                # Operation log in a separate database to avoid version conflicts
│   │   ├── storage.ts              # Preference persistence; invalid values fall back to defaults
│   │   ├── pwa.ts                  # Service Worker registration, update prompt, install guidance
│   │   └── utils.ts                # Pure helpers: escaping, formatting, byte units
│   ├── services/                   # Domain services, one file per section
│   │   ├── index.ts                # Services aggregate and construction
│   │   ├── device.service.ts
│   │   ├── app.service.ts
│   │   ├── display.service.ts
│   │   ├── file.service.ts
│   │   ├── system.service.ts
│   │   ├── battery.service.ts
│   │   ├── vendor.service.ts
│   │   └── rollback.service.ts     # Replays snapshots in reverse
│   ├── tools/
│   │   ├── registry.ts             # Tool types, registry, filtering by capability
│   │   └── builtin.ts              # Definitions and implementation bindings for the 26 built-in tools
│   └── ui/
│       ├── App.tsx                 # Shell: sidebar + main area + terminal; emergency route dispatch
│       ├── state/                  # Signals and global actions
│       ├── components/             # ToolCard, Terminal, PwaPrompt, and others
│       ├── views/                  # Section pages
│       └── theme/                  # Design tokens and four stylesheets
├── NOTICE                          # Third-party component disclosure
├── LICENSE                         # Apache-2.0 full text (GitHub detects the license from this)
├── LICENSE-MIT                     # MIT full text
├── LICENSING.md                    # Layer routing table (human-readable)
├── README.md
└── README_EN.md
```

Planned but not yet created: `src/plugins/` (plugin host), `src/ui/i18n/` (language packs), `public/scrcpy-server` (screen mirroring not implemented).

Unit tests live next to the code they cover (`src/core/utils.test.ts` and so on) rather than in a separate `tests/` directory: when the code under test changes, its tests are right there, which is easier to maintain than hunting across directories. End-to-end tests do not exist yet.

---

## 12. Performance

### 12.1 Measured Data

Measurement environment: macOS 15 / Apple Silicon, Node.js 22.22.2, Vite 7.3.8, production build via `npm run build`. Sizes are actual file byte counts; gzip figures come from `gzip -c`.

| Artifact | Raw size | gzip | Notes |
|---|---|---|---|
| `index-*.js` | 147.2 KB | 50.9 KB | Required for first paint: Preact, tool registry, all services and views |
| `index-*.css` | 35.8 KB | 6.6 KB | Five stylesheets merged |
| `adb-*.js` | 71.7 KB | 21.7 KB | ADB transport layer, loaded on connect |
| `index.html` | 2.2 KB | 1.1 KB | Includes PWA metadata |
| Icons total | 202.7 KB | — | 192 / 512 / maskable / apple-touch |
| **First paint total** | **about 179 KB** | **about 56 KB** | JS + CSS + HTML, excluding icons |
| **Full artifact** | **462 KB** | **—** | 12 files in `dist/` |

Build time 0.8 seconds, 180 modules. Type checking via `tsc --noEmit` reports zero errors.

### 12.2 Runtime Overhead

| Item | Measured or configured | Basis |
|---|---|---|
| Command ring buffer | Capped at 200 entries | `#recentCommands` in `shell.ts` trims on overflow |
| Audit record reads | Only the current session prefix | Snapshot and audit rows are filtered by `sessionId`; history does not participate in sorting |
| Snapshot restore ordering | 50 same-millisecond records strictly reversed | The sort key is the monotonic `seq`, never a timestamp |
| Terminal output merging | Consecutive same-channel text merged | Prevents line-by-line rendering from stuttering on long commands |
| Service Worker precache | 11 files | Every build artifact precached (`sw.js` excepted), ADB chunk included |

### 12.3 Not Yet Measured

Four items are **unmeasured**: mirroring latency, large-file transfer throughput, logcat throughput at 100,000 lines, and memory usage. The corresponding features (mirroring, live logcat streaming) are not implemented in v0.1. They fall in the v0.2 range on the roadmap, at which point measurements will be added together with device model and connection method.

---

## 13. Security and Privacy

### 13.1 Data Flow

| Data | Location | Leaves the machine |
|---|---|---|
| Device information | Browser memory | No |
| File contents | Browser ↔ USB ↔ device | No |
| Terminal output | Browser memory | No |
| Interface preferences | localStorage | No |
| Operation log and settings snapshots | IndexedDB | No |
| ADB private key | IndexedDB (`Tango` database) | No |
| Usage statistics | **Not collected** | — |

### 13.2 No Telemetry

This project **contains no tracking, analytics, or crash reporting**. No Google Analytics, no Sentry, no self-hosted reporting endpoint, and no third-party CDN resources.

The artifact can be verified with the following commands. Note that the first one matches once: that is the package name `com.miui.analytics` in the Xiaomi component list (a disable-able system statistics component), which is functional data rather than telemetry code:

```bash
grep -rE "gtag|sentry|umami|plausible|google-analytics" dist/   # should be empty
grep -rE "https://cdn\." dist/                                  # should be empty
grep -rhoE "https?://[a-zA-Z0-9._/-]+" dist/ | sort -u          # 5 entries remain, see below
```

The actual purpose of every absolute URL in the artifact:

| URL | Purpose | Triggers a browser request |
|---|---|---|
| `https://connect.rom.miui.com/generate_204` | Written to device settings as a string, to fix the Xiaomi "WiFi shows connected but has no internet" issue | No; the string is sent only to the device |
| `http://connect.rom.miui.com/generate_204` | The same, being the original value written back on restore | No |
| `http://www.w3.org/2000/svg` | SVG namespace identifier | No; not a requestable address |
| `http://www.w3.org/1999/xhtml` | Same | No |
| `http://www.w3.org/1998/Math/MathML` | Same | No |

### 13.3 Permission Model

The only authorisation credential on the device side is the "Allow USB debugging" dialog on the phone. This project **provides no means of bypassing that confirmation**, and does not accept exporting or sharing an already-authorised device session.

Risk grading is the only expression of permissions in the interface; the four levels of `Tool.risk` map directly to interaction:

| Level | Name | Interface behaviour | Recorded |
|---|---|---|---|
| 0 | Read-only | Executes on click | No log entry |
| 1 | Reversible | Executes on click; snapshot taken before the change | Log entry written |
| 2 | Needs confirmation | Dialog (can be disabled in preferences) | Log entry written |
| 3 | High risk | Dialog plus typing the confirmation word; unaffected by preferences | Log entry written |

**No permission declaration field is implemented.** `available()` is based on real capabilities probed at connection time rather than a static `none` / `shell+` / `root` / `bootloader` label. The reason is that static labels go stale: the same command requires different permissions across ROMs, and a declared label is actively misleading.

### 13.4 Status of Sensitive-Data Redaction

**Not implemented.** v0.1 offers no device report export, so there is no redaction logic either. Export is planned for v0.2, at which point redaction ships with it: serial numbers keep the first 4 and last 4 characters, IMEI and MEID are fully masked, and MAC addresses keep the OUI.

The device overview page currently shows the full serial number — this is a local interface that does not leave the machine, but users should mask it themselves when sharing screenshots.

### 13.5 Status of Local Data Cleanup

There is **no** "clear everything" button. The practical cleanup procedure is described in 9.3.

The omission is deliberate: clearing everything would delete both the ADB private key and the operation log, the former forcing re-authorisation and the latter permanently losing "what did I just change". When a device has been broken, the operation log is exactly what the user needs most.

---

## 14. Compatibility

### 14.1 Browsers

| Browser | Support | Notes |
|---|---|---|
| Chrome (desktop) | Full | Preferred |
| Edge (desktop) | Full | Preferred |
| Chromium-based (Brave / Opera / Vivaldi) | Mostly full | Some builds ship without WebUSB |
| Chrome for Android | Usable | Requires C-to-C or OTG; the interface adapts to mobile |
| Safari and all iOS browsers | Unsupported | No WebUSB; engine limitation |
| Firefox | Unsupported | WebUSB explicitly declined |
| Chinese browsers in "speed" mode | Engine-dependent | Most ship without WebUSB and show an explicit notice |

### 14.2 Operating Systems

| System | Status | Notes |
|---|---|---|
| Windows 10 / 11 | Supported | The system must recognise the ADB interface; a driver may be needed the first time |
| macOS (Intel / Apple Silicon) | Supported | Driver-free |
| Linux (x64 / arm64) | Supported | Requires udev rules, see below |
| ChromeOS | Supported | Driver-free |
| Virtual machines | Unstable | USB passthrough commonly fails the handshake; a physical machine is recommended |

Linux udev rules:

```bash
# /etc/udev/rules.d/51-android.rules
SUBSYSTEM=="usb", ATTR{idVendor}=="18d1", MODE="0666", GROUP="plugdev"
# Append each vendor's idVendor as needed
sudo udevadm control --reload-rules && sudo udevadm trigger
```

### 14.3 Android Versions

| Version | SDK | Notes |
|---|---|---|
| Android 8–10 | 26–29 | Basic features work; mirroring audio unavailable |
| Android 11–13 | 30–33 | Full features; wireless pairing available |
| Android 14–16 | 34–36 | Full features; the clipboard API changed and needs a compatibility branch |
| Android 17+ | 37+ | To be verified |

### 14.4 Vendor Differences

Vendor detection is performed by `detectVendor()`, comparing `ro.product.brand`, `ro.product.manufacturer`, `ro.product.vendor.brand`, `ro.build.product`, and the probed `brand` in order, returning on the first match. `brand` is preferred over `manufacturer` because a Redmi device reports manufacturer Xiaomi but brand Redmi.

Six categories are covered today:

| Category | Match rule | System name | Zone content |
|---|---|---|---|
| Xiaomi / Redmi / POCO | `xiaomi\|redmi\|poco` | MIUI · HyperOS | Disable-able component list |
| OPPO / OnePlus / realme | `oppo\|oneplus\|realme` | ColorOS · realme UI | Same |
| vivo / iQOO | `vivo\|iqoo` | OriginOS · Funtouch | Same |
| Huawei / Honor | `huawei\|honor` | EMUI · HarmonyOS · MagicOS | Same |
| Samsung | `samsung` | One UI | Same |
| Other (generic) | No match | — | The vendor zone is not shown |

Vendor hint text (such as Xiaomi requiring "USB debugging (Security settings)") comes from `vendorHint()` in the session layer and is shown next to the connect panel and error messages rather than as a generic error.

### 14.5 PWA and Offline

| Item | Status | Notes |
|---|---|---|
| Service Worker | Supported | Registers on Chromium-based browsers and Safari 16.4+ |
| Offline interface | Supported | 11 files precached (HTML, manifest, 5 icons, entry JS and CSS, ADB chunk) |
| Offline device operation | No network needed | Device communication runs over USB and never touched the network |
| Install as desktop app | Supported | Chrome and Edge show an install button; Safari uses "Add to Home Screen" |
| Update prompt | Supported | A bar appears at the top when a new version is found; the user decides when to refresh |

Outside a secure context (HTTP and not localhost), neither the Service Worker nor WebUSB is available, and the page states this explicitly.

---

## 15. Known Issues and Limitations

### 15.1 Architectural Limitations (Cannot Be Engineered Away)

| # | Limitation | Cause | Handling |
|---|---|---|---|
| 1 | Reloading or closing the page disconnects the device | The WebUSB session is bound to the tab's lifetime | Stated in the interface; transfers can be restarted after an interruption |
| 2 | Long tasks cannot run in the background | Browsers throttle background tabs | Background scheduling precision is not promised |
| 3 | Remote control of another person's device is unsupported | The architecture has no relay and no such design intent | Stated explicitly; not implemented |
| 4 | Safari, Firefox, and iOS are unsupported | The first has no WebUSB; the second declined to implement it | An unsupported-browser notice is shown on open |
| 5 | HTTPS or localhost is mandatory | WebUSB requires a secure context | HTTP sites get an explicit notice rather than a silent failure |
| 6 | Wireless connection needs a self-hosted relay | Zero-backend architecture | None is hosted; the method is documented only |
| 7 | Unusable under `file://` | Not a secure context | The installed PWA works offline, bypassing the restriction |

### 15.2 Features Not Yet Implemented

| # | Item | Status |
|---|---|---|
| 1 | Screen mirroring (scrcpy) | Not implemented; `public/scrcpy-server` does not exist |
| 2 | Live logcat | Not implemented; only manual execution in the terminal |
| 3 | Fastboot and flashing | Not implemented |
| 4 | Script orchestration and scheduling | Not implemented |
| 5 | Plugin system | Not implemented; see 10.7 |
| 6 | Multi-device parallelism | Not implemented; one session at a time |
| 7 | Device report export and redaction | Not implemented; see 13.4 |
| 8 | Single-file offline build | Not implemented; see 7.5 |

### 15.3 Known Defects

| # | Issue | Impact | Status |
|---|---|---|---|
| 1 | `canWriteSecureSettings` is inferred from version and vendor policy | On a few ROMs the verdict differs from reality and the failure appears only at write time | Known; the tool layer provides a fallback message |
| 2 | Some vendor ROMs restrict `pm` / `settings` | The command returns a permission error | The raw error is shown along with the vendor note |
| 3 | GPU load readings are unreliable | sysfs nodes differ across vendors | Labelled as unavailable rather than shown as 0 |
| 4 | Service Worker updates require a manual refresh | Users may stay on an old version for a long time | A top bar prompts; no automatic refresh to avoid interrupting work |
| 5 | End-to-end tests are absent | Real USB handshakes and multi-device behaviour cannot regress in CI | Unit tests cover the pure-function layer in CI; end-to-end pending, see the roadmap |

---

## 16. Changelog

### v0.1.0-dev — 2026-11-15

First runnable version.

**Features**

- 9 functional sections and 26 tool cards covering device overview, app management, display and input, file transfer, system tuning, battery management, and the vendor zone.
- 2 interaction surfaces without cards: the ADB terminal (with 3 persistent shortcuts) and the operation log (filterable by status, exportable as JSON).
- The vendor zone branches across 5 vendor categories, with `visibleTools()` filtering on `ro.product.brand`.
- 9 read-only probes run in parallel at connection time to build `DeviceCapabilities`, from which tools report availability or a reason.

**Reliability**

- Settings snapshots: every `settings put` / `wm` write records the previous value first, and one-click restore replays in reverse. The sort key is a monotonic sequence, so multiple records in the same millisecond still reverse correctly.
- Emergency reset page `#/reset-display`: one button per page, all dimensions in px; at 2.5× root font size the button size and position are unchanged.
- Command ring buffer with sequence watermark: the audit slices windows by `commandMark()` rather than timestamps, preventing same-millisecond bleed between operations.
- When `settings get` returns `null`, the inverse is translated to `settings delete` instead of writing the string "null".

**PWA and deployment**

- Added a Web App Manifest, a Service Worker, and icons in 4 sizes.
- Three cache strategies: network-first for navigation, cache-first for hashed artifacts, incremental update for static resources.
- The version is injected at build time from the artifact fingerprint, so unchanged content yields an unchanged version and users receive no meaningless update prompts.
- GitHub Actions deploys to Pages automatically; live at <https://ntars.github.io/Webroit/>.

**Known gaps**

- Mirroring, logcat, Fastboot, script orchestration, the plugin system, and multi-device support are not implemented.
- End-to-end tests are absent. The pure-function layer is covered by unit tests in CI; a real WebUSB handshake still needs manual verification.
- No device report export or redaction.

### Earlier

The project was previously in design and planning. There is no public release before this one. Planning documents (feature inventory, technical design, decision records) are internal material and are not distributed with the repository.

---

## 17. Roadmap

| Version | Codename | Goal | Exit criteria | Status |
|---|---|---|---|---|
| v0.1 | Screwdriver | Connection and minimal loop (26 items) | Plug in to connect, install packages, transfer files, take screenshots, run commands | Done |
| v0.2 | Handle | Live monitoring and mirroring (60 cumulative) | Screen mirroring works; 100k-line logcat stream does not crash; CPU / memory / temperature curves | Not started |
| v0.3 | Wrench | Backup, scripting, multi-device (90 cumulative) | One script runs across three devices and produces a report | Not started |
| v0.4 | Scalpel | Fastboot and high-risk operations (120 cumulative) | Flashing and rollback completed on 5 devices across 3 vendors | Not started |
| v1.0 | Workshop | Plugin ecosystem and release (152 cumulative) | Third parties can write plugins; i18n complete; tests cover core paths | Not started |

**Technical debt list** before v0.2 (prioritised over new features):

1. Add end-to-end tests — the pure-function layer is covered by unit tests in CI, but a real WebUSB handshake still needs manual verification.
2. Device report export with sensitive-data redaction (see 13.4).
3. Single-file offline build (see 7.5), or explicitly retire the plan.

**Explicitly not scheduled**: cloud accounts, iOS / HarmonyOS, one-click root, an APK store, remote assistance.

---

## 18. Contributing

### 18.1 Suitable Contributions

| Area | Description | Difficulty |
|---|---|---|
| Device compatibility | Post your device model, Android version, ROM, and which tools do not work on your machine in an Issue | Low |
| Error-code mapping | Add a rule to the table in `src/core/error-copy.ts`; `npm run verify:copy` checks that the new rule supplies both a cause and a next step | Low |
| Documentation review | Verify factual consistency between `README.md` and `README_EN.md`, and point out mismatches with the code | Low |
| New tools | Implement a feature entry against the `Tool` interface, with screenshots and failure behaviour from a real device | Medium |
| Testing | Add unit tests for the remaining `src/services/` modules; the interfaces already make them testable | Medium |
| Bug reports | Include device model, Android version, ROM, reproduction steps, and console logs | Low |

Plugin examples are not accepted for now — the plugin system is not implemented; see 10.7.

### 18.2 Before Submitting

1. **Do not submit code of unknown origin.** Any snippet copied from another project must state its source and license in the PR, and must not be GPL-2.0-only or an incompatible license.
2. **Do not submit anything from CzJam/gjgjxweb.** That project is GPL-3.0-only, incompatible with this project's Apache-2.0 / MIT (copyleft cannot be absorbed into a permissive license), and this project is written from scratch.
3. **Features that affect device behaviour must state the tested model and result.** If untested, say so in the PR rather than submitting on "it should work".
4. **Discuss before adding a dependency.** This project deliberately keeps dependencies minimal; a new package needs a justification for why existing capabilities cannot do the job.
5. **Redact screenshots and logs.** Mask serial numbers, IMEI, and account information first.

### 18.3 Code Style

- TypeScript strict mode with `noUnusedLocals` / `noUnusedParameters` / `noImplicitOverride` all enabled.
- Comments are in Chinese and explain "why", not "what".
- Commit messages are in Chinese, formatted as `type: action`, for example `应用管理: 修复停用系统包后无法恢复`.
- Files stay under roughly 500 lines; split beyond that, services by section and components by responsibility.

### 18.4 `any` Is Now Zero — What the Old Trade-off Got Wrong

Earlier versions carried 18 `any`s in `src/core/transport/driver.ts`, justified by "`@yume-chan/*` ships a `ReadableStream` that is incompatible with the DOM one, so annotating it produces a dozen errors downstream". That was half true: the errors were real, but the two `ReadableStream`s **are the same class at runtime** — `@yume-chan/stream-extra`'s `esm/stream.js` does `export { ReadableStream }` straight from `globalThis`. The conflict lives only in the `.d.ts` shapes (one declares a zero-argument `getReader()` overload, the other does not), not in the objects.

Once that was clear, all 18 went away without a single `as unknown as`:

| Was `any` | Count | Now |
|---|---|---|
| The five `Libs` fields (`adb` / `stream` / `usb` / `CredentialStore` / `manager`) | 5 | Expression types such as `typeof import('@yume-chan/adb')`, inferred from the dynamic `import()` return value — they stay accurate across package upgrades |
| `as any` on `libs.*` member access (`Consumable`, `MaybeConsumable`, `default`, `AdbDaemonWebUsbDeviceManager.BROWSER`) | 4 | All assertions removed. The namespace types already export these; the casts existed only to paper over the untyped parameters |
| `Driver` fields and parameters (`#adb`, `#sessions`, constructor `adb`, `get raw()`, `#withSync`'s `sync`) | 5 | `Adb` / `Set<AdbSync>` / `(sync: AdbSync) => Promise<T>`; `get raw()` returns `Adb` |
| `authenticate()`'s `connection` and `transport` callback parameter | 2 | `AdbDaemonConnection` / `AdbDaemonTransport`, inferred from `authenticate()`'s return type |
| `connectUsb()`'s `selected` and `(error as any)?.name` | 2 | `AdbDaemonWebUsbDevice` (with `ConnectOptions.device` typed too); the error check became `instanceof libs.usb.AdbDaemonWebUsbDevice.DeviceBusyError`, which survives minification unlike a `name` string |
| **Total** | **18** | Zero `any`, no `as unknown as` |

Exactly one shape difference had to be worked around, and the fix is a narrow structural interface rather than a cast:

```ts
// Only requires: take a reader, read a chunk, release the lock.
// Both the DOM stream and the package's stream satisfy it.
interface ByteSource {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    releaseLock(): void;
  };
}
```

`collect()` accepts that, so the streams from `exec()` and `read()` pass straight in. The other direction — handing `File.stream()` to `sync.write()` — re-wraps it in the package's own `ReadableStream` constructor, wiring its `pull` to the DOM reader. Since both are the same constructor at runtime, this is zero-copy; it only makes the types line up.

`no-explicit-any` now applies **repo-wide**: the exemption for `driver.ts` in `eslint.config.js` is gone, and `verify:docs` recounts `any` and fails on a single occurrence. 58 `.ts` / `.tsx` files, 0 places of `any` (six are test files).

The one remaining convention is "the UI layer must not import `@yume-chan/adb`", still held by code review rather than a custom ESLint rule.

---

## 19. Copyright and License

Original code is licensed per directory, using **only Apache License 2.0 and MIT** — both permissive. Full texts live in [LICENSE](LICENSE) (Apache-2.0) and [LICENSE-MIT](LICENSE-MIT) (MIT); the layer map is in [LICENSING.md](LICENSING.md).

| Path | License |
|---|---|
| `src/services/` `src/tools/` `src/core/transport/` | Apache-2.0 |
| `src/core/` (rest), `src/ui/`, `src/node/`, `bin/`, `scripts/` | MIT |
| Brand name, logo and interface design | All rights reserved |

Both licenses allow commercial use, modification, closed-source distribution and sublicensing — **no copyleft**. Your derivative work does not need to be open-sourced. Just keep the copyright notice, the license texts and [NOTICE](NOTICE) when redistributing. Apache-2.0 adds an express patent license (Section 3).

This project is a backend-less static PWA: no server, no database, the build runs directly in the user's browser. There is therefore no "network service" for AGPL's Section 13 to constrain — anyone curious about the implementation can simply open DevTools.

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

The "Webroit" name, logo, and interface design belong to Ntarstudio and are not covered by the code license.

Third-party components retain their respective copyrights and licenses; see [NOTICE](NOTICE).

---

## 20. NOTICE and Open-Source Compliance

The complete third-party component disclosure (name, version, copyright holder, license, official URL, purpose, modification status, and license text) is in [NOTICE](NOTICE). That file is maintained separately and cannot be replaced by this section.

### 20.1 Disclosure Scope

| Category | Count | Distributed with the artifact |
|---|---|---|
| Runtime direct dependencies | 6 | Yes |
| Runtime transitive dependencies | 4 | Yes |
| Build-time dependencies | 15 | No, they do not enter `dist/` |
| Platform-specific optional binary entries | 52 | No, only one is installed per platform |
| Binary components distributed with the package | 0 | — |

25 components in total. The previously planned `scrcpy-server` (Apache-2.0) is currently **not** in the repository or the artifact, because screen mirroring is not implemented.

### 20.2 License Distribution

| License | Count | Components |
|---|---|---|
| MIT | 22 | Everything except the three below |
| ISC | 1 | `picocolors` |
| BSD-3-Clause | 1 | `source-map-js` |
| Apache-2.0 | 1 | `typescript` |

All four are permissive and compatible with the project's own Apache-2.0 / MIT. **There are no copyleft components such as GPL / LGPL / AGPL / MPL**, so no upstream license conflict can arise.

### 20.3 Special Notes

1. **The ADB protocol** is published by Google under Apache-2.0. The `@yume-chan/adb` used here is an independent TypeScript reimplementation of that protocol (MIT), not a derivative work of Google's code.
2. **All icons in this project are hand-written SVG paths**, using no vendor logos and no external icon library or icon font.
3. **Fonts use the system font stack** (`-apple-system`, `PingFang SC`, `Microsoft YaHei`, and others); no webfont file is downloaded or distributed.
4. **Brand names appearing in the interface** (Xiaomi, OPPO, vivo, Huawei, Samsung, and others) serve only as a basis for device identification and feature branching. This is descriptive use and involves no trademark licence.
5. **This project uses no code, copy, or images of unknown origin or unlabelled license.** All code is written from scratch.

### 20.4 Maintenance Obligation on Dependency Changes

After any change to `package.json` or `package-lock.json`, [NOTICE](NOTICE) and the counts in this section must be updated together. Verification:

```bash
npm ci
node -e "const d=require('./package-lock.json');const p=d.packages;const s=new Set();for(const k in p){if(!k)continue;const n=k.split('node_modules/').pop();if(n.startsWith('@esbuild/')||n.startsWith('@rollup/'))continue;s.add(n)}console.log(s.size,'组件')"
```

The output should be 25. A different number means something was added or removed and the disclosure needs updating.

---

## Disclaimer

```
By using this tool you acknowledge and accept the following:

1. This tool operates Android devices directly through the ADB / Fastboot
   protocols and performs low-level operations. Any operation carries a risk
   of data loss, system instability, or a device that fails to boot.

2. This tool works only with your explicit authorisation. The "Allow USB
   debugging" confirmation on the device is the sole credential; this tool
   provides and accepts no means of bypassing it.

3. Flashing partitions, erasing partitions, and modifying system properties
   are at the user's own risk. Back up important data beforehand and confirm
   that the image matches the device model exactly.

4. This tool does not provide bootloader unlocking, activation-lock bypass,
   screen-lock bypass, or the compromise of another person's device, and
   offers no assistance for such purposes.

5. This software is provided "as is" under Apache-2.0 and MIT, without warranty of any
   kind, express or implied. The authors and contributors accept no liability
   for any direct or indirect loss arising from its use.

6. This tool collects and uploads no user data. All device operations happen
   between your browser and the local USB connection.
```

---

## Related Files

Files in the repository that accompany this README:

| File | Content |
|---|---|
| [`README.md`](README.md) | Chinese version, section-for-section with this file |
| [`NOTICE`](NOTICE) | Itemised third-party disclosure with license texts |
| [`LICENSE`](LICENSE) | Apache-2.0 full text (drives GitHub detection) |
| [`LICENSE-MIT`](LICENSE-MIT) | MIT full text |
| [`LICENSING.md`](LICENSING.md) | Layer routing table |
| [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) | Pages deployment workflow |
| [`package.json`](package.json) | Dependencies and build scripts |
| [`public/sw.js`](public/sw.js) | Service Worker source |

A set of internal design documents exists from the planning phase (feature inventory, technical design, decision records, risk and compliance, device validation checklist). They are not distributed with the repository; their substance has been distilled into the corresponding sections of this README according to what is actually implemented.
