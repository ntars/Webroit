/**
 * 应用入口。
 *
 * 启动顺序有意如此：
 * 1. 先应用主题（避免白屏闪一下再变色）
 * 2. 注册工具与两个宿主能力（产物下载、快照落盘）
 * 3. 注入服务解析器
 * 4. 注册 PWA 与挂载组件
 */

import { render } from 'preact';

import { loadPreferences } from '@/core/storage';
import { App } from '@/ui/App';
import { registerTools, type ModuleId } from '@/tools/registry';
import { BUILTIN_TOOLS, bindFileSink, bindServices } from '@/tools/builtin';
import {
  preferences,
  services,
  pendingUpdate,
  activeModule,
  pushOutput,
} from '@/ui/state/app-state';
import { explainError } from '@/core/error-copy';
import { auditLog } from '@/core/audit';
import { bindSnapshotBackend, snapshots } from '@/core/snapshot';
import { installIndexedDbBackend } from '@/core/snapshot-indexeddb';
import { registerServiceWorker, watchInstallPrompt } from '@/core/pwa';
import { applyTheme, watchSystemTheme } from '@/ui/theme/apply';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';

import '@/ui/theme/tokens.css';
import '@/ui/theme/base.css';
import '@/ui/theme/components.css';
import '@/ui/theme/layout.css';
import '@/ui/theme/views.css';

/**
 * 应用主题到根元素。
 *
 * 实际写入在 `ui/theme/apply.ts` —— 首屏与设置面板走同一条路，
 * 免得「启动时对、点按钮不对」这类分裂再次出现。
 */
function bootTheme(): void {
  applyTheme(loadPreferences().theme);
  watchSystemTheme();
}

/**
 * 产物交付方式：浏览器里触发下载。
 *
 * 这段代码只属于浏览器，所以放在入口而不在 tools/builtin.ts ——
 * 后者要同时被命令行编译，不能出现 document。
 */
function registerBrowserFileSink(): void {
  bindFileSink((blob, name) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
}

/**
 * 全局异常兜底。
 *
 * 两类「没人 await 的异常」都收在这里，而不是只在组件边界里处理：
 *
 * 1. `unhandledrejection` —— 所有 `void somePromise()` 的失败都会落到这里。
 *    本仓库大量使用 `void xxx()` 表达「这条支路不需要等」，一旦失败就彻底静默，
 *    用户看到的只是某个按钮点了没反应。
 * 2. `error` —— 事件回调、定时器、以及边界之外的同步异常。
 *
 * 只记录、不拦截：`preventDefault` 会让浏览器控制台里也没有红字，
 * 排查时反而更难。终端留一条，用户能复制出来。
 */
function watchGlobalErrors(): void {
  window.addEventListener('unhandledrejection', (event) => {
    const explained = explainError(event.reason);
    pushOutput('stderr', `[未处理的异步异常] ${explained.reason}`);
  });

  window.addEventListener('error', (event) => {
    // 资源加载失败（img/script）也走这个事件，但 error 字段为空，不重复记
    if (!event.error) return;
    const explained = explainError(event.error);
    pushOutput('stderr', `[未捕获异常] ${explained.reason}`);
  });
}

function bootstrap(): void {
  bootTheme();

  // 注册内置工具，一次即可
  registerTools(BUILTIN_TOOLS);

  // 工具层通过这个回调拿到当前连接的服务，不直接持有会话
  bindServices(() => services.value);

  // 截屏 / 拉取 / 导出 APK 的落盘方式（浏览器 = 下载）
  registerBrowserFileSink();

  // 预加载审计日志，避免首次操作时才等 IndexedDB 打开
  void auditLog.whenReady();

  /*
   * 快照也要在首屏前就绪 —— 用户在第一个操作里改设置时，
   * 上一次会话的陈旧记录必须已经清掉，否则会回放出错误的值。
   *
   * 落盘后端要先注册再等 whenReady：SnapshotStore 构造时就开始初始化，
   * 那时后端还没注册，所以注册之后要重新对齐一次已有记录。
   */
  void installIndexedDbBackend(bindSnapshotBackend).then(() => snapshots.whenReady());

  /*
   * 恢复上次使用的分区。
   *
   * 两件事必须同时做：preferences 里要有完整偏好（主题、字号等），
   * activeModule 也要切到上次的分区。只写 preferences 的话，
   * 界面仍然停在默认的「设备总览」—— 偏好看上去存住了，实际却没生效。
   */
  const prefs = loadPreferences();
  preferences.set(prefs);
  if (prefs.lastModule) {
    activeModule.set(prefs.lastModule as ModuleId);
  }

  // PWA：注册离线能力，并把「有新版本」交给界面提示，不自动刷新
  watchInstallPrompt();
  registerServiceWorker((apply) => pendingUpdate.set(apply));

  // 全局兜底要早于挂载：挂载期的异常同样需要被记录
  watchGlobalErrors();

  const root = document.getElementById('app');
  if (!root) throw new Error('找不到挂载节点 #app');

  /*
   * 外壳级兜底。
   *
   * 分区级边界（App.tsx 里那个）挡住的是「某个分区坏了」；
   * 这一层挡的是「外壳自己坏了」—— 侧边栏、终端、顶栏任何一处抛错。
   * 没有它，一个 `undefined.map()` 就能把页面变成纯白，连刷新提示都没有。
   *
   * 这一层的出口只有刷新：外壳都没了，就没有「其余部分仍可用」可讲。
   */
  render(
    <ErrorBoundary
      label="整个界面"
      note="这不是设备的问题。点上方「重试」重新渲染；仍然失败就刷新页面 —— 刷新不会动设备上的任何数据。"
    >
      <App />
    </ErrorBoundary>,
    root,
  );
}

bootstrap();
