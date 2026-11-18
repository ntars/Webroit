/**
 * `utils.ts` 单元测试。
 *
 * 重点覆盖两类函数：
 * 1. 拼进 shell 命令的校验器（quote / assertPackageName / assertNumber）——
 *    这里放过一个非法值，就等于允许一条注入命令下到设备。
 * 2. 解析器（parseProps / parseDisplay / parseBattery / parseFocus / parseCpuFreq）——
 *    它们吃的是真机原始文本，格式边界比类型系统复杂，只能靠样例守。
 */

import { describe, expect, it } from 'vitest';
import {
  assertCommandSuccess,
  assertInteger,
  assertNumber,
  assertPackageName,
  baseName,
  checkAbort,
  formatBytes,
  formatDuration,
  joinBytes,
  parseBattery,
  parseCpuFreq,
  parseDisplay,
  parseFocus,
  parseProps,
  pickDeviceName,
  quote,
  safeFileName,
  sleep,
  splitArgs,
  timestamp,
  toArrayBuffer,
} from './utils';

describe('quote', () => {
  it('用单引号包裹普通值', () => {
    expect(quote('abc')).toBe("'abc'");
  });

  it("把内部单引号转义成 POSIX 的 '\\'' 形式，避免提前闭合", () => {
    expect(quote("a'b")).toBe("'a'\\''b'");
  });

  it('数字入参先转字符串', () => {
    expect(quote(42)).toBe("'42'");
  });
});

describe('assertPackageName', () => {
  it('接受合法包名并原样返回', () => {
    expect(assertPackageName('com.android.settings')).toBe('com.android.settings');
  });

  it('去掉首尾空白后再校验', () => {
    expect(assertPackageName('  com.foo.bar  ')).toBe('com.foo.bar');
  });

  it('拒绝只有一段的名字', () => {
    expect(() => assertPackageName('settings')).toThrow(/有效的软件包名/);
  });

  it('拒绝带 shell 元字符的注入尝试', () => {
    expect(() => assertPackageName('com.foo;rm -rf /')).toThrow(/有效的软件包名/);
  });

  it('空值报错文案带「空」字样，便于用户看懂', () => {
    expect(() => assertPackageName('')).toThrow(/收到：空/);
  });
});

describe('assertNumber / assertInteger', () => {
  it('接受区间内数值', () => {
    expect(assertNumber('50', 1, 100)).toBe(50);
  });

  it('接受边界值', () => {
    expect(assertNumber('1', 1, 100)).toBe(1);
    expect(assertNumber('100', 1, 100)).toBe(100);
  });

  it('超出区间抛错并回显收到的值', () => {
    expect(() => assertNumber('101', 1, 100, 'DPI')).toThrow(/DPI应在 1 — 100 之间（收到：101）/);
  });

  it('非数字抛错', () => {
    expect(() => assertNumber('abc', 1, 100)).toThrow(/应在/);
  });

  it('空串不当 0 处理', () => {
    expect(() => assertNumber('', 0, 100)).toThrow(/收到：空/);
  });

  it('整数校验拒绝小数', () => {
    expect(() => assertInteger('1.5', 0, 10, '层级')).toThrow(/层级必须是整数/);
  });

  it('整数校验接受整数值', () => {
    expect(assertInteger('7', 0, 10)).toBe(7);
  });
});

describe('safeFileName', () => {
  it('把各平台非法字符替换成下划线', () => {
    expect(safeFileName('a/b:c*d?e')).toBe('a_b_c_d_e');
  });

  it('吃掉控制字符', () => {
    expect(safeFileName('a\u0000b\u001fc')).toBe('a_b_c');
  });

  it('空输入回落到 fallback', () => {
    expect(safeFileName('')).toBe('file');
  });

  it('超长名截到 160 字符', () => {
    expect(safeFileName('x'.repeat(300))).toHaveLength(160);
  });
});

describe('baseName', () => {
  it('取 POSIX 路径最后一段', () => {
    expect(baseName('/sdcard/Download/a.png')).toBe('a.png');
  });

  it('Windows 反斜杠路径同样能切', () => {
    expect(baseName('C:\\Users\\me\\a.txt')).toBe('a.txt');
  });

  it('空路径返回空串', () => {
    expect(baseName('')).toBe('');
  });
});

describe('timestamp', () => {
  it('按 年-月-日_时-分-秒 补零输出', () => {
    const date = new Date(2026, 0, 5, 9, 8, 7);
    expect(timestamp(date)).toBe('2026-01-05_09-08-07');
  });
});

describe('parseProps', () => {
  it('解析 getprop 的 [key]: [value] 行', () => {
    const props = parseProps('[ro.product.model]: [Pixel 7]\n[ro.build.version.sdk]: [34]\n');
    expect(props['ro.product.model']).toBe('Pixel 7');
    expect(props['ro.build.version.sdk']).toBe('34');
  });

  it('忽略不符合格式的行', () => {
    expect(parseProps('noise line\n[ro.a]: [1]')['ro.a']).toBe('1');
  });

  it('空值也记成空串而非丢弃', () => {
    expect(parseProps('[ro.empty]: []')['ro.empty']).toBe('');
  });
});

describe('pickDeviceName', () => {
  it('优先取厂商营销名', () => {
    expect(pickDeviceName({ 'ro.vendor.oplus.market.name': 'OnePlus 13', 'ro.product.model': 'PJZ110' }))
      .toBe('OnePlus 13');
  });

  it('跳过占位值 unknown', () => {
    expect(pickDeviceName({ 'ro.product.marketname': 'unknown', 'ro.product.model': 'A1' })).toBe('A1');
  });

  it('全部缺失时给「未知机型」而非空串', () => {
    expect(pickDeviceName({})).toBe('未知机型');
  });
});

describe('parseDisplay', () => {
  it('只有 Physical 时视为未改过', () => {
    const info = parseDisplay('Physical size: 1080x2400', 'Physical density: 440');
    expect(info.width).toBe(1080);
    expect(info.height).toBe(2400);
    expect(info.dpi).toBe(440);
    expect(info.overridden).toBe(false);
  });

  it('存在 Override 时取最后一组为当前值，Physical 留在 physicalSize', () => {
    const info = parseDisplay(
      'Physical size: 1080x2400\nOverride size: 720x1600',
      'Physical density: 440\nOverride density: 320',
    );
    expect(info.width).toBe(720);
    expect(info.height).toBe(1600);
    expect(info.dpi).toBe(320);
    expect(info.physicalSize).toBe('1080x2400');
    expect(info.physicalDpi).toBe(440);
    expect(info.overridden).toBe(true);
  });

  it('按最短边算 dp：720 × 160 / 320 = 360', () => {
    const info = parseDisplay('Override size: 720x1600', 'Override density: 320');
    expect(info.dp).toBe(360);
  });

  it('输出为空时全部字段为 null，不抛错', () => {
    const info = parseDisplay('', '');
    expect(info.width).toBeNull();
    expect(info.dp).toBeNull();
    expect(info.overridden).toBe(false);
  });
});

describe('parseBattery', () => {
  const raw = [
    'Current Battery Service state:',
    '  AC powered: false',
    '  USB powered: true',
    '  Wireless powered: false',
    '  status: 2',
    '  level: 87',
    '  voltage: 4201',
    '  temperature: 305',
  ].join('\n');

  it('读出电量 / 电压 / 温度并按单位换算', () => {
    const info = parseBattery(raw);
    expect(info.level).toBe(87);
    expect(info.voltage).toBeCloseTo(4.201, 3);
    expect(info.temperature).toBeCloseTo(30.5, 3);
  });

  it('读出来源标记', () => {
    const info = parseBattery(raw);
    expect(info.acPowered).toBe(false);
    expect(info.usbPowered).toBe(true);
    expect(info.wirelessPowered).toBe(false);
  });

  it('识别「电量统计已暂停」', () => {
    expect(parseBattery('level: 50\n  Service state: not charging\n(mUpdatesStopped)').updatesStopped)
      .toBe(false);
    expect(parseBattery('level: 50\nupdates stopped').updatesStopped).toBe(true);
  });

  it('缺字段时对应项为 null', () => {
    const info = parseBattery('level: 12');
    expect(info.voltage).toBeNull();
    expect(info.temperature).toBeNull();
  });
});

describe('parseFocus', () => {
  it('从 mCurrentFocus 抽包名与 Activity', () => {
    const info = parseFocus('  mCurrentFocus=Window{abc u0 com.android.settings/com.android.settings.MainSettings}');
    expect(info.package).toBe('com.android.settings');
    expect(info.activity).toBe('com.android.settings.MainSettings');
  });

  it('Activity 写成 .MainActivity 时补全包名', () => {
    const info = parseFocus('mResumedActivity: ActivityRecord{1 u0 com.foo.bar/.MainActivity t12}');
    expect(info.activity).toBe('com.foo.bar.MainActivity');
  });

  it('无匹配行时返回空串，不返回 undefined', () => {
    expect(parseFocus('nothing here')).toEqual({ package: '', activity: '' });
  });
});

describe('parseCpuFreq', () => {
  it('解析每核频率并换算成 MHz，按核号排序', () => {
    const cores = parseCpuFreq('2:2400000\n0:1800000\n1:1800000');
    expect(cores).toEqual([
      { id: 0, mhz: 1800 },
      { id: 1, mhz: 1800 },
      { id: 2, mhz: 2400 },
    ]);
  });

  it('忽略无法解析的行', () => {
    expect(parseCpuFreq('garbage\n0:1000000')).toHaveLength(1);
  });
});

describe('formatDuration', () => {
  it('拆成天/时/分', () => {
    expect(formatDuration(90061)).toBe('1天1时1分');
  });

  it('负数按 0 处理', () => {
    expect(formatDuration(-5)).toBe('0天0时0分');
  });
});

describe('formatBytes', () => {
  it('小于 10 保留一位小数', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('大于等于 10 取整', () => {
    expect(formatBytes(20 * 1024)).toBe('20 KB');
  });

  it('0 显示 0.0 B', () => {
    expect(formatBytes(0)).toBe('0.0 B');
  });
});

describe('toArrayBuffer / joinBytes', () => {
  it('拷贝出独立 ArrayBuffer，内容一致', () => {
    const source = new Uint8Array([1, 2, 3]);
    const buffer = toArrayBuffer(source);
    expect(buffer.byteLength).toBe(3);
    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3]);
    // 必须是拷贝而非共享视图：改源不影响结果
    source[0] = 9;
    expect(new Uint8Array(buffer)[0]).toBe(1);
  });

  it('多段拼接保持顺序', () => {
    const merged = joinBytes([new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3])]);
    expect([...merged]).toEqual([1, 2, 3]);
  });

  it('空数组拼出空块', () => {
    expect(joinBytes([]).length).toBe(0);
  });
});

describe('splitArgs', () => {
  it('按空白切分', () => {
    expect(splitArgs('pm list packages -3')).toEqual(['pm', 'list', 'packages', '-3']);
  });

  it('保留双引号内的空格', () => {
    expect(splitArgs('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  it('保留单引号内的空格', () => {
    expect(splitArgs("echo 'a b' c")).toEqual(['echo', 'a b', 'c']);
  });

  it('空引号产生空参数而不是被丢弃', () => {
    expect(splitArgs('a "" b')).toEqual(['a', '', 'b']);
  });

  it('引号未闭合时抛错，不拼出半截命令', () => {
    expect(() => splitArgs('echo "abc')).toThrow(/引号未闭合/);
  });

  it('连续空白不产生空参数', () => {
    expect(splitArgs('  a   b  ')).toEqual(['a', 'b']);
  });
});

describe('assertCommandSuccess', () => {
  it('Success 原样返回', () => {
    expect(assertCommandSuccess('Success')).toBe('Success');
  });

  it('Failure 行视为失败并抛出原文', () => {
    expect(() => assertCommandSuccess('Failure [INSTALL_FAILED_ALREADY_EXISTS]')).toThrow(
      /INSTALL_FAILED_ALREADY_EXISTS/,
    );
  });

  it('Permission denied 视为失败', () => {
    expect(() => assertCommandSuccess('java.lang.SecurityException: Permission denied')).toThrow();
  });

  it('普通输出不误判', () => {
    expect(assertCommandSuccess('package:com.foo')).toBe('package:com.foo');
  });
});

describe('sleep / checkAbort', () => {
  it('已中止的 signal 直接拒绝', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(10, controller.signal)).rejects.toThrow();
  });

  it('等待期间中止会立刻拒绝，不必等满时长', async () => {
    const controller = new AbortController();
    const promise = sleep(10_000, controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow();
  });

  it('无 signal 时正常等到点', async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
  });

  it('checkAbort 在已中止时抛错', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => checkAbort(controller.signal)).toThrow();
  });

  it('checkAbort 无 signal 或未中止时静默通过', () => {
    expect(() => checkAbort(undefined)).not.toThrow();
    expect(() => checkAbort(new AbortController().signal)).not.toThrow();
  });
});
