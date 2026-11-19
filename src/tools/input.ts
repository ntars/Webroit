/**
 * 工具入参的收敛小工具。
 *
 * UI 表单、CLI 字符串、MCP 的 JSON 值三种来源送进来的类型各不相同，
 * 工具定义不应该各写一份 `String(input[key] ?? '')`。这里统一收口，
 * 让每个工具的执行体只关心业务。
 *
 * 全部是纯函数，可单独测试。
 */

/** 从 input 里取字符串 */
export function str(input: Record<string, unknown>, key: string, fallback = ''): string {
  const value = input[key];
  return value === undefined || value === null ? fallback : String(value);
}

/** 从 input 里取数字 */
export function num(input: Record<string, unknown>, key: string): number {
  return Number(input[key]);
}

/** 从 input 里取布尔 */
export function bool(input: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = input[key];
  if (value === undefined || value === null) return fallback;
  return value === true || value === 'true' || value === 'on' || value === 1;
}

/** 解析包名列表，逗号 / 换行 / 空格都认 */
export function packageList(raw: string): string[] {
  return raw
    .split(/[,\n\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
