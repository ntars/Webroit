/**
 * 品牌徽章：显示当前设备品牌与 ROM 类型。
 *
 * 这个组件看起来可有可无，但它解决的问题很实际 ——
 * 用户在两台设备间切换时，很多功能的可用性是不同的
 * （小米能改分辨率、某些品牌不能），一个常驻的品牌标识
 * 能避免「为什么这个按钮在我另一台手机上能用」的困惑。
 */

import { type FunctionComponent } from 'preact';

import { vendorMeta } from '@/tools/registry';
import { services } from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';

export const BrandBadge: FunctionComponent = () => {
  const current = useSignal(services);
  if (!current) return null;

  const meta = vendorMeta(current.vendor);
  const caps = current.capabilities;

  return (
    <div class="brand-badge">
      <div class="brand-badge__name">{meta?.name ?? caps.brand}</div>
      <div class="brand-badge__rom">{meta?.rom ?? caps.model}</div>
      <div class="brand-badge__android">Android {caps.release}</div>
    </div>
  );
};
