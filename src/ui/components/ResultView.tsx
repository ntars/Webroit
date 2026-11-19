/**
 * 结果渲染器：把 ToolResult.data 渲染成可读的表格或键值对。
 *
 * 难点在于 data 的形状是各服务自定义的，UI 无法预知。
 * 策略是三条规则覆盖绝大多数情况：
 * 1. 数组 → 表格，取第一项的键作表头
 * 2. 对象 → 键值对列表
 * 3. 其他 → 原样打印
 * 特殊形状（如设备快照里嵌套对象）会递归一层，超过一层就 JSON 化，
 * 避免渲染出无限缩进的嵌套表格。
 */

import { type FunctionComponent } from 'preact';
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';

import type { ToolResult } from '@/tools/registry';
import { formatBytes } from '@/core/utils';

interface Props {
  result: ToolResult;
}

/** 判断是否为简单值 */
function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** 值的展示化 */
function display(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === 'string') return value || '—';
  if (Array.isArray(value)) return `${value.length} 项`;
  return JSON.stringify(value);
}

/** 字段名的中文化映射：常见键名直译，避免表格里出现英文 */
const LABELS: Record<string, string> = {
  brand: '品牌',
  model: '型号',
  device: '设备代号',
  android: '系统版本',
  sdk: 'API 等级',
  abi: '指令集',
  fingerprint: '系统指纹',
  kernel: '内核版本',
  arch: '架构',
  storageType: '存储类型',
  boardId: '主板序列号',
  uptime: '运行时长',
  marketName: '营销名称',
  display: '显示',
  battery: '电池',
  level: '电量',
  voltage: '电压',
  temperature: '温度',
  name: '名称',
  versionName: '版本名',
  versionCode: '版本号',
  targetSdk: '目标 API',
  minSdk: '最低 API',
  firstInstallTime: '首次安装',
  lastUpdateTime: '最近更新',
  paths: '安装路径',
  permissions: '权限',
  system: '系统应用',
  disabled: '已停用',
  installed: '已安装',
  package: '包名',
  success: '结果',
  message: '说明',
  size: '大小',
  dir: '类型',
  group: '分组',
  label: '功能',
  impact: '影响',
  recommended: '建议停用',
  width: '宽度',
  height: '高度',
  dpi: '密度',
  dp: '最小宽度',
  physicalSize: '物理分辨率',
  physicalDpi: '物理密度',
  overridden: '已修改',
  id: '核心',
  mhz: '频率 MHz',
  activity: 'Activity',
  fontScale: '字体缩放',
  windowAnimation: '窗口动画',
  transitionAnimation: '过渡动画',
  animatorDuration: '属性动画',
  screenOffTimeout: '锁屏超时',
  status: '状态',
  health: '健康度',
  plug: '供电',
  simulated: '模拟中',
  milliamp: '电流 mA',
  watt: '功率 W',
  acPowered: '交流供电',
  usbPowered: 'USB 供电',
  wirelessPowered: '无线供电',
  updatesStopped: '统计已暂停',
};

/** 取字段的中文标签 */
function labelOf(key: string): string {
  return LABELS[key] ?? key;
}

export const ResultView: FunctionComponent<Props> = ({ result }) => {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div class="result">
      <div class="result__summary" data-destructive={result.destructive}>
        {result.summary}
      </div>

      {result.data !== undefined && result.data !== null && (
        <>
          {showRaw ? (
            <pre class="result__raw">{JSON.stringify(result.data, null, 2)}</pre>
          ) : (
            <DataView data={result.data} />
          )}
          <button
            type="button"
            class="btn btn--ghost btn--sm result__toggle"
            onClick={() => setShowRaw(!showRaw)}
          >
            {showRaw ? '按结构化查看' : '查看原始数据'}
          </button>
        </>
      )}
    </div>
  );
};

/** 按数据形状选择渲染方式 */
const DataView: FunctionComponent<{ data: unknown }> = ({ data }) => {
  if (Array.isArray(data)) {
    /*
     * 空数组是最容易被写死成「没有数据」的地方。
     * 但那句话没告诉用户任何有用的东西 —— 是设备没内容，还是筛选筛空了？
     * 这里给出两条具体出路：重跑一次，或去终端看原始输出。
     */
    if (data.length === 0) {
      return (
        <div class="empty">
          <div>这次执行没有返回任何条目</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>
            可能是设备上确实没有匹配内容，也可能命令被厂商 ROM 拦下了。
            重新执行一次；仍然为空就切到「终端」分区手动跑同一条命令，看设备返回了什么。
          </div>
        </div>
      );
    }

    // 全是简单值 → 打成标签
    if (data.every(isPrimitive)) {
      return (
        <div class="chips">
          {data.map((item, index) => (
            <span key={index} class="tag tag--neutral">{display(item)}</span>
          ))}
        </div>
      );
    }

    // 对象数组 → 表格
    return <Table rows={data as Record<string, unknown>[]} />;
  }

  if (typeof data === 'object' && data !== null) {
    return <KeyValue data={data as Record<string, unknown>} />;
  }

  return <div class="result__summary">{display(data)}</div>;
};

/** 对象数组渲染成表格 */
const Table: FunctionComponent<{ rows: Record<string, unknown>[] }> = ({ rows }) => {
  // 取所有行的键并集，避免某行缺字段导致列丢失
  const keys: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }

  // 列太多时只显示前 6 列，防止表格横向溢出血屏
  const visibleKeys = keys.slice(0, 6);
  const truncated = keys.length > visibleKeys.length;

  return (
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            {visibleKeys.map((key) => (
              <th key={key}>{labelOf(key)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {visibleKeys.map((key) => {
                const value = row[key];
                // 包名、路径、时间这类内容需要等宽字体才好读
                const mono = ['package', 'name', 'remote', 'paths'].includes(key);
                return (
                  <td key={key} class={mono ? 'table__mono' : undefined}>
                    {renderCell(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <div class="table__note">另有 {keys.length - visibleKeys.length} 列未显示，可切换原始数据查看</div>
      )}
    </div>
  );
};

/** 单元格渲染：处理布尔与嵌套 */
function renderCell(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? <span class="tag tag--success">是</span> : <span class="tag tag--neutral">否</span>;
  }
  if (typeof value === 'number' && value > 1024 * 1024) {
    // 大概率是字节数，转成可读大小
    return formatBytes(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : `${value.length} 项`;
  }
  return display(value);
}

/** 键值对渲染，嵌套对象递归一层 */
const KeyValue: FunctionComponent<{ data: Record<string, unknown> }> = ({ data }) => {
  const entries = Object.entries(data);

  return (
    <div class="kv-list">
      {entries.map(([key, value]) => {
        // 嵌套对象单独成块，否则一行里塞不下
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const nested = Object.entries(value as Record<string, unknown>).filter(
            ([, inner]) => isPrimitive(inner),
          );
          if (nested.length === 0) return null;
          return (
            <div key={key} class="kv-group">
              <div class="kv-group__title">{labelOf(key)}</div>
              <div class="kv">
                {nested.map(([innerKey, innerValue]) => (
                  <Fragment key={innerKey}>
                    <div class="kv__key">{labelOf(innerKey)}</div>
                    <div class="kv__value">{display(innerValue)}</div>
                  </Fragment>
                ))}
              </div>
            </div>
          );
        }

        if (Array.isArray(value) && value.every(isPrimitive)) {
          return (
            <div key={key} class="kv kv--inline">
              <div class="kv__key">{labelOf(key)}</div>
              <div class="kv__value">
                {value.length === 0 ? '—' : value.map((item) => display(item)).join('、')}
              </div>
            </div>
          );
        }

        return (
          <div key={key} class="kv kv--inline">
            <div class="kv__key">{labelOf(key)}</div>
            <div class="kv__value">{display(value)}</div>
          </div>
        );
      })}
    </div>
  );
};
