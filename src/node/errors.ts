/**
 * 运行期错误类型。
 *
 * 为什么要区分：agent 调用时必须能分辨「我参数写错了，改一下再试」
 * 和「设备出问题了，重试也没用」。只靠 stderr 文案判断不可靠 ——
 * 文案会随版本变，退出码不会。
 */

/** 用法错误：参数缺失、工具不存在、越权调用。退出码 2 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
