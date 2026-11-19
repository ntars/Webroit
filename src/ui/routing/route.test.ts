/**
 * 路由判定测试。
 *
 * 重心是「进得去也出得来」这一条：入口有 hash 与查询串两种写法，
 * 退出必须两处同时清干净。上一版的缺陷正是「清了 hash、忘了查询串」——
 * 地址栏看着变了，判定条件依然成立，用户被永久留在逃生页。
 */

import { describe, expect, it } from 'vitest';

import {
  EMERGENCY_FLAG,
  EMERGENCY_HASH,
  appUrl,
  routeOf,
  withoutEmergencyFlag,
} from '@/ui/routing/route';

describe('routeOf', () => {
  it('两种入口都判为应急页', () => {
    expect(routeOf(EMERGENCY_HASH, '')).toBe('emergency');
    expect(routeOf('', `?${EMERGENCY_FLAG}`)).toBe('emergency');
    expect(routeOf('', `?${EMERGENCY_FLAG}=1`)).toBe('emergency');
  });

  it('普通地址判为正常界面', () => {
    expect(routeOf('', '')).toBe('app');
    expect(routeOf('#/files', '')).toBe('app');
    // 参数值里出现同名字样不该误判，只看键
    expect(routeOf('', '?q=reset-display')).toBe('app');
  });

  it('hash 必须完全相等才算，前缀不算', () => {
    // `#/reset-display-x` 不是这个路由；宽松匹配会让新增路由被吞掉
    expect(routeOf('#/reset-display-x', '')).toBe('app');
    expect(routeOf('#/reset-display/', '')).toBe('app');
  });
});

describe('withoutEmergencyFlag', () => {
  it('去掉标记后返回空串', () => {
    expect(withoutEmergencyFlag(`?${EMERGENCY_FLAG}`)).toBe('');
  });

  it('保留其余参数', () => {
    expect(withoutEmergencyFlag(`?module=files&${EMERGENCY_FLAG}`)).toBe('?module=files');
    expect(withoutEmergencyFlag(`?${EMERGENCY_FLAG}&module=files`)).toBe('?module=files');
  });

  it('本来就没有标记时原样返回', () => {
    expect(withoutEmergencyFlag('?module=files')).toBe('?module=files');
    expect(withoutEmergencyFlag('')).toBe('');
  });
});

describe('appUrl', () => {
  it('查询串入口退出后不再被判为应急页', () => {
    // 这条就是本轮修的缺陷：只清 hash 时下面这个断言会失败
    const url = appUrl('/', '?reset-display', '');
    expect(routeOf('', new URL(`http://x${url}`).search)).toBe('app');
  });

  it('hash 入口退出后不再被判为应急页', () => {
    const url = appUrl('/', '', EMERGENCY_HASH);
    expect(routeOf(new URL(`http://x${url}`).hash, '')).toBe('app');
  });

  it('两种入口叠加时一并清掉', () => {
    const url = appUrl('/', '?reset-display', EMERGENCY_HASH);
    expect(url).toBe('/');
  });

  it('退出后回到根路径，不留空查询串的垃圾 `?`', () => {
    expect(appUrl('/', '?reset-display', '')).toBe('/');
  });

  it('保留子路径与其余参数', () => {
    // 部署在 GitHub Pages 子目录时 pathname 不是 `/`，不能被写死成根
    expect(appUrl('/webroit/', '?reset-display&module=files', '')).toBe('/webroit/?module=files');
  });
});
