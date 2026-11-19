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
import { preferences, services, pendingUpdate, activeModule } from '@/ui/state/app-state';
import { auditLog } from '@/core/audit';
import { bindSnapshotBackend, snapshots } from '@/core/snapshot';
import { installIndexedDbBackend } from '@/core/snapshot-indexeddb';
import { registerServiceWorker, watchInstallPrompt } from '@/core/pwa';
import { applyTheme, watchSystemTheme } from '@/ui/theme/apply';

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

  const root = document.getElementById('app');
  if (!root) throw new Error('找不到挂载节点 #app');
  render(<App />, root);
}

bootstrap();
