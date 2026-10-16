import type { NineSliceInsets } from '../types';

const MARKER = /@9slice\{([^}]*)\}/i;

export interface NineSliceParseResult {
  value?: NineSliceInsets;
  error?: string;
}

export function parseNineSlice(name: string, width?: number, height?: number): NineSliceParseResult {
  const marker = MARKER.exec(name);
  if (!marker) {
    return {};
  }
  const values: Record<string, number> = {};
  for (const part of marker[1].split(',')) {
    const [rawKey, rawValue] = part.split(':').map((item) => item.trim());
    if (!rawKey || rawValue === undefined || !['l', 'r', 't', 'b'].includes(rawKey.toLowerCase())) {
      return { error: `九宫格参数格式错误：${marker[0]}` };
    }
    if (rawValue === '') {
      return { error: `九宫格边距不能为空：${part}` };
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) {
      return { error: `九宫格边距必须是非负数：${part}` };
    }
    values[rawKey.toLowerCase()] = value;
  }
  if (!['l', 'r', 't', 'b'].every((key) => key in values)) {
    return { error: '九宫格必须显式提供 l、r、t、b 四个边距' };
  }
  if (width !== undefined && values.l + values.r > width) {
    return { error: '九宫格左右边距超过图片宽度' };
  }
  if (height !== undefined && values.t + values.b > height) {
    return { error: '九宫格上下边距超过图片高度' };
  }
  return { value: { left: values.l, right: values.r, top: values.t, bottom: values.b } };
}

export function stripNineSliceMarker(name: string): string {
  return name.replace(MARKER, '').trim();
}
