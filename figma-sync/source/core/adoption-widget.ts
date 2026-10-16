import type { AdoptionConstraints } from '../types';

export interface CocosWidgetSnapshot {
  enabled: boolean;
  targetIsParent: boolean;
  alignLeft: boolean;
  alignRight: boolean;
  alignTop: boolean;
  alignBottom: boolean;
  alignHorizontalCenter: boolean;
  alignVerticalCenter: boolean;
  absoluteLeft: boolean;
  absoluteRight: boolean;
  absoluteTop: boolean;
  absoluteBottom: boolean;
  absoluteHorizontalCenter: boolean;
  absoluteVerticalCenter: boolean;
}

export interface WidgetConstraintResult {
  constraints?: AdoptionConstraints;
  reason?: string;
}

function horizontalConstraint(source: CocosWidgetSnapshot): AdoptionConstraints['horizontal'] | string {
  if (source.alignHorizontalCenter && (source.alignLeft || source.alignRight)) return '水平中心与左右边约束同时启用';
  if (source.alignLeft && source.alignRight) {
    if (source.absoluteLeft === source.absoluteRight) return source.absoluteLeft ? 'STRETCH' : 'SCALE';
    return '左右边混用了像素与百分比单位';
  }
  if (source.alignLeft) return source.absoluteLeft ? 'MIN' : '单边百分比左约束无法映射';
  if (source.alignRight) return source.absoluteRight ? 'MAX' : '单边百分比右约束无法映射';
  if (source.alignHorizontalCenter) return source.absoluteHorizontalCenter ? 'CENTER' : '百分比水平中心无法映射';
  return 'MIN';
}

function verticalConstraint(source: CocosWidgetSnapshot): AdoptionConstraints['vertical'] | string {
  if (source.alignVerticalCenter && (source.alignTop || source.alignBottom)) return '垂直中心与上下边约束同时启用';
  if (source.alignTop && source.alignBottom) {
    if (source.absoluteTop === source.absoluteBottom) return source.absoluteTop ? 'STRETCH' : 'SCALE';
    return '上下边混用了像素与百分比单位';
  }
  if (source.alignTop) return source.absoluteTop ? 'MIN' : '单边百分比上约束无法映射';
  if (source.alignBottom) return source.absoluteBottom ? 'MAX' : '单边百分比下约束无法映射';
  if (source.alignVerticalCenter) return source.absoluteVerticalCenter ? 'CENTER' : '百分比垂直中心无法映射';
  return 'MIN';
}

export function cocosWidgetToFigma(source: CocosWidgetSnapshot): WidgetConstraintResult {
  if (!source.enabled) return {};
  if (!source.targetIsParent) return { reason: 'Widget target 不是直接父节点' };
  const horizontal = horizontalConstraint(source);
  const vertical = verticalConstraint(source);
  const validHorizontal = ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE'].includes(horizontal);
  const validVertical = ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE'].includes(vertical);
  if (!validHorizontal || !validVertical) {
    return { reason: [validHorizontal ? '' : horizontal, validVertical ? '' : vertical].filter(Boolean).join('；') };
  }
  return {
    constraints: {
      horizontal: horizontal as AdoptionConstraints['horizontal'],
      vertical: vertical as AdoptionConstraints['vertical'],
    },
  };
}
