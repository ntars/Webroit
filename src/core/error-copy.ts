/**
 * 错误文案翻译层。
 *
 * 为什么需要这一层：
 * 设备的原始报错是给开发者看的 —— `device offline`、`Failure
 * [INSTALL_FAILED_INSUFFICIENT_STORAGE]`、`error: closed`。
 * 直接甩到界面上，用户既不知道发生了什么，也不知道下一步该做什么，
 * 只能截图去问人。这一层把原文翻译成「发生了什么 + 现在做什么」两句话。
 *
 * 三条设计约束：
 * 1. **原文不丢**：翻译结果带上原始文本，排查时仍然可复制。
 * 2. **不猜**：只有能明确识别的模式才给具体原因；认不出的走兜底，
 *    兜底也必须给出可执行动作，而不是「未知错误」。
 * 3. **纯函数**：不碰 DOM、不读全局，UI 与 CLI、单测共用同一份判断。
 */

/**
 * 错误的可判定类别。
 *
 * 有类别才能决定「重试按钮该做什么」：连接断了要重连，
 * 参数错了要改参数，签名冲突要先去卸载。只靠布尔值区分不出来。
 */
export type ErrorKind =
  | 'cancelled'
  | 'busy'
  | 'offline'
  | 'unauthorized'
  | 'storage'
  | 'signature'
  | 'install'
  | 'permission'
  | 'missing-command'
  | 'timeout'
  | 'disconnected'
  | 'no-selection'
  | 'unsupported'
  | 'unknown';

/** 一条可执行的解释 */
export interface Explanation {
  kind: ErrorKind;
  /** 发生了什么，一句话 */
  reason: string;
  /** 现在可以做什么，必须是一个动作 */
  next: string;
  /** 值不值得原样重试 */
  retry: boolean;
  /** 设备的原始报错，便于复制排查；无原文时为空串 */
  raw: string;
}

/** 一条识别规则 */
interface Rule {
  kind: ErrorKind;
  /** 命中即采用 */
  test: RegExp;
  /** 生成解释；text 是已 trim 的原文 */
  build: (text: string) => Omit<Explanation, 'raw' | 'kind'>;
}

/**
 * 识别规则表。
 *
 * 顺序有意义：越具体的放前面。例如「接口被占用」的原文里也含 `error`，
 * 若把通用的 `/error/` 放前面就会被它先吃掉。
 */
const RULES: Rule[] = [
  {
    // 用户自己按了中止 / 切走页面，不是故障
    kind: 'cancelled',
    test: /用户已取消|用户已停止|操作已停止|页面已离开|AbortError|aborted/i,
    build: () => ({
      reason: '操作已被取消。',
      /*
       * 出口不能说「设备状态没有被改动」。
       *
       * 这句话在「点中止时命令还没发出去」的前提下是对的，但中止多半发生在
       * 一条命令跑到一半的时候（冻结某个应用、安装到第 3 个分包、传输到 60%），
       * 那时设备上究竟落了多少是不确定的。承诺「没改动」会让人放心地不复查，
       * 而真实情况可能是一个半冻结的应用或一批半装的文件。
       * 改成「先复查」—— 不确定的时候，让用户去看一眼比替他打包票安全。
       */
      next: '命令已停手，但中止可能发生在某一步执行途中，请先复查当前状态再决定是否重新执行。',
      retry: true,
    }),
  },
  {
    kind: 'busy',
    test: /ADB 接口被占用|already.*use|claim.*interface|DeviceBusy/i,
    build: () => ({
      reason: '这台设备的 ADB 接口已被别的程序占用。',
      next: '关掉其他 WebADB 标签页，或在终端执行 adb kill-server 后重新连接。',
      retry: true,
    }),
  },
  {
    kind: 'offline',
    test: /device offline|no devices\/emulators|device not found|设备已离线/i,
    build: () => ({
      reason: '设备当前处于离线状态，命令没有送达。',
      next: '检查数据线是否松动（优先换一根支持数据传输的线），确认手机屏幕亮着后重新连接。',
      retry: true,
    }),
  },
  {
    kind: 'unauthorized',
    test: /unauthorized|authoriz|未授权|授权被拒/i,
    build: () => ({
      reason: '手机没有确认这次调试授权。',
      next: '看手机屏幕，在「允许 USB 调试吗」弹窗里勾选「一律允许」并点确定；没弹窗就拔插一次数据线。',
      retry: true,
    }),
  },
  {
    kind: 'storage',
    test: /INSTALL_FAILED_INSUFFICIENT_STORAGE|INSTALL_FAILED_NO_SPACE|no space left/i,
    build: () => ({
      reason: '设备存储空间不足，安装包放不下。',
      next: '清理设备存储（照片、缓存、旧应用）后重试，或先卸载不再使用的应用。',
      retry: true,
    }),
  },
  {
    kind: 'signature',
    test: /INSTALL_FAILED_UPDATE_INCOMPATIBLE|INSTALL_FAILED_VERSION_DOWNGRADE|signatures do not match/i,
    build: () => ({
      reason: '设备上已有同包名但签名或版本不同的应用，系统拒绝覆盖。',
      next: '先在「应用管理」里卸载那个旧版本，再重新安装；卸载前确认它没有你需要保留的数据。',
      retry: false,
    }),
  },
  {
    kind: 'install',
    test: /INSTALL_FAILED_/,
    build: (text) => ({
      reason: `安装被系统拒绝（${text.replace(/^Failure\s*/i, '').slice(0, 120)}）。`,
      next: '确认安装包与设备架构匹配（arm64 设备装 arm64 包），并检查是否已在设备上开启了「未知来源」安装。',
      retry: false,
    }),
  },
  {
    kind: 'permission',
    test: /Permission denied|not allowed|SELinux|Operation not permitted|权限不足|没有权限/i,
    build: () => ({
      reason: '这条命令需要比当前更高的权限，被厂商 ROM 拦下了。',
      next: '打开开发者选项里的「USB 调试（安全设置）」并关闭「权限监控」，然后重新连接再试。',
      retry: true,
    }),
  },
  {
    // 命令在设备上不存在；与「权限不足」是两件事，出口也不同
    kind: 'missing-command',
    test: /inaccessible or not found|command not found|Unknown command/i,
    build: (text) => ({
      reason: `设备上没有这条命令（${text.slice(0, 80)}）。`,
      next: '这通常是系统版本过低或厂商裁剪所致，换用「终端」分区手工执行替代命令，或升级系统后再试。',
      retry: false,
    }),
  },
  {
    kind: 'timeout',
    test: /timeout|timed out|超时|ETIMEDOUT/i,
    build: () => ({
      reason: '设备在预期时间内没有回应。',
      next: '设备可能正在处理上一个任务，等几秒后重试；长时间无响应就拔插数据线重连。',
      retry: true,
    }),
  },
  {
    kind: 'disconnected',
    /*
     * 「设备连接已结束」是 `resetConnection()` 中止在途命令时用的原因原文。
     * 它必须落在「连接中断」这一档，不能落进上面的「已取消」：
     * 用户没有点中止，是线掉了 —— 出口是去查数据线，不是「重新执行一次即可」。
     */
    test: /设备已断开|设备连接已结束|连接已中断|disconnected|error: closed|broken pipe|transfer error|no connection/i,
    build: () => ({
      reason: '与设备的连接中断了。',
      next: '重新插拔数据线，等手机回到桌面后点「重新连接」。中断时正在进行的操作可能只完成了一半，请复查结果。',
      retry: true,
    }),
  },
  {
    kind: 'no-selection',
    test: /未选择设备/,
    build: () => ({
      reason: '没有选择设备，连接没有建立。',
      next: '重新点「连接设备」，在弹出的浏览器窗口里选中你的手机。',
      retry: true,
    }),
  },
  {
    kind: 'unsupported',
    test: /不支持 WebUSB/,
    build: () => ({
      reason: '当前浏览器没有提供 WebUSB 接口。',
      next: '改用 Chrome 或 Edge 桌面版，并通过 https 或 localhost 打开本页面。',
      retry: false,
    }),
  },
];

/** 兜底文案里出现即视为「没有信息量」的词，供校验脚本断言 */
export const VAGUE_PHRASES = ['操作失败', '未知错误', '出错了', '发生错误', '系统错误'];

/**
 * 把任意异常翻译成可执行的解释。
 *
 * @param caught 捕获到的异常，可以是 Error、字符串或任意值
 * @param fallback 设备没有给出任何文本时用的一句话
 */
export function explainError(caught: unknown, fallback = '设备没有返回具体原因。'): Explanation {
  const raw = messageOf(caught).trim();

  for (const rule of RULES) {
    if (rule.test.test(raw)) {
      return { kind: rule.kind, ...rule.build(raw), raw };
    }
  }

  /*
   * 兜底：认不出的错误也必须能往前走。
   * 原因位置放原文（有原文就比「未知错误」有用），出口是通用排查顺序。
   */
  return {
    kind: 'unknown',
    reason: raw || fallback,
    next: '先确认设备仍在连接状态，然后重试一次。反复失败时，把这段原文连同机型、系统版本一起记录下来，便于定位是设备侧还是工具侧的问题。',
    retry: true,
    raw,
  };
}

/**
 * 从任意捕获值里取一句话。
 *
 * UI、CLI、终端三处都要做这件事，写法必须一致 ——
 * 否则同一个异常在界面上和命令行里显示成两个样子。
 */
export function messageOf(caught: unknown): string {
  if (caught instanceof Error) {
    // DOMException 的 message 可能为空，此时退回 name
    return caught.message || caught.name || '';
  }
  if (typeof caught === 'string') return caught;
  if (caught === null || caught === undefined) return '';
  try {
    return JSON.stringify(caught);
  } catch {
    return String(caught);
  }
}
