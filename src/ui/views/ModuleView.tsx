/**
 * 分区视图：按注册表自动渲染当前分区的全部工具。
 *
 * UI 不认识任何具体功能 —— 它只认识 Tool 接口。
 * 加一个功能只要往注册表塞一个对象，这个文件不用改。
 *
 * 未连接时同样按真实视图渲染，而不是整屏换成连接引导：
 * 访客应当能看清每个分区有哪些功能、每个功能要填什么、风险几级。
 * 各视图内部自行处理「哪些数据需要真机才能读」，把读取区换成内联的连接提示，
 * 工具卡片则保持可展开、可填参。
 */

import { type FunctionComponent } from 'preact';
import { useMemo, useState } from 'preact/hooks';

import { visibleTools, type ModuleId, type Tool } from '@/tools/registry';
import { capabilitiesFor } from '@/core/preview';
import { services } from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';
import { ToolCard } from '@/ui/components/ToolCard';
import { DeviceOverview } from '@/ui/views/DeviceOverview';
import { AppsView } from '@/ui/views/AppsView';
import { BatteryView } from '@/ui/views/BatteryView';
import { VendorView } from '@/ui/views/VendorView';
import { TerminalView } from '@/ui/views/TerminalView';
import { AuditView } from '@/ui/views/AuditView';

interface Props {
  module: ModuleId;
}

/**
 * 各分区的渲染策略。
 *
 * 大部分分区直接由注册表里的工具卡片驱动（通用渲染）。
 * 少数分区因为需要「先读数据再操作」的两段式交互（应用列表、电池采样、
 * 品牌组件清单），走专门的视图组件 —— 这些能力没法用
 * 「填参数 → 点执行 → 看结果」一个表单概括。
 *
 * terminal 与 audit 是 viewOnly 分区：它们完全没有工具卡片，
 * 必须在取 services 之前就分流，否则 `if (!current) return null` 会把它们挡掉。
 */
export const ModuleView: FunctionComponent<Props> = ({ module }) => {
  const current = useSignal(services);

  // viewOnly 分区不依赖设备服务，先于 null 检查返回
  if (module === 'terminal') return <TerminalView />;
  if (module === 'audit') return <AuditView />;

  /*
   * 未连接时用预览画像取工具列表。
   * 品牌专区的过滤依赖真实品牌，预览期没有品牌可判，
   * 所以只在已连接时按品牌过滤，未连接时展示全部 —— 让访客知道这个分区存在。
   */
  const tools = useMemo(() => {
    const view = capabilitiesFor(current?.capabilities ?? null);
    return visibleTools(module, view);
  }, [module, current]);

  switch (module) {
    case 'device':
      return <DeviceOverview tools={tools} />;
    case 'apps':
      return <AppsView tools={tools} />;
    case 'battery':
      return <BatteryView tools={tools} />;
    case 'vendor':
      return <VendorView tools={tools} />;
    default:
      return <GenericModule tools={tools} />;
  }
};

/** 通用分区：工具卡片列表 */
const GenericModule: FunctionComponent<{ tools: Tool[] }> = ({ tools }) => {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (tools.length === 0) {
    return (
      <div class="empty">
        <div>当前设备没有可用的功能</div>
        <div style={{ fontSize: '12px' }}>
          这通常是因为系统版本过低，或厂商限制了相关命令
        </div>
      </div>
    );
  }

  return (
    <div class="tool-grid">
      {tools.map((tool) => (
        <ToolCard
          key={tool.id}
          tool={tool}
          expanded={expanded === tool.id}
          onToggle={() => setExpanded(expanded === tool.id ? null : tool.id)}
        />
      ))}
    </div>
  );
};
